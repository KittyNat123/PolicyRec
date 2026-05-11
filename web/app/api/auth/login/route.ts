import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE_NAME, verifyPassword } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const loginId = typeof body.login_id === "string" ? body.login_id.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!loginId || !password) {
      return NextResponse.json(
        { error: "아이디와 비밀번호를 입력해주세요." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("users")
      .select("login_id,password_hash,role")
      .eq("login_id", loginId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || !verifyPassword(password, data.password_hash as string)) {
      return NextResponse.json(
        { error: "아이디 또는 비밀번호가 맞지 않습니다." },
        { status: 401 }
      );
    }

    const role = data.role === "admin" || loginId === "admin" ? "admin" : "user";
    const response = NextResponse.json({ user: { login_id: loginId, role } });
    response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(loginId), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (e) {
    const message = e instanceof Error ? e.message : "로그인 중 오류가 발생했어요.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
