import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, hashPassword, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const DEFAULT_FILTER_NAME = "기본 필터";

function normalizeLoginId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFilterValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "전체") return null;
  return trimmed;
}

function normalizeAge(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 120) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 120) return parsed;
  }
  return null;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizePhone(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const loginId = normalizeLoginId(body.login_id);
    const password = typeof body.password === "string" ? body.password : "";
    const nickname = normalizeName(body.nickname);
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone);

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(loginId)) {
      return NextResponse.json(
        { error: "아이디는 영문/숫자/_ 조합 3~30자로 입력해주세요." },
        { status: 400 }
      );
    }
    if (password.length < 4) {
      return NextResponse.json(
        { error: "비밀번호는 4자 이상으로 입력해주세요." },
        { status: 400 }
      );
    }
    if (nickname.length < 2 || nickname.length > 30) {
      return NextResponse.json(
        { error: "이름은 2~30자로 입력해주세요." },
        { status: 400 }
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "이메일 형식으로 입력해주세요. 예: name@example.com" },
        { status: 400 }
      );
    }
    if (!/^01[016789]-\d{3,4}-\d{4}$/.test(phone)) {
      return NextResponse.json(
        { error: "휴대폰 번호는 010-1234-5678 형식으로 입력해주세요." },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("users").insert({
      login_id: loginId,
      email,
      password_hash: hashPassword(password),
      role: "user",
    });

    if (error) {
      const isDuplicate =
        error.code === "23505" || error.message.includes("duplicate");
      return NextResponse.json(
        {
          error: isDuplicate
            ? "이미 사용 중인 아이디입니다."
            : error.message,
        },
        { status: isDuplicate ? 409 : 500 }
      );
    }

    const region = normalizeFilterValue(body.region);
    const category = normalizeFilterValue(body.category);
    const targetAge = normalizeAge(body.target_age);
    const userType = typeof body.user_type === "string" ? body.user_type.trim() : "";

    const { error: userInfoError } = await supabase.from("user_info").insert({
      login_id: loginId,
      nickname,
      age_group: targetAge !== null ? String(targetAge) : null,
      regions: region ? [region] : [],
      categories: category ? [category] : [],
      interest_keywords: [],
      user_type: userType || null,
      phone,
    });

    if (userInfoError) {
      return NextResponse.json({ error: userInfoError.message }, { status: 500 });
    }

    const { error: filterError } = await supabase.from("user_filters").insert({
      login_id: loginId,
      filter_name: DEFAULT_FILTER_NAME,
      regions: region ? [region] : [],
      categories: category ? [category] : [],
      target_age: targetAge,
    });

    if (filterError) {
      return NextResponse.json({ error: filterError.message }, { status: 500 });
    }

    const response = NextResponse.json({ user: { login_id: loginId } });
    response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(loginId), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (e) {
    const message = e instanceof Error ? e.message : "회원가입 중 오류가 발생했어요.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

