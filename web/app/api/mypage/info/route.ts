import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_info")
    .select("*")
    .eq("login_id", loginId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "정보를 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ info: data ?? null });
}

export async function PUT(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  
  const { error } = await supabase
    .from("user_info")
    .upsert({
      login_id: loginId,
      nickname: body.nickname || null,
      age_group: body.age_group || null,
      regions: body.regions || [],
      categories: body.categories || [],
      interest_keywords: body.interest_keywords || [],
      user_type: body.user_type || null,
      updated_dt: new Date().toISOString(),
    });

  if (error) {
    return NextResponse.json({ error: "정보를 저장하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
