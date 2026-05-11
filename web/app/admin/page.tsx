"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Stats = {
  total: number;
  open: number;
  standing: number;
  embeddingRatio: number;
  embeddingCount: number;
  topCategories: { category: string; count: number }[];
};

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/stats", { cache: "no-store" });
      if (res.status === 401) {
        setAccessDenied(true);
        setLoading(false);
        router.replace("/");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "통계를 불러오지 못했어요.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setStats(data);
      setLoading(false);
    })();
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-500 dark:bg-black dark:text-zinc-400">
        <div className="rounded-lg border border-zinc-200 bg-white px-5 py-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          관리자 통계를 불러오고 있어요.
        </div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-black">
        <div className="max-w-md rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">
            관리자 권한이 없거나 로그아웃된 상태예요.
          </p>
          <p className="mt-2">
            홈 화면으로 이동 중입니다. 바로 이동이 필요하면 아래 버튼을 눌러주세요.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            홈으로 이동
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-black">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-semibold">관리자 통계를 불러오지 못했어요.</p>
          <p className="mt-2">{error}</p>
          <Link
            href="/"
            className="mt-4 inline-flex rounded-md border border-red-200 px-3 py-2 text-sm font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
          >
            홈으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const missingEmbeddingCount = Math.max(stats.total - stats.embeddingCount, 0);
  const maxCategoryCount = Math.max(...stats.topCategories.map((c) => c.count), 1);
  const openRatio =
    stats.total > 0 ? Math.round((stats.open / stats.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-950 dark:bg-black dark:text-zinc-50 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-blue-700 dark:text-blue-300">
              Admin
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              수집 현황
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              정책 데이터 수집량과 임베딩 처리 상태를 한 번에 확인합니다.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            홈으로
          </Link>
        </div>

        <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              임베딩 처리 상태
            </h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                missingEmbeddingCount > 0
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                  : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
              }`}
            >
              {missingEmbeddingCount > 0 ? "확인 필요" : "정상"}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-blue-600 dark:bg-blue-400"
              style={{ width: `${Math.min(stats.embeddingRatio, 100)}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            전체 {stats.total.toLocaleString()}건 중{" "}
            {stats.embeddingCount.toLocaleString()}건 임베딩 완료
            {missingEmbeddingCount > 0
              ? `, ${missingEmbeddingCount.toLocaleString()}건은 확인이 필요합니다.`
              : " 상태입니다."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard
            label="전체 공고"
            value={stats.total.toLocaleString()}
            unit="건"
          />
          <StatCard
            label="모집중"
            value={stats.open.toLocaleString()}
            unit={`전체의 ${openRatio}%`}
          />
          <StatCard
            label="상시"
            value={stats.standing.toLocaleString()}
            unit="건"
          />
          <StatCard
            label="임베딩 완료"
            value={`${stats.embeddingRatio}%`}
            unit={`(${stats.embeddingCount.toLocaleString()}건)`}
          />
          <StatCard
            label="미임베딩"
            value={missingEmbeddingCount.toLocaleString()}
            unit="건"
            tone={missingEmbeddingCount > 0 ? "warning" : "default"}
          />
        </div>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              카테고리별 공고 수
            </h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              상위 5개
            </span>
          </div>
          {stats.topCategories.length > 0 ? (
            <ul className="space-y-3">
              {stats.topCategories.map(({ category, count }) => (
                <li key={category}>
                  <div className="mb-1 flex justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-200">
                      {category}
                    </span>
                    <span className="shrink-0 font-medium">
                      {count.toLocaleString()}건
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-2 rounded-full bg-blue-500"
                      style={{ width: `${Math.round((count / maxCategoryCount) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md bg-zinc-50 px-3 py-4 text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              표시할 카테고리 통계가 아직 없습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  tone = "default",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone === "warning"
          ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
          : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
      }`}
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
      {unit && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{unit}</p>
      )}
    </div>
  );
}
