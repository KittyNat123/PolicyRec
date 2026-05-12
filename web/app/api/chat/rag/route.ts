import { NextRequest, NextResponse } from "next/server";
import {
  extractSelfQueryFilters,
  generatePolicyAnswer,
  getQueryEmbedding,
  hasSelfQueryFilterSignal,
} from "@/lib/gemini";
import type {
  RagHistoryMessage,
  RagPolicyContext,
  RagUserContext,
  SelfQueryFilters,
} from "@/lib/gemini";
import { getLoginIdFromRequest } from "@/lib/auth";
import {
  cleanDetailUrl,
  cleanPolicyText,
  cleanTargetGroup,
  normalizeApplicationDetails,
} from "@/lib/policy-normalization";
import { ALL_OPTION, CATEGORIES, REGIONS } from "@/lib/profile-options";
import { supabase } from "@/lib/supabase";
import { recruitmentStatus } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MATCH_COUNT = 30;
const RESULT_COUNT = 5;
const MATCH_THRESHOLD = 0.65;
const NATIONWIDE_REGION = "전국";
const REGION_ALIAS_GROUPS: string[][] = [
  ["강원특별자치도", "강원도"],
  ["전북특별자치도", "전라북도"],
  ["제주특별자치도", "제주도"],
  ["세종특별자치시", "세종시"],
];

const PRIMARY_BASE_COLUMNS = [
  "id",
  "source",
  "source_id",
  "title",
  "summary",
  "provider",
  "s_category",
  "region",
  "target_age_min",
  "target_age_max",
  "apply_start_dt",
  "apply_end_dt",
  "target_group",
  "target_tags",
  "support_type",
  "detail_url",
].join(",");

const PRIMARY_EXTENDED_COLUMNS = [
  PRIMARY_BASE_COLUMNS,
  "application_method",
  "required_documents",
  "additional_conditions",
].join(",");

const LEGACY_RICH_COLUMNS = [
  "id",
  "source",
  "source_id",
  "title",
  "summary",
  "content",
  "provider",
  "category",
  "region",
  "target_age_min",
  "target_age_max",
  "start_date",
  "end_date",
  "target_group",
  "detail_url",
].join(",");

type AnnouncementSchema = "primary_extended" | "primary" | "legacy";
type SupabaseLikeError = { message?: string };
type FilterConflict = {
  field: "category" | "region" | "target_age";
  profile_value: string | number;
  ai_value: string | number;
  used: "self_query";
};
type NormalizedResultRow = Record<string, unknown> & {
  summary: string | null;
  s_category: string | null;
  region: string | null;
  apply_start_dt: string | null;
  apply_end_dt: string | null;
  target_group: string | null;
  target_tags: string[];
  application_method: string | null;
  required_documents: string | null;
  additional_conditions: string | null;
  detail_url: string | null;
};
type RerankRow = NormalizedResultRow & {
  id: number;
  similarity?: number;
  final_score: number;
  match_bonus: number;
};

async function loadUserContext(
  request: NextRequest
): Promise<RagUserContext | undefined> {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) return undefined;

  // ☑️수정: MVP 기준에서 RAG 추천도 user_filters가 아니라 user_info 원본 프로필만 참조
  const userInfoResult = await supabase
    .from("user_info")
    .select("region,regions,categories,age_group,user_type")
    .eq("login_id", loginId)
    .maybeSingle();

  const userInfo = userInfoResult.data as {
    region?: string | null;
    regions?: string[] | null;
    categories?: string[] | null;
    age_group?: string | null;
    user_type?: string | null;
  } | null;

  const regions = (userInfo?.regions ?? []) as unknown[];
  const categories = (userInfo?.categories ?? []) as unknown[];
  const rawRegion = regions[0] ?? userInfo?.region;
  const rawCategory = categories[0];
  const region =
    typeof rawRegion === "string" &&
    rawRegion !== NATIONWIDE_REGION &&
    rawRegion !== "전체"
      ? rawRegion
      : null;
  const category =
    typeof rawCategory === "string" && rawCategory !== "전체"
      ? rawCategory
      : null;
  const fallbackAge =
    typeof userInfo?.age_group === "string" && userInfo.age_group.trim()
      ? Number(userInfo.age_group)
      : null;
  const targetAge = Number.isInteger(fallbackAge) ? fallbackAge : null;

  return {
    loginId,
    region,
    category,
    targetAge,
    userType: userInfo?.user_type ?? null,
  };
}

