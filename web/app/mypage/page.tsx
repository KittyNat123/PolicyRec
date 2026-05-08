"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const ALL = "전체";
const REGIONS: string[] = [
  ALL, "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
  "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도",
  "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도",
];

const CATEGORIES: string[] = [
  ALL, "창업", "경영", "기술", "인력/일자리", "판로/수출", "자금", "교육/멘토링",
  "시설/공간", "행사/네트워크", "주거", "복지/문화", "의료/건강",
];

const USER_TYPES = ["선택 안함", "청년", "예비 창업자", "창업자", "기업"];

type UserInfo = {
  nickname: string;
  age_group: string;
  regions: string[];
  categories: string[];
  interest_keywords: string[];
  user_type: string;
};

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

export default function MyPage() {
  const router = useRouter();
  
  // Edit Mode
  const [isEditingInfo, setIsEditingInfo] = useState(false);

  // Info State
  const [info, setInfo] = useState<UserInfo>({
    nickname: "",
    age_group: "",
    regions: [],
    categories: [],
    interest_keywords: [],
    user_type: "선택 안함",
  });
  const [infoLoading, setInfoLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  // Scraps State
  const [scraps, setScraps] = useState<ScrapDetail[]>([]);
  const [scrapsLoading, setScrapsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [scrapTotalCount, setScrapTotalCount] = useState(0);
  
  // Animation key for sliding effect
  const [scrapAnimKey, setScrapAnimKey] = useState(0);

  // Recommendations State
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recLoading, setRecLoading] = useState(false);

  // Accordion State
  const [expandedAnnId, setExpandedAnnId] = useState<number | null>(null);

  // Initial Fetch
  useEffect(() => {
    fetchInfo();
    fetchRecommendations();
  }, []);

  // Fetch scraps when page changes
  useEffect(() => {
    fetchScraps(page);
  }, [page]);

  const fetchInfo = async () => {
    setInfoLoading(true);
    try {
      const res = await fetch("/api/mypage/info", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.info) {
          setInfo({
            nickname: data.info.nickname || "",
            age_group: data.info.age_group || "",
            regions: data.info.regions || [],
            categories: data.info.categories || [],
            interest_keywords: data.info.interest_keywords || [],
            user_type: data.info.user_type || "선택 안함",
          });
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setInfoLoading(false);
    }
  };

  const fetchScraps = async (p: number) => {
    setScrapsLoading(true);
    try {
      const res = await fetch(`/api/mypage/scraps/detail?page=${p}`, { cache: "no-store" });
      if (res.status === 401) return;
      if (res.ok) {
        const data = await res.json();
        setScraps(data.scraps || []);
        setTotalPages(data.totalPages || 1);
        setScrapTotalCount(data.totalCount || 0);
        setScrapAnimKey((prev) => prev + 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setScrapsLoading(false);
    }
  };

  const fetchRecommendations = async () => {
    setRecLoading(true);
    try {
      const res = await fetch("/api/mypage/recommendations", { cache: "no-store" });
      if (res.status === 401) return;
      if (res.ok) {
        const data = await res.json();
        setRecommendations(data.recommendations || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRecLoading(false);
    }
  };

  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage("저장 중...");
    try {
      const res = await fetch("/api/mypage/info", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(info),
      });
      if (res.ok) {
        setSaveMessage("저장되었습니다.");
        setTimeout(() => {
          setSaveMessage("");
          setIsEditingInfo(false);
        }, 1500);
      } else {
        setSaveMessage("저장에 실패했습니다.");
      }
    } catch (e) {
      setSaveMessage("오류가 발생했습니다.");
    }
  };

  const toggleAccordion = (annId: number) => {
    setExpandedAnnId(prev => (prev === annId ? null : annId));
  };

  const handleUnscrap = async (annId: number) => {
    if (!confirm("이 공고의 스크랩을 해제하시겠습니까?")) return;
    
    try {
      const res = await fetch("/api/mypage/scraps", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ann_id: annId }),
      });

      if (res.ok) {
        // 목록 새로고침
        fetchScraps(page);
        if (expandedAnnId === annId) setExpandedAnnId(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const currentRegion = info.regions.length > 0 ? info.regions[0] : ALL;
  const currentCategory = info.categories.length > 0 ? info.categories[0] : ALL;

  const renderPagination = () => {
    if (totalPages <= 1) return null;
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    
    return (
      <div className="mt-6 flex items-center justify-center gap-2">
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => setPage(p)}
            className={`w-8 h-8 rounded-full text-sm font-bold transition-all ${
              p === page 
                ? 'bg-blue-600 text-white shadow-md' 
                : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-50 p-6 pb-20 dark:bg-black">
      {/* Sliding Animation Style */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes slideInRight {
          from { transform: translateX(30px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .slide-in {
          animation: slideInRight 0.4s ease-out forwards;
        }
      `}} />

      <div className="mx-auto max-w-3xl space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">마이페이지</h1>
          <Link href="/" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
            홈으로 돌아가기 &rarr;
          </Link>
        </div>

        {/* 1. 내 정보 수정 구역 */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">내 정보 설정</h2>
            {!isEditingInfo && (
              <button
                onClick={() => setIsEditingInfo(true)}
                className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                정보 수정하기
              </button>
            )}
          </div>

          {infoLoading ? (
            <div className="text-sm text-zinc-500 py-4">불러오는 중...</div>
          ) : !isEditingInfo ? (
            <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm sm:grid-cols-3">
              <div>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">닉네임</span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{info.nickname || "-"}</span>
              </div>
              <div>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">나이</span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{info.age_group ? `${info.age_group}세` : "-"}</span>
              </div>
              <div>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">사용자 유형</span>
                <span className="font-medium text-blue-600 dark:text-blue-400">{info.user_type}</span>
              </div>
              <div>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">관심 지역</span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{currentRegion}</span>
              </div>
              <div>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">관심 분야</span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{currentCategory}</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleInfoSubmit} className="space-y-4 rounded-lg bg-zinc-50 p-4 border border-zinc-100 dark:bg-zinc-950 dark:border-zinc-800">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">닉네임</label>
                  <input
                    type="text"
                    value={info.nickname}
                    onChange={(e) => setInfo({ ...info, nickname: e.target.value })}
                    className="w-full rounded-md border border-zinc-300 p-2 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-black dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">나이</label>
                  <input
                    type="number"
                    value={info.age_group}
                    onChange={(e) => setInfo({ ...info, age_group: e.target.value })}
                    className="w-full rounded-md border border-zinc-300 p-2 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-black dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">관심 지역</label>
                  <select
                    value={currentRegion}
                    onChange={(e) => setInfo({ ...info, regions: e.target.value === ALL ? [] : [e.target.value] })}
                    className="w-full rounded-md border border-zinc-300 p-2 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-black dark:text-white"
                  >
                    {REGIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">관심 분야</label>
                  <select
                    value={currentCategory}
                    onChange={(e) => setInfo({ ...info, categories: e.target.value === ALL ? [] : [e.target.value] })}
                    className="w-full rounded-md border border-zinc-300 p-2 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-black dark:text-white"
                  >
                    {CATEGORIES.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">사용자 유형</label>
                  <select
                    value={info.user_type}
                    onChange={(e) => setInfo({ ...info, user_type: e.target.value })}
                    className="w-full rounded-md border border-zinc-300 p-2 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-black dark:text-white"
                  >
                    {USER_TYPES.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="flex items-center gap-3 pt-2">
                <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                  저장
                </button>
                <button type="button" onClick={() => setIsEditingInfo(false)} className="rounded-md px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  취소
                </button>
                {saveMessage && <span className="text-sm font-medium text-green-600 dark:text-green-400">{saveMessage}</span>}
              </div>
            </form>
          )}
        </section>

        {/* 2. 스크랩 내역 조회 구역 */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">
              스크랩 내역
            </h2>
            <span className="text-sm font-normal text-zinc-500">(총 {scrapTotalCount}건, 마감임박순)</span>
          </div>

          {scrapsLoading && scraps.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">불러오는 중...</div>
          ) : scraps.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">스크랩한 공고가 없습니다.</div>
          ) : (
            <>
              {/* 애니메이션 래퍼 */}
              <div key={`scrap-page-${scrapAnimKey}`} className="slide-in flex flex-col gap-3">
                {scraps.map((scrap) => (
                  <div key={scrap.scrap_id} className="group flex flex-col gap-1.5 rounded-lg border border-zinc-100 bg-zinc-50 p-4 transition-colors hover:border-blue-200 hover:bg-blue-50/50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-blue-900/50 dark:hover:bg-blue-950/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-1 items-start gap-2">
                        <button
                          onClick={() => handleUnscrap(scrap.ann_id)}
                          className="mt-0.5 shrink-0 text-yellow-400 hover:text-zinc-300 transition-colors"
                          title="스크랩 해제"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                            <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
                          </svg>
                        </button>
                        <a
                          href={scrap.detail_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-base font-semibold text-zinc-800 decoration-blue-500 hover:text-blue-600 hover:underline dark:text-zinc-200 dark:hover:text-blue-400 line-clamp-2"
                        >
                          {scrap.title}
                        </a>
                      </div>
                      {scrap.is_urgent && !scrap.is_closed && (
                        <span className="shrink-0 animate-pulse rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-600 dark:border-red-900 dark:bg-red-900/40 dark:text-red-400">
                          🚨 마감임박
                        </span>
                      )}
                      {scrap.is_closed && (
                        <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                          마감
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        마감일: {scrap.apply_end_dt ? new Date(scrap.apply_end_dt).toLocaleDateString() : '미정'}
                      </div>
                      <button
                        onClick={() => toggleAccordion(scrap.ann_id)}
                        className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                      >
                        {expandedAnnId === scrap.ann_id ? (
                          <>접기 <span className="text-[10px]">▲</span></>
                        ) : (
                          <>자세히보기 <span className="text-[10px]">▼</span></>
                        )}
                      </button>
                    </div>
                    {expandedAnnId === scrap.ann_id && (
                      <div className="mt-2 rounded-md bg-white p-3 border border-zinc-200 shadow-sm dark:bg-zinc-900 dark:border-zinc-700">
                        <div className="flex gap-2 mb-2">
                          {scrap.region && <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{scrap.region}</span>}
                          {scrap.s_category && <span className="rounded bg-blue-50 border border-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300">{scrap.s_category}</span>}
                        </div>
                        <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed text-xs">
                          {scrap.summary || "요약 정보가 없습니다."}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {renderPagination()}
            </>
          )}
        </section>

        {/* 3. 맞춤정보 추천 구역 */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">
              맞춤정보 추천 <span className="ml-1 text-sm font-normal text-blue-500">Beta</span>
            </h2>
          </div>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            {info.nickname || "사용자"}님의 관심 설정(<strong>{currentCategory}</strong> / <strong>{currentRegion}</strong> / <strong>{info.user_type}</strong>)과 스크랩 이력을 바탕으로 분석한 추천 공고입니다.
          </p>
          
          {recLoading ? (
            <div className="py-4 text-center text-sm text-zinc-500">맞춤 공고를 분석 중입니다...</div>
          ) : recommendations.length === 0 ? (
            <div className="py-4 text-center text-sm text-zinc-500">추천할 공고가 없습니다. 관심 설정을 변경해보세요.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {recommendations.map((rec) => (
                <div key={rec.id} className="flex flex-col gap-1.5 rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4 dark:border-blue-600 dark:bg-blue-950/30">
                  <div className="flex items-start justify-between gap-3">
                    <a
                      href={rec.detail_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-base font-semibold text-zinc-800 hover:text-blue-600 hover:underline dark:text-zinc-200"
                    >
                      {rec.title}
                    </a>
                  </div>
                  <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
                    💡 추천 사유: {rec.reason}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      마감일: {rec.apply_end_dt ? new Date(rec.apply_end_dt).toLocaleDateString() : '미정'}
                    </div>
                    <button
                      onClick={() => toggleAccordion(rec.id)}
                      className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                    >
                      {expandedAnnId === rec.id ? (
                        <>접기 <span className="text-[10px]">▲</span></>
                      ) : (
                        <>자세히보기 <span className="text-[10px]">▼</span></>
                      )}
                    </button>
                  </div>
                  {expandedAnnId === rec.id && (
                    <div className="mt-2 rounded-md bg-white p-3 border border-zinc-200 shadow-sm dark:bg-zinc-900 dark:border-zinc-700">
                      <div className="flex gap-2 mb-2">
                        {rec.region && <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{rec.region}</span>}
                        {rec.s_category && <span className="rounded bg-blue-50 border border-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300">{rec.s_category}</span>}
                      </div>
                      <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed text-xs">
                        {rec.summary || "요약 정보가 없습니다."}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
