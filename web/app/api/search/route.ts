// =====================================================================
// /api/search — 검색 API (POST 전용)
// =====================================================================
// 흐름:
//   1) 클라이언트가 { query, filter_category?, filter_region?, user_age? } 로 POST
//   2) 검색어 → Gemini 임베딩 (768차원)
//   3) Supabase RPC 호출 — 1차/2차 폴백 전략:
//      [1차] match_announcements_hybrid (보미님이 등록 후 사용 — 풍부한 컬럼)
//      [2차] match_announcements (구 RPC, 등록되어 있음 — id+similarity만)
//          → announcements 테이블에서 SELECT 로 풍부한 컬럼 보강
//   4) 결과 리스트를 JSON으로 반환
//
// 1차가 성공하면 그대로 반환. 1차 실패(미등록/스키마캐시 미반영) 시 2차로 자동 폴백.
// 보미님이 hybrid 등록하면 자동으로 1차에서 성공해 풍부한 컬럼 반환.
// =====================================================================

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  extractSelfQueryFilters,
  getQueryEmbedding,
  hasSelfQueryFilterSignal,
} from "@/lib/gemini";
import {
  cleanDetailUrl,
  cleanPolicyText,
  cleanTargetGroup,
  normalizeApplicationDetails,
} from "@/lib/policy-normalization";
import type { SelfQueryFilters } from "@/lib/gemini";

export const dynamic = "force-dynamic";

const DEFAULT_MATCH_COUNT = 10;
const FILTERED_FALLBACK_MATCH_COUNT = 100;
const FILTER_ONLY_MATCH_COUNT = 600;

// 카드 표시에 필요한 컬럼들 (announcements 테이블에서 SELECT)
// 누락된 컬럼이 DB에 있을 수도 있고 없을 수도 있어 안전하게 별표(*) 대신 명시
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

// Read-only compatibility bridge for older local Supabase projects.
// v1.1.9 remains the primary contract above.
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

const NATIONWIDE_REGION = "전국";
const KST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const REGION_ALIAS_GROUPS: string[][] = [
  ["강원특별자치도", "강원도"],
  ["전북특별자치도", "전라북도"],
  ["제주특별자치도", "제주도"],
  ["세종특별자치시", "세종시"],
];

type AnnouncementSchema = "primary_extended" | "primary" | "legacy";
type SupabaseLikeError = { message?: string };
type FilterConflict = {
  field: "category" | "region" | "target_age";
  ui_value: string | number;
  ai_value: string | number;
  used: "ui";
};
type NormalizedResultRow = Record<string, unknown> & {
  summary: string | null;
  s_category: string | null;
  apply_start_dt: string | null;
  apply_end_dt: string | null;
  target_tags: string[];
  target_group: string | null;
  application_method: string | null;
  required_documents: string | null;
  additional_conditions: string | null;
  detail_url: string | null;
};

function buildFilterConflicts({
  uiCategory,
  uiRegion,
  uiAge,
  selfQuery,
}: {
  uiCategory: string | null;
  uiRegion: string | null;
  uiAge: number | null;
  selfQuery: SelfQueryFilters | null;
}): FilterConflict[] {
  if (!selfQuery?.applied) return [];
  const conflicts: FilterConflict[] = [];
  if (
    uiCategory &&
    selfQuery.category &&
    uiCategory !== selfQuery.category
  ) {
    conflicts.push({
      field: "category",
      ui_value: uiCategory,
      ai_value: selfQuery.category,
      used: "ui",
    });
  }
  if (uiRegion && selfQuery.region && uiRegion !== selfQuery.region) {
    conflicts.push({
      field: "region",
      ui_value: uiRegion,
      ai_value: selfQuery.region,
      used: "ui",
    });
  }
  if (
    uiAge !== null &&
    selfQuery.target_age !== null &&
    uiAge !== selfQuery.target_age
  ) {
    conflicts.push({
      field: "target_age",
      ui_value: uiAge,
      ai_value: selfQuery.target_age,
      used: "ui",
    });
  }
  return conflicts;
}

