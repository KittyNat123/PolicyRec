"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import type { User } from "@/lib/types";

type ScrapDetail = {
  scrap_id: number;
  ann_id: number;
  title: string;
  detail_url: string;
  apply_end_dt: string | null;
  summary: string | null;
  region: string | null;
  s_category: string | null;
  is_urgent: boolean;
  is_closed: boolean;
  scrapped_at: string;
};

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

type UserInfo = {
  email?: string | null;
  phone?: string | null;
  age_group?: string | null;
  regions?: string[] | null;
  categories?: string[] | null;
  interest_keywords?: string[] | null;
  user_type?: string | null;
};

export default function MyPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [scraps, setScraps] = useState<ScrapDetail[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [info, setInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const meRes = await fetch("/api/auth/me", { cache: "no-store" });
      const meData = await meRes.json().catch(() => ({}));
      const user = (meData.user ?? null) as User | null;
      if (!user) {
        router.replace("/?auth=login");
        return;
      }
      setCurrentUser(user);
      const [scrapsRes, recsRes] = await Promise.all([
        fetch("/api/mypage/scraps/detail?page=1", { cache: "no-store" }),
        fetch("/api/mypage/recommendations", { cache: "no-store" }),
      ]);
      const infoRes = await fetch("/api/mypage/info", { cache: "no-store" });
      if (infoRes.ok) {
        const data = await infoRes.json().catch(() => ({}));
        const loadedInfo = (data.info ?? null) as UserInfo | null;
        setInfo(loadedInfo);
      }
      if (scrapsRes.ok) {
        const data = await scrapsRes.json().catch(() => ({}));
        setScraps((data.scraps ?? []) as ScrapDetail[]);
      }
      if (recsRes.ok) {
        const data = await recsRes.json().catch(() => ({}));
        setRecommendations((data.recommendations ?? []) as Recommendation[]);
      }
      setLoading(false);
    })();
  }, [router]);

  const preferenceSummary = [
    info?.regions?.[0],
    info?.categories?.[0],
    info?.user_type,
    info?.age_group ? `${info.age_group}세` : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AppHeader currentUser={currentUser} />
      <main className="mx-auto max-w-5xl px-4 py-7 sm:px-6">
        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">
            마이페이지를 불러오고 있어요.
          </div>
        ) : (
          <div className="space-y-9">
            <section>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-blue-600">마이페이지</p>
                  <h1 className="mt-1 text-2xl font-bold">맞춤 추천 정책</h1>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {recommendations.slice(0, 3).map((item) => (
                  <MiniPolicy key={item.id} item={item} />
                ))}
                {recommendations.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500 md:col-span-3">
                    아직 추천 정책이 없습니다.
                  </div>
                )}
              </div>
            </section>

            <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-600">맞춤 추천 기본값</p>
                <p className="mt-1 text-sm text-slate-600">
                  {preferenceSummary.length > 0
                    ? preferenceSummary.join(" · ")
                    : "프로필에서 지역, 나이, 관심 분야를 설정해보세요."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.push("/profile")}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                프로필에서 편집
              </button>
            </section>

            <section>
              <h2 className="mb-4 text-xl font-bold">신청 현황</h2>
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                {scraps.slice(0, 3).map((item) => (
                  <div key={item.scrap_id} className="border-b border-slate-100 p-4 last:border-0">
                    <span className={`mb-2 inline-block rounded-full px-2.5 py-1 text-xs font-bold ${item.is_urgent ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {item.is_urgent ? "마감임박" : item.is_closed ? "마감" : "진행중"}
                    </span>
                    <h3 className="font-bold text-slate-950">{item.title}</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      신청일: {new Date(item.scrapped_at).toLocaleDateString("ko-KR")}
                    </p>
                  </div>
                ))}
                {scraps.length === 0 && (
                  <p className="p-6 text-sm text-slate-500">아직 신청 현황으로 볼 정책이 없습니다.</p>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-4 text-xl font-bold">관심 분야</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {["주거", "취업", "금융", "복지", "창업", "문화"].map((item, index) => (
                  <div
                    key={item}
                    className={`rounded-lg border p-5 text-center font-bold ${
                      index % 2 === 0
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function MiniPolicy({ item }: { item: Recommendation }) {
  return (
    <a
      href={item.detail_url}
      target="_blank"
      rel="noreferrer"
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-200 hover:shadow-md"
    >
      <div className="mb-4 flex gap-1.5">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">진행중</span>
        {item.s_category && (
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{item.s_category}</span>
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
