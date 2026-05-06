import { NextRequest, NextResponse } from "next/server";
import {
  generatePolicyAnswer,
  getQueryEmbedding,
} from "@/lib/gemini";
import type { RagHistoryMessage, RagPolicyContext } from "@/lib/gemini";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MATCH_COUNT = 8;
const RESULT_COUNT = 5;

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
  summary: string | null;
  s_category: string | null;
  apply_start_dt: string | null;
  apply_end_dt: string | null;
  target_tags: string[];
  application_method: string | null;
  required_documents: string | null;
  additional_conditions: string | null;
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
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function normalizeResultRow(row: Record<string, unknown>): NormalizedResultRow {
  const summary =
    typeof row.summary === "string"
      ? row.summary
      : typeof row.content === "string"
        ? row.content
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

  return {
    ...row,
    summary,
    s_category: sCategory,
    apply_start_dt: applyStart,
    apply_end_dt: applyEnd,
    target_tags: normalizeTargetTags(row.target_tags),
    application_method: toNullableString(row.application_method),
    required_documents: toNullableString(row.required_documents),
    additional_conditions: toNullableString(row.additional_conditions),
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

function buildFallbackAnswer(question: string, policies: RagPolicyContext[]) {
  if (policies.length === 0) {
    return `"${question}"에 맞는 정책을 찾지 못했어요. 지역, 나이, 창업 단계 같은 조건을 조금 더 구체적으로 입력해보세요.`;
  }
  const names = policies
    .slice(0, 3)
    .map((policy) => `- ${policy.title}${policy.detail_url ? "" : " (상세 링크 없음)"}`)
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
    "천안",
    "아산",
    "서울",
    "경기",
    "강원",
    "충청",
    "전라",
    "경상",
    "제주",
  ];
  if (policySignals.some((signal) => normalized.includes(signal))) {
    return false;
  }

  const casualSignals = [
    "안녕",
    "안녕하세요",
    "하이",
    "ㅎㅇ",
    "hello",
    "hi",
    "고마워",
    "감사",
    "뭐해",
    "너누구",
    "도와줘",
    "정보",
    "뭘말",
    "뭐말",
    "뭐주면",
    "어떤정보",
    "어떻게말",
    "무엇을말",
  ];
  return (
    normalized.length <= 40 &&
    casualSignals.some((signal) => normalized.includes(signal))
  );
}

function buildGeneralAnswer(question: string) {
  const normalized = question.replace(/\s/g, "");
  if (
    normalized.includes("정보") ||
    normalized.includes("뭐") ||
    normalized.includes("무엇") ||
    normalized.includes("어떤")
  ) {
    return "지역, 나이, 관심 분야를 알려주시면 좋아요. 예를 들면 “천안에 사는 25살 예비창업자인데 자금 지원이 궁금해요”처럼 물어보면 맞는 정책을 찾아드릴게요.";
  }
  return "안녕하세요! 궁금한 걸 물어보세요. 지역, 나이, 관심 분야나 창업 단계가 있으면 더 잘 맞는 정책을 추천해드릴게요.";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const question = typeof body.message === "string" ? body.message.trim() : "";
    const history = normalizeHistory(body.history);

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

    const queryEmbedding = await getQueryEmbedding(question);
    const hybridResult = await supabase.rpc("match_announcements_hybrid", {
      query_embedding: queryEmbedding,
      match_threshold: 0.2,
      match_count: MATCH_COUNT,
      filter_category: null,
      filter_region: null,
      user_age: null,
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

    const results = ((richRowsRaw ?? []) as Array<Record<string, unknown>>)
      .map((row) => ({
        ...normalizeResultRow(row),
        similarity: similarityById.get(row.id as number) ?? 0,
      }))
      .sort((a, b) => b.similarity - a.similarity)
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
        detail_url: toNullableString(record.detail_url),
      };
    });

    let reply: string;
    try {
      reply = await generatePolicyAnswer({ question, policies, history });
    } catch (error) {
      console.warn("[/api/chat/rag] Gemini 답변 생성 실패:", error);
      reply = buildFallbackAnswer(question, policies);
    }

    return NextResponse.json({ reply, results, rpc_used: "hybrid" });
  } catch (error) {
    console.error("[/api/chat/rag] error:", error);
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
