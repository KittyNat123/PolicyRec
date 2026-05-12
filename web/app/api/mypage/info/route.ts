import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const PROFILE_COLUMNS =
  "login_id,name,nickname,age_group,phone,regions,categories,user_type,created_dt,updated_dt";
const CRITICAL_PROFILE_COLUMNS = ["name", "nickname", "phone", "user_type"];

type ProfileInfo = {
  login_id?: string;
  name?: string | null;
  nickname?: string | null;
  age_group?: string | null;
  phone?: string | null;
  region?: string | null;
  regions?: string[] | null;
  categories?: string[] | null;
  user_type?: string | null;
  email?: string | null;
  updated_dt?: string | null;
};

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

function isSchemaCacheError(error: { message?: string; code?: string } | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST204" ||
    message.includes("schema cache") ||
    message.includes("Could not find") ||
    message.includes("does not exist")
  );
}

function missingColumnFromError(error: { message?: string }) {
  const message = error.message ?? "";
  return (
    message.match(/'([^']+)' column of 'user_info'/)?.[1] ??
    message.match(/Could not find the '([^']+)' column/i)?.[1] ??
    null
  );
}

function normalizeProfileText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function loadUserEmail(loginId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("email")
    .eq("login_id", loginId)
    .maybeSingle();

  if (error) throw error;
  return data?.email ?? null;
}

async function upsertUserInfoWithColumnFallback(payload: Record<string, unknown>) {
  const attemptPayload = { ...payload };
  const missingColumns: string[] = [];
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 0; attempt < 12; attempt++) {
    const { error } = await supabase
      .from("user_info")
      .upsert(attemptPayload, { onConflict: "login_id" });

    if (!error) return { ok: true, missingColumns, error: null };

    lastError = error;
    const missingColumn = missingColumnFromError(error);
    if (!missingColumn || !(missingColumn in attemptPayload)) break;

    missingColumns.push(missingColumn);
    delete attemptPayload[missingColumn];
  }

  return { ok: false, missingColumns, error: lastError };
}

function mergeProfileInfo({
  loginId,
  info,
  email,
}: {
  loginId: string;
  info: ProfileInfo | null;
  email: string | null;
}): ProfileInfo {
  const regions = normalizeStringArray(info?.regions ?? []);
  const categories = normalizeStringArray(info?.categories ?? []);

  return {
    login_id: loginId,
    ...(info ?? {}),
    email,
    age_group: info?.age_group ?? null,
    region: info?.region ?? regions[0] ?? null,
    regions,
    categories,
  };
}

function toProfileFilter(info: ProfileInfo | null, fallbackUserType: string | null = null) {
  const targetAge =
    typeof info?.age_group === "string" && info.age_group.trim()
      ? Number(info.age_group)
      : null;
  return {
    // ☑️수정: P0-0 기준으로 /api/mypage/info의 filter 응답도 user_info에서만 파생
    filter_id: undefined,
    filter_name: "기본 필터",
    regions: normalizeStringArray(info?.regions ?? []),
    categories: normalizeStringArray(info?.categories ?? []),
    target_age: Number.isInteger(targetAge) ? targetAge : null,
    user_type: info?.user_type ?? fallbackUserType ?? null,
    created_dt: undefined,
  };
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    const email = await loadUserEmail(loginId);
    const { data, error } = await supabase
      .from("user_info")
      .select(PROFILE_COLUMNS)
      .eq("login_id", loginId)
      .maybeSingle();

    if (!error) {
      return NextResponse.json({
        info: mergeProfileInfo({
          loginId,
          info: data as ProfileInfo | null,
          email,
        }),
        filter: toProfileFilter(data as ProfileInfo | null),
        setup_required: false,
      });
    }

    if (!isSchemaCacheError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      info: mergeProfileInfo({
        loginId,
        info: null,
        email,
      }),
      filter: toProfileFilter(null),
      setup_required: true,
      setup_warning:
        "Supabase API 스키마 캐시가 일부 user_info 컬럼을 아직 인식하지 못해 기본 정보만 불러왔습니다.",
      setup_error: error.message,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "프로필 정보를 불러오지 못했습니다." },
      { status: 500 }
    );
  }
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
  const categories = normalizeStringArray(body.categories);
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

  try {
    if (email) {
      const { error: emailError } = await supabase
        .from("users")
        .update({ email })
        .eq("login_id", loginId);

      if (emailError) throw emailError;
    }

    const fullPayload = {
      login_id: loginId,
      name: name || null,
      nickname: nickname || null,
      age_group: ageGroup,
      phone: phone || null,
      regions,
      categories,
      user_type: userType,
      updated_dt: new Date().toISOString(),
    };

    // ☑️수정: P0-0 기준으로 프로필 저장은 user_info 원본만 갱신하고 user_filters는 건드리지 않음
    const userInfoSave = await upsertUserInfoWithColumnFallback(fullPayload);

    if (!userInfoSave.ok) {
      return NextResponse.json(
        {
          error:
            userInfoSave.error?.message ??
            "user_info 저장에 실패했습니다. Supabase 스키마 캐시를 확인해주세요.",
          setup_required: isSchemaCacheError(userInfoSave.error),
          missing_columns: userInfoSave.missingColumns,
        },
        { status: isSchemaCacheError(userInfoSave.error) ? 503 : 500 }
      );
    }

    const criticalMissing = userInfoSave.missingColumns.filter((column) =>
      CRITICAL_PROFILE_COLUMNS.includes(column)
    );
    const setupRequired = userInfoSave.missingColumns.length > 0;
    const savedInfoResult = await supabase
      .from("user_info")
      .select(PROFILE_COLUMNS)
      .eq("login_id", loginId)
      .maybeSingle();

    if (savedInfoResult.error) {
      return NextResponse.json(
        {
          success: false,
          error: "user_info 저장 후 DB 값을 다시 확인하지 못했습니다.",
          setup_required: isSchemaCacheError(savedInfoResult.error),
          missing_columns: userInfoSave.missingColumns,
          warning: savedInfoResult.error.message,
        },
        { status: isSchemaCacheError(savedInfoResult.error) ? 503 : 500 }
      );
    }

    const savedInfo = (savedInfoResult.data ?? null) as ProfileInfo | null;
    const mismatchedColumns = CRITICAL_PROFILE_COLUMNS.filter((column) => {
      if (criticalMissing.includes(column)) return false;
      const expected = normalizeProfileText(fullPayload[column as keyof typeof fullPayload]);
      const saved = normalizeProfileText(savedInfo?.[column as keyof ProfileInfo]);
      return expected !== saved;
    });
    const failedColumns = Array.from(new Set([...criticalMissing, ...mismatchedColumns]));

    return NextResponse.json({
      success: failedColumns.length === 0,
      info: mergeProfileInfo({
        loginId,
        info: savedInfo,
        email: email || null,
      }),
      filter: toProfileFilter(savedInfo, userType),
      setup_required: setupRequired,
      missing_columns: userInfoSave.missingColumns,
      warning:
        failedColumns.length > 0
          ? `다음 컬럼은 DB 저장 후 확인값이 요청값과 다릅니다: ${failedColumns.join(", ")}`
          : setupRequired
            ? `일부 컬럼은 제외하고 저장했습니다: ${userInfoSave.missingColumns.join(", ")}`
            : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "프로필 저장에 실패했습니다." },
      { status: 500 }
    );
  }
}
