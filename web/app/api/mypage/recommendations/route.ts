import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getQueryEmbedding } from "@/lib/gemini";
import { recruitmentStatus } from "@/lib/utils";
import fs from 'fs';
import path from 'path';

// ==========================================
// [설정] 파일 로깅 활성화 여부 플래그 -  개빌시에만 True 설정.
// True 설정시 data/log에 맞춤정보추천 가중치 계산 로그 기록.
// ==========================================
const ENABLE_FILE_LOGGING = false;

function appendRecommendationLog(loginId: string, context: any, profileResults: any[], scrapResults: any[]) {
  if (!ENABLE_FILE_LOGGING) return;

  try {
    const now = new Date();
    // 한국 시간(KST) 기준으로 날짜 포맷팅 (YYYY-MM-DD)
    const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dateString = kstDate.toISOString().split('T')[0];

    // AI_agent/data/log 폴더 경로 설정 (web 디렉토리의 한 단계 위)
    const logDir = path.join(process.cwd(), '..', 'data', 'log');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const filePath = path.join(logDir, `${dateString}_log.log`);

    const logEntry = {
      timestamp: now.toISOString(),
      type: "RECOMMENDATION",
      login_id: loginId,
      context: context,
      profile_top_10: profileResults.slice(0, 10).map((item, idx) => ({
        rank: idx + 1,
        id: item.id,
        title: item.title,
        total_score: Number(item.totalScore.toFixed(4)),
        details: {
          region: Number(((item.regionScore || 0) * 0.4).toFixed(4)),
          type: Number(((item.typeScore || 0) * 0.15).toFixed(4)),
          category: Number(((item.categoryScore || 0) * 0.15).toFixed(4)),
          similarity: Number(((item.similarityScore || 0) * 0.3).toFixed(4))
        }
      })),
      scrap_top_10: scrapResults.slice(0, 10).map((item, idx) => ({
        rank: idx + 1,
        id: item.id,
        title: item.title,
        total_score: Number(item.totalScore.toFixed(4)),
        details: {
          category: Number(((item.categoryScore || 0) * 0.4).toFixed(4)),
          region: Number(((item.regionScore || 0) * 0.3).toFixed(4)),
          support: Number(((item.supportTypeScore || 0) * 0.2).toFixed(4)),
          similarity: Number(((item.similarityScore || 0) * 0.1).toFixed(4))
        }
      }))
    };

    // 보기 편하게 예쁘게 포맷팅하여 저장
    const logHeader = `[${now.toISOString()}] ${loginId} - RECOMMENDATION LOG\n`;
    const logContent = JSON.stringify(logEntry, null, 2);
    const separator = `\n${"=".repeat(80)}\n\n`;

    fs.appendFileSync(filePath, logHeader + logContent + separator, 'utf8');
  } catch (err) {
    console.error("로그 파일 저장 실패:", err);
  }
}

export const dynamic = "force-dynamic";

type UserInfoRow = {
  regions: string[] | null;
  categories: string[] | null;
  age_group: string | null;
  user_type: string | null;
};

type ScrapAnnouncementRow = {
  title: string | null;
  summary: string | null;
};

type ScrapRow = {
  ann_id: number;
  announcements: ScrapAnnouncementRow | ScrapAnnouncementRow[] | null;
};

type HybridMatchRow = {
  id: number;
};

