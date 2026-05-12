import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function toProfileFilter(info: {
  regions?: string[] | null;
  categories?: string[] | null;
  age_group?: string | null;
  user_type?: string | null;
} | null) {
  const targetAge =
    typeof info?.age_group === "string" && info.age_group.trim()
      ? Number(info.age_group)
      : null;
  return {
    // ☑️수정: P0-0에서 savedFilter 응답은 user_info 원본 프로필을 기준으로 구성
    filter_id: undefined,
    filter_name: "기본 필터",
    regions: info?.regions ?? [],
    categories: info?.categories ?? [],
    target_age: Number.isInteger(targetAge) ? targetAge : null,
    user_type: info?.user_type ?? null,
    created_dt: undefined,
  };
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ user: null, filter: null });
  }

  const [userResult, userInfoResult] = await Promise.all([
    supabase.from("users").select("role").eq("login_id", loginId).maybeSingle(),
    supabase
      .from("user_info")
      .select("regions,categories,age_group,user_type")
      .eq("login_id", loginId)
      .maybeSingle(),
  ]);

  const role =
    userResult.data?.role === "admin" || loginId === "admin" ? "admin" : "user";

  if (userInfoResult.error) {
    return NextResponse.json(
      {
        user: { login_id: loginId, role },
        filter: null,
        filter_error: userInfoResult.error.message,
      },
      { status: 200 }
    );
  }

  const info = userInfoResult.data as {
    regions?: string[] | null;
    categories?: string[] | null;
    age_group?: string | null;
    user_type?: string | null;
  } | null;
  const mergedFilter = info ? toProfileFilter(info) : null;

  return NextResponse.json({
    user: { login_id: loginId, role },
    filter: mergedFilter,
  });
}

