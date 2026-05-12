import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { SavedChat } from "@/lib/types";

const CHAT_HISTORY_TABLE = "chat_history";
const TRANSCRIPT_SEPARATOR = "\n\n---\n\n";

type ChatHistoryRow = {
  chat_id: number | string;
  user_query: string | null;
  ai_response: string | null;
  created_dt: string;
};

function isMissingChatHistoryTableError(error: { message?: string; code?: string }) {
  return (
    error.code === "PGRST205" ||
    error.message?.includes("Could not find the table")
  );
}

function isChatIdRequiredError(error: { message?: string; code?: string }) {
  const message = error.message ?? "";
  return (
    error.code === "23502" ||
    (message.includes("chat_id") && (
      message.includes("null value") ||
      message.includes("violates not-null") ||
      message.includes("does not have a default")
    ))
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

function makeSavedChatTitle(content: string): string {
  const userBlock = content
    .split(TRANSCRIPT_SEPARATOR)
    .find((block) => block.slice(0, block.indexOf("\n")).trim() === "사용자");
  const source = userBlock ?? content;
  const newlineIdx = source.indexOf("\n");
  const body = (newlineIdx === -1 ? source : source.slice(newlineIdx + 1))
    .replace(/\n추천 정책 ID:.*$/m, "")
    .trim();
  const title = body || content.trim() || "저장된 대화";
  return title.length > 40 ? `${title.slice(0, 40)}...` : title;
}

function transcriptFromChatHistory(row: ChatHistoryRow): string {
  const aiResponse = row.ai_response?.trim() ?? "";
  if (
    aiResponse.includes(TRANSCRIPT_SEPARATOR) ||
    aiResponse.startsWith("사용자\n") ||
    aiResponse.startsWith("PolicyRec\n")
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
    .find((block) => block.slice(0, block.indexOf("\n")).trim() === "사용자");
  if (!userBlock) return content.slice(0, 500);
  const newlineIdx = userBlock.indexOf("\n");
  return (newlineIdx === -1 ? userBlock : userBlock.slice(newlineIdx + 1))
    .replace(/\n추천 정책 ID:.*$/m, "")
    .trim()
    .slice(0, 500);
}

function toSavedChat(row: ChatHistoryRow): SavedChat {
  const content = transcriptFromChatHistory(row);
  return {
    id: Number(row.chat_id),
    title: makeSavedChatTitle(content),
    content,
    ann_ids: [],
    created_dt: row.created_dt,
  };
}

function createFallbackChatId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function setupErrorResponse(error: { message?: string }) {
  return NextResponse.json(
    {
      error: `chat_history 테이블 접근을 확인해주세요. Supabase 스키마 캐시/컬럼 권한 문제일 수 있습니다. (${error.message ?? "unknown error"})`,
    },
    { status: 503 }
  );
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from(CHAT_HISTORY_TABLE)
    .select("chat_id,user_query,ai_response,created_dt")
    .eq("login_id", loginId)
    .order("created_dt", { ascending: false });

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
    const payload = {
      login_id: loginId,
      user_query: firstUserQueryFromTranscript(content),
      ai_response: content,
    };
    let { data, error } = await supabase
      .from(CHAT_HISTORY_TABLE)
      .insert(payload)
      .select("chat_id,user_query,ai_response,created_dt")
      .single();

    if (error && isChatIdRequiredError(error)) {
      const retry = await supabase
        .from(CHAT_HISTORY_TABLE)
        .insert({
          chat_id: createFallbackChatId(),
          ...payload,
        })
        .select("chat_id,user_query,ai_response,created_dt")
        .single();
      data = retry.data;
      error = retry.error;
    }

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
    return NextResponse.json({ error: "수정할 대화 ID가 올바르지 않습니다." }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "저장할 대화 내용이 없습니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from(CHAT_HISTORY_TABLE)
    .update({
      user_query: firstUserQueryFromTranscript(content),
      ai_response: content,
      created_dt: new Date().toISOString(),
    })
    .eq("login_id", loginId)
    .eq("chat_id", id)
    .select("chat_id,user_query,ai_response,created_dt")
    .maybeSingle();

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
    return NextResponse.json({ error: "삭제할 대화 ID가 올바르지 않습니다." }, { status: 400 });
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
