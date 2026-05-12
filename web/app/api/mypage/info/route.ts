import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const DEFAULT_FILTER_NAME = "기본 필터";

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAgeGroup(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 120) return null;
  return String(parsed);
}

function missingColumnFromError(error: { message?: string }) {
  const match = error.message?.match(/'([^']+)' column of 'user_info'/);
  return match?.[1] ?? null;
}

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
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  const ageGroup = normalizeAgeGroup(body.age_group);
  const regions = normalizeStringArray(body.regions);
  const primaryRegion =
    typeof body.region === "string" && body.region.trim()
      ? body.region.trim()
      : regions[0] ?? null;
  const categories = normalizeStringArray(body.categories);
  const interestKeywords = normalizeStringArray(body.interest_keywords);
  const userType =
    typeof body.user_type === "string" && body.user_type.trim()
      ? body.user_type.trim()
      : null;

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
  
  const userInfoPayload: Record<string, unknown> = {
    login_id: loginId,
    name: name || null,
    nickname: nickname || null,
    age_group: ageGroup,
    phone: phone || null,
    region: primaryRegion,
    regions,
    categories,
    interest_keywords: interestKeywords,
    user_type: userType,
    updated_dt: new Date().toISOString(),
  };
  const missingColumns: string[] = [];
  let updatedInfo: Record<string, unknown> | null = null;
  let error: { message?: string } | null = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await supabase
      .from("user_info")
      .upsert(userInfoPayload, { onConflict: "login_id" })
      .select("*")
      .single();

    if (!result.error) {
      updatedInfo = result.data as Record<string, unknown>;
      error = null;
      break;
    }

    const missingColumn = missingColumnFromError(result.error);
    if (!missingColumn || !(missingColumn in userInfoPayload)) {
      error = result.error;
      break;
    }

    missingColumns.push(missingColumn);
    delete userInfoPayload[missingColumn];
  }

  if (error) {
    return NextResponse.json({ error: error.message || "정보를 저장하지 못했습니다." }, { status: 500 });
  }

  const targetAge = ageGroup ? Number(ageGroup) : null;

  const { error: deleteFilterError } = await supabase
    .from("user_filters")
    .delete()
    .eq("login_id", loginId)
    .eq("filter_name", DEFAULT_FILTER_NAME);

  if (deleteFilterError) {
    return NextResponse.json({ error: deleteFilterError.message }, { status: 500 });
  }

  const { data: updatedFilter, error: filterError } = await supabase
    .from("user_filters")
    .insert({
      login_id: loginId,
      filter_name: DEFAULT_FILTER_NAME,
      regions,
      categories,
      target_age: Number.isInteger(targetAge) ? targetAge : null,
    })
    .select("filter_id,filter_name,regions,categories,target_age,created_dt")
    .single();

  if (filterError) {
    return NextResponse.json({ error: filterError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    info: {
      ...(updatedInfo ?? {}),
      email: email || null,
    },
    filter: {
      ...(updatedFilter ?? {}),
      user_type: userType,
    },
    setup_required: missingColumns.length > 0,
    missing_columns: missingColumns,
  });
}