function buildProfileFilterConflicts(
  userContext: RagUserContext | undefined,
  selfQuery: SelfQueryFilters | null
): FilterConflict[] {
  if (!userContext || !selfQuery?.applied) return [];
  const conflicts: FilterConflict[] = [];
  if (
    userContext.category &&
    selfQuery.category &&
    userContext.category !== selfQuery.category
  ) {
    conflicts.push({
      field: "category",
      profile_value: userContext.category,
      ai_value: selfQuery.category,
      used: "self_query",
    });
  }
  if (
    userContext.region &&
    selfQuery.region &&
    userContext.region !== selfQuery.region
  ) {
    conflicts.push({
      field: "region",
      profile_value: userContext.region,
      ai_value: selfQuery.region,
      used: "self_query",
    });
  }
  if (
    userContext.targetAge !== null &&
    userContext.targetAge !== undefined &&
    selfQuery.target_age !== null &&
    selfQuery.target_age !== undefined &&
    userContext.targetAge !== selfQuery.target_age
  ) {
    conflicts.push({
      field: "target_age",
      profile_value: userContext.targetAge,
      ai_value: selfQuery.target_age,
      used: "self_query",
    });
  }
  return conflicts;
}

function conflictLabel(field: FilterConflict["field"]) {
  if (field === "region") return "지역";
  if (field === "category") return "관심 분야";
  return "나이";
}

function buildFilterConflictQuestion(conflicts: FilterConflict[]) {
  const lines = conflicts.map(
    (conflict) =>
      `${conflictLabel(conflict.field)}은 저장된 값이 '${conflict.profile_value}'인데, 이번 질문에서는 '${conflict.ai_value}'로 보여요.`
  );
  const target = conflicts
    .map((conflict) => `${conflictLabel(conflict.field)} ${conflict.ai_value}`)
    .join(", ");
  return `${lines.join("\n")}\n이번 대화에서는 ${target} 기준으로 찾아볼까요?`;
}

function chooseEmbeddingQuery(query: string, selfQuery: SelfQueryFilters | null) {
  const semanticQuery = selfQuery?.applied ? selfQuery.semantic_query.trim() : "";
  return semanticQuery.replace(/\s/g, "").length >= 2 ? semanticQuery : query;
}

function isMissingColumnError(error: SupabaseLikeError | null) {
  if (!error?.message) return false;
  return (
    error.message.includes("does not exist") ||
    error.message.includes("Could not find")
  );
}

function columnsForSchema(schema: AnnouncementSchema) {
  if (schema === "primary_extended") return PRIMARY_EXTENDED_COLUMNS;
  if (schema === "primary") return PRIMARY_BASE_COLUMNS;
  return LEGACY_RICH_COLUMNS;
}

function normalizeTargetTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (tag): tag is string => typeof tag === "string" && tag.trim() !== ""
    );
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function toNullableString(value: unknown): string | null {
  return cleanPolicyText(value);
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildRegionCandidates(filterRegion: string): string[] {
  const group = REGION_ALIAS_GROUPS.find((items) => items.includes(filterRegion));
  if (!group) return [filterRegion, NATIONWIDE_REGION];
  return Array.from(new Set([...group, NATIONWIDE_REGION]));
}

function calculateFinalScore(
  row: Record<string, unknown>,
  similarity: number,
  filterRegion: string | null,
  userAge: number | null
) {
  const simScore = similarity * 100;
  let bonus = 0;

  if (filterRegion && row.region === filterRegion) {
    bonus += 30;
  }

  if (userAge !== null) {
    const min = toNullableNumber(row.target_age_min);
    const max = toNullableNumber(row.target_age_max);
    if (min !== null || max !== null) {
      if ((min === null || min <= userAge) && (max === null || max >= userAge)) {
        bonus += 10;
      }
    }
  }

  return { finalScore: simScore + bonus, matchBonus: bonus };
}

function compareByFinalScoreDescThenIdAsc(a: RerankRow, b: RerankRow) {
  if (a.final_score !== b.final_score) return b.final_score - a.final_score;
  return a.id - b.id;
}

function normalizeResultRow(row: Record<string, unknown>): NormalizedResultRow {
  const summary =
    typeof row.summary === "string"
      ? cleanPolicyText(row.summary)
      : typeof row.content === "string"
        ? cleanPolicyText(row.content)
        : null;
  const sCategory =
    typeof row.s_category === "string"
      ? row.s_category
      : typeof row.category === "string"
        ? row.category
        : null;
  const applyStart =
    typeof row.apply_start_dt === "string"
      ? row.apply_start_dt
      : typeof row.start_date === "string"
        ? row.start_date
        : null;
  const applyEnd =
    typeof row.apply_end_dt === "string"
      ? row.apply_end_dt
      : typeof row.end_date === "string"
        ? row.end_date
        : null;
  const targetTags = normalizeTargetTags(row.target_tags);
  const applicationDetails = normalizeApplicationDetails(
    row.application_method,
    row.required_documents
  );

  return {
    ...row,
    summary,
    s_category: sCategory,
    region: toNullableString(row.region),
    apply_start_dt: applyStart,
    apply_end_dt: applyEnd,
    target_group: cleanTargetGroup(row.target_group, targetTags),
    target_tags: targetTags,
    application_method: applicationDetails.application_method,
    required_documents: applicationDetails.required_documents,
    additional_conditions: toNullableString(row.additional_conditions),
    detail_url: cleanDetailUrl(row.detail_url),
  };
}

async function selectAnnouncementRowsByIds(ids: number[]) {
  let data: unknown[] | null = null;
  let error: SupabaseLikeError | null = null;

  for (const schema of ["primary_extended", "primary", "legacy"] as const) {
    const result = await supabase
      .from("announcements")
      .select(columnsForSchema(schema))
      .in("id", ids);
    data = result.data as unknown[] | null;
    error = result.error;
    if (!error || !isMissingColumnError(error)) break;
  }

  return { data, error };
}

function normalizeHistory(value: unknown): RagHistoryMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (message): message is RagHistoryMessage =>
        message &&
        typeof message === "object" &&
        ((message as RagHistoryMessage).role === "user" ||
          (message as RagHistoryMessage).role === "assistant") &&
        typeof (message as RagHistoryMessage).content === "string"
    )
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 1000),
    }))
    .slice(-8);
}

function buildHistoryConditionQuery(
  question: string,
  history: RagHistoryMessage[]
) {
  // ☑️수정: 짧은 확인 답변에서도 직전 사용자 발화의 지역/나이/분야 조건을 재사용
  const recentUserMessages = history
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.content.trim())
    .filter(Boolean);

  if (recentUserMessages.length === 0) return question;
  return [...recentUserMessages, question].join("\n");
}

function compactConditionText(value: string) {
  return value.replace(/\s/g, "").toLowerCase();
}

function buildRegionAliases(region: string) {
  const aliases = new Set([region]);
  aliases.add(region.replace(/특별자치도|특별자치시|특별시|광역시|도|시$/g, ""));
  aliases.add(region.slice(0, 2));
  return [...aliases].filter((alias) => alias.length >= 2);
}

function extractLocalSelfQueryFilters(query: string): SelfQueryFilters | null {
  // ☑️수정: history에서 이미 말한 명확한 지역/나이/분야는 Gemini self-query 실패와 무관하게 재사용
  const compact = compactConditionText(query);
  if (!compact) return null;

  const region =
    Array.from(REGIONS).find(
      (item) =>
        item !== ALL_OPTION &&
        buildRegionAliases(item).some((alias) =>
          compact.includes(compactConditionText(alias))
        )
    ) ?? null;
  const category =
    Array.from(CATEGORIES).find(
      (item) =>
        item !== ALL_OPTION && compact.includes(compactConditionText(item))
    ) ?? null;
  const ageMatch = compact.match(/(?:만)?(\d{1,3})(?:세|살)/);
  const targetAge = ageMatch ? Number(ageMatch[1]) : null;
  const safeTargetAge =
    targetAge !== null && targetAge >= 0 && targetAge <= 120 ? targetAge : null;

  if (!region && !category && safeTargetAge === null) return null;

  return {
    region,
    target_age: safeTargetAge,
    category,
    semantic_query: query,
    confidence: 0.9,
    applied: true,
    reason: "local_condition_signal",
  };
}

