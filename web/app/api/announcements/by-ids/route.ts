import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import {
  cleanDetailUrl,
  cleanPolicyText,
  cleanTargetGroup,
  normalizeApplicationDetails,
} from "@/lib/policy-normalization";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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
type NormalizedResultRow = Record<string, unknown> & {
  id: unknown;
  summary: string | null;
  s_category: string | null;
  apply_start_dt: string | null;
  apply_end_dt: string | null;
  target_group: string | null;
  target_tags: string[];
  application_method: string | null;
  required_documents: string | null;
  additional_conditions: string | null;
  detail_url: string | null;
  similarity: number;
};

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

function normalizeIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => (typeof id === "number" ? id : Number(id)))
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 100);
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
    id: row.id,
    summary,
    s_category: sCategory,
    apply_start_dt: applyStart,
    apply_end_dt: applyEnd,
    target_group: cleanTargetGroup(row.target_group, targetTags),
    target_tags: targetTags,
    application_method: applicationDetails.application_method,
    required_documents: applicationDetails.required_documents,
    additional_conditions: toNullableString(row.additional_conditions),
    detail_url: cleanDetailUrl(row.detail_url),
    similarity: 0,
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

export async function POST(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const requestedIds = normalizeIds(body.ids);
  if (requestedIds.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const { data: scrapRows, error: scrapError } = await supabase
    .from("scraps")
    .select("ann_id")
    .eq("login_id", loginId)
    .in("ann_id", requestedIds);

  if (scrapError) {
    return NextResponse.json({ error: scrapError.message }, { status: 500 });
  }

  const allowedIds = new Set(
    ((scrapRows ?? []) as Array<{ ann_id?: unknown }>)
      .map((row) =>
        typeof row.ann_id === "number" ? row.ann_id : Number(row.ann_id)
      )
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  const ids = requestedIds.filter((id) => allowedIds.has(id));
  if (ids.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const { data, error } = await selectAnnouncementRowsByIds(ids);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const orderById = new Map(ids.map((id, index) => [id, index]));
  const results = ((data ?? []) as Array<Record<string, unknown>>)
    .map(normalizeResultRow)
    .sort(
      (a, b) =>
        (orderById.get(a.id as number) ?? 0) -
        (orderById.get(b.id as number) ?? 0)
    );

  return NextResponse.json({ results });
}
