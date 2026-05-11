import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const DEFAULT_FILTER_NAME = "기본 필터";

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
  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("email")
    .eq("login_id", loginId)
    .maybeSingle();

  if (error || userError) {
    return NextResponse.json({ error: "정보를 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    info: {
      ...(data ?? {}),
      email: userData?.email ?? null,
    },
  });
}

export async function PUT(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "이메일 형식으로 입력해주세요." }, { status: 400 });
  }
  if (phone && !/^01[016789]-\d{3,4}-\d{4}$/.test(phone)) {
    return NextResponse.json(
      { error: "휴대폰 번호는 010-1234-5678 형식으로 입력해주세요." },
      { status: 400 }
    );
  }

  if (email) {
    const { error: emailError } = await supabase
      .from("users")
      .update({ email })
      .eq("login_id", loginId);

    if (emailError) {
      return NextResponse.json({ error: "이메일을 저장하지 못했습니다." }, { status: 500 });
    }
  }
  
  const { error } = await supabase
    .from("user_info")
    .upsert({
      login_id: loginId,
      nickname: body.nickname || null,
      age_group: body.age_group || null,
      phone: phone || null,
      regions: body.regions || [],
      categories: body.categories || [],
      interest_keywords: body.interest_keywords || [],
      user_type: body.user_type || null,
      updated_dt: new Date().toISOString(),
    });

  if (error) {
    return NextResponse.json({ error: "정보를 저장하지 못했습니다." }, { status: 500 });
  }

  const regions = Array.isArray(body.regions) ? body.regions : [];
  const categories = Array.isArray(body.categories) ? body.categories : [];
  const targetAge =
    typeof body.age_group === "string" && body.age_group.trim()
      ? Number(body.age_group)
      : null;

  await supabase
    .from("user_filters")
    .delete()
    .eq("login_id", loginId)
    .eq("filter_name", DEFAULT_FILTER_NAME);

  await supabase.from("user_filters").insert({
    login_id: loginId,
    filter_name: DEFAULT_FILTER_NAME,
    regions,
    categories,
    target_age: Number.isInteger(targetAge) ? targetAge : null,
  });

  return NextResponse.json({ success: true });
}