function extractExplicitHistoryCategory(history: RagHistoryMessage[]) {
  // ☑️수정: 현재 질문에서 빠진 분야만 보충하기 위해 최근 사용자 발화의 명시 category만 분리 추출
  const recentUserQuery = history
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n");

  if (!recentUserQuery) return null;
  return extractLocalSelfQueryFilters(recentUserQuery)?.category ?? null;
}

function supplementMissingCategoryFromHistory(
  selfQuery: SelfQueryFilters | null,
  history: RagHistoryMessage[]
): SelfQueryFilters | null {
  // ☑️수정: 현재 질문에 지역/나이는 있지만 category가 없을 때만 history category를 보충
  if (!selfQuery?.applied || selfQuery.category) return selfQuery;
  const hasCurrentRegionOrAge =
    Boolean(selfQuery.region) ||
    (selfQuery.target_age !== null && selfQuery.target_age !== undefined);
  if (!hasCurrentRegionOrAge) return selfQuery;

  const historyCategory = extractExplicitHistoryCategory(history);
  if (!historyCategory) return selfQuery;

  return {
    ...selfQuery,
    category: historyCategory,
    reason: selfQuery.reason
      ? `${selfQuery.reason}+history_category`
      : "history_category",
  };
}

async function extractContextualSelfQuery(
  question: string,
  history: RagHistoryMessage[]
) {
  // ☑️수정: 현재 질문에 조건이 있으면 현재 질문을 우선하고, 없을 때만 history를 보조 조건으로 사용
  const currentLocalSelfQuery = extractLocalSelfQueryFilters(question);
  if (currentLocalSelfQuery) {
    return supplementMissingCategoryFromHistory(currentLocalSelfQuery, history);
  }

  if (hasSelfQueryFilterSignal(question)) {
    const currentSelfQuery = await extractSelfQueryFilters(question);
    return supplementMissingCategoryFromHistory(currentSelfQuery, history);
  }

  const historyConditionQuery = buildHistoryConditionQuery(question, history);
  if (historyConditionQuery === question) return null;
  const historyLocalSelfQuery = extractLocalSelfQueryFilters(historyConditionQuery);
  if (historyLocalSelfQuery) return historyLocalSelfQuery;
  if (!hasSelfQueryFilterSignal(historyConditionQuery)) return null;

  return extractSelfQueryFilters(historyConditionQuery);
}

function buildFallbackAnswer(question: string, policies: RagPolicyContext[]) {
  if (policies.length === 0) {
    return `"${question}"에 맞는 정책을 바로 찾지는 못했어요. 지역, 나이, 관심 분야, 현재 상황을 조금 더 구체적으로 알려주시면 다시 좁혀볼게요.`;
  }
  const names = policies
    .slice(0, 3)
    .map((policy) => `- ${policy.title}${policy.detail_url ? "" : " (상세 링크 확인 필요)"}`)
    .join("\n");
  return `관련 정책을 찾았어요. 아래 후보를 먼저 확인해보세요.\n${names}`;
}

function isCasualMessage(message: string) {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[!?.~\s]/g, "");
  const policySignals = [
    "정책",
    "지원",
    "사업",
    "공고",
    "신청",
    "창업",
    "청년",
    "자금",
    "주거",
    "일자리",
    "대출",
    "보조금",
    "교육",
    "멘토링",
  ];
  if (policySignals.some((signal) => normalized.includes(signal))) return false;

  const casualSignals = [
    "안녕",
    "하이",
    "hello",
    "hi",
    "고마워",
    "감사",
    "뭐해",
    "넌누구",
    "정보",
    "뭐말",
    "뭐주면",
  ];
  return (
    normalized.length <= 40 &&
    casualSignals.some((signal) => normalized.includes(signal))
  );
}

function isPersonalizedRequest(message: string): boolean {
  const normalized = message.replace(/\s/g, "").toLowerCase();
  const signals = [
    "나에게맞",
    "나한테맞",
    "나랑맞",
    "내게맞",
    "맞춤",
    "추천해줘",
    "추천해주세요",
    "추천부탁",
    "맞는정책",
  ];
  return signals.some((signal) => normalized.includes(signal));
}