function chooseEmbeddingQuery(
  query: string,
  selfQuery: SelfQueryFilters | null,
  uiFiltersComplete: boolean
) {
  // UI에서 카테고리+지역 둘 다 설정된 경우: 원래 쿼리로 임베딩 (0건 방지)
  if (uiFiltersComplete) return query;
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

function normalizeResultRow(row: Record<string, unknown>): NormalizedResultRow {
  const category =
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
  const summary =
    typeof row.summary === "string"
      ? cleanPolicyText(row.summary)
      : typeof row.content === "string"
        ? cleanPolicyText(row.content)
        : null;
  const targetTags = normalizeTargetTags(row.target_tags);
  const applicationDetails = normalizeApplicationDetails(
    row.application_method,
    row.required_documents
  );

  return {
    ...row,
    summary,
    s_category: category,
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

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toKstDateKey(date: Date): string {
  return KST_DATE_FORMATTER.format(date);
}

function buildRegionCandidates(filterRegion: string): string[] {
  const group = REGION_ALIAS_GROUPS.find((items) => items.includes(filterRegion));
  if (!group) return [filterRegion, NATIONWIDE_REGION];
  return Array.from(new Set([...group, NATIONWIDE_REGION]));
}

function compareBySimilarityDescThenIdAsc(
  a: Record<string, unknown>,
  b: Record<string, unknown>
) {
  const similarityA = toNullableNumber(a.similarity) ?? 0;
  const similarityB = toNullableNumber(b.similarity) ?? 0;
  if (similarityA !== similarityB) return similarityB - similarityA;

  const idA = toNullableNumber(a.id) ?? Number.MAX_SAFE_INTEGER;
  const idB = toNullableNumber(b.id) ?? Number.MAX_SAFE_INTEGER;
  return idA - idB;
}

function applyResultFilters(
  rows: Array<Record<string, unknown>>,
  filterCategory: string | null,
  filterRegion: string | null,
  userAge: number | null
) {
  let filtered = rows.map(normalizeResultRow);
  if (filterCategory) {
    filtered = filtered.filter((r) => r.s_category === filterCategory);
  }
  if (filterRegion) {
    const regionCandidates = new Set(buildRegionCandidates(filterRegion));
    // hybrid와 동일 규칙: 특정 지역 + 전국 함께 표시
    filtered = filtered.filter(
      (r) => typeof r.region === "string" && regionCandidates.has(r.region)
    );
  }
  if (userAge !== null) {
    filtered = filtered.filter((r) => {
      const min = toNullableNumber(r.target_age_min);
      const max = toNullableNumber(r.target_age_max);
      const okMin = min === null || min <= userAge;
      const okMax = max === null || max >= userAge;
      return okMin && okMax;
    });
  }
  return filtered;
}

function columnsForSchema(schema: AnnouncementSchema) {
  if (schema === "primary_extended") return PRIMARY_EXTENDED_COLUMNS;
  if (schema === "primary") return PRIMARY_BASE_COLUMNS;
  return LEGACY_RICH_COLUMNS;
}

function isPrimarySchema(schema: AnnouncementSchema) {
  return schema === "primary_extended" || schema === "primary";
}

// 첫 화면 모집중 공고용 추가 옵션 (정렬/페이지네이션/모집중 필터)
type FilterQueryOptions = {
  sortBy?: "end_date_asc" | "start_date_desc";
  offset?: number;
  limit?: number;
  onlyOpen?: boolean;
};

function buildFilteredAnnouncementsQuery(
  schema: AnnouncementSchema,
  filterCategory: string | null,
  filterRegion: string | null,
  options: FilterQueryOptions = {}
) {
  const categoryColumn = isPrimarySchema(schema) ? "s_category" : "category";
  const endDateColumn = isPrimarySchema(schema) ? "apply_end_dt" : "end_date";
  const startDateColumn = isPrimarySchema(schema)
    ? "apply_start_dt"
    : "start_date";
  let tableQuery = supabase.from("announcements").select(columnsForSchema(schema));

  if (filterCategory) {
    tableQuery = tableQuery.eq(categoryColumn, filterCategory);
  }
  if (filterRegion) {
    tableQuery = tableQuery.in("region", buildRegionCandidates(filterRegion));
  }
  if (options.onlyOpen) {
    const today = toKstDateKey(new Date()); // YYYY-MM-DD (KST)
    tableQuery = tableQuery.gte(endDateColumn, today);
  }

  // 정렬
  if (options.sortBy === "start_date_desc") {
    tableQuery = tableQuery
      .order(startDateColumn, { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
  } else {
    // 기본: 마감 임박순
    tableQuery = tableQuery
      .order(endDateColumn, { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
  }

  // 페이지네이션 (offset/limit 지정 시) 또는 기본 상한
  const offset = options.offset ?? 0;
  const limit = options.limit ?? FILTER_ONLY_MATCH_COUNT;
  tableQuery = tableQuery.range(offset, offset + limit - 1);

  return tableQuery;
}

async function searchByFiltersOnly(
  filterCategory: string | null,
  filterRegion: string | null,
  userAge: number | null,
  options: FilterQueryOptions = {}
) {
  // hasMore 판단을 위해 limit+1 개 가져옴 (이후 잘라냄)
  const requestedLimit = options.limit ?? FILTER_ONLY_MATCH_COUNT;
  const probeOptions: FilterQueryOptions = {
    ...options,
    limit: requestedLimit + 1,
  };

  let data: unknown[] | null = null;
  let error: SupabaseLikeError | null = null;

  for (const schema of ["primary_extended", "primary", "legacy"] as const) {
    const result = await buildFilteredAnnouncementsQuery(
      schema,
      filterCategory,
      filterRegion,
      probeOptions
    );
    data = result.data as unknown[] | null;
    error = result.error;
    if (!error || !isMissingColumnError(error)) break;
  }

  if (error) {
    return { results: [], hasMore: false, error };
  }

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const filtered = applyResultFilters(
    rows,
    filterCategory,
    filterRegion,
    userAge
  );
  const hasMore = filtered.length > requestedLimit;
  const results = filtered.slice(0, requestedLimit).map((row) => ({
    ...normalizeResultRow(row),
    similarity: 0,
  }));

  return { results, hasMore, error: null };
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

export async function POST(request: NextRequest) {
  try {
    // ----- 1. 요청 파싱 -----
    const body = await request.json().catch(() => ({}));
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const rawFilterCategory =
      typeof body.filter_category === "string" ? body.filter_category.trim() : "";
    const rawFilterRegion =
      typeof body.filter_region === "string" ? body.filter_region.trim() : "";
    const filterCategory =
      rawFilterCategory && rawFilterCategory !== "전체" ? rawFilterCategory : null;
    const filterRegion =
      rawFilterRegion && rawFilterRegion !== "전체" ? rawFilterRegion : null;
    const userAge = toNullableNumber(body.user_age);

    // 첫 화면 모집중 공고용 추가 파라미터 (검색어 없을 때만 의미 있음)
    const sortBy: "end_date_asc" | "start_date_desc" =
      body.sort_by === "start_date_desc" ? "start_date_desc" : "end_date_asc";
    const offset =
      typeof body.offset === "number" && body.offset >= 0 ? body.offset : 0;
    const limit =
      typeof body.limit === "number" && body.limit > 0
        ? Math.min(body.limit, 100)
        : null; // null이면 기존 기본값(FILTER_ONLY_MATCH_COUNT) 사용
    const onlyOpen = body.only_open === true;

    if (!query) {
      const filterOnlyResult = await searchByFiltersOnly(
        filterCategory,
        filterRegion,
        userAge,
        {
          sortBy,
          offset,
          limit: limit ?? undefined,
          onlyOpen,
        }
      );

      if (filterOnlyResult.error) {
        return NextResponse.json(
          { error: filterOnlyResult.error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        results: filterOnlyResult.results,
        hasMore: filterOnlyResult.hasMore,
        rpc_used: "table_filter",
        self_query: null,
        filter_conflicts: [],
      });
    }

    const shouldExtractSelfQuery =
      (!filterCategory || !filterRegion || userAge === null) &&
      hasSelfQueryFilterSignal(query);
    const selfQuery = shouldExtractSelfQuery
      ? await extractSelfQueryFilters(query)
      : null;
    const filterConflicts = buildFilterConflicts({
      uiCategory: filterCategory,
      uiRegion: filterRegion,
      uiAge: userAge,
      selfQuery,
    });
    // 카테고리는 taxonomy가 애매한 질문에서 false negative를 만들기 쉬워서
    // 사용자가 UI로 고른 값만 하드 필터로 적용합니다.
    const effectiveFilterCategory = filterCategory;
    const effectiveFilterRegion = filterRegion ?? selfQuery?.region ?? null;
    const effectiveUserAge = userAge ?? selfQuery?.target_age ?? null;
    const uiFiltersComplete = Boolean(filterCategory && filterRegion);
    const embeddingQuery = chooseEmbeddingQuery(query, selfQuery, uiFiltersComplete);

    // ----- 2. 검색어 → 임베딩 -----
    const queryEmbedding = await getQueryEmbedding(embeddingQuery);

    // ----- 3-1. 1차: hybrid RPC 시도 (필터 + 풍부한 컬럼) -----
    const hybridResult = await supabase.rpc("match_announcements_hybrid", {
      query_embedding: queryEmbedding,
      match_threshold: 0.65,
      match_count: 10,
      filter_category: effectiveFilterCategory,
      filter_region: effectiveFilterRegion,
      user_age: effectiveUserAge,
    });

    if (!hybridResult.error) {
      // 성공 (보미님 등록 완료 시점부터 자동으로 이 길로 들어옴)
      const hybridRows = (hybridResult.data ?? []) as Array<
        Record<string, unknown> & { id: number; similarity?: number }
      >;
      const ids = hybridRows.map((row) => row.id).filter(Number.isFinite);
      const { data: richRowsRaw, error: richError } =
        ids.length > 0
          ? await selectAnnouncementRowsByIds(ids)
          : { data: null, error: null };
      const similarityById = new Map(
        hybridRows.map((row) => [row.id, Number(row.similarity ?? 0)])
      );
      const results =
        richError || !richRowsRaw
          ? hybridRows.map(normalizeResultRow)
          : ((richRowsRaw ?? []) as Array<Record<string, unknown>>)
            .map((row) => ({
              ...row,
              similarity: similarityById.get(row.id as number) ?? 0,
            }))
            .sort(compareBySimilarityDescThenIdAsc)
            .map(normalizeResultRow);
      return NextResponse.json({
        results,
        rpc_used: richError ? "hybrid" : "hybrid_with_table",
        self_query: selfQuery,
        filter_conflicts: filterConflicts,
      });
    }

    // hybrid 실패 → 로그 + 2차 폴백
    console.warn(
      "[/api/search] hybrid RPC 실패 → 구 match_announcements로 폴백:",
      hybridResult.error.message
    );

    // ----- 3-2. 2차: 구 match_announcements + table SELECT 보강 -----
    const hasFallbackFilters =
      Boolean(effectiveFilterCategory || effectiveFilterRegion) ||
      effectiveUserAge !== null;
    const basicResult = await supabase.rpc("match_announcements", {
      query_embedding: queryEmbedding,
      match_threshold: 0.65,
      match_count: hasFallbackFilters
        ? FILTERED_FALLBACK_MATCH_COUNT
        : DEFAULT_MATCH_COUNT,
    });

    if (basicResult.error) {
      // 둘 다 실패 — 진짜 문제
      console.error(
        "[/api/search] 두 RPC 모두 실패:",
        basicResult.error
      );
      return NextResponse.json(
        {
          error: basicResult.error.message,
          hint:
            "Supabase에 RPC가 등록되어 있지 않습니다. " +
            "Database/RPC_match_announcements_hybrid_v1.sql 또는 " +
            "Database/유사도 검색을 위한 RPC 함수 생성.txt 를 SQL Editor에서 실행하세요.",
        },
        { status: 500 }
      );
    }

    const basicRows = (basicResult.data ?? []) as Array<{
      id: number;
      similarity: number;
      [key: string]: unknown;
    }>;

    if (basicRows.length === 0) {
      return NextResponse.json({
        results: [],
        rpc_used: "basic",
        self_query: selfQuery,
        filter_conflicts: filterConflicts,
      });
    }

    // 구 RPC는 반환 컬럼이 적으므로 announcements 테이블에서 풍부한 컬럼 보강
    const ids = basicRows.map((r) => r.id);
    const { data: richRowsRaw, error: richError } =
      await selectAnnouncementRowsByIds(ids);

    if (richError) {
      console.warn(
        "[/api/search] 풍부한 컬럼 보강 실패 — 구 RPC 결과만 반환:",
        richError.message
      );
      const fallbackRows = applyResultFilters(
        basicRows.map(normalizeResultRow),
        effectiveFilterCategory,
        effectiveFilterRegion,
        effectiveUserAge
      ).slice(0, DEFAULT_MATCH_COUNT);
      return NextResponse.json({
        results: fallbackRows,
        rpc_used: "basic_only",
        self_query: selfQuery,
        filter_conflicts: filterConflicts,
      });
    }

    // Supabase 타입 생성 파일이 아직 없어서, select 결과를 직접 행 객체로 간주합니다.
    const richRows = (richRowsRaw ?? []) as unknown as Array<Record<string, unknown>>;

    // similarity는 RPC에서, 나머지 컬럼은 table에서 가져와 합치기
    const similarityById = new Map(
      basicRows.map((r) => [r.id, r.similarity])
    );

    // similarity 순으로 정렬해서 반환
    const merged: Array<Record<string, unknown> & { similarity: number }> = richRows
      .map((row) => ({
        ...row,
        similarity: similarityById.get(row.id as number) ?? 0,
      }))
      .sort(compareBySimilarityDescThenIdAsc);

    // 클라이언트 사이드 필터 적용 (구 RPC는 필터 인자 안 받으므로 여기서 처리)
    const filtered = applyResultFilters(
      merged.map(normalizeResultRow),
      effectiveFilterCategory,
      effectiveFilterRegion,
      effectiveUserAge
    ).slice(0, DEFAULT_MATCH_COUNT);

    return NextResponse.json({
      results: filtered,
      rpc_used: "basic_with_table",
      self_query: selfQuery,
      filter_conflicts: filterConflicts,
    });
  } catch (e) {
    console.error("[/api/search] error:", e);
    const message = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
