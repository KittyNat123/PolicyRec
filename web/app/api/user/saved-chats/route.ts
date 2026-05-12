import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { SavedChat } from "@/lib/types";

const CHAT_HISTORY_TABLE = "chat_history";
const TRANSCRIPT_SEPARATOR = "\n\n---\n\n";
const BASE_SELECT = "chat_id,user_query,ai_response,created_dt";
const SELECT_WITH_SESSION = `chat_id,session_id,user_query,ai_response,created_dt`;

type ChatHistoryRow = {
  chat_id: number | string;
  session_id?: string | null;
  user_query: string | null;
  ai_response: string | null;
  created_dt: string;
};

type SupabaseLikeError = { message?: string; code?: string };

function isMissingChatHistoryTableError(error: SupabaseLikeError) {
  return (
    error.code === "PGRST205" ||
    error.message?.includes("Could not find the table")
  );
}

function isMissingSessionIdColumnError(error: SupabaseLikeError | null) {
  const message = error?.message ?? "";
  return message.includes("session_id") && (
    message.includes("Could not find") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

function isChatIdRequiredError(error: SupabaseLikeError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "23502" ||
    (message.includes("chat_id") &&
      (message.includes("null value") ||
        message.includes("violates not-null") ||
        message.includes("does not have a default")))
  );
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function formatSessionTimestamp(date: Date) {
  return date.toISOString().replace(/\D/g, "").slice(0, 14);
}

function createSessionId(loginId: string) {
  return `${loginId}_${formatSessionTimestamp(new Date())}`;
}

function speakerLineIsUser(value: string) {
  const trimmed = value.trim();
  return trimmed === "사용자" || trimmed === "?ъ슜??";
}

function stripRecommendedIds(value: string) {
  return value
    .replace(/\n추천 정책 ID:.*$/m, "")
    .replace(/\n異붿쿇 ?뺤콉 ID:.*$/m, "")
    .trim();
}

function makeSavedChatTitle(content: string): string {
  const userBlock = content
    .split(TRANSCRIPT_SEPARATOR)
    .find((block) => speakerLineIsUser(block.slice(0, block.indexOf("\n"))));
  const source = userBlock ?? content;
  const newlineIdx = source.indexOf("\n");
  const body = stripRecommendedIds(newlineIdx === -1 ? source : source.slice(newlineIdx + 1));
  const title = body || content.trim() || "저장된 대화";
  return title.length > 40 ? `${title.slice(0, 40)}...` : title;
}

function transcriptFromChatHistory(row: ChatHistoryRow): string {
  const aiResponse = row.ai_response?.trim() ?? "";
  if (
    aiResponse.includes(TRANSCRIPT_SEPARATOR) ||
    aiResponse.startsWith("사용자\n") ||
    aiResponse.startsWith("PolicyRec\n") ||
    aiResponse.startsWith("?ъ슜??n")
  ) {
    return aiResponse;
  }

  return [
    row.user_query?.trim() ? `사용자\n${row.user_query.trim()}` : null,
    aiResponse ? `PolicyRec\n${aiResponse}` : null,
  ]
    .filter((block): block is string => Boolean(block))
    .join(TRANSCRIPT_SEPARATOR);
}

function firstUserQueryFromTranscript(content: string): string {
  const userBlock = content
    .split(TRANSCRIPT_SEPARATOR)
    .find((block) => speakerLineIsUser(block.slice(0, block.indexOf("\n"))));
  if (!userBlock) return content.slice(0, 500);
  const newlineIdx = userBlock.indexOf("\n");
  return stripRecommendedIds(newlineIdx === -1 ? userBlock : userBlock.slice(newlineIdx + 1)).slice(0, 500);
}

function toSavedChat(row: ChatHistoryRow): SavedChat {
  const content = transcriptFromChatHistory(row);
  return {
    id: Number(row.chat_id),
    session_id: row.session_id ?? null,
    title: makeSavedChatTitle(content),
    content,
    ann_ids: [],
    created_dt: row.created_dt,
  };
}

function createFallbackChatId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function setupErrorResponse(error: SupabaseLikeError) {
  return NextResponse.json(
    {
      error: `chat_history 테이블 접근을 확인해주세요. Supabase 스키마 캐시/컬럼 권한 문제일 수 있습니다. (${error.message ?? "unknown error"})`,
    },
    { status: 503 }
  );
}

async function selectSavedChats(loginId: string) {
  const withSession = await supabase
    .from(CHAT_HISTORY_TABLE)
    .select(SELECT_WITH_SESSION)
    .eq("login_id", loginId)
    .order("created_dt", { ascending: false });

  if (!withSession.error || !isMissingSessionIdColumnError(withSession.error)) {
    return withSession;
  }

  return supabase
    .from(CHAT_HISTORY_TABLE)
    .select(BASE_SELECT)
    .eq("login_id", loginId)
    .order("created_dt", { ascending: false });
}

async function insertSavedChat(payload: Record<string, unknown>) {
  let result = await supabase
    .from(CHAT_HISTORY_TABLE)
    .insert(payload)
    .select(SELECT_WITH_SESSION)
    .single();

  if (isMissingSessionIdColumnError(result.error)) {
    const withoutSessionId = { ...payload };
    delete withoutSessionId.session_id;
    result = await supabase
      .from(CHAT_HISTORY_TABLE)
      .insert(withoutSessionId)
      .select(BASE_SELECT)
      .single();
  }

  if (isChatIdRequiredError(result.error)) {
    result = await supabase
      .from(CHAT_HISTORY_TABLE)
      .insert({
        chat_id: createFallbackChatId(),
        ...payload,
      })
      .select(SELECT_WITH_SESSION)
      .single();

    if (isMissingSessionIdColumnError(result.error)) {
      const withoutSessionId = { ...payload };
      delete withoutSessionId.session_id;
      result = await supabase
        .from(CHAT_HISTORY_TABLE)
        .insert({
          chat_id: createFallbackChatId(),
          ...withoutSessionId,
        })
        .select(BASE_SELECT)
        .single();
    }
  }

  return result;
}

async function updateSavedChat(
  loginId: string,
  id: number,
  content: string,
  sessionId?: string | null
) {
  const updatePayload: Record<string, unknown> = {
    user_query: firstUserQueryFromTranscript(content),
    ai_response: content,
    created_dt: new Date().toISOString(),
  };

  if (sessionId) {
    updatePayload.session_id = sessionId;
  }

  let result = await supabase
    .from(CHAT_HISTORY_TABLE)
    .update(updatePayload)
    .eq("login_id", loginId)
    .eq("chat_id", id)
    .select(SELECT_WITH_SESSION)
    .maybeSingle();

  if (isMissingSessionIdColumnError(result.error)) {
    const fallbackPayload = { ...updatePayload };
    delete fallbackPayload.session_id;

    result = await supabase
      .from(CHAT_HISTORY_TABLE)
      .update(fallbackPayload)
      .eq("login_id", loginId)
      .eq("chat_id", id)
      .select(BASE_SELECT)
      .maybeSingle();
  }

  return result;
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await selectSavedChats(loginId);

  if (error) {
    if (isMissingChatHistoryTableError(error)) {
      return NextResponse.json({
        saved_chats: [],
        setup_required: true,
        setup_error: error.message,
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    saved_chats: ((data ?? []) as ChatHistoryRow[]).map(toSavedChat),
  });
}

export async function POST(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!content) {
    return NextResponse.json({ error: "저장할 대화 내용이 없습니다." }, { status: 400 });
  }

  try {
    const requestedSessionId =
      typeof body.session_id === "string" && body.session_id.trim()
        ? body.session_id.trim()
        : createSessionId(loginId);

    const payload = {
      login_id: loginId,
      session_id: requestedSessionId,
      user_query: firstUserQueryFromTranscript(content),
      ai_response: content,
    };

    const { data, error } = await insertSavedChat(payload);

    if (error) {
      if (isMissingChatHistoryTableError(error)) return setupErrorResponse(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ saved_chat: toSavedChat(data as ChatHistoryRow) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "저장 대화를 생성하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const id =
    normalizePositiveInteger(body.id) ??
    normalizePositiveInteger(new URL(request.url).searchParams.get("id"));
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!id) {
    return NextResponse.json({ error: "수정할 저장 대화 ID가 올바르지 않습니다." }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "저장할 대화 내용이 없습니다." }, { status: 400 });
  }

  const requestedSessionId =
    typeof body.session_id === "string" && body.session_id.trim()
      ? body.session_id.trim()
      : null;

  const { data, error } = await updateSavedChat(
    loginId,
    id,
    content,
    requestedSessionId
  );

  if (error) {
    if (isMissingChatHistoryTableError(error)) return setupErrorResponse(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "수정할 저장 대화를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ saved_chat: toSavedChat(data as ChatHistoryRow) });
}

export async function DELETE(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const id =
    normalizePositiveInteger(body.id) ??
    normalizePositiveInteger(new URL(request.url).searchParams.get("id"));

  if (!id) {
    return NextResponse.json({ error: "삭제할 저장 대화 ID가 올바르지 않습니다." }, { status: 400 });
  }

  const { error } = await supabase
    .from(CHAT_HISTORY_TABLE)
    .delete()
    .eq("login_id", loginId)
    .eq("chat_id", id);

  if (error) {
    if (isMissingChatHistoryTableError(error)) return setupErrorResponse(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
