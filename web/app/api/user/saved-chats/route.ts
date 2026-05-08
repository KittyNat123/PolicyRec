import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { SavedChat } from "@/lib/types";

type SavedChatRow = {
  id: number | string;
  content: string;
  ann_ids: unknown;
  created_dt: string;
};

function isMissingSavedChatsTableError(error: { message?: string; code?: string }) {
  return (
    error.code === "PGRST205" ||
    error.message?.includes("Could not find the table")
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

function normalizeAnnIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const item of value) {
    const annId = normalizePositiveInteger(item);
    if (annId) seen.add(annId);
  }
  return Array.from(seen);
}

function makeSavedChatTitle(content: string): string {
  const userBlock = content
    .split("\n\n---\n\n")
    .find((block) => block.slice(0, block.indexOf("\n")).trim() === "사용자");
  const source = userBlock ?? content;
  const newlineIdx = source.indexOf("\n");
  const body = (newlineIdx === -1 ? source : source.slice(newlineIdx + 1))
    .replace(/\n추천 정책 ID:.*$/m, "")
    .trim();
  const title = body || content.trim() || "저장된 대화";
  return title.length > 40 ? `${title.slice(0, 40)}...` : title;
}

function toSavedChat(row: SavedChatRow): SavedChat {
  return {
    id: Number(row.id),
    title: makeSavedChatTitle(row.content),
    content: row.content,
    ann_ids: normalizeAnnIds(row.ann_ids),
    created_dt: row.created_dt,
  };
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("saved_chats")
    .select("id,content,ann_ids,created_dt")
    .eq("login_id", loginId)
    .order("created_dt", { ascending: false });

  if (error) {
    if (isMissingSavedChatsTableError(error)) {
      return NextResponse.json({ saved_chats: [], setup_required: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    saved_chats: ((data ?? []) as SavedChatRow[]).map(toSavedChat),
  });
}

export async function POST(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const annIds = normalizeAnnIds(body.ann_ids);

  if (!content) {
    return NextResponse.json(
      { error: "저장할 답변 내용이 없습니다." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("saved_chats")
    .insert({
      login_id: loginId,
      content,
      ann_ids: annIds,
    })
    .select("id,content,ann_ids,created_dt")
    .single();

  if (error) {
    if (isMissingSavedChatsTableError(error)) {
      return NextResponse.json(
        {
          error:
            "saved_chats 테이블이 아직 적용되지 않았어요. Database/saved_chats_ddl.sql을 먼저 적용해주세요.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved_chat: toSavedChat(data as SavedChatRow) });
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
  const annIds = normalizeAnnIds(body.ann_ids);

  if (!id) {
    return NextResponse.json(
      { error: "수정할 저장 대화 ID가 올바르지 않습니다." },
      { status: 400 }
    );
  }

  if (!content) {
    return NextResponse.json(
      { error: "저장할 대화 내용이 없습니다." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("saved_chats")
    .update({
      content,
      ann_ids: annIds,
    })
    .eq("login_id", loginId)
    .eq("id", id)
    .select("id,content,ann_ids,created_dt")
    .maybeSingle();

  if (error) {
    if (isMissingSavedChatsTableError(error)) {
      return NextResponse.json(
        {
          error:
            "saved_chats 테이블이 아직 적용되지 않았어요. Database/saved_chats_ddl.sql을 먼저 적용해주세요.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "수정할 저장 대화를 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  return NextResponse.json({ saved_chat: toSavedChat(data as SavedChatRow) });
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
    return NextResponse.json(
      { error: "삭제할 저장 답변 ID가 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("saved_chats")
    .delete()
    .eq("login_id", loginId)
    .eq("id", id);

  if (error) {
    if (isMissingSavedChatsTableError(error)) {
      return NextResponse.json(
        {
          error:
            "saved_chats 테이블이 아직 적용되지 않았어요. Database/saved_chats_ddl.sql을 먼저 적용해주세요.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