type RecommendationRow = {
  id: number;
  title: string;
  summary: string | null;
  s_category: string | null;
  region: string | null;
  apply_end_dt: string | null;
  detail_url: string;
};

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    // 1. 내 정보 가져오기
    const { data: userInfo } = await supabase
      .from("user_info")
      .select("regions, categories, age_group, user_type")
      .eq("login_id", loginId)
      .maybeSingle();
    const typedUserInfo = userInfo as UserInfoRow | null;

    const userRegion = typedUserInfo?.regions?.[0] || null;
    const userCategory = typedUserInfo?.categories?.[0] || null;
    const userAge = typedUserInfo?.age_group ? parseInt(typedUserInfo.age_group, 10) : null;
    const userType = typedUserInfo?.user_type || "일반";

    // 2. 스크랩 이력 가져오기 (최근 5건)
    const { data: scraps } = await supabase
      .from("scraps")
      .select(`
        ann_id,
        announcements ( title, summary, support_type, s_category, region )
      `)
      .eq("login_id", loginId)
      .order("created_dt", { ascending: false })
      .limit(5);

    const typedScraps = (scraps ?? []) as any[];
    const scrappedIds = new Set(typedScraps.map((s) => s.ann_id));
    const scrapTitles = typedScraps
      .map((s) =>
        Array.isArray(s.announcements)
          ? s.announcements[0]?.title ?? null
          : s.announcements?.title ?? null
      )
      .filter((title): title is string => Boolean(title))
      .join(", ");

    // 사용자가 선호하는 데이터 분석 (스크랩 기준)
    const scrapStats = {
      categories: {} as Record<string, number>,
      regions: {} as Record<string, number>,
      supportTypes: new Set<string>(),
      total: typedScraps.length
    };

    typedScraps.forEach(s => {
      const ann = Array.isArray(s.announcements) ? s.announcements[0] : s.announcements;
      if (!ann) return;
      if (ann.s_category) scrapStats.categories[ann.s_category] = (scrapStats.categories[ann.s_category] || 0) + 1;
      if (ann.region) scrapStats.regions[ann.region] = (scrapStats.regions[ann.region] || 0) + 1;
      if (ann.support_type) scrapStats.supportTypes.add(ann.support_type);
    });

    // 3. 임베딩 생성 (병렬)
    const profileQueryText = `나이: ${userAge || '미상'}세, 지역: ${userRegion || '무관'}, 분야: ${userCategory || '무관'}, 사용자 유형: ${userType}.`;
    const hasScraps = scrapTitles.length > 0;
    const scrapQueryText = hasScraps ? `다음 정책들과 유사한 공고: ${scrapTitles}` : "";

    const [profileEmb, scrapEmb] = await Promise.all([
      getQueryEmbedding(profileQueryText),
      hasScraps ? getQueryEmbedding(scrapQueryText) : Promise.resolve(null)
    ]);

    // 4. 리트리벌: 필터 없이 대량(50건) 가져오기
    const [profileResults, scrapResults] = await Promise.all([
      supabase.rpc("retrieve_only_announcements", { query_embedding: profileEmb, match_count: 50 }),
      scrapEmb ? supabase.rpc("retrieve_only_announcements", { query_embedding: scrapEmb, match_count: 50 }) : Promise.resolve({ data: [], error: null })
    ]);

    if (profileResults.error || scrapResults.error) {
      console.error("Retrieval error:", profileResults.error || scrapResults.error);
      return NextResponse.json({ error: "검색 중 오류가 발생했습니다." }, { status: 500 });
    }

    const profileCandidates = (profileResults.data ?? []) as any[];
    const scrapCandidates = (scrapResults.data ?? []) as any[];

    // 5. 리랭킹 (Reranking)

    // [프로필 기반 가중치 계산] - 기존 로직 유지 (지역40, 유형15, 분야15, 유사도30)
    const rerankedProfile = profileCandidates
      .filter(row => !scrappedIds.has(row.id))
      .map(row => {
        let regionScore = 0;
        if (userRegion && row.region === userRegion) regionScore = 1.0;
        else if (row.region === "전국") regionScore = 0.5;

        const isTypeMatch = (row.target_group?.includes(userType) || row.target_tags?.includes(userType));
        const typeScore = isTypeMatch ? 1.0 : 0;

        const isCategoryMatch = (userCategory && row.s_category === userCategory);
        const categoryScore = isCategoryMatch ? 1.0 : 0;

        const similarityScore = row.similarity;

        const totalScore = (regionScore * 0.4) + (typeScore * 0.15) + (categoryScore * 0.15) + (similarityScore * 0.3);
        return { ...row, regionScore, typeScore, categoryScore, similarityScore, totalScore };
      })
      .sort((a, b) => b.totalScore - a.totalScore);

    // [스크랩 기반 가중치 계산] - 신규 로직 적용 (분야40, 지역30, 지원유형20, 벡터10)
    const rerankedScrap = scrapCandidates
      .filter(row => !scrappedIds.has(row.id))
      .map(row => {
        // 1) 분야 선호도 (40%)
        const catFreq = scrapStats.categories[row.s_category] || 0;
        const categoryScore = scrapStats.total > 0 ? (catFreq / scrapStats.total) : 0;

        // 2) 지역 선호도 (30%)
        const regFreq = scrapStats.regions[row.region] || 0;
        const regionScore = scrapStats.total > 0 ? (regFreq / scrapStats.total) : 0;

        // 3) 지원 유형 선호도 (20%)
        const supportTypeScore = scrapStats.supportTypes.has(row.support_type) ? 1.0 : 0;

        // 4) 벡터 유사도 (10%)
        const similarityScore = row.similarity;

        const totalScore = (categoryScore * 0.4) + (regionScore * 0.3) + (supportTypeScore * 0.2) + (similarityScore * 0.1);
        return { ...row, categoryScore, regionScore, supportTypeScore, similarityScore, totalScore };
      })
      .sort((a, b) => b.totalScore - a.totalScore);

    // 6. 최종 결과 조합 (스크랩 기반 1건 + 프로필 기반 1~2건)
    const finalSelection: any[] = [];
    const usedIds = new Set<number>();

    // 스크랩 기반 우선 (1건)
    if (rerankedScrap.length > 0) {
      const topScrap = rerankedScrap[0];
      finalSelection.push({
        ...topScrap,
        reason: "기존 스크랩 이력을 분석하여 선호하시는 지원 유형의 정책을 추천합니다.",
        status: recruitmentStatus(null, topScrap.apply_end_dt)
      });
      usedIds.add(topScrap.id);
    }

    // 프로필 기반 (스크랩 있으면 1건, 없으면 2건)
    const profileCountNeeded = hasScraps ? 1 : 2;
    let addedCount = 0;
    for (const item of rerankedProfile) {
      if (!usedIds.has(item.id)) {
        finalSelection.push({
          ...item,
          reason: `사용자님의 프로필(${userType}, ${userRegion || '지역무관'})과 관심 분야에 최적화된 정책입니다.`,
          status: recruitmentStatus(null, item.apply_end_dt)
        });
        usedIds.add(item.id);
        addedCount++;
        if (addedCount >= profileCountNeeded) break;
      }
    }

    // 파일 시스템 로깅 수행
    appendRecommendationLog(
      loginId,
      { userAge, userRegion, userCategory, userType, hasScraps },
      rerankedProfile,
      rerankedScrap
    );

    return NextResponse.json({ recommendations: finalSelection });

  } catch (error) {
    console.error("Recommendations API error:", error);
    return NextResponse.json({ error: "서버 내부 오류가 발생했습니다." }, { status: 500 });
  }
}
