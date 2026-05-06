import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ user: null, filter: null });
  }

  const { data: filter, error } = await supabase
    .from("user_filters")
    .select("filter_id,filter_name,regions,categories,target_age,created_dt")
    .eq("login_id", loginId)
    .order("created_dt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { user: { login_id: loginId }, filter: null, filter_error: error.message },
      { status: 200 }
    );
  }

  return NextResponse.json({
    user: { login_id: loginId },
    filter: filter ?? null,
  });
}

