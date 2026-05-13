import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type AnnouncementRow = {
  id: number;
  title: string | null;
  provider: string | null;
  region: string | null;
  s_category: string | null;
  source: string | null;
  detail_url: string | null;
  apply_end_dt: string | null;
  created_dt: string | null;
  updated_dt: string | null;
};

type UserInfoRow = {
  login_id: string | null;
  nickname: string | null;
  name: string | null;
  age_group: string | null;
  regions: string[] | string | null;
  categories: string[] | string | null;
  user_type: string | null;
  created_dt: string | null;
};

type UserRow = {
  login_id: string | null;
  role: string | null;
  created_dt: string | null;
};

type BatchLogRow = {
  log_id: number;
  source: string | null;
  status: string | null;
  total_count: number | null;
  inserted_count: number | null;
  error_message: string | null;
  execution_time_ms: number | null;
  created_dt: string | null;
};

type ScrapAnnIdRow = {
  ann_id: number | string | null;
};

type DistributionItem = {
  label: string;
  count: number;
};

const PAGE_SIZE = 1000;
const EMPTY_LABEL = "미입력";
const STANDING_LABEL = "상시/미정";
// ☑️수정: user_info.age_group 숫자 문자열을 데모용 고정 나이대 구간으로 묶기 위한 표시 순서
const AGE_BUCKET_ORDER = ["10대 이하", "20대", "30대", "40대", "50대", "60대 이상", EMPTY_LABEL];
// ☑️수정: 사용자 분포 그래프에서 선택하지 않은 값 계열은 모두 미입력으로 통합
const EMPTY_PROFILE_VALUES = new Set(["", "선택 안함", "선택안함", "미선택", "없음", "-", "null", "undefined"]);

// ☑️수정: 관리자 대시보드가 DB를 변경하지 않도록 모든 데이터 접근을 select 조회로만 구성
async function isAdmin(loginId: string): Promise<boolean> {
  if (loginId === "admin") return true;

  const { data } = await supabase
    .from("users")
    .select("role")
    .eq("login_id", loginId)
    .maybeSingle();

  return data?.role === "admin";
}