function hasUserProfile(userContext: RagUserContext | undefined): boolean {
  if (!userContext) return false;
  // ☑️수정: 홈 AI 추천 진입 조건과 맞추기 위해 user_type은 필수 조건에서 제외
  return Boolean(
    userContext.region &&
      userContext.category &&
      userContext.targetAge !== null &&
      userContext.targetAge !== undefined
  );
}

function buildSavedFilterPrefix(userContext: RagUserContext): string {
  const parts: string[] = [];
  if (userContext.region) parts.push(`지역: ${userContext.region}`);
  if (userContext.userType) parts.push(`사용자 유형: ${userContext.userType}`);
  if (userContext.category) parts.push(`관심 분야: ${userContext.category}`);
  if (userContext.targetAge !== null && userContext.targetAge !== undefined) {
    parts.push(`나이: ${userContext.targetAge}세`);
  }
  if (parts.length === 0) return "";
  return `저장된 정보(${parts.join(", ")})를 함께 반영해서 추천했어요.\n\n`;
}

const ASK_PROFILE_REPLY = `정확한 추천을 위해 몇 가지만 알려주세요.
지역:
나이:
관심 분야:
현재 상황:

이 중 아는 것만 적어주셔도 지금 신청 가능한 정책 위주로 다시 찾아볼게요.`;

