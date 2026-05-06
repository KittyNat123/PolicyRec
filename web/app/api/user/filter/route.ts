import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const DEFAULT_FILTER_NAME = "기본 필터";

function normalizeFilterValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "전체") return null;
  return trimmed;
}

function normalizeAge(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_filters")
    .select("filter_id,filter_name,regions,categories,target_age,created_dt")
    .eq("login_id", loginId)
    .order("created_dt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ filter: data ?? null });
}

export async function POST(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const region = normalizeFilterValue(body.region);
  const category = normalizeFilterValue(body.category);
  const targetAge = normalizeAge(body.target_age);

  const { error: deleteError } = await supabase
    .from("user_filters")
    .delete()
    .eq("login_id", loginId)
    .eq("filter_name", DEFAULT_FILTER_NAME);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("user_filters")
    .insert({
      login_id: loginId,
      filter_name: DEFAULT_FILTER_NAME,
      regions: region ? [region] : [],
      categories: category ? [category] : [],
      target_age: targetAge,
    })
    .select("filter_id,filter_name,regions,categories,target_age,created_dt")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ filter: data });
}