function kstDateString(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00+09:00`);
  date.setDate(date.getDate() + days);
  return kstDateString(date);
}

function normalizeDateText(value: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function announcementStatus(
  applyEndDt: string | null,
  today: string,
  urgentUntil: string
): "모집중" | "마감" | "마감임박" | "상시/미정" {
  const endDate = normalizeDateText(applyEndDt);
  if (!endDate) return STANDING_LABEL;
  if (endDate < today) return "마감";
  if (endDate <= urgentUntil) return "마감임박";
  return "모집중";
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim() || EMPTY_LABEL;
}

function normalizeList(value: string[] | string | null): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeProfileLabel(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return EMPTY_PROFILE_VALUES.has(trimmed) || EMPTY_PROFILE_VALUES.has(trimmed.toLowerCase())
    ? EMPTY_LABEL
    : trimmed;
}

function addCount(target: Map<string, number>, rawLabel: string | null | undefined) {
  const label = normalizeText(rawLabel);
  target.set(label, (target.get(label) ?? 0) + 1);
}

function addProfileCount(target: Map<string, number>, rawLabel: string | null | undefined) {
  const label = normalizeProfileLabel(rawLabel);
  target.set(label, (target.get(label) ?? 0) + 1);
}

function normalizeProfileList(value: string[] | string | null): string[] {
  const labels = normalizeList(value).map(normalizeProfileLabel);
  return labels.length > 0 ? [...new Set(labels)] : [EMPTY_LABEL];
}

function addListCounts(target: Map<string, number>, values: string[] | string | null) {
  const normalized = normalizeList(values);
  if (normalized.length === 0) {
    addCount(target, EMPTY_LABEL);
    return;
  }
  normalized.forEach((value) => addCount(target, value));
}

function addProfileListCounts(target: Map<string, number>, values: string[] | string | null) {
  normalizeProfileList(values).forEach((value) => addProfileCount(target, value));
}

function toDistribution(map: Map<string, number>, limit = 12): DistributionItem[] {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"))
    .slice(0, limit);
}

// ☑️수정: age_group 원본값(예: "22", "35")을 숫자로 변환해 고정 연령대 구간으로 정규화
function normalizeAgeBucket(value: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return EMPTY_LABEL;

  const age = Number(trimmed);
  if (!Number.isFinite(age) || age < 0) return EMPTY_LABEL;
  if (age <= 19) return "10대 이하";
  if (age <= 29) return "20대";
  if (age <= 39) return "30대";
  if (age <= 49) return "40대";
  if (age <= 59) return "50대";
  return "60대 이상";
}

function toAgeDistribution(map: Map<string, number>): DistributionItem[] {
  return AGE_BUCKET_ORDER.map((label) => ({
    label,
    count: map.get(label) ?? 0,
  }));
}

function normalizeAnnId(value: number | string | null): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

// ☑️수정: 분야/지역/source 분포는 별도 DB 함수 없이 select 페이지네이션으로 안전하게 집계
async function fetchAllRows<T>(table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase.from(table).select(columns).range(from, to);
    if (error) throw error;

    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

function isFailureLog(row: Pick<BatchLogRow, "status" | "error_message">): boolean {
  const status = row.status?.toLowerCase() ?? "";
  if (row.error_message?.trim()) return true;
  if (!status) return false;
  return !["success", "succeeded", "ok", "completed", "done"].includes(status);
}

function displayUserName(info: UserInfoRow | undefined, loginId: string | null): string {
  if (info?.nickname?.trim()) return info.nickname.trim();
  if (loginId?.trim()) return `${loginId.slice(0, 3)}***`;
  return "사용자";
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId || !(await isAdmin(loginId))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 401 });
  }

  const today = kstDateString();
  const urgentUntil = addDays(today, 7);

  try {
    const [
      totalResult,
      openResult,
      closedResult,
      standingResult,
      urgentResult,
      embeddedResult,
      usersResult,
      scrapsResult,
      announcementRows,
      userInfoRows,
      scrapAnnRows,
      recentUsersResult,
      recentBatchLogsResult,
      allBatchLogs,
    ] = await Promise.all([
      supabase.from("announcements").select("id", { count: "exact", head: true }),
      supabase
        .from("announcements")
        .select("id", { count: "exact", head: true })
        .not("apply_end_dt", "is", null)
        .gte("apply_end_dt", today),
      supabase
        .from("announcements")
        .select("id", { count: "exact", head: true })
        .not("apply_end_dt", "is", null)
        .lt("apply_end_dt", today),
      supabase
        .from("announcements")
        .select("id", { count: "exact", head: true })
        .is("apply_end_dt", null),
      supabase
        .from("announcements")
        .select("id", { count: "exact", head: true })
        .not("apply_end_dt", "is", null)
        .gte("apply_end_dt", today)
        .lte("apply_end_dt", urgentUntil),
      supabase
        .from("announcements")
        .select("id", { count: "exact", head: true })
        .not("embedding", "is", null),
      supabase.from("users").select("user_account_id", { count: "exact", head: true }),
      supabase.from("scraps").select("scrap_id", { count: "exact", head: true }),
      fetchAllRows<AnnouncementRow>(
        "announcements",
        "id,title,provider,region,s_category,source,detail_url,apply_end_dt,created_dt,updated_dt"
      ),
      fetchAllRows<UserInfoRow>(
        "user_info",
        "login_id,nickname,name,age_group,regions,categories,user_type,created_dt"
      ),
      fetchAllRows<ScrapAnnIdRow>("scraps", "ann_id"),
      supabase
        .from("users")
        .select("login_id,role,created_dt")
        .order("created_dt", { ascending: false })
        .limit(5),
      supabase
        .from("api_batch_logs")
        .select("log_id,source,status,total_count,inserted_count,error_message,execution_time_ms,created_dt")
        .order("created_dt", { ascending: false })
        .limit(10),
      fetchAllRows<BatchLogRow>("api_batch_logs", "log_id,status,error_message"),
    ]);

    if (totalResult.error) throw totalResult.error;
    if (openResult.error) throw openResult.error;
    if (closedResult.error) throw closedResult.error;
    if (standingResult.error) throw standingResult.error;
    if (urgentResult.error) throw urgentResult.error;
    if (embeddedResult.error) throw embeddedResult.error;
    if (usersResult.error) throw usersResult.error;
    if (scrapsResult.error) throw scrapsResult.error;
    if (recentUsersResult.error) throw recentUsersResult.error;
    if (recentBatchLogsResult.error) throw recentBatchLogsResult.error;

    const categoryMap = new Map<string, number>();
    const regionMap = new Map<string, number>();
    const sourceMap = new Map<string, number>();

    const announcements = announcementRows
      .map((row) => {
        addCount(categoryMap, row.s_category);
        addCount(regionMap, row.region);
        addCount(sourceMap, row.source || row.provider);

        return {
          id: row.id,
          title: normalizeText(row.title),
          provider: normalizeText(row.provider),
          region: normalizeText(row.region),
          category: normalizeText(row.s_category),
          source: normalizeText(row.source),
          detailUrl: row.detail_url,
          applyEndDt: normalizeDateText(row.apply_end_dt),
          createdDt: row.created_dt,
          updatedDt: row.updated_dt,
          status: announcementStatus(row.apply_end_dt, today, urgentUntil),
        };
      })
      .sort((a, b) =>
        (b.updatedDt ?? b.createdDt ?? "").localeCompare(a.updatedDt ?? a.createdDt ?? "")
      );

    const ageMap = new Map<string, number>();
    const userRegionMap = new Map<string, number>();
    const interestMap = new Map<string, number>();
    const userTypeMap = new Map<string, number>();
    const userInfoByLoginId = new Map<string, UserInfoRow>();

    userInfoRows.forEach((row) => {
      if (row.login_id) userInfoByLoginId.set(row.login_id, row);
      addCount(ageMap, normalizeAgeBucket(row.age_group));
      addProfileListCounts(userRegionMap, row.regions);
      addProfileListCounts(interestMap, row.categories);
      addProfileCount(userTypeMap, row.user_type);
    });

    const recentUsers = ((recentUsersResult.data ?? []) as UserRow[]).map((user) => {
      const info = user.login_id ? userInfoByLoginId.get(user.login_id) : undefined;
      return {
        displayName: displayUserName(info, user.login_id),
        ageGroup: normalizeAgeBucket(info?.age_group ?? null),
        regions: normalizeProfileList(info?.regions ?? null).slice(0, 3),
        categories: normalizeProfileList(info?.categories ?? null).slice(0, 3),
        userType: normalizeProfileLabel(info?.user_type),
        role: user.role === "admin" ? "admin" : "user",
        createdDt: user.created_dt,
      };
    });

    const announcementById = new Map(announcements.map((row) => [row.id, row]));
    const scrapCountByAnnId = new Map<number, number>();
    scrapAnnRows.forEach((row) => {
      const annId = normalizeAnnId(row.ann_id);
      if (!annId) return;
      scrapCountByAnnId.set(annId, (scrapCountByAnnId.get(annId) ?? 0) + 1);
    });

    // ☑️수정: scraps.ann_id와 announcements.id를 메모리에서 연결해 인기 스크랩 정책 TOP 10 생성
    const popularScrappedAnnouncements = [...scrapCountByAnnId.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 10)
      .map(([annId, scrapCount], index) => {
        const announcement = announcementById.get(annId);
        if (!announcement) return null;
        return {
          rank: index + 1,
          id: announcement.id,
          title: announcement.title,
          provider: announcement.provider,
          region: announcement.region,
          category: announcement.category,
          source: announcement.source,
          detailUrl: announcement.detailUrl,
          scrapCount,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const recentBatchLogs = ((recentBatchLogsResult.data ?? []) as BatchLogRow[]).map((log) => ({
      logId: log.log_id,
      source: normalizeText(log.source),
      status: normalizeText(log.status),
      totalCount: log.total_count ?? 0,
      insertedCount: log.inserted_count ?? 0,
      errorMessage: log.error_message?.trim() || "-",
      executionTimeMs: log.execution_time_ms ?? 0,
      createdDt: log.created_dt,
    }));

    const latestBatchLog = recentBatchLogs[0] ?? null;
    const total = totalResult.count ?? 0;
    const embedded = embeddedResult.count ?? 0;

    // ☑️수정: 실제 DB에 존재하는 지표만 JSON으로 내려 mock 지표가 화면에 섞이지 않도록 정리
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      today,
      announcements: {
        total,
        open: openResult.count ?? 0,
        closed: closedResult.count ?? 0,
        standing: standingResult.count ?? 0,
        urgent: urgentResult.count ?? 0,
        embeddingCount: embedded,
        embeddingRatio: total > 0 ? Math.round((embedded / total) * 100) : 0,
        byCategory: toDistribution(categoryMap),
        byRegion: toDistribution(regionMap),
        bySource: toDistribution(sourceMap),
        recent: announcements.slice(0, 10),
        rows: announcements,
      },
      popularScrappedAnnouncements,
      users: {
        total: usersResult.count ?? 0,
        recent: recentUsers,
        byAgeGroup: toAgeDistribution(ageMap),
        byRegion: toDistribution(userRegionMap),
        byInterest: toDistribution(interestMap),
        byUserType: toDistribution(userTypeMap),
      },
      scraps: {
        total: scrapsResult.count ?? 0,
      },
      batchLogs: {
        latestStatus: latestBatchLog?.status ?? "-",
        latestTotalCount: latestBatchLog?.totalCount ?? 0,
        latestInsertedCount: latestBatchLog?.insertedCount ?? 0,
        latestExecutionTimeMs: latestBatchLog?.executionTimeMs ?? 0,
        failureCount: allBatchLogs.filter(isFailureLog).length,
        recent: recentBatchLogs,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "관리자 통계를 불러오지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
