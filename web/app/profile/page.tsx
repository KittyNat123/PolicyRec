"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PolicyCard } from "@/components/PolicyCard";
import type { SavedFilter, SearchResult, User } from "@/lib/types";

type ScrapRow = {
  ann_id?: unknown;
};

function normalizeScrapIds(scraps: ScrapRow[]) {
  return scraps
    .map((scrap) =>
      typeof scrap.ann_id === "number" ? scrap.ann_id : Number(scrap.ann_id)
    )
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return data.error ?? fallback;
}

export default function ProfilePage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [savedFilter, setSavedFilter] = useState<SavedFilter | null>(null);
  const [scrappedIds, setScrappedIds] = useState<Set<number>>(new Set());
  const [recentScraps, setRecentScraps] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadProfile() {
    setLoading(true);
    setError(null);
    try {
      const meRes = await fetch("/api/auth/me", { cache: "no-store" });
      const meData = await meRes.json().catch(() => ({}));
      const user = (meData.user ?? null) as User | null;
      setCurrentUser(user);
      setSavedFilter((meData.filter ?? null) as SavedFilter | null);

      if (!user) {
        setScrappedIds(new Set());
        setRecentScraps([]);
        return;
      }

      const scrapsRes = await fetch("/api/user/scraps", { cache: "no-store" });
      if (!scrapsRes.ok) {
        throw new Error(
          await readApiError(scrapsRes, "스크랩 정보를 불러오지 못했어요.")
        );
      }

      const scrapsData = await scrapsRes.json().catch(() => ({}));
      const ids = normalizeScrapIds((scrapsData.scraps ?? []) as ScrapRow[]);
      setScrappedIds(new Set(ids));

      if (ids.length === 0) {
        setRecentScraps([]);
        return;
      }

      const detailsRes = await fetch("/api/announcements/by-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ids.slice(0, 3) }),
      });
      if (!detailsRes.ok) {
        throw new Error(
          await readApiError(detailsRes, "최근 스크랩을 불러오지 못했어요.")
        );
      }

      const detailsData = await detailsRes.json().catch(() => ({}));
      setRecentScraps((detailsData.results ?? []) as SearchResult[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "프로필을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleScrap(annId: number) {
    if (!currentUser) return;

    const res = await fetch("/api/user/scraps", {
      method: scrappedIds.has(annId) ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ann_id: annId }),
    });

    if (!res.ok) {
      setError(await readApiError(res, "스크랩 처리에 실패했어요."));
      return;
    }

    setScrappedIds((prev) => {
      const next = new Set(prev);
      if (next.has(annId)) {
        next.delete(annId);
      } else {
        next.add(annId);
      }
      return next;
    });
    setRecentScraps((prev) => prev.filter((item) => item.id !== annId));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfile();
  }, []);

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 dark:bg-black sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-500">PolicyRec</p>
            <h1 className="text-3xl font-bold tracking-tight">내 프로필</h1>
          </div>
          <div className="flex gap-2">
            <Link
              href="/"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              검색으로 돌아가기
            </Link>
            <Link
              href="/scraps"
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              스크랩 목록
            </Link>
          </div>
        </div>

        {loading && (
          <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
            프로필을 불러오는 중...
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {!loading && !currentUser && (
          <section className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            로그인 후 프로필과 스크랩 목록을 확인할 수 있어요.
          </section>
        )}

        {!loading && currentUser && (
          <div className="space-y-5">
            <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500">로그인 계정</p>
              <p className="mt-1 text-xl font-semibold">{currentUser.login_id}</p>
            </section>

            <section className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500">스크랩</p>
                <p className="mt-1 text-2xl font-semibold">{scrappedIds.size}개</p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500">저장 지역</p>
                <p className="mt-1 font-medium">
                  {savedFilter?.regions?.[0] ?? "없음"}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500">저장 카테고리</p>
                <p className="mt-1 font-medium">
                  {savedFilter?.categories?.[0] ?? "없음"}
                </p>
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">최근 스크랩</h2>
                <Link
                  href="/scraps"
                  className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                >
                  전체 보기
                </Link>
              </div>
              {recentScraps.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
                  아직 스크랩한 정책이 없어요.
                </div>
              ) : (
                <ul className="space-y-3">
                  {recentScraps.map((item) => (
                    <PolicyCard
                      key={item.id}
                      item={item}
                      canScrap
                      isScrapped={scrappedIds.has(item.id)}
                      onToggleScrap={toggleScrap}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
