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

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/stats", { cache: "no-store" });
      if (res.status === 401) {
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
      <div className="flex min-h-screen items-center justify-center text-zinc-500">
        통계 불러오는 중...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center text-red-500">
        {error}
      </div>
    );
  }

  if (!stats) return null;

  const maxCategoryCount = Math.max(...stats.topCategories.map((c) => c.count), 1);

  return (
    <div className="min-h-screen bg-zinc-50 p-6 dark:bg-black">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">관리자 수집현황</h1>
          <Link
            href="/"
            className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400"
          >
            ← 홈으로
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="전체 공고" value={stats.total.toLocaleString()} unit="건" />
          <StatCard label="모집중" value={stats.open.toLocaleString()} unit="건" />
          <StatCard label="상시" value={stats.standing.toLocaleString()} unit="건" />
          <StatCard
            label="임베딩 완료"
            value={`${stats.embeddingRatio}%`}
            unit={`(${stats.embeddingCount.toLocaleString()}건)`}
          />
          <StatCard
            label="미임베딩"
            value={(stats.total - stats.embeddingCount).toLocaleString()}
            unit="건"
            highlight={stats.total - stats.embeddingCount > 0}
          />
        </div>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            카테고리별 공고 수 (상위 5개)
          </h2>
          <ul className="space-y-3">
            {stats.topCategories.map(({ category, count }) => (
              <li key={category}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-zinc-700 dark:text-zinc-200">{category}</span>
                  <span className="font-medium">{count.toLocaleString()}건</span>
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
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight
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