function buildGeneralAnswer(question: string) {
  const normalized = question.replace(/\s/g, "");
  if (
    normalized.includes("정보") ||
    normalized.includes("뭐") ||
    normalized.includes("무엇") ||
    normalized.includes("어떤")
  ) {
    return "조건을 말씀해주시면 신청 가능한 공고 위주로 추천해드릴게요!\n지역:\n나이:\n관심 분야:\n현재 상황:";
  }
  return "조건을 말씀해주시면 신청 가능한 공고 위주로 추천해드릴게요!\n지역:\n나이:\n관심 분야:\n현재 상황:";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const question = typeof body.message === "string" ? body.message.trim() : "";
    const history = normalizeHistory(body.history);
    const confirmedFilterOverride = body.confirmed_filter_override === true;

    if (!question) {
      return NextResponse.json(
        { error: "질문을 입력해주세요." },
        { status: 400 }
      );
    }

    if (isCasualMessage(question)) {
      return NextResponse.json({
        reply: buildGeneralAnswer(question),
        results: [],
        intent: "general",
      });
    }

    const userContext = await loadUserContext(request);
    const selfQuery = await extractContextualSelfQuery(question, history);
    const contextualUserContext: RagUserContext = {
      // ☑️수정: 프로필이 비어 있어도 history/question에서 확인된 조건이 있으면 ask_profile로 되돌아가지 않도록 병합
      loginId: userContext?.loginId ?? null,
      region: selfQuery?.region ?? userContext?.region ?? null,
      category: selfQuery?.category ?? userContext?.category ?? null,
      targetAge: selfQuery?.target_age ?? userContext?.targetAge ?? null,
      userType: userContext?.userType ?? null,
    };

    if (isPersonalizedRequest(question) && !hasUserProfile(contextualUserContext)) {
      return NextResponse.json({
        reply: ASK_PROFILE_REPLY,
        results: [],
        intent: "ask_profile",
      });
    }

    const filterConflicts = buildProfileFilterConflicts(userContext, selfQuery);

    if (filterConflicts.length > 0 && !confirmedFilterOverride) {
      return NextResponse.json({
        reply: buildFilterConflictQuestion(filterConflicts),
        results: [],
        intent: "confirm_filter_override",
        pending_query: question,
        filter_conflicts: filterConflicts,
      });
    }

    const effectiveFilterCategory =
      selfQuery?.category ?? userContext?.category ?? null;
    const effectiveFilterRegion =
      selfQuery?.region ?? userContext?.region ?? null;
    const effectiveUserAge =
      selfQuery?.target_age ?? userContext?.targetAge ?? null;
    const embeddingQuery = chooseEmbeddingQuery(question, selfQuery);
    const effectiveUserContext: RagUserContext = {
      loginId: userContext?.loginId ?? null,
      region: effectiveFilterRegion,
      category: effectiveFilterCategory,
      targetAge: effectiveUserAge,
      userType: userContext?.userType ?? null,
    };
    const profileContributionContext: RagUserContext = {
      loginId: userContext?.loginId ?? null,
      region: selfQuery?.region ? null : userContext?.region ?? null,
      category: selfQuery?.category ? null : userContext?.category ?? null,
      userType: userContext?.userType ?? null,
      targetAge:
        selfQuery?.target_age !== null && selfQuery?.target_age !== undefined
          ? null
          : (userContext?.targetAge ?? null),
    };

    const queryEmbedding = await getQueryEmbedding(embeddingQuery);
    const hybridResult = await supabase.rpc("match_announcements_hybrid", {
      query_embedding: queryEmbedding,
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
      filter_category: effectiveFilterCategory,
      filter_region: effectiveFilterRegion,
      user_age: effectiveUserAge,
    });

    if (hybridResult.error) {
      return NextResponse.json(
        { error: hybridResult.error.message },
        { status: 500 }
      );
    }

    const hybridRows = (hybridResult.data ?? []) as Array<
      Record<string, unknown> & { id: number; similarity?: number }
    >;
    const ids = hybridRows.map((row) => row.id).filter(Number.isFinite);
    const similarityById = new Map(
      hybridRows.map((row) => [row.id, Number(row.similarity ?? 0)])
    );

    const { data: richRowsRaw, error: richError } =
      ids.length > 0
        ? await selectAnnouncementRowsByIds(ids)
        : { data: null, error: null };

    if (richError) {
      return NextResponse.json({ error: richError.message }, { status: 500 });
    }

    const sourceRows =
      richRowsRaw && richRowsRaw.length > 0
        ? (richRowsRaw as Array<Record<string, unknown>>)
        : hybridRows;

    const results = sourceRows
      .map((row) => {
        const normalized = normalizeResultRow(row);
        const id = toNullableNumber(normalized.id) ?? 0;
        const similarity = similarityById.get(id) ?? 0;
        const { finalScore, matchBonus } = calculateFinalScore(
          normalized,
          similarity,
          effectiveFilterRegion,
          effectiveUserAge
        );
        return {
          ...normalized,
          id,
          similarity,
          final_score: finalScore,
          match_bonus: matchBonus,
        } satisfies RerankRow;
      })
      .filter(
        (row) =>
          row.id > 0 &&
          recruitmentStatus(row.apply_start_dt, row.apply_end_dt) !== "마감" &&
          (!effectiveFilterRegion ||
            (typeof row.region === "string" &&
              buildRegionCandidates(effectiveFilterRegion).includes(row.region)))
      )
      .sort(compareByFinalScoreDescThenIdAsc)
      .slice(0, RESULT_COUNT);

    const policies = results.map((row): RagPolicyContext => {
      const record = row as Record<string, unknown>;
      return {
        title: String(record.title ?? ""),
        summary: toNullableString(record.summary),
        provider: toNullableString(record.provider),
        region: toNullableString(record.region),
        s_category: toNullableString(record.s_category),
        target_group: toNullableString(record.target_group),
        target_tags: normalizeTargetTags(record.target_tags),
        support_type: toNullableString(record.support_type),
        application_method: toNullableString(record.application_method),
        required_documents: toNullableString(record.required_documents),
        additional_conditions: toNullableString(record.additional_conditions),
        apply_start_dt: toNullableString(record.apply_start_dt),
        apply_end_dt: toNullableString(record.apply_end_dt),
        detail_url: cleanDetailUrl(record.detail_url),
      };
    });

    let reply: string;
    try {
      reply = await generatePolicyAnswer({
        question,
        policies,
        history,
        userContext: effectiveUserContext,
      });
    } catch (error) {
      console.warn("[/api/chat/rag] Gemini answer failed:", error);
      reply = buildFallbackAnswer(question, policies);
    }

    if (filterConflicts.length > 0 && confirmedFilterOverride) {
      reply = `좋아요. 이번 대화에서는 방금 말씀하신 조건을 우선해서 찾아봤어요.\n\n${reply}`;
    } else if (history.length === 0 && hasUserProfile(profileContributionContext)) {
      reply = buildSavedFilterPrefix(profileContributionContext) + reply;
    }

    return NextResponse.json({
      reply,
      results,
      rpc_used: "hybrid_rerank",
      self_query: selfQuery,
      filter_conflicts: filterConflicts,
    });
  } catch (error) {
    console.error("[/api/chat/rag] error:", error);
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
