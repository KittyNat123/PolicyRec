"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";

type Stats = {
  total: number;
  open: number;
  standing: number;
  embeddingRatio: number;
  embeddingCount: number;
  topCategories: { category: string; count: number }[];
};

type AdminTab = "dashboard" | "policies" | "users";

const MOCK_POLICIES = [
  ["청년 월세 한시 특별지원", "국토교통부", "주거", "마감임박", "2026-06-30"],
  ["청년 창업 도약 패키지", "중소벤처기업부", "창업", "진행중", "2026-07-15"],
  ["국민취업지원제도 유형", "고용노동부", "취업", "진행중", "2026-12-31"],
  ["서울시 청년 교통비 지원", "서울특별시", "복지", "진행중", "2026-08-31"],
  ["청년 내일저축계좌", "보건복지부", "금융", "마감임박", "2026-05-31"],
  ["문화누리카드", "문화체육관광부", "문화", "진행중", "2026-11-30"],
];

const USER_BUCKETS = [
  { label: "19-24", value: 2800 },
  { label: "25-29", value: 3900 },
  { label: "30-34", value: 2400 },
  { label: "35-39", value: 1600 },
  { label: "40-49", value: 950 },
  { label: "50+", value: 480 },
];

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/stats", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "관리자 통계를 불러오지 못했어요.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setStats(data);
      setLoading(false);
    })();
  }, [router]);

  const urgentCount = useMemo(() => {
    if (!stats) return 0;
    return Math.min(3, Math.max(stats.total - stats.open - stats.standing, 0) || 3);
  }, [stats]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AppHeader currentUser={{ login_id: "admin", role: "admin" }} />
        <div className="mx-auto max-w-[1280px] px-6 py-10 text-sm text-slate-500">
          관리자 대시보드를 불러오고 있어요.
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AppHeader currentUser={{ login_id: "admin", role: "admin" }} />
        <div className="mx-auto max-w-[1280px] px-6 py-10">
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {error ?? "표시할 관리자 데이터가 없습니다."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AppHeader currentUser={{ login_id: "admin", role: "admin" }} />
      <main className="mx-auto max-w-[1280px] px-4 py-7 sm:px-6">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">관리자 대시보드</h1>
            <p className="mt-2 text-sm text-slate-500">PolicyRec 정책 데이터 관리</p>
          </div>
          <button className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700">
            + 정책 추가
          </button>
        </div>

        <div className="mb-6 inline-flex rounded-lg bg-slate-100 p-1">
          {[
            ["dashboard", "대시보드"],
            ["policies", "정책 관리"],
            ["users", "사용자 현황"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key as AdminTab)}
              className={`rounded-md px-4 py-2 text-sm font-bold ${
                activeTab === key
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "dashboard" && (
          <DashboardTab stats={stats} urgentCount={urgentCount} />
        )}
        {activeTab === "policies" && <PoliciesTab />}
        {activeTab === "users" && <UsersTab />}
      </main>
    </div>
  );
}

function DashboardTab({
  stats,
  urgentCount,
}: {
  stats: Stats;
  urgentCount: number;
}) {
  const maxCategory = Math.max(...stats.topCategories.map((item) => item.count), 1);
  const closedCount = Math.max(stats.total - stats.open - stats.standing, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <AdminMetric label="전체 정책" value={stats.total.toLocaleString()} sub="이번 주 3개 추가" tone="blue" />
        <AdminMetric label="총 조회수" value="28,541" sub="12.4% 지난주 대비" tone="violet" />
        <AdminMetric label="신청 건수" value="1,284" sub="8.7% 지난주 대비" tone="green" />
        <AdminMetric label="마감 임박" value={urgentCount.toLocaleString()} sub="7일 이내" tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel title="주간 활동 현황">
          <div className="flex h-48 items-end gap-4 px-3 pt-6">
            {[1200, 1450, 980, 1700, 2150, 780, 620].map((value, index) => (
              <div key={index} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-36 w-full items-end justify-center gap-1">
                  <span className="w-8 rounded-t bg-blue-100" style={{ height: `${(value / 2200) * 100}%` }} />
                  <span className="w-8 rounded-t bg-blue-600" style={{ height: `${Math.max(8, (value / 9000) * 100)}%` }} />
                </div>
                <span className="text-xs text-slate-500">{["월", "화", "수", "목", "금", "토", "일"][index]}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="정책 상태">
          <div className="flex flex-col items-center gap-5 py-4">
            <div
              className="h-32 w-32 rounded-full"
              style={{
                background: `conic-gradient(#22c55e 0 68%, #f59e0b 68% 86%, #94a3b8 86% 100%)`,
              }}
            />
            <div className="grid w-full grid-cols-2 gap-3 text-sm">
              <Legend label="진행중" value={stats.open} color="bg-emerald-500" />
              <Legend label="마감임박" value={urgentCount} color="bg-amber-500" />
              <Legend label="마감" value={closedCount} color="bg-slate-400" />
              <Legend label="예정" value={0} color="bg-blue-500" />
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="분야별 정책 현황">
        <div className="space-y-4 py-3">
          {stats.topCategories.map((item) => (
            <div key={item.category} className="grid grid-cols-[70px_1fr_48px] items-center gap-3">
              <span className="text-sm text-slate-600">{item.category}</span>
              <div className="h-2 rounded-full bg-blue-50">
                <div
                  className="h-2 rounded-full bg-blue-600"
                  style={{ width: `${Math.max(4, (item.count / maxCategory) * 100)}%` }}
                />
              </div>
              <span className="text-right text-sm font-bold text-slate-700">{item.count}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="최근 활동 로그">
        {[
          "청년 마음건강 지원사업 정책 추가됨",
          "청년 월세 한시 특별지원 마감일 수정됨",
          "국민취업지원제도 유형 신청 150건 처리 완료",
          "경기도 청년 기본소득 마감 임박",
        ].map((item, index) => (
          <div key={item} className="flex items-center justify-between border-b border-slate-100 py-4 last:border-0">
            <span className="text-sm text-slate-700">{item}</span>
            <span className="text-xs text-slate-400">{["10분 전", "1시간 전", "3시간 전", "5시간 전"][index]}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function PoliciesTab() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row">
        <input
          placeholder="정책명 또는 기관 검색"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
          <option>전체 상태</option>
        </select>
        <select className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
          <option>전체 분야</option>
        </select>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-500">
            <tr>
              {["정책명", "기관", "분야", "상태", "마감일", "관리"].map((head) => (
                <th key={head} className="px-4 py-3">{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_POLICIES.map((row) => (
              <tr key={row[0]} className="border-t border-slate-100">
                {row.map((cell, index) => (
                  <td key={`${row[0]}-${index}`} className="px-4 py-4">
                    {index === 2 ? (
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{cell}</span>
                    ) : index === 3 ? (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${cell === "마감임박" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{cell}</span>
                    ) : cell}
                  </td>
                ))}
                <td className="px-4 py-4 text-slate-400">수정 · 삭제</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsersTab() {
  const max = Math.max(...USER_BUCKETS.map((item) => item.value));
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <AdminMetric label="전체 가입자" value="12,847" sub="234 이번 달" tone="blue" />
        <AdminMetric label="활성 사용자 (MAU)" value="5,621" sub="8.2%" tone="green" />
        <AdminMetric label="평균 세션 시간" value="4분 32초" sub="임시 지표" tone="violet" />
        <AdminMetric label="정책 신청 전환율" value="18.4%" sub="2.1%p" tone="amber" />
      </div>
      <Panel title="연령대별 사용자 분포">
        <div className="flex h-52 items-end gap-5 px-6 pt-8">
          {USER_BUCKETS.map((item) => (
            <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
              <div className="w-full rounded-t bg-blue-600" style={{ height: `${Math.max(12, (item.value / max) * 150)}px` }} />
              <span className="text-xs text-slate-500">{item.label}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="최근 신규 가입자">
        {[
          ["박민준 · 26세", "서울 · 관심: 취업", "오늘"],
          ["이소연 · 29세", "경기 · 관심: 주거", "어제"],
          ["정재원 · 24세", "부산 · 관심: 창업", "2일 전"],
        ].map(([name, meta, date]) => (
          <div key={name} className="flex items-center justify-between border-b border-slate-100 py-4 last:border-0">
            <div>
              <p className="font-bold text-slate-800">{name}</p>
              <p className="mt-1 text-xs text-slate-500">{meta}</p>
            </div>
            <span className="text-xs text-slate-400">{date}</span>
          </div>
        ))}
      </Panel>
    </div>
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
  tone: "blue" | "green" | "violet" | "amber";
}) {
  const toneClass = {
    blue: "text-blue-600",
    green: "text-emerald-600",
    violet: "text-violet-600",
    amber: "text-amber-600",
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-3 text-3xl font-bold ${toneClass}`}>{value}</p>
      <p className="mt-2 text-xs font-semibold text-emerald-600">{sub}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Legend({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-2 text-slate-600">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
        {label}
      </span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
