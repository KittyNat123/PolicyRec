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
  user_type: string | null;
};

type ScrapAnnouncementRow = {
  title: string | null;
  summary: string | null;
  s_category: string | null;
  region: string | null;
  support_type: string | null;
};

type ScrapRow = {
  ann_id: number;
  announcements: ScrapAnnouncementRow | ScrapAnnouncementRow[] | null;
};

type HybridMatchRow = {
  id: number;
  s_category?: string | null;
  region?: string | null;
  target_group?: string | null;
  target_tags?: string[] | null;
  support_type?: string | null;
  similarity?: number | null;
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

type ScrapPreferenceStats = {
  categories: Record<string, number>;
  regions: Record<string, number>;
  supportTypes: Set<string>;
  total: number;
};

const DEBUG_RECOMMENDATION_RANKING = process.env.NODE_ENV === "development";

// ☑️수정: 추천 품질 튜닝 포인트. 비중만 바꾸면 profile/scrap reranking 성향을 조정할 수 있다.
const PROFILE_SCORE_WEIGHTS = {
  region: 0.4,
  userType: 0.15,
  category: 0.15,
  similarity: 0.3,
} as const;

const SCRAP_SCORE_WEIGHTS = {
  category: 0.4,
  region: 0.3,
  supportType: 0.2,
  similarity: 0.1,
} as const;

function pickAnnouncementText(source: ScrapAnnouncementRow | ScrapAnnouncementRow[] | null) {
  if (Array.isArray(source)) return source[0]?.title ?? null;
  return source?.title ?? null;
}

function pickAnnouncement(source: ScrapAnnouncementRow | ScrapAnnouncementRow[] | null) {
  if (Array.isArray(source)) return source[0] ?? null;
  return source;
}

function incrementCount(map: Record<string, number>, key: string | null | undefined) {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

function buildScrapPreferenceStats(scraps: ScrapRow[]): ScrapPreferenceStats {
  const stats: ScrapPreferenceStats = {
    categories: {},
    regions: {},
    supportTypes: new Set<string>(),
    total: 0,
  };

  for (const scrap of scraps) {
    const announcement = pickAnnouncement(scrap.announcements);
    if (!announcement) continue;

    stats.total += 1;
    incrementCount(stats.categories, announcement.s_category);
    incrementCount(stats.regions, announcement.region);
    if (announcement.support_type) stats.supportTypes.add(announcement.support_type);
  }

  return stats;
}

function roundScore(value: number) {
  return Number(value.toFixed(4));
}

function rankProfileMatches(
  rows: HybridMatchRow[],
  context: {
    scrappedIds: Set<number>;
    selectedIds: number[];
    region: string | null;
    category: string | null;
    userType: string | null;
  }
) {
  const ranked = rows
    .filter((row) => !context.scrappedIds.has(row.id) && !context.selectedIds.includes(row.id))
    .map((row, index) => {
      // ☑️수정: profile reranking 점수 구조
      // region 40% + user_type 15% + category 15% + vector similarity 30%
      const regionScore =
        context.region && row.region === context.region ? 1 : row.region === "전국" ? 0.5 : 0;
      const categoryScore = context.category && row.s_category === context.category ? 1 : 0;
      const typeScore =
        context.userType &&
        (row.target_group?.includes(context.userType) ||
          row.target_tags?.includes(context.userType))
          ? 1
          : 0;
      const similarityScore = Number(row.similarity ?? 0);
      const totalScore =
        regionScore * PROFILE_SCORE_WEIGHTS.region +
        typeScore * PROFILE_SCORE_WEIGHTS.userType +
        categoryScore * PROFILE_SCORE_WEIGHTS.category +
        similarityScore * PROFILE_SCORE_WEIGHTS.similarity;

      return {
        row,
        index,
        scores: { regionScore, typeScore, categoryScore, similarityScore },
        totalScore,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore || a.index - b.index);

  if (DEBUG_RECOMMENDATION_RANKING) {
    console.debug(
      "[/api/mypage/recommendations] profile rerank top",
      ranked.slice(0, 3).map(({ row, scores, totalScore }) => ({
        id: row.id,
        region: roundScore(scores.regionScore),
        user_type: roundScore(scores.typeScore),
        category: roundScore(scores.categoryScore),
        similarity: roundScore(scores.similarityScore),
        total: roundScore(totalScore),
      }))
    );
  }

  return ranked
    .map((item) => item.row);
}

function rankScrapMatches(
  rows: HybridMatchRow[],
  context: {
    scrappedIds: Set<number>;
    selectedIds: number[];
    stats: ScrapPreferenceStats;
  }
) {
  const ranked = rows
    .filter((row) => !context.scrappedIds.has(row.id) && !context.selectedIds.includes(row.id))
    .map((row, index) => {
      // ☑️수정: scrap reranking 점수 구조
      // category 40% + region 30% + support_type 20% + vector similarity 10%
      const categoryScore =
        context.stats.total > 0 && row.s_category
          ? (context.stats.categories[row.s_category] ?? 0) / context.stats.total
          : 0;
      const regionScore =
        context.stats.total > 0 && row.region
          ? (context.stats.regions[row.region] ?? 0) / context.stats.total
          : 0;
      const supportTypeScore =
        row.support_type && context.stats.supportTypes.has(row.support_type) ? 1 : 0;
      const similarityScore = Number(row.similarity ?? 0);
      const totalScore =
        categoryScore * SCRAP_SCORE_WEIGHTS.category +
        regionScore * SCRAP_SCORE_WEIGHTS.region +
        supportTypeScore * SCRAP_SCORE_WEIGHTS.supportType +
        similarityScore * SCRAP_SCORE_WEIGHTS.similarity;

      return {
        row,
        index,
        scores: { categoryScore, regionScore, supportTypeScore, similarityScore },
        totalScore,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore || a.index - b.index);

  if (DEBUG_RECOMMENDATION_RANKING) {
    console.debug(
      "[/api/mypage/recommendations] scrap rerank top",
      ranked.slice(0, 3).map(({ row, scores, totalScore }) => ({
        id: row.id,
        category: roundScore(scores.categoryScore),
        region: roundScore(scores.regionScore),
        support_type: roundScore(scores.supportTypeScore),
        similarity: roundScore(scores.similarityScore),
        total: roundScore(totalScore),
      }))
    );
  }

  return ranked
    .map((item) => item.row);
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
      .select("regions, categories, age_group, user_type")
      .eq("login_id", loginId)
      .maybeSingle();

    if (userInfoError) {
      return NextResponse.json({ error: userInfoError.message }, { status: 500 });
    }

    const typedUserInfo = (userInfo ?? null) as UserInfoRow | null;
    const region = typedUserInfo?.regions?.[0] ?? null;
    const category = typedUserInfo?.categories?.[0] ?? null;
    const age = typedUserInfo?.age_group ? Number.parseInt(typedUserInfo.age_group, 10) : null;
    const userType = typedUserInfo?.user_type?.trim() || null;
    const profileReady = Boolean(region && category && Number.isInteger(age));

    const { data: scraps, error: scrapError } = await supabase
      .from("scraps")
      .select(`
        ann_id,
        announcements ( title, summary, s_category, region, support_type )
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
    const scrapStats = buildScrapPreferenceStats(typedScraps);

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
      const profileQueryText = `지역: ${region}, 나이: ${age}세, 관심 분야: ${category}.${
        userType ? ` 사용자 유형: ${userType}.` : ""
      } 이 조건에 잘 맞는 지원 공고를 추천해주세요.`;
      const profileSearch = await findRecommendationMatches(profileQueryText, rpcBaseParams);
      if (profileSearch.warning) warnings.push(`profile: ${profileSearch.warning}`);

      const rankedProfileRows = rankProfileMatches(profileSearch.rows, {
        scrappedIds,
        selectedIds: recommendationIds,
        region,
        category,
        userType,
      });

      for (const row of rankedProfileRows) {
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

      const rankedScrapRows = rankScrapMatches(scrapSearch.rows, {
        scrappedIds,
        selectedIds: recommendationIds,
        stats: scrapStats,
      });

      for (const row of rankedScrapRows) {
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
