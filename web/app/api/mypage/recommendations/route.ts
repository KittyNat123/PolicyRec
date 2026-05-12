import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getQueryEmbedding } from "@/lib/gemini";
import { recruitmentStatus } from "@/lib/utils";

export const dynamic = "force-dynamic";

type UserInfoRow = {
  regions: string[] | null;
  categories: string[] | null;
  age_group: string | null;
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

type RecommendationSearchResult = {
  rows: HybridMatchRow[];
  warning: string | null;
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

function pickAnnouncementText(source: ScrapAnnouncementRow | ScrapAnnouncementRow[] | null) {
  if (Array.isArray(source)) return source[0]?.title ?? null;
  return source?.title ?? null;
}

async function findRecommendationMatches(
  queryText: string,
  rpcBaseParams: {
    match_threshold: number;
    match_count: number;
    filter_category: string | null;
    filter_region: string | null;
    user_age: number | null;
  }
): Promise<RecommendationSearchResult> {
  try {
    const queryEmbedding = await getQueryEmbedding(queryText);
    const hybridResult = await supabase.rpc("match_announcements_hybrid", {
      ...rpcBaseParams,
      query_embedding: queryEmbedding,
    });

    if (!hybridResult.error) {
      return {
        rows: (hybridResult.data ?? []) as HybridMatchRow[],
        warning: null,
      };
    }

    // ☑️수정: hybrid RPC 실패 시 구 RPC로 한 번 더 내려가 홈 추천 카드 500을 방지
    console.warn(
      "[/api/mypage/recommendations] hybrid RPC fallback:",
      hybridResult.error.message
    );
    const basicResult = await supabase.rpc("match_announcements", {
      query_embedding: queryEmbedding,
      match_threshold: rpcBaseParams.match_threshold,
      match_count: rpcBaseParams.match_count,
    });

    if (basicResult.error) {
      return {
        rows: [],
        warning: basicResult.error.message,
      };
    }

    return {
      rows: (basicResult.data ?? []) as HybridMatchRow[],
      warning: hybridResult.error.message,
    };
  } catch (error) {
    // ☑️수정: Gemini 임베딩 등 추천 생성 실패가 API 전체 500으로 번지지 않게 정상 응답으로 degrade
    const message =
      error instanceof Error ? error.message : "recommendation search failed";
    console.warn(
      "[/api/mypage/recommendations] recommendation search skipped:",
      message
    );
    return {
      rows: [],
      warning: message,
    };
  }
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    const { data: userInfo, error: userInfoError } = await supabase
      .from("user_info")
      .select("regions, categories, age_group")
      .eq("login_id", loginId)
      .maybeSingle();

    if (userInfoError) {
      return NextResponse.json({ error: userInfoError.message }, { status: 500 });
    }

    const typedUserInfo = (userInfo ?? null) as UserInfoRow | null;
    const region = typedUserInfo?.regions?.[0] ?? null;
    const category = typedUserInfo?.categories?.[0] ?? null;
    const age = typedUserInfo?.age_group ? Number.parseInt(typedUserInfo.age_group, 10) : null;
    const profileReady = Boolean(region && category && Number.isInteger(age));

    const { data: scraps, error: scrapError } = await supabase
      .from("scraps")
      .select(`
        ann_id,
        announcements ( title, summary )
      `)
      .eq("login_id", loginId)
      .order("created_dt", { ascending: false })
      .limit(5);

    if (scrapError) {
      return NextResponse.json({ error: scrapError.message }, { status: 500 });
    }

    const typedScraps = (scraps ?? []) as ScrapRow[];
    const scrappedIds = new Set(typedScraps.map((item) => item.ann_id));
    const scrapTitles = typedScraps
      .map((item) => pickAnnouncementText(item.announcements))
      .filter((title): title is string => Boolean(title))
      .join(", ");
    const scrapReady = scrapTitles.length > 0;

    if (!profileReady && !scrapReady) {
      return NextResponse.json({
        recommendations: [],
        profile_ready: false,
        scrap_ready: false,
      });
    }

    const rpcBaseParams = {
      match_threshold: 0.1,
      match_count: 50,
      filter_category: profileReady ? category : null,
      filter_region: profileReady ? region : null,
      user_age: profileReady ? age : null,
    };

    const recommendationIds: number[] = [];
    const reasonMap = new Map<number, string>();
    const warnings: string[] = [];

    if (profileReady) {
      const profileQueryText = `지역: ${region}, 나이: ${age}세, 관심 분야: ${category}. 이 조건에 잘 맞는 지원 공고를 추천해주세요.`;
      const profileSearch = await findRecommendationMatches(profileQueryText, rpcBaseParams);
      if (profileSearch.warning) warnings.push(`profile: ${profileSearch.warning}`);

      for (const row of profileSearch.rows) {
        if (!scrappedIds.has(row.id) && !recommendationIds.includes(row.id)) {
          recommendationIds.push(row.id);
          reasonMap.set(row.id, `${region}, ${category}, ${age}세 조건에 맞춰 고른 공고예요.`);
          break;
        }
      }
    }

    if (scrapReady) {
      const scrapQueryText = `최근 스크랩한 정책과 의미적으로 비슷한 공고를 추천해주세요. ${scrapTitles}`;
      const scrapSearch = await findRecommendationMatches(scrapQueryText, rpcBaseParams);
      if (scrapSearch.warning) warnings.push(`scrap: ${scrapSearch.warning}`);

      for (const row of scrapSearch.rows) {
        if (!scrappedIds.has(row.id) && !recommendationIds.includes(row.id)) {
          recommendationIds.push(row.id);
          reasonMap.set(row.id, "최근 스크랩한 정책과 비슷한 흐름의 공고예요.");
          break;
        }
      }
    }

    if (recommendationIds.length === 0) {
      return NextResponse.json({
        recommendations: [],
        profile_ready: profileReady,
        scrap_ready: scrapReady,
        recommendation_warnings: warnings,
      });
    }

    const { data: recommendations, error: recommendationError } = await supabase
      .from("announcements")
      .select("id, title, summary, s_category, region, apply_end_dt, detail_url")
      .in("id", recommendationIds);

    if (recommendationError) {
      return NextResponse.json({ error: recommendationError.message }, { status: 500 });
    }

    const typedRecommendations = (recommendations ?? []) as RecommendationRow[];
    const formatted = recommendationIds
      .map((id) => typedRecommendations.find((item) => item.id === id))
      .filter((item): item is RecommendationRow => Boolean(item))
      .map((item) => ({
        ...item,
        status: recruitmentStatus(null, item.apply_end_dt),
        reason: reasonMap.get(item.id) ?? "맞춤 추천 공고예요.",
      }));

    return NextResponse.json({
      recommendations: formatted,
      profile_ready: profileReady,
      scrap_ready: scrapReady,
      recommendation_warnings: warnings,
    });
  } catch (error) {
    console.error("Recommendations API error:", error);
    return NextResponse.json(
      { error: "추천 정보를 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
