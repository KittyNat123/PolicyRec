"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";

type AnnouncementStatus = "모집중" | "마감" | "마감임박" | "상시/미정";

type DistributionItem = {
  label: string;
  count: number;
};

type AnnouncementItem = {
  id: number;
  title: string;
  provider: string;
  region: string;
  category: string;
  source: string;
  detailUrl: string | null;
  applyEndDt: string | null;
  createdDt: string | null;
  updatedDt: string | null;
  status: AnnouncementStatus;
};

type PopularScrappedAnnouncement = {
  rank: number;
  id: number;
  title: string;
  provider: string;
  region: string;
  category: string;
  source: string;
  detailUrl: string | null;
  scrapCount: number;
};

type RecentUser = {
  displayName: string;
  ageGroup: string;
  regions: string[];
  categories: string[];
  userType: string;
  role: "admin" | "user";
  createdDt: string | null;
};

type BatchLog = {
  logId: number;
  source: string;
  status: string;
  totalCount: number;
  insertedCount: number;
  errorMessage: string;
  executionTimeMs: number;
  createdDt: string | null;
};

type AdminStats = {
  generatedAt: string;
  today: string;
  announcements: {
    total: number;
    open: number;
    closed: number;
    standing: number;
    urgent: number;
    embeddingCount: number;
    embeddingRatio: number;
    byCategory: DistributionItem[];
    byRegion: DistributionItem[];
    bySource: DistributionItem[];
    recent: AnnouncementItem[];
    rows: AnnouncementItem[];
  };
  popularScrappedAnnouncements: PopularScrappedAnnouncement[];
  users: {
    total: number;
    recent: RecentUser[];
    byAgeGroup: DistributionItem[];
    byRegion: DistributionItem[];
    byInterest: DistributionItem[];
    byUserType: DistributionItem[];
  };
  scraps: {
    total: number;
  };
  batchLogs: {
    latestStatus: string;
    latestTotalCount: number;
    latestInsertedCount: number;
    latestExecutionTimeMs: number;
    failureCount: number;
    recent: BatchLog[];
  };
};

type AdminTab = "dashboard" | "announcements" | "users";

const ALL_OPTION = "전체";

