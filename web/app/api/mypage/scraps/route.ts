import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function normalizeAnnId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("scraps")
    .select("scrap_id,ann_id,created_dt")
    .eq("login_id", loginId)
    .order("created_dt", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ scraps: data ?? [] });
}

export async function POST(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const annId = normalizeAnnId(body.ann_id);
  if (!annId) {
    return NextResponse.json(
      { error: "공고 ID가 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("scraps")
    .select("scrap_id,ann_id,created_dt")
    .eq("login_id", loginId)
    .eq("ann_id", annId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ scrap: existing, already_saved: true });
  }

  const { data, error } = await supabase
    .from("scraps")
    .insert({ login_id: loginId, ann_id: annId })
    .select("scrap_id,ann_id,created_dt")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ scrap: data });
}

export async function DELETE(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const annId = normalizeAnnId(body.ann_id);
  if (!annId) {
    return NextResponse.json(
      { error: "공고 ID가 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("scraps")
    .delete()
    .eq("login_id", loginId)
    .eq("ann_id", annId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
