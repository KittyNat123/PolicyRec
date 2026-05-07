import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ user: null, filter: null });
  }

  const [filterResult, userResult] = await Promise.all([
    supabase
      .from("user_filters")
      .select("filter_id,filter_name,regions,categories,target_age,created_dt")
      .eq("login_id", loginId)
      .order("created_dt", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("users").select("role").eq("login_id", loginId).maybeSingle(),
  ]);

  const role = userResult.data?.role ?? "user";

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

  return NextResponse.json({
    user: { login_id: loginId, role },
    filter: filterResult.data ?? null,
  });
}