// ☑️수정: 오늘 데모 범위에 맞춰 mock 지표 없이 read-only 관리자 탭만 유지
const TABS: Array<{ key: AdminTab; label: string }> = [
  { key: "dashboard", label: "대시보드" },
  { key: "announcements", label: "공고 데이터 조회" },
  { key: "users", label: "사용자 현황" },
];

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    void (async () => {
      const res = await fetch("/api/admin/stats", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/");
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!alive) return;

      if (!res.ok) {
        setError(data.error ?? "관리자 통계를 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      setStats(data as AdminStats);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  if (loading) {
    return (
      <AdminShell>
        <div className="px-6 py-10 text-sm text-slate-500">
          실제 DB 기준 관리자 데이터를 불러오는 중입니다.
        </div>
      </AdminShell>
    );
  }

  if (error || !stats) {
    return (
      <AdminShell>
        <div className="px-6 py-10">
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {error ?? "관리자 데이터를 확인할 수 없습니다."}
          </div>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <main className="mx-auto max-w-[1280px] px-4 py-7 sm:px-6">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">관리자 대시보드</h1>
            <p className="mt-2 text-sm text-slate-500">
              실제 DB의 공고, 사용자 조건, 스크랩, 수집 로그를 조회 전용으로 확인합니다.
            </p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">
            read-only · DB select 조회
          </div>
        </div>

        <div className="mb-6 inline-flex rounded-lg bg-slate-100 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-md px-4 py-2 text-sm font-bold ${
                activeTab === tab.key
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "dashboard" && <DashboardTab stats={stats} />}
        {activeTab === "announcements" && <AnnouncementsTab stats={stats} />}
        {activeTab === "users" && <UsersTab stats={stats} />}
      </main>
    </AdminShell>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AppHeader currentUser={{ login_id: "admin", role: "admin" }} />
      {children}
    </div>
  );
}

function DashboardTab({ stats }: { stats: AdminStats }) {
  const openWithoutUrgent = Math.max(stats.announcements.open - stats.announcements.urgent, 0);
  const statusItems = [
    { label: "모집중", count: openWithoutUrgent, color: "bg-emerald-500" },
    { label: "마감임박", count: stats.announcements.urgent, color: "bg-amber-500" },
    { label: "마감", count: stats.announcements.closed, color: "bg-slate-400" },
    { label: "상시/미정", count: stats.announcements.standing, color: "bg-blue-500" },
  ];

  return (
    <div className="space-y-6">
      {/* ☑️수정: 발표 첫 화면은 실제 DB 핵심 요약 4개만 남겨 복잡도를 줄임 */}
      <div className="grid gap-4 md:grid-cols-4">
        <AdminMetric label="전체 공고 수" value={formatCount(stats.announcements.total)} sub="announcements" tone="blue" />
        <AdminMetric label="모집중 공고 수" value={formatCount(stats.announcements.open)} sub="마감임박 포함" tone="green" />
        <AdminMetric label="전체 가입자 수" value={formatCount(stats.users.total)} sub="users" tone="blue" />
        <AdminMetric label="전체 스크랩 수" value={formatCount(stats.scraps.total)} sub="scraps" tone="green" />
      </div>

      {/* ☑️수정: 데모에서 빈 수집 상태 카드 대신 공고 상태 현황을 가로 전체 폭으로 강조 */}
      <div className="grid gap-4">
        <Panel title="공고 상태 현황" emphasis>
          <StatusRatioBar items={statusItems} total={stats.announcements.total} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="분야별 공고 현황">
          <HorizontalBars items={stats.announcements.byCategory} />
        </Panel>
        <Panel title="지역별 공고 현황">
          <HorizontalBars items={stats.announcements.byRegion} />
        </Panel>
        <Panel title="source/provider별 공고 현황">
          <HorizontalBars items={stats.announcements.bySource} />
        </Panel>
      </div>

      {/* ☑️수정: 사용자 분포 그래프는 사용자 현황 탭에만 남기고 대시보드에서는 숨김 */}
      {/* ☑️수정: 하단 목록은 발표 가독성을 위해 나란히가 아닌 전체 폭 카드로 세로 배치 */}
      <div className="space-y-4">
        <Panel title="최근 등록/업데이트 공고 10개">
          <AnnouncementCompactList items={stats.announcements.recent} />
        </Panel>
        <Panel title="인기 스크랩 정책 TOP 10" description="사용자들이 가장 많이 저장한 정책입니다.">
          <PopularScrappedAnnouncementsTable items={stats.popularScrappedAnnouncements} />
        </Panel>
      </div>
    </div>
  );
}

function AnnouncementsTab({ stats }: { stats: AdminStats }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(ALL_OPTION);
  const [category, setCategory] = useState<string>(ALL_OPTION);
  const [region, setRegion] = useState<string>(ALL_OPTION);
  const [source, setSource] = useState<string>(ALL_OPTION);

  // ☑️수정: 정책 관리 기능을 제거하고 클라이언트 필터 기반 공고 조회만 제공
  const options = useMemo(() => {
    return {
      categories: uniqueOptions(stats.announcements.rows.map((item) => item.category)),
      regions: uniqueOptions(stats.announcements.rows.map((item) => item.region)),
      sources: uniqueOptions(stats.announcements.rows.map((item) => item.source)),
    };
  }, [stats.announcements.rows]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return stats.announcements.rows.filter((item) => {
      const matchesQuery =
        !normalizedQuery ||
        item.title.toLowerCase().includes(normalizedQuery) ||
        item.provider.toLowerCase().includes(normalizedQuery);
      const matchesStatus = status === ALL_OPTION || item.status === status;
      const matchesCategory = category === ALL_OPTION || item.category === category;
      const matchesRegion = region === ALL_OPTION || item.region === region;
      const matchesSource = source === ALL_OPTION || item.source === source;

      return matchesQuery && matchesStatus && matchesCategory && matchesRegion && matchesSource;
    });
  }, [category, query, region, source, stats.announcements.rows, status]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="제목 또는 기관 검색"
            className="min-w-0 rounded-lg border border-slate-200 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
          <FilterSelect value={status} onChange={setStatus} options={[ALL_OPTION, "모집중", "마감임박", "마감", "상시/미정"]} />
          <FilterSelect value={category} onChange={setCategory} options={[ALL_OPTION, ...options.categories]} />
          <FilterSelect value={region} onChange={setRegion} options={[ALL_OPTION, ...options.regions]} />
          <FilterSelect value={source} onChange={setSource} options={[ALL_OPTION, ...options.sources]} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {formatCount(filtered.length)}개 표시 / 전체 {formatCount(stats.announcements.rows.length)}개
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-500">
              <tr>
                {["제목", "기관", "지역", "분야", "상태", "마감일", "source", "상세 보기"].map((head) => (
                  <th key={head} className="px-4 py-3">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((item) => (
                <tr key={item.id} className="border-t border-slate-100 align-top">
                  <td className="max-w-[340px] px-4 py-4 font-semibold text-slate-800">{item.title}</td>
                  <td className="px-4 py-4 text-slate-600">{item.provider}</td>
                  <td className="px-4 py-4 text-slate-600">{item.region}</td>
                  <td className="px-4 py-4 text-slate-600">{item.category}</td>
                  <td className="px-4 py-4">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-4 text-slate-600">{item.applyEndDt ?? "상시/미정"}</td>
                  <td className="px-4 py-4 text-slate-600">{item.source}</td>
                  <td className="px-4 py-4">
                    {item.detailUrl ? (
                      <a
                        href={item.detailUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold text-blue-700 hover:text-blue-800"
                      >
                        열기
                      </a>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <EmptyState label="조건에 맞는 공고가 없습니다." />}
        {filtered.length > 100 && (
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            화면 성능을 위해 상위 100개만 표시합니다. 검색어나 필터를 좁혀 확인하세요.
          </div>
        )}
      </div>
    </div>
  );
}

function UsersTab({ stats }: { stats: AdminStats }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <AdminMetric label="전체 가입자 수" value={formatCount(stats.users.total)} sub="users" tone="blue" />
        <AdminMetric label="최근 신규 가입자" value={formatCount(stats.users.recent.length)} sub="최근 5명" tone="green" />
        <AdminMetric label="나이대 항목" value={formatCount(stats.users.byAgeGroup.length)} sub="user_info.age_group" tone="violet" />
        <AdminMetric label="사용자 유형 항목" value={formatCount(stats.users.byUserType.length)} sub="user_info.user_type" tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="나이대별 사용자 분포">
          <VerticalBars items={stats.users.byAgeGroup} />
        </Panel>
        <Panel title="사용자 유형별 분포">
          <HorizontalBars items={stats.users.byUserType} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="지역별 사용자 분포">
          <HorizontalBars items={stats.users.byRegion} />
        </Panel>
        <Panel title="관심분야별 사용자 분포">
          <HorizontalBars items={stats.users.byInterest} />
        </Panel>
      </div>

      <Panel title="최근 신규 가입자">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-500">
              <tr>
                {["닉네임", "나이대", "지역", "관심분야", "사용자 유형", "가입일"].map((head) => (
                  <th key={head} className="px-4 py-3">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.users.recent.map((user, index) => (
                <tr key={`${user.displayName}-${index}`} className="border-t border-slate-100">
                  <td className="px-4 py-4 font-semibold text-slate-800">{user.displayName}</td>
                  <td className="px-4 py-4 text-slate-600">{user.ageGroup}</td>
                  <td className="px-4 py-4 text-slate-600">{joinLabels(user.regions)}</td>
                  <td className="px-4 py-4 text-slate-600">{joinLabels(user.categories)}</td>
                  <td className="px-4 py-4 text-slate-600">{user.userType}</td>
                  <td className="px-4 py-4 text-slate-600">{formatDate(user.createdDt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stats.users.recent.length === 0 && <EmptyState label="최근 가입자 데이터가 없습니다." />}
      </Panel>
      {/* ☑️수정: 데모 기준 빈 api_batch_logs 영역은 사용자 현황 화면에서도 노출하지 않음 */}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-0 rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function AdminMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "blue" | "green" | "violet" | "amber" | "red" | "slate";
}) {
  const toneClass = {
    blue: "text-blue-600",
    green: "text-emerald-600",
    violet: "text-violet-600",
    amber: "text-amber-600",
    red: "text-red-600",
    slate: "text-slate-700",
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-3 text-3xl font-bold ${toneClass}`}>{value}</p>
      <p className="mt-2 text-xs font-semibold text-slate-500">{sub}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-2 break-words text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}

function Panel({
  title,
  description,
  emphasis = false,
  children,
}: {
  title: string;
  description?: string;
  emphasis?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-lg border bg-white p-5 ${
        emphasis ? "border-blue-200 shadow-sm ring-1 ring-blue-100" : "border-slate-200"
      }`}
    >
      <h2 className={`${emphasis ? "text-xl" : "text-lg"} font-bold text-slate-950`}>{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ☑️수정: 새 차트 라이브러리 없이 CSS div 기반 막대 그래프로 분포를 표현
function HorizontalBars({ items }: { items: DistributionItem[] }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  if (items.length === 0) return <EmptyState label="표시할 데이터가 없습니다." />;

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[96px_1fr_52px] items-center gap-3">
          <span className="truncate text-sm text-slate-600" title={item.label}>
            {item.label}
          </span>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-blue-600"
              style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }}
            />
          </div>
          <span className="text-right text-sm font-bold text-slate-700">{formatCount(item.count)}</span>
        </div>
      ))}
    </div>
  );
}

function VerticalBars({ items }: { items: DistributionItem[] }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  if (items.length === 0) return <EmptyState label="표시할 데이터가 없습니다." />;

  return (
    <div className="flex h-56 items-end gap-3 px-2 pt-6">
      {items.slice(0, 8).map((item) => (
        <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <span className="text-xs font-bold text-slate-700">{formatCount(item.count)}</span>
          <div className="flex h-36 w-full items-end justify-center">
            <div
              className="w-full max-w-[42px] rounded-t bg-blue-600"
              style={{ height: `${Math.max(10, (item.count / max) * 144)}px` }}
            />
          </div>
          <span className="w-full truncate text-center text-xs text-slate-500" title={item.label}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusRatioBar({
  items,
  total,
}: {
  items: Array<{ label: string; count: number; color: string }>;
  total: number;
}) {
  const denominator = Math.max(total, 1);

  return (
    <div className="space-y-5">
      <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
        {items.map((item) => (
          <div
            key={item.label}
            className={item.color}
            style={{ width: `${(item.count / denominator) * 100}%` }}
            title={`${item.label} ${item.count}개`}
          />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
            <span className="inline-flex min-w-0 items-center gap-2 text-slate-600">
              <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
              {item.label}
            </span>
            <span className="float-right text-base font-bold text-slate-900">{formatCount(item.count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnnouncementCompactList({ items }: { items: AnnouncementItem[] }) {
  if (items.length === 0) return <EmptyState label="최근 공고 데이터가 없습니다." />;

  return (
    <div className="divide-y divide-slate-100">
      {items.map((item) => (
        <div key={item.id} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-bold text-slate-800" title={item.title}>
              {item.title}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {item.provider} · {item.region} · {item.category}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <StatusBadge status={item.status} />
            <p className="mt-1 text-xs text-slate-400">{formatDate(item.updatedDt ?? item.createdDt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function BatchLogTable({ logs, compact = false }: { logs: BatchLog[]; compact?: boolean }) {
  if (logs.length === 0) return <EmptyState label="수집 로그가 없습니다." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-slate-50 text-xs font-bold text-slate-500">
          <tr>
            {["source", "status", "수집", "삽입", "소요 시간", "오류", "일시"].map((head) => (
              <th key={head} className="px-3 py-3">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.logId} className="border-t border-slate-100 align-top">
              <td className="px-3 py-3 font-semibold text-slate-800">{log.source}</td>
              <td className="px-3 py-3 text-slate-600">{log.status}</td>
              <td className="px-3 py-3 text-slate-600">{formatCount(log.totalCount)}</td>
              <td className="px-3 py-3 text-slate-600">{formatCount(log.insertedCount)}</td>
              <td className="px-3 py-3 text-slate-600">{formatDuration(log.executionTimeMs)}</td>
              <td className={`${compact ? "max-w-[180px]" : "max-w-[260px]"} truncate px-3 py-3 text-slate-600`} title={log.errorMessage}>
                {log.errorMessage}
              </td>
              <td className="px-3 py-3 text-slate-500">{formatDateTime(log.createdDt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ☑️수정: scraps.ann_id와 announcements.id 집계 결과를 read-only 인기 스크랩 정책 표로 표시
function PopularScrappedAnnouncementsTable({
  items,
  compact = false,
}: {
  items: PopularScrappedAnnouncement[];
  compact?: boolean;
}) {
  if (items.length === 0) return <EmptyState label="아직 스크랩 데이터가 없습니다." />;

  return (
    <div className="overflow-x-auto">
      {/* ☑️수정: 전체 폭 카드에서 정책명 컬럼을 넓게 잡아 TOP 10 표의 가로 스크롤을 최소화 */}
      <table className={`${compact ? "min-w-[760px]" : "min-w-[860px]"} w-full table-fixed text-left text-sm`}>
        <colgroup>
          <col className="w-[56px]" />
          <col className="w-[34%]" />
          <col className="w-[16%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[86px]" />
          <col className="w-[76px]" />
        </colgroup>
        <thead className="bg-slate-50 text-xs font-bold text-slate-500">
          <tr>
            {["순위", "정책명", "기관", "지역", "분야", "source", "스크랩 수", "상세 보기"].map((head) => (
              <th key={head} className="px-3 py-3">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-slate-100 align-top">
              <td className="px-3 py-4 font-bold text-blue-700">{item.rank}</td>
              <td className="truncate px-3 py-4 font-semibold text-slate-800" title={item.title}>{item.title}</td>
              <td className="truncate px-3 py-4 text-slate-600" title={item.provider}>{item.provider}</td>
              <td className="truncate px-3 py-4 text-slate-600" title={item.region}>{item.region}</td>
              <td className="truncate px-3 py-4 text-slate-600" title={item.category}>{item.category}</td>
              <td className="truncate px-3 py-4 text-slate-600" title={item.source}>{item.source}</td>
              <td className="px-3 py-4 font-bold text-slate-900">{formatCount(item.scrapCount)}</td>
              <td className="px-3 py-4">
                {item.detailUrl ? (
                  <a
                    href={item.detailUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-blue-700 hover:text-blue-800"
                  >
                    열기
                  </a>
                ) : (
                  <span className="text-slate-400">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: AnnouncementStatus }) {
  const className = {
    모집중: "bg-emerald-50 text-emerald-700",
    마감임박: "bg-amber-50 text-amber-700",
    마감: "bg-slate-100 text-slate-600",
    "상시/미정": "bg-blue-50 text-blue-700",
  }[status];

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${className}`}>
      {status}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{label}</div>;
}

function formatCount(value: number): string {
  return value.toLocaleString("ko-KR");
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(ms: number): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}초`;
}

function uniqueOptions(values: string[]): string[] {
  return [...new Set(values.filter((value) => value && value !== "미입력"))].sort((a, b) =>
    a.localeCompare(b, "ko")
  );
}

function joinLabels(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "미입력";
}
