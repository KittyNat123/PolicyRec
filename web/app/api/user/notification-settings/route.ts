import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const TABLE = "notification_settings";
const DEFAULT_SETTINGS = {
  deadline_notice: true,
  recommendation_notice: true,
  scrap_activity_notice: false,
};

function isMissingTableOrColumn(error: { message?: string; code?: string }) {
  const message = error.message ?? "";
  return (
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    message.includes("Could not find the table") ||
    message.includes("does not exist") ||
    message.includes("Could not find") ||
    message.includes("schema cache")
  );
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select("deadline_notice,recommendation_notice,scrap_activity_notice")
    .eq("login_id", loginId)
    .maybeSingle();

  if (error) {
    if (isMissingTableOrColumn(error)) {
      return NextResponse.json({
        settings: DEFAULT_SETTINGS,
        setup_required: true,
        setup_error: error.message,
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    settings: data ?? DEFAULT_SETTINGS,
    setup_required: false,
  });
}

export async function PUT(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const settings = {
    deadline_notice: normalizeBoolean(
      body.deadline_notice,
      DEFAULT_SETTINGS.deadline_notice
    ),
    recommendation_notice: normalizeBoolean(
      body.recommendation_notice,
      DEFAULT_SETTINGS.recommendation_notice
    ),
    scrap_activity_notice: normalizeBoolean(
      body.scrap_activity_notice,
      DEFAULT_SETTINGS.scrap_activity_notice
    ),
  };
  const payload = {
    login_id: loginId,
    ...settings,
    updated_dt: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(payload, { onConflict: "login_id" })
    .select("deadline_notice,recommendation_notice,scrap_activity_notice")
    .single();

  if (error) {
    if (isMissingTableOrColumn(error)) {
      return NextResponse.json({
        success: true,
        settings,
        setup_required: true,
        setup_error: error.message,
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    settings: data,
    setup_required: false,
  });
}
