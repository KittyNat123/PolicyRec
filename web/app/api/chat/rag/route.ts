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
import { ALL_OPTION, CATEGORIES, REGIONS, USER_TYPES } from "@/lib/profile-options";
import { supabase } from "@/lib/supabase";
import { recruitmentStatus } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MATCH_COUNT = 30;
const RESULT_COUNT = 5;
const MATCH_THRESHOLD = 0.65;
const TITLE_FALLBACK_MATCH_LIMIT = 30;
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
  field: "category" | "region" | "target_age" | "user_type";
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
type RecentResultRow = NormalizedResultRow & {
  id: number;
  similarity?: number;
};
type ClientProfileFilter = {
  regions?: unknown;
  categories?: unknown;
  target_age?: unknown;
  user_type?: unknown;
};

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return null;
  const found = value.find((item) => typeof item === "string" && item.trim());
  return typeof found === "string" ? found.trim() : null;
}

function normalizeProfileRegion(value: unknown): string | null {
  const region = firstString(value);
  if (!region || region === NATIONWIDE_REGION || region === ALL_OPTION) {
    return null;
  }
  return region;
}

function normalizeProfileCategory(value: unknown): string | null {
  const category = firstString(value);
  return category && category !== ALL_OPTION ? category : null;
}

function normalizeProfileAge(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const age = typeof value === "number" ? value : Number(value);
  return Number.isInteger(age) && age >= 0 && age <= 120 ? age : null;
}

function normalizeProfileUserType(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasAnyUserContextValue(context: RagUserContext | undefined) {
  return Boolean(
    context?.loginId ||
      context?.region ||
      context?.category ||
      (context?.targetAge !== null && context?.targetAge !== undefined) ||
      context?.userType
  );
}

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

  return {
    loginId,
    region: normalizeProfileRegion(userInfo?.regions ?? userInfo?.region),
    category: normalizeProfileCategory(userInfo?.categories),
    targetAge: normalizeProfileAge(userInfo?.age_group),
    userType: normalizeProfileUserType(userInfo?.user_type),
  };
}

function contextFromClientProfile(
  profile: unknown,
  loginId: string | null
): RagUserContext | undefined {
  if (!profile || typeof profile !== "object") return undefined;
  const filter = profile as ClientProfileFilter;
  const context: RagUserContext = {
    loginId,
    region: normalizeProfileRegion(filter.regions),
    category: normalizeProfileCategory(filter.categories),
    targetAge: normalizeProfileAge(filter.target_age),
    userType: normalizeProfileUserType(filter.user_type),
  };
  return hasAnyUserContextValue(context) ? context : undefined;
}

function mergeUserContexts(
  primary: RagUserContext | undefined,
  fallback: RagUserContext | undefined
): RagUserContext | undefined {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    loginId: primary.loginId ?? fallback.loginId ?? null,
    region: primary.region ?? fallback.region ?? null,
    category: primary.category ?? fallback.category ?? null,
    targetAge: primary.targetAge ?? fallback.targetAge ?? null,
    userType: primary.userType ?? fallback.userType ?? null,
  };
}

function buildPendingOverrideProfile(
  selfQuery: SelfQueryFilters | null,
  questionUserType: string | null
) {
  // ☑️수정: confirm 이후 승인 시 현재 active chat에 저장할 override 조건
  return {
    regions: selfQuery?.region ? [selfQuery.region] : null,
    categories: selfQuery?.category ? [selfQuery.category] : null,
    target_age:
      selfQuery?.target_age !== null && selfQuery?.target_age !== undefined
        ? selfQuery.target_age
        : null,
    user_type: questionUserType,
  };
}

