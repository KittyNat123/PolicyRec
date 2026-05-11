import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ user: null, filter: null });
  }

  const [filterResult, userResult, userInfoResult] = await Promise.all([
    supabase
      .from("user_filters")
      .select("filter_id,filter_name,regions,categories,target_age,created_dt")
      .eq("login_id", loginId)
      .order("created_dt", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("users").select("role").eq("login_id", loginId).maybeSingle(),
    supabase
      .from("user_info")
      .select("regions,categories,age_group,user_type")
      .eq("login_id", loginId)
      .maybeSingle(),
  ]);

  const role =
    userResult.data?.role === "admin" || loginId === "admin" ? "admin" : "user";

  if (filterResult.error) {
    return NextResponse.json(
      {
        user: { login_id: loginId, role },
        filter: null,
        filter_error: filterResult.error.message,
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
  const fallbackAge =
    typeof info?.age_group === "string" && info.age_group.trim()
      ? Number(info.age_group)
      : null;
  const mergedFilter =
    filterResult.data
      ? {
          ...filterResult.data,
          user_type: info?.user_type ?? null,
        }
      : info
        ? {
            filter_id: undefined,
            filter_name: "기본 필터",
            regions: info.regions ?? [],
            categories: info.categories ?? [],
            target_age: Number.isInteger(fallbackAge) ? fallbackAge : null,
            user_type: info.user_type ?? null,
            created_dt: undefined,
          }
        : null;

  return NextResponse.json({
    user: { login_id: loginId, role },
    filter: mergedFilter,
  });
}

