"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { PolicyCard } from "@/components/PolicyCard";
import type { SearchResult, User } from "@/lib/types";

type Recommendation = {
  id: number;
  title: string;
  detail_url: string;
  summary: string | null;
  region: string | null;
  s_category: string | null;
  apply_end_dt: string | null;
  reason: string;
};

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

export default function ScrapsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [scrappedIds, setScrappedIds] = useState<Set<number>>(new Set());
  const [items, setItems] = useState<SearchResult[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    return items.reduce<Record<string, SearchResult[]>>((acc, item) => {
      const key = item.s_category || "기타";
      acc[key] = [...(acc[key] ?? []), item];
      return acc;
    }, {});
  }, [items]);

  const loadScrapsPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await fetch("/api/auth/me", { cache: "no-store" });
      const meData = await meRes.json().catch(() => ({}));
      const user = (meData.user ?? null) as User | null;
      setCurrentUser(user);

      if (!user) {
        router.replace("/?auth=login");
        return;
      }

      const [scrapsRes, recommendationsRes] = await Promise.all([
        fetch("/api/mypage/scraps", { cache: "no-store" }),
        // ☑️수정: 새 API 없이 기존 마이페이지 추천 API를 스크랩 상단 추천 공고에 재사용
        fetch("/api/mypage/recommendations", { cache: "no-store" }),
      ]);

      if (recommendationsRes.ok) {
        const recommendationsData = await recommendationsRes.json().catch(() => ({}));
        setRecommendations((recommendationsData.recommendations ?? []) as Recommendation[]);
      } else {
        setRecommendations([]);
      }

      if (!scrapsRes.ok) {
        throw new Error(
          await readApiError(scrapsRes, "스크랩 목록을 불러오지 못했어요.")
        );
      }

      const scrapsData = await scrapsRes.json().catch(() => ({}));
      const ids = normalizeScrapIds((scrapsData.scraps ?? []) as ScrapRow[]);
      setScrappedIds(new Set(ids));

      if (ids.length === 0) {
        setItems([]);
        return;
      }

      const detailsRes = await fetch("/api/announcements/by-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!detailsRes.ok) {
        throw new Error(
          await readApiError(detailsRes, "스크랩한 공고를 불러오지 못했어요.")
        );
      }

      const detailsData = await detailsRes.json().catch(() => ({}));
      setItems((detailsData.results ?? []) as SearchResult[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "스크랩 목록을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  async function toggleScrap(annId: number) {
    if (!currentUser) return;

    const res = await fetch("/api/mypage/scraps", {
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
      next.delete(annId);
      return next;
    });
    setItems((prev) => prev.filter((item) => item.id !== annId));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadScrapsPage();
  }, [loadScrapsPage]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AppHeader currentUser={currentUser} />
      <main className="mx-auto max-w-5xl px-4 py-7 sm:px-6">
        {loading && (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">
            스크랩 목록을 불러오고 있어요.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !currentUser && (
          <section className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            로그인하면 스크랩한 정책을 확인할 수 있어요.
          </section>
        )}

        {!loading && currentUser && (
          <div className="space-y-9">
            <section>
              <div className="mb-4">
                <p className="text-sm font-semibold text-blue-600">스크랩</p>
                <h1 className="mt-1 text-2xl font-bold">스크랩 기반 추천 공고</h1>
                <p className="mt-2 text-sm text-slate-500">
                  최근 저장한 정책과 비슷한 공고예요.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {recommendations.slice(0, 3).map((item) => (
                  <RecommendationCard key={item.id} item={item} />
                ))}
                {recommendations.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500 md:col-span-3">
                    추천 공고가 아직 없어요. 관심 있는 정책을 스크랩하면 비슷한 공고를 보여드릴게요.
                  </div>
                )}
              </div>
            </section>

            <div>
              <h1 className="mt-1 text-2xl font-bold">저장한 정책 {items.length}개</h1>
            </div>

            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
                아직 스크랩한 정책이 없어요.
              </div>
            ) : (
              Object.entries(grouped).map(([category, policies]) => (
                <section key={category}>
                  <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
                    <span className="h-2 w-2 rounded-full bg-blue-600" />
                    {category} <span className="text-sm font-medium text-slate-400">({policies.length}개)</span>
                  </h2>
                  <ul className="grid gap-4 md:grid-cols-2">
                    {policies.map((item) => (
                      <PolicyCard
                        key={item.id}
                        item={item}
                        canScrap
                        isScrapped={scrappedIds.has(item.id)}
                        onToggleScrap={toggleScrap}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function RecommendationCard({ item }: { item: Recommendation }) {
  return (
    <a
      href={item.detail_url}
      target="_blank"
      rel="noreferrer"
      // ☑️수정: 기존 마이페이지 추천 카드 형태를 스크랩 상단 추천 영역으로 이동
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-200 hover:shadow-md"
    >
      <div className="mb-4 flex gap-1.5">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
          진행중
        </span>
        {item.s_category && (
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
            {item.s_category}
          </span>
        )}
      </div>
      <h3 className="line-clamp-2 text-lg font-bold text-slate-950">{item.title}</h3>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.summary}</p>
      <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm font-bold text-blue-800">
        {item.reason}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        {item.apply_end_dt ? `${item.apply_end_dt} 마감` : "상시"}
      </p>
    </a>
  );
}