function buildProfileFilterConflicts(
  userContext: RagUserContext | undefined,
  selfQuery: SelfQueryFilters | null,
  questionUserType: string | null
): FilterConflict[] {
  if (!userContext) return [];
  const conflicts: FilterConflict[] = [];
  if (
    selfQuery?.applied &&
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
    selfQuery?.applied &&
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
    selfQuery?.applied &&
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
  if (
    userContext.userType &&
    questionUserType &&
    userContext.userType !== questionUserType
  ) {
    conflicts.push({
      field: "user_type",
      profile_value: userContext.userType,
      ai_value: questionUserType,
      used: "self_query",
    });
  }
  return conflicts;
}

function conflictLabel(field: FilterConflict["field"]) {
  if (field === "region") return "지역";
  if (field === "category") return "관심 분야";
  if (field === "user_type") return "사용자 유형";
  return "나이";
}

function formatConflictValue(field: FilterConflict["field"], value: string | number) {
  if (field === "target_age" && typeof value === "number") return `${value}세`;
  return String(value);
}

function buildFilterConflictQuestion(
  conflicts: FilterConflict[],
  userContext: RagUserContext | undefined,
  questionSelfQuery: SelfQueryFilters | null,
  questionUserType: string | null
) {
  const profileParts = [
    userContext?.region,
    userContext?.targetAge !== null && userContext?.targetAge !== undefined
      ? `${userContext.targetAge}세`
      : null,
    userContext?.userType,
    userContext?.category,
  ].filter(Boolean);
  const questionParts = [
    questionSelfQuery?.region,
    questionSelfQuery?.target_age !== null &&
    questionSelfQuery?.target_age !== undefined
      ? `${questionSelfQuery.target_age}세`
      : null,
    questionUserType,
    questionSelfQuery?.category,
  ].filter(Boolean);

  if (profileParts.length > 0 && questionParts.length > 0) {
    return `현재 프로필은 ${profileParts.join(" / ")}로 설정되어 있는데,\n이번에는 ${questionParts.join(" / ")} 기준으로 검색할까요?`;
  }

  const target = conflicts
    .map(
      (conflict) =>
        `${conflictLabel(conflict.field)} ${formatConflictValue(
          conflict.field,
          conflict.ai_value
        )}`
    )
    .join(", ");
  return `현재 프로필과 이번 질문 조건이 달라요.\n이번에는 ${target} 기준으로 검색할까요?`;
}

function chooseEmbeddingQuery(query: string, selfQuery: SelfQueryFilters | null) {
  const semanticQuery = selfQuery?.applied ? selfQuery.semantic_query.trim() : "";
  return semanticQuery.replace(/\s/g, "").length >= 2 ? semanticQuery : query;
}

function buildProfileRecommendationQuery(
  question: string,
  userContext: RagUserContext | undefined
) {
  // ☑️수정: "내 저장 정보" 같은 지시문 자체가 아니라 실제 저장 프로필 조건을 embedding query로 사용
  const parts = [
    userContext?.region,
    userContext?.targetAge !== null && userContext?.targetAge !== undefined
      ? `${userContext.targetAge}세`
      : null,
    userContext?.userType,
    userContext?.category,
    "지금 신청 가능한 정책 추천",
  ].filter(Boolean);
  return parts.length > 1 ? parts.join(" ") : question;
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

function rowMatchesAge(row: Record<string, unknown>, userAge: number | null) {
  if (userAge === null) return true;
  const min = toNullableNumber(row.target_age_min);
  const max = toNullableNumber(row.target_age_max);
  return (min === null || min <= userAge) && (max === null || max >= userAge);
}

function compareByFinalScoreDescThenIdAsc(a: RerankRow, b: RerankRow) {
  if (a.final_score !== b.final_score) return b.final_score - a.final_score;
  return a.id - b.id;
}

function normalizeAnnouncementKeyword(value: string) {
  return value.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

function stripTrailingKoreanParticles(value: string) {
  let keyword = value;
  for (let i = 0; i < 3; i += 1) {
    const next = keyword.replace(/(에서|에게|으로|로|은|는|이|가|을|를|와|과|랑|의|도|만)$/u, "");
    if (next === keyword) break;
    keyword = next;
  }
  return keyword;
}

function isApplicationGuideQuestion(message: string) {
  // ☑️수정: 신청가이드성 질문에서만 공고명 부분검색 fallback을 켜 기존 추천 흐름 영향을 줄인다.
  const compact = normalizeAnnouncementKeyword(message);
  if (!compact.includes("신청") && !compact.includes("접수") && !compact.includes("서류")) {
    return false;
  }
  return [
    "신청방법",
    "신청절차",
    "필요서류",
    "제출서류",
    "어떻게",
    "어디서",
    "하려면",
    "하나요",
    "해요",
    "알려줘",
    "알려주세요",
    "절차",
    "서류",
    "접수",
  ].some((signal) => compact.includes(signal));
}

function extractAnnouncementKeywordCandidates(question: string) {
  if (!isApplicationGuideQuestion(question)) return [];

  // ☑️수정: "넥스트로컬 사업 어떻게 신청해요?" 같은 문장에서 안내 표현을 걷어내고 고유명사 후보만 남긴다.
  const guideNoise =
    /(신청\s*방법|신청\s*절차|필요\s*서류|제출\s*서류|어떻게|어디서|하려면|하나요|해요|해주세요|해줘|알려주세요|알려줘|사업|공고|정책|지원|관련|대한|자세히|좀|신청|접수|방법|절차|서류|필요|제출|안내|하려고|하는|하려|하면|해)/gu;
  const spaced = question
    .replace(/[()[\]{}"'`“”‘’?!.,:;<>]/g, " ")
    .replace(guideNoise, " ")
    .split(/\s+/)
    .map((part) => stripTrailingKoreanParticles(part.trim()))
    .filter((part) => normalizeAnnouncementKeyword(part).length >= 3);

  const compact = stripTrailingKoreanParticles(
    question.replace(guideNoise, "").replace(/[()[\]{}"'`“”‘’?!.,:;<>~\s]/g, "")
  );
  const candidates = [compact, ...spaced]
    .map((part) => normalizeAnnouncementKeyword(part))
    .filter((part) => part.length >= 3 && !/^\d+$/.test(part));

  return Array.from(new Set(candidates))
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);
}

function buildTextSearchOr(candidates: string[], columns: string[]) {
  return candidates
    .flatMap((candidate) =>
      columns.map((column) => `${column}.ilike.%${candidate}%`)
    )
    .join(",");
}

function calculateTitleFallbackScore(row: NormalizedResultRow, candidates: string[]) {
  const title = normalizeAnnouncementKeyword(String(row.title ?? ""));
  const summary = normalizeAnnouncementKeyword(row.summary ?? "");
  const content = normalizeAnnouncementKeyword(String(row.content ?? ""));

  return candidates.reduce((score, candidate) => {
    if (title.includes(candidate)) return Math.max(score, 1000 + candidate.length);
    if (summary.includes(candidate)) return Math.max(score, 700 + candidate.length);
    if (content.includes(candidate)) return Math.max(score, 500 + candidate.length);
    return score;
  }, 0);
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

function normalizeActiveChatHistory(body: Record<string, unknown>): RagHistoryMessage[] {
  if (body.history_scope && body.history_scope !== "active_chat") return [];
  // Only the current chat room messages passed by the active client are used.
  // Stored chat_history rows from other chat_id/session_id values are never read here.
  return normalizeHistory(body.history);
}

function normalizeRecentResults(value: unknown): RecentResultRow[] {
  if (!Array.isArray(value)) return [];
  const results: RecentResultRow[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
      const normalized = normalizeResultRow(row as Record<string, unknown>);
      const id = toNullableNumber(normalized.id);
    if (!id) continue;
    results.push({
        ...normalized,
        id,
        similarity: toNullableNumber((row as Record<string, unknown>).similarity) ?? 0,
    });
    if (results.length >= 10) break;
  }
  return results;
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
  let category =
    Array.from(CATEGORIES).find(
      (item) =>
        item !== ALL_OPTION && compact.includes(compactConditionText(item))
    ) ?? null;
  if (
    !category &&
    ["재취업", "취업", "구직", "일자리"].some((alias) =>
      compact.includes(alias)
    )
  ) {
    category = "인력/일자리";
  }
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

function extractLocalUserType(query: string): string | null {
  const compact = compactConditionText(query);
  if (!compact) return null;

  const directUserType =
    Array.from(USER_TYPES).find(
      (item) =>
        item !== "선택 안함" && compact.includes(compactConditionText(item))
    ) ?? null;
  if (directUserType) return directUserType;

  if (compact.includes("재취업")) return "구직자";
  if (compact.includes("취업준비") || compact.includes("구직")) return "구직자";
  if (compact.includes("예비창업")) return "예비 창업자";
  return null;
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
  history: RagHistoryMessage[],
  userContext: RagUserContext | undefined
): SelfQueryFilters | null {
  // ☑️수정: 현재 질문에 지역/나이는 있지만 category가 없을 때만 history category를 보충
  if (!selfQuery?.applied || selfQuery.category) return selfQuery;
  if (userContext?.category) return selfQuery;
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

async function extractCurrentQuestionSelfQuery(question: string) {
  const currentLocalSelfQuery = extractLocalSelfQueryFilters(question);
  if (currentLocalSelfQuery) return currentLocalSelfQuery;

  if (hasSelfQueryFilterSignal(question)) {
    return extractSelfQueryFilters(question);
  }

  return null;
}

function keepOnlyProfileMissingFields(
  selfQuery: SelfQueryFilters | null,
  userContext: RagUserContext | undefined
): SelfQueryFilters | null {
  if (!selfQuery?.applied) return null;

  const region = userContext?.region ? null : selfQuery.region;
  const category = userContext?.category ? null : selfQuery.category;
  const targetAge =
    userContext?.targetAge !== null && userContext?.targetAge !== undefined
      ? null
      : selfQuery.target_age;

  if (!region && !category && targetAge === null) return null;

  return {
    ...selfQuery,
    region,
    category,
    target_age: targetAge,
    reason: selfQuery.reason
      ? `${selfQuery.reason}+active_chat_missing_profile_fields`
      : "active_chat_missing_profile_fields",
  };
}

async function extractActiveChatFollowupSelfQuery(
  question: string,
  history: RagHistoryMessage[]
) {
  const historyConditionQuery = buildHistoryConditionQuery(question, history);
  if (historyConditionQuery === question) return null;
  const historyLocalSelfQuery = extractLocalSelfQueryFilters(historyConditionQuery);
  if (historyLocalSelfQuery) return historyLocalSelfQuery;
  if (!hasSelfQueryFilterSignal(historyConditionQuery)) return null;

  return extractSelfQueryFilters(historyConditionQuery);
}

async function extractContextualSelfQuery(
  question: string,
  history: RagHistoryMessage[],
  userContext: RagUserContext | undefined,
  questionSelfQuery: SelfQueryFilters | null
) {
  // Priority: current question > current profile > current active chat history.
  // Active chat history may only fill fields that are absent from both the question and profile.
  if (questionSelfQuery?.applied) {
    return supplementMissingCategoryFromHistory(
      questionSelfQuery,
      history,
      userContext
    );
  }

  const historySelfQuery = await extractActiveChatFollowupSelfQuery(
    question,
    history
  );
  return keepOnlyProfileMissingFields(historySelfQuery, userContext);
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

const REFINEMENT_TODAY = "2026-05-13";

function normalizeRefinementText(value: string) {
  return value.replace(/\s/g, "").toLowerCase();
}

function daysUntilDeadline(applyEnd: string | null) {
  if (!applyEnd) return Number.POSITIVE_INFINITY;
  const end = new Date(`${applyEnd.slice(0, 10)}T00:00:00`).getTime();
  const today = new Date(`${REFINEMENT_TODAY}T00:00:00`).getTime();
  if (!Number.isFinite(end) || !Number.isFinite(today)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((end - today) / (1000 * 60 * 60 * 24));
}

function categoryFromRefinement(message: string) {
  const compact = normalizeRefinementText(message);
  if (compact.includes("주거")) return "주거";
  if (compact.includes("교육")) return "교육/멘토링";
  if (compact.includes("창업")) return "창업";
  if (compact.includes("재취업") || compact.includes("취업") || compact.includes("일자리")) {
    return "인력/일자리";
  }
  return null;
}

function isProfileReferenceRequest(message: string) {
  const compact = normalizeRefinementText(message);
  // ☑️수정: "내 저장 정보/내 프로필/내 조건"은 active override나 history가 아니라 저장 프로필 참조로 처리
  return ["내저장정보", "내프로필", "내조건", "내조건에맞는공고"].some(
    (signal) => compact.includes(signal)
  );
}

function isRecommendationSummaryRequest(message: string) {
  const compact = normalizeRefinementText(message);
  // ☑️수정: 직전 추천 설명 요청은 새 검색이 아니라 마지막 표시 결과 요약으로 처리
  return [
    "뭘추천했어",
    "뭐추천했어",
    "무엇을추천했어",
    "왜추천했어",
    "방금추천한거",
    "방금찾은거",
  ].some((signal) => compact.includes(signal));
}

function isRefinementRequest(message: string) {
  const compact = normalizeRefinementText(message);
  const requestedCategory = categoryFromRefinement(message);
  const categoryRefinement =
    Boolean(requestedCategory) &&
    (compact.includes("만") || compact.includes("쪽") || compact.includes("말고"));
  return categoryRefinement || [
    "그중",
    "방금찾은것들중에서",
    "방금찾은것중에서",
    "방금찾은거",
    "방금추천한거",
    "너가방금찾은것들중에서",
    "더보여줘",
    "비슷한거",
    "마감임박",
    "주거말고",
    "교육쪽",
    "창업만",
  ].some((signal) => compact.includes(signal));
}

function summarizeRecentResults(
  question: string,
  recentResults: RecentResultRow[]
) {
  if (recentResults.length === 0 || !isRecommendationSummaryRequest(question)) {
    return null;
  }

  const wantsReason = normalizeRefinementText(question).includes("왜추천");
  const rows = recentResults.slice(0, RESULT_COUNT);
  const names = rows
    .map((row, index) => {
      const meta = [
        row.provider,
        row.region,
        row.s_category,
        row.apply_end_dt ? `마감 ${row.apply_end_dt.slice(0, 10)}` : null,
      ].filter(Boolean);
      const reason = wantsReason
        ? `\n  추천 이유: ${[row.region, row.s_category, row.target_group]
            .filter(Boolean)
            .join(" / ")} 조건과 맞는 공고로 보여드렸어요.`
        : "";
      return `${index + 1}. ${String(row.title ?? "")}${
        meta.length ? ` (${meta.join(", ")})` : ""
      }${reason}`;
    })
    .join("\n");

  return {
    reply: wantsReason
      ? `방금 추천한 공고와 이유를 다시 정리하면 아래와 같아요.\n${names}`
      : `방금 추천한 공고는 아래 목록이에요.\n${names}`,
    results: rows,
  };
}

function refineRecentResults(
  question: string,
  recentResults: RecentResultRow[]
) {
  // ☑️수정: 현재 active chat의 직전 추천 결과를 새 검색 전에 재필터링/재정렬
  if (recentResults.length === 0 || !isRefinementRequest(question)) return null;

  const compact = normalizeRefinementText(question);
  const wantsUrgentDeadline = compact.includes("마감임박");
  const excludesHousing = compact.includes("주거말고");
  const requestedCategory = categoryFromRefinement(question);
  const categoryOnly = compact.includes("만") || compact.includes("쪽");

  let refined = [...recentResults];

  if (excludesHousing) {
    refined = refined.filter((row) => row.s_category !== "주거");
  } else if (requestedCategory && categoryOnly) {
    refined = refined.filter((row) => row.s_category === requestedCategory);
  }

  if (wantsUrgentDeadline) {
    refined = refined
      .filter((row) => {
        const diff = daysUntilDeadline(row.apply_end_dt);
        return Number.isFinite(diff) && diff >= 0;
      })
      .sort(
        (a, b) =>
          daysUntilDeadline(a.apply_end_dt) - daysUntilDeadline(b.apply_end_dt)
      );
  }

  if (!wantsUrgentDeadline && !requestedCategory && !excludesHousing) {
    refined = refined.slice(0, RESULT_COUNT);
  }

  const results = refined.slice(0, RESULT_COUNT);
  const title =
    wantsUrgentDeadline
      ? "직전 추천 결과 중 마감이 가까운 순서로 다시 좁혔어요."
      : results.length > 0
        ? "직전 추천 결과를 기준으로 다시 좁혔어요."
        : requestedCategory
          ? `직전 추천 결과 안에는 ${requestedCategory} 카테고리 공고가 없어요.`
          : "직전 추천 결과 안에서는 조건에 맞는 공고를 찾지 못했어요.";
  const names = results
    .map((row) => {
      const deadline = row.apply_end_dt ? `, 마감 ${row.apply_end_dt.slice(0, 10)}` : "";
      return `- ${String(row.title ?? "")}${deadline}`;
    })
    .join("\n");

  return {
    reply: names ? `${title}\n${names}` : title,
    results,
  };
}

async function searchAnnouncementResults({
  queryEmbedding,
  filterCategory,
  filterRegion,
  userAge,
  relaxRegionFilter = false,
}: {
  queryEmbedding: number[];
  filterCategory: string | null;
  filterRegion: string | null;
  userAge: number | null;
  relaxRegionFilter?: boolean;
}) {
  const hybridResult = await supabase.rpc("match_announcements_hybrid", {
    query_embedding: queryEmbedding,
    match_threshold: MATCH_THRESHOLD,
    match_count: MATCH_COUNT,
    filter_category: filterCategory,
    filter_region: filterRegion,
    user_age: userAge,
  });

  if (hybridResult.error) {
    throw new Error(hybridResult.error.message);
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
    throw new Error(richError.message);
  }

  const sourceRows =
    richRowsRaw && richRowsRaw.length > 0
      ? (richRowsRaw as Array<Record<string, unknown>>)
      : hybridRows;

  return sourceRows
    .map((row) => {
      const normalized = normalizeResultRow(row);
      const id = toNullableNumber(normalized.id) ?? 0;
      const similarity = similarityById.get(id) ?? 0;
      const { finalScore, matchBonus } = calculateFinalScore(
        normalized,
        similarity,
        filterRegion,
        userAge
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
        (relaxRegionFilter ||
          !filterRegion ||
          (typeof row.region === "string" &&
            buildRegionCandidates(filterRegion).includes(row.region)))
    )
    .sort(compareByFinalScoreDescThenIdAsc)
    .slice(0, RESULT_COUNT);
}

async function searchAnnouncementTitleFallback(candidates: string[]) {
  if (candidates.length === 0) return [];

  // ☑️수정: 특정 공고 신청가이드 질문은 프로필 필터보다 공고명 부분검색을 우선한다.
  let data: unknown[] | null = null;
  let error: SupabaseLikeError | null = null;

  for (const schema of ["primary_extended", "primary", "legacy"] as const) {
    const resultWithContent = await supabase
      .from("announcements")
      .select(columnsForSchema(schema))
      .or(buildTextSearchOr(candidates, ["title", "summary", "content"]))
      .limit(TITLE_FALLBACK_MATCH_LIMIT);
    data = resultWithContent.data as unknown[] | null;
    error = resultWithContent.error;

    if (error && isMissingColumnError(error)) {
      const resultWithoutContent = await supabase
        .from("announcements")
        .select(columnsForSchema(schema))
        .or(buildTextSearchOr(candidates, ["title", "summary"]))
        .limit(TITLE_FALLBACK_MATCH_LIMIT);
      data = resultWithoutContent.data as unknown[] | null;
      error = resultWithoutContent.error;
    }

    if (!error || !isMissingColumnError(error)) break;
  }

  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const normalized = normalizeResultRow(row);
      const id = toNullableNumber(normalized.id) ?? 0;
      const textScore = calculateTitleFallbackScore(normalized, candidates);
      return {
        ...normalized,
        id,
        similarity: 0,
        final_score: textScore,
        match_bonus: textScore,
      } satisfies RerankRow;
    })
    .filter(
      (row) =>
        row.id > 0 &&
        row.final_score > 0 &&
        recruitmentStatus(row.apply_start_dt, row.apply_end_dt) !== "마감"
    )
    .sort(compareByFinalScoreDescThenIdAsc)
    .slice(0, RESULT_COUNT);
}

async function selectProfileFallbackRows({
  filterCategory,
  filterRegion,
  userAge,
}: {
  filterCategory: string | null;
  filterRegion: string | null;
  userAge: number | null;
}) {
  // ☑️수정: profile semantic RPC가 비었을 때도 현재 공고 테이블 메타데이터로 프로필 추천 후보를 구성
  let data: unknown[] | null = null;
  let error: SupabaseLikeError | null = null;

  for (const schema of ["primary_extended", "primary", "legacy"] as const) {
    const result = await supabase
      .from("announcements")
      .select(columnsForSchema(schema))
      .limit(100);
    data = result.data as unknown[] | null;
    error = result.error;
    if (!error || !isMissingColumnError(error)) break;
  }

  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const normalized = normalizeResultRow(row);
      const id = toNullableNumber(normalized.id) ?? 0;
      const { finalScore, matchBonus } = calculateFinalScore(
        normalized,
        0,
        filterRegion,
        userAge
      );
      return {
        ...normalized,
        id,
        similarity: 0,
        final_score: finalScore,
        match_bonus: matchBonus,
      } satisfies RerankRow;
    })
    .filter((row) => {
      if (row.id <= 0) return false;
      if (recruitmentStatus(row.apply_start_dt, row.apply_end_dt) === "마감") {
        return false;
      }
      if (filterCategory && row.s_category !== filterCategory) return false;
      if (
        filterRegion &&
        typeof row.region === "string" &&
        !buildRegionCandidates(filterRegion).includes(row.region)
      ) {
        return false;
      }
      return rowMatchesAge(row, userAge);
    })
    .sort(compareByFinalScoreDescThenIdAsc)
    .slice(0, RESULT_COUNT);
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
    const history = normalizeActiveChatHistory(body);
    const recentResults = normalizeRecentResults(body.recent_results);
    const confirmedFilterOverride = body.confirmed_filter_override === true;

    if (!question) {
      return NextResponse.json(
        { error: "질문을 입력해주세요." },
        { status: 400 }
      );
    }

    // ☑️수정: confirm 승인 재실행은 summarize/refinement/general 분기보다 우선 처리
    const recentSummary = confirmedFilterOverride
      ? null
      : summarizeRecentResults(question, recentResults);
    if (recentSummary) {
      return NextResponse.json({
        reply: recentSummary.reply,
        results: recentSummary.results,
        intent: "summarize_recent_results",
        refinement_source: "active_chat_recent_results",
      });
    }

    const refinement = confirmedFilterOverride
      ? null
      : refineRecentResults(question, recentResults);
    if (refinement) {
      return NextResponse.json({
        reply: refinement.reply,
        results: refinement.results,
        intent: "refine_recent_results",
        refinement_source: "active_chat_recent_results",
      });
    }

    if (!confirmedFilterOverride && isCasualMessage(question)) {
      return NextResponse.json({
        reply: buildGeneralAnswer(question),
        results: [],
        intent: "general",
      });
    }

    const clientLoginId =
      typeof body.current_login_id === "string" ? body.current_login_id : null;
    const routeUserContext = await loadUserContext(request);
    const clientUserContext = contextFromClientProfile(
      body.current_profile,
      clientLoginId
    );
    const storedUserContext = mergeUserContexts(routeUserContext, clientUserContext);
    const usesStoredProfileRequest = isProfileReferenceRequest(question);
    const activeOverrideContext = usesStoredProfileRequest
      ? undefined
      : contextFromClientProfile(body.active_chat_override, clientLoginId);
    // ☑️수정: 승인된 active chat override는 원본 프로필보다 우선하되, 현재 요청에만 적용
    const userContext = mergeUserContexts(activeOverrideContext, storedUserContext);
    const profileSource = activeOverrideContext
      ? "active_chat_override"
      : routeUserContext
        ? clientUserContext
        ? "route_user_info+active_page_profile"
        : "route_user_info"
        : clientUserContext
          ? "active_page_profile"
          : "none";
    const questionSelfQuery = await extractCurrentQuestionSelfQuery(question);
    const questionUserType = extractLocalUserType(question);
    const selfQuery = await extractContextualSelfQuery(
      question,
      history,
      userContext,
      questionSelfQuery
    );
    const contextualUserContext: RagUserContext = {
      // ☑️수정: 현재 질문 조건을 최우선, 부족한 값은 프로필, 그 다음 active chat 보조값만 병합
      loginId: userContext?.loginId ?? null,
      region: selfQuery?.region ?? userContext?.region ?? null,
      category: selfQuery?.category ?? userContext?.category ?? null,
      targetAge: selfQuery?.target_age ?? userContext?.targetAge ?? null,
      userType: questionUserType ?? userContext?.userType ?? null,
    };

    if (isPersonalizedRequest(question) && !hasUserProfile(contextualUserContext)) {
      return NextResponse.json({
        reply: ASK_PROFILE_REPLY,
        results: [],
        intent: "ask_profile",
        profile_source: profileSource,
      });
    }

    const filterConflicts = buildProfileFilterConflicts(
      userContext,
      questionSelfQuery,
      questionUserType
    );

    if (filterConflicts.length > 0 && !confirmedFilterOverride) {
      return NextResponse.json({
        reply: buildFilterConflictQuestion(
          filterConflicts,
          userContext,
          questionSelfQuery,
          questionUserType
        ),
        results: [],
        intent: "confirm_filter_override",
        pending_query: question,
        pending_override_profile: buildPendingOverrideProfile(
          questionSelfQuery,
          questionUserType
        ),
        filter_conflicts: filterConflicts,
        profile_source: profileSource,
      });
    }

    const effectiveFilterCategory =
      selfQuery?.category ?? userContext?.category ?? null;
    const effectiveFilterRegion =
      selfQuery?.region ?? userContext?.region ?? null;
    const effectiveUserAge =
      selfQuery?.target_age ?? userContext?.targetAge ?? null;
    const effectiveUserContext: RagUserContext = {
      loginId: userContext?.loginId ?? null,
      region: effectiveFilterRegion,
      category: effectiveFilterCategory,
      targetAge: effectiveUserAge,
      userType: questionUserType ?? userContext?.userType ?? null,
    };
    const embeddingQuery = usesStoredProfileRequest
      ? buildProfileRecommendationQuery(question, effectiveUserContext)
      : chooseEmbeddingQuery(question, selfQuery);
    const profileContributionContext: RagUserContext = {
      loginId: userContext?.loginId ?? null,
      region: selfQuery?.region ? null : userContext?.region ?? null,
      category: selfQuery?.category ? null : userContext?.category ?? null,
      userType: questionUserType ? null : userContext?.userType ?? null,
      targetAge:
        selfQuery?.target_age !== null && selfQuery?.target_age !== undefined
          ? null
          : (userContext?.targetAge ?? null),
    };

    const titleFallbackCandidates = extractAnnouncementKeywordCandidates(question);
    let matchedByTitleFallback = false;
    // ☑️수정: 신청가이드 질문에서 공고명이 보이면 프로필/history 필터 없는 title/summary/content 검색을 먼저 시도
    let results = await searchAnnouncementTitleFallback(titleFallbackCandidates);
    matchedByTitleFallback = results.length > 0;

    let queryEmbedding: number[] | null = null;
    if (!matchedByTitleFallback) {
      queryEmbedding = await getQueryEmbedding(embeddingQuery);
      results = await searchAnnouncementResults({
        queryEmbedding,
        filterCategory: effectiveFilterCategory,
        filterRegion: effectiveFilterRegion,
        userAge: effectiveUserAge,
      });
    }

    if (usesStoredProfileRequest && results.length === 0 && queryEmbedding) {
      // ☑️수정: 프로필 기반 추천은 strict 지역/분야/나이 조합이 비면 프로필 의미 query를 유지한 채 단계적으로 완화
      const relaxedAttempts = [
        {
          filterCategory: effectiveFilterCategory,
          filterRegion: null,
          userAge: effectiveUserAge,
          relaxRegionFilter: true,
        },
        {
          filterCategory: null,
          filterRegion: effectiveFilterRegion,
          userAge: effectiveUserAge,
        },
        {
          filterCategory: effectiveFilterCategory,
          filterRegion: effectiveFilterRegion,
          userAge: null,
        },
        {
          filterCategory: null,
          filterRegion: null,
          userAge: null,
          relaxRegionFilter: true,
        },
      ];

      for (const attempt of relaxedAttempts) {
        results = await searchAnnouncementResults({
          queryEmbedding,
          filterCategory: attempt.filterCategory,
          filterRegion: attempt.filterRegion,
          userAge: attempt.userAge,
          relaxRegionFilter: attempt.relaxRegionFilter,
        });
        if (results.length > 0) break;
      }

      if (results.length === 0) {
        results = await selectProfileFallbackRows({
          filterCategory: effectiveFilterCategory,
          filterRegion: effectiveFilterRegion,
          userAge: effectiveUserAge,
        });
      }
    }

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
        // ☑️수정: 공고명 fallback으로 찾은 신청가이드 답변은 프로필 조건을 답변 근거처럼 주입하지 않는다.
        userContext: matchedByTitleFallback
          ? { loginId: userContext?.loginId ?? null }
          : effectiveUserContext,
      });
    } catch (error) {
      console.warn("[/api/chat/rag] Gemini answer failed:", error);
      reply = buildFallbackAnswer(question, policies);
    }

    if (filterConflicts.length > 0 && confirmedFilterOverride) {
      reply = `좋아요. 이번 대화에서는 방금 말씀하신 조건을 우선해서 찾아봤어요.\n\n${reply}`;
    } else if (
      !matchedByTitleFallback &&
      policies.length > 0 &&
      (usesStoredProfileRequest || history.length === 0) &&
      hasUserProfile(profileContributionContext)
    ) {
      // ☑️수정: 실제 추천 결과가 있을 때만 프로필 반영 안내를 붙여 fallback과 섞이지 않게 함
      reply = buildSavedFilterPrefix(profileContributionContext) + reply;
    }

    return NextResponse.json({
      reply,
      results,
      rpc_used: "hybrid_rerank",
      self_query: selfQuery,
      filter_conflicts: filterConflicts,
      profile_source: profileSource,
    });
  } catch (error) {
    console.error("[/api/chat/rag] error:", error);
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
