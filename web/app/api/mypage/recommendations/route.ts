import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getQueryEmbedding } from "@/lib/gemini";
import { recruitmentStatus } from "@/lib/utils";

export const dynamic = "force-dynamic";

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

    const region = userInfo?.regions?.[0] || null;
    const category = userInfo?.categories?.[0] || null;
    const age = userInfo?.age_group ? parseInt(userInfo.age_group, 10) : null;
    const userType = userInfo?.user_type || "알 수 없음";

    // 2. 스크랩 이력 가져오기 (최대 5건)
    const { data: scraps } = await supabase
      .from("scraps")
      .select(`
        ann_id,
        announcements ( title, summary )
      `)
      .eq("login_id", loginId)
      .order("created_dt", { ascending: false })
      .limit(5);

    const scrappedIds = new Set((scraps || []).map((s: any) => s.ann_id));
    const scrapTitles = (scraps || [])
      .map((s: any) => s.announcements?.title)
      .filter(Boolean)
      .join(", ");

    // 3. 두 가지 개별 쿼리 텍스트 준비
    const profileQueryText = `나이: ${age || '미상'}세, 지역: ${region || '무관'}, 분야: ${category || '무관'}, 사용자 유형: ${userType}. 이 사용자에게 적합한 지원 정책을 추천해주세요.`;
    const hasScraps = scrapTitles.length > 0;
    const scrapQueryText = hasScraps 
      ? `다음 정책들과 유사한 공고를 찾아주세요: ${scrapTitles}`
      : "";

    // 4. 임베딩 및 하이브리드 검색 실행 (병렬)
    const [profileEmb, scrapEmb] = await Promise.all([
      getQueryEmbedding(profileQueryText),
      hasScraps ? getQueryEmbedding(scrapQueryText) : Promise.resolve(null)
    ]);

    const rpcParams = {
      match_threshold: 0.1,
      match_count: 10,
      filter_category: category !== "전체" ? category : null,
      filter_region: region !== "전체" ? region : null,
      user_age: age,
    };

    const [profileRes, scrapRes] = await Promise.all([
      supabase.rpc("match_announcements_hybrid", { ...rpcParams, query_embedding: profileEmb }),
      scrapEmb ? supabase.rpc("match_announcements_hybrid", { ...rpcParams, query_embedding: scrapEmb }) : Promise.resolve({ data: [], error: null })
    ]);

    if (profileRes.error || scrapRes.error) {
      console.error("Hybrid search error:", profileRes.error || scrapRes.error);
      return NextResponse.json({ error: "추천 검색 중 오류가 발생했습니다." }, { status: 500 });
    }

    // 5. 추천 항목 선별 (이미 스크랩한 건 제외, 중복 제외)
    const recommendedIds: number[] = [];
    const reasonMap = new Map<number, string>();

    // 스크랩 기반 1순위 (있을 경우 1건)
    const scrapRows = (scrapRes.data || []) as any[];
    for (const row of scrapRows) {
      if (!scrappedIds.has(row.id)) {
        recommendedIds.push(row.id);
        reasonMap.set(row.id, "기존에 스크랩하신 공고들과 유사한 맞춤형 정책입니다.");
        break; // 1건만
      }
    }

    // 내 정보 기반 2순위 (스크랩 기반이 있으면 1건, 없으면 2건)
    const targetProfileCount = hasScraps ? 1 : 2;
    let addedProfileCount = 0;
    const profileRows = (profileRes.data || []) as any[];
    
    for (const row of profileRows) {
      if (!scrappedIds.has(row.id) && !recommendedIds.includes(row.id)) {
        recommendedIds.push(row.id);
        reasonMap.set(row.id, `입력하신 프로필(${userType}, ${region || '지역무관'})에 적합한 추천 정책입니다.`);
        addedProfileCount++;
        if (addedProfileCount >= targetProfileCount) break;
      }
    }

    if (recommendedIds.length === 0) {
      return NextResponse.json({ recommendations: [] });
    }

    // 6. 추천 공고 상세 정보 조회
    const { data: recommendations, error: recError } = await supabase
      .from("announcements")
      .select("id, title, summary, s_category, region, apply_end_dt, detail_url")
      .in("id", recommendedIds);

    if (recError) {
      console.error("Fetch recommendations error:", recError);
      return NextResponse.json({ error: "공고 상세 정보 조회 실패" }, { status: 500 });
    }

    // 모집 여부 등 추가 정보 가공 및 순서 유지(recommendedIds 순서대로)
    const formattedRecs = recommendedIds
      .map(id => recommendations?.find((r: any) => r.id === id))
      .filter(Boolean)
      .map((rec: any) => {
        return {
          ...rec,
          status: recruitmentStatus(null, rec.apply_end_dt),
          reason: reasonMap.get(rec.id) || "추천 공고입니다."
        };
      });

    return NextResponse.json({ recommendations: formattedRecs });

  } catch (error) {
    console.error("Recommendations API error:", error);
    return NextResponse.json({ error: "서버 내부 오류가 발생했습니다." }, { status: 500 });
  }
}
