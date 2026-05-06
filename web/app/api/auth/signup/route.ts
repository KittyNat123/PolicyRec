import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, hashPassword, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function normalizeLoginId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const loginId = normalizeLoginId(body.login_id);
    const password = typeof body.password === "string" ? body.password : "";

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

    const email =
      typeof body.email === "string" && body.email.trim()
        ? body.email.trim()
        : `${loginId}@policyrec.local`;

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

    await supabase.from("user_info").insert({ login_id: loginId });

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

