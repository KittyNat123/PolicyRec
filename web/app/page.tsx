// =====================================================================
// PolicyRec 검색 화면 (Next.js MVP)
// =====================================================================
// - 자연어 검색 → /api/search → Gemini embedding → Supabase RPC
// - 카테고리/지역/나이 필터는 서버 검색 인자로 전달
// - 모집상태는 apply_start_dt/apply_end_dt 기준으로 프론트에서 계산
// - 로그인 사용자는 현재 필터를 user_filters 테이블에 저장/불러오기 가능
// =====================================================================

"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  formatDate,
  dDayLabel,
  recruitmentStatus,
  getSourceBadge,
  STATUS_BADGE_STYLES,
  formatTargetAgeRange,
  type RecruitmentStatus,
} from "@/lib/utils";

const ALL = "전체";

// UI에서는 "전체" 하나만 보여줍니다. DB의 실제 값 "전국"은 검색 API/RPC에서 계속 사용합니다.
const REGIONS: string[] = [
  ALL,
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
];

const CATEGORIES: string[] = [
  ALL,
  "창업",
  "경영",
  "기술",
  "인력/일자리",
  "판로/수출",
  "자금",
  "교육/멘토링",
  "시설/공간",
  "행사/네트워크",
  "주거",
  "복지/문화",
  "기타",
];

const STATUSES: (RecruitmentStatus | typeof ALL)[] = [
  ALL,
  "모집중",
  "마감",
  "모집예정",
  "상시",
];

type SearchResult = {
  id: number;
  source: string | null;
  source_id: string | null;
  title: string;
  summary: string | null;
  provider: string | null;
  s_category: string | null;
  region: string | null;
  target_age_min: number | null;
  target_age_max: number | null;
  apply_start_dt: string | null;
  apply_end_dt: string | null;
  target_group: string | null;
  target_tags: string[] | null;
  support_type: string | null;
  detail_url: string | null;
  similarity: number;
};

type User = {
  login_id: string;
};

type SavedFilter = {
  filter_id?: number;
  filter_name?: string;
  regions: string[] | null;
  categories: string[] | null;
  target_age: number | null;
  created_dt?: string;
};

type AuthMode = "login" | "signup";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  results?: SearchResult[];
};

function parseTargetAge(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 120) return null;
  return parsed;
}

function savedRegionToUi(region: string | undefined): string {
  if (!region || region === "전국") return ALL;
  return REGIONS.includes(region) ? region : ALL;
}

function savedCategoryToUi(category: string | undefined): string {
  if (!category) return ALL;
  return CATEGORIES.includes(category) ? category : ALL;
}

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return data.error ?? fallback;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>(ALL);
  const [filterRegion, setFilterRegion] = useState<string>(ALL);
  const [filterAge, setFilterAge] = useState("");
  const [filterStatus, setFilterStatus] = useState<RecruitmentStatus | typeof ALL>(
    ALL
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [savedFilter, setSavedFilter] = useState<SavedFilter | null>(null);
  const [scrappedIds, setScrappedIds] = useState<Set<number>>(new Set());
  const [showScrappedOnly, setShowScrappedOnly] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const [showClosed, setShowClosed] = useState(false);

  const loadScraps = useCallback(async () => {
    const res = await fetch("/api/user/scraps", { cache: "no-store" });
    if (!res.ok) {
      setScrappedIds(new Set());
      return;
    }
    const data = await res.json().catch(() => ({}));
    const ids = new Set<number>(
      ((data.scraps ?? []) as Array<{ ann_id?: unknown }>)
        .map((scrap) =>
          typeof scrap.ann_id === "number" ? scrap.ann_id : Number(scrap.ann_id)
        )
        .filter((id) => Number.isInteger(id) && id > 0)
    );
    setScrappedIds(ids);
  }, []);

  const loadSession = useCallback(async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setCurrentUser(data.user ?? null);
    setSavedFilter(data.filter ?? null);
    if (data.user) {
      await loadScraps();
    } else {
      setScrappedIds(new Set());
    }
    if (data.filter_error) {
      setAuthMessage(`필터 조회 오류: ${data.filter_error}`);
    }
  }, [loadScraps]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSession();
  }, [loadSession]);

  async function handleAuthSubmit() {
    setAuthLoading(true);
    setAuthMessage(null);
    try {
      const res = await fetch(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login_id: loginId, password }),
      });
      if (!res.ok) {
        throw new Error(
          await readApiError(
            res,
            authMode === "login" ? "로그인에 실패했어요." : "회원가입에 실패했어요."
          )
        );
      }
      const data = await res.json();
      setCurrentUser(data.user);
      setPassword("");
      setAuthMessage(authMode === "login" ? "로그인했습니다." : "회원가입했습니다.");
      await loadSession();
    } catch (e) {
      setAuthMessage(e instanceof Error ? e.message : "인증 오류가 발생했어요.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    setSavedFilter(null);
    setScrappedIds(new Set());
    setShowScrappedOnly(false);
    setAuthMessage("로그아웃했습니다.");
  }

  async function toggleScrap(annId: number) {
    if (!currentUser) {
      setAuthMessage("스크랩하려면 먼저 로그인해주세요.");
      return;
    }

    const isScrapped = scrappedIds.has(annId);
    const res = await fetch("/api/user/scraps", {
      method: isScrapped ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ann_id: annId }),
    });

    if (!res.ok) {
      setAuthMessage(await readApiError(res, "스크랩 처리에 실패했어요."));
      return;
    }

    setScrappedIds((prev) => {
      const next = new Set(prev);
      if (isScrapped) {
        next.delete(annId);
      } else {
        next.add(annId);
      }
      return next;
    });
    setAuthMessage(isScrapped ? "스크랩을 해제했습니다." : "스크랩했습니다.");
  }

  async function saveCurrentFilter() {
    setAuthMessage(null);
    const targetAge = parseTargetAge(filterAge);
    if (filterAge.trim() && targetAge === null) {
      setAuthMessage("나이는 0~120 사이의 숫자로 입력해주세요.");
      return;
    }

    const res = await fetch("/api/user/filter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        region: filterRegion,
        category: filterCategory,
        target_age: targetAge,
      }),
    });

    if (!res.ok) {
      setAuthMessage(await readApiError(res, "필터 저장에 실패했어요."));
      return;
    }

    const data = await res.json();
    setSavedFilter(data.filter);
    setAuthMessage("현재 필터를 저장했습니다.");
  }

  function applySavedFilter() {
    if (!savedFilter) return;
    setFilterRegion(savedRegionToUi(savedFilter.regions?.[0]));
    setFilterCategory(savedCategoryToUi(savedFilter.categories?.[0]));
    setFilterAge(
      typeof savedFilter.target_age === "number" ? String(savedFilter.target_age) : ""
    );
    setAuthMessage("저장된 필터를 적용했습니다.");
  }

  async function handleSearch() {
    const trimmed = query.trim();
    const targetAge = parseTargetAge(filterAge);
    const hasFilter =
      filterCategory !== ALL ||
      filterRegion !== ALL ||
      Boolean(filterAge.trim()) ||
      filterStatus !== ALL;

    if (!trimmed && !hasFilter) {
      setError("검색어를 입력하거나 필터를 하나 이상 선택해주세요.");
      return;
    }
    if (filterAge.trim() && targetAge === null) {
      setError("나이는 0~120 사이의 숫자로 입력해주세요.");
      return;
    }

    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          filter_category: filterCategory,
          filter_region: filterRegion,
          user_age: targetAge,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "검색 중 오류가 발생했어요.");
      }
      setResults((data.results ?? []) as SearchResult[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleResetFilters() {
    setQuery("");
    setFilterCategory(ALL);
    setFilterRegion(ALL);
    setFilterAge("");
    setFilterStatus(ALL);
    setError(null);
  }

  async function handleChatSend() {
    const trimmed = chatInput.trim();
    if (!trimmed || chatLoading) return;

    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "검색 중 오류가 발생했어요.");
      }
      const top = ((data.results ?? []) as SearchResult[])
        .filter(
          (r) =>
            recruitmentStatus(r.apply_start_dt, r.apply_end_dt) !== "마감"
        )
        .slice(0, 5);
      const reply: ChatMessage = {
        role: "assistant",
        content:
          top.length === 0
            ? "조건에 맞는 정책을 찾지 못했어요. 키워드를 조금 바꿔보세요."
            : "관련 정책을 찾았어요. 아래 후보를 확인해보세요.",
        results: top,
      };
      setChatMessages((prev) => [...prev, reply]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "알 수 없는 오류";
      setChatError(message);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `오류가 발생했어요: ${message}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  const statusFilteredResults =
    filterStatus === ALL
      ? showClosed
        ? results
        : results.filter(
            (r) =>
              recruitmentStatus(r.apply_start_dt, r.apply_end_dt) !== "마감"
          )
      : results.filter(
          (r) =>
            recruitmentStatus(r.apply_start_dt, r.apply_end_dt) ===
            filterStatus
        );

  // 스크랩만 보기 모드에서는 "마감 제외" 기본 동작을 우회한다.
  // 자기가 스크랩한 정책은 마감 여부 상관없이 보여주는 게 자연스럽기 때문.
  // 단, 사용자가 모집상태 dropdown을 명시 선택했으면 그 필터는 적용한다.
  const visibleResults =
    showScrappedOnly && currentUser
      ? (filterStatus === ALL
          ? results
          : results.filter(
              (r) =>
                recruitmentStatus(r.apply_start_dt, r.apply_end_dt) ===
                filterStatus
            )
        ).filter((r) => scrappedIds.has(r.id))
      : statusFilteredResults;
  const canSearch = Boolean(
    query.trim() ||
      filterCategory !== ALL ||
      filterRegion !== ALL ||
      filterAge.trim() ||
      filterStatus !== ALL
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">PolicyRec</h1>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              청년·창업자·기업을 위한 정책 추천{" "}
              <span className="text-xs text-zinc-400">Next.js MVP</span>
            </p>
          </div>
          <AuthPanel
            authMode={authMode}
            setAuthMode={setAuthMode}
            loginId={loginId}
            setLoginId={setLoginId}
            password={password}
            setPassword={setPassword}
            currentUser={currentUser}
            authLoading={authLoading}
            authMessage={authMessage}
            savedFilter={savedFilter}
            onSubmit={handleAuthSubmit}
            onLogout={handleLogout}
            onSaveFilter={saveCurrentFilter}
            onApplyFilter={applySavedFilter}
            scrapCount={scrappedIds.size}
            showScrappedOnly={showScrappedOnly}
            onToggleScrappedOnly={() => setShowScrappedOnly((value) => !value)}
          />
        </header>

        <section className="mb-8 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="예: 25살 청년이 받을 수 있는 창업 지원이 궁금해요"
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              onClick={handleSearch}
              disabled={loading || !canSearch}
              className="rounded-lg bg-blue-600 px-6 py-3 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "검색 중..." : "검색"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="카테고리"
              value={filterCategory}
              onChange={setFilterCategory}
              options={CATEGORIES}
            />
            <FilterSelect
              label="지역"
              value={filterRegion}
              onChange={setFilterRegion}
              options={REGIONS}
            />
            <label className="inline-flex items-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">나이</span>
              <input
                type="number"
                min={0}
                max={120}
                value={filterAge}
                onChange={(e) => setFilterAge(e.target.value)}
                placeholder="예: 25"
                className="w-24 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <FilterSelect
              label="모집상태"
              value={filterStatus}
              onChange={(v) =>
                setFilterStatus(v as RecruitmentStatus | typeof ALL)
              }
              options={STATUSES as readonly string[]}
            />
            <div className="ml-auto flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={showClosed}
                  onChange={(e) => setShowClosed(e.target.checked)}
                  className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800"
                />
                모집완료까지 보기
              </label>
              <button
                type="button"
                onClick={handleResetFilters}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                검색 초기화
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {searched && !loading && !error && (
          <div className="mb-3 text-sm text-zinc-500">
            검색 결과 {visibleResults.length}건
            {filterStatus !== ALL && results.length !== visibleResults.length && (
              <span className="text-zinc-400">
                {" "}
                (전체 {results.length}건 중 모집상태 필터 적용)
              </span>
            )}
            {showScrappedOnly && currentUser && (
              <span className="text-zinc-400"> (스크랩한 공고만 보기)</span>
            )}
          </div>
        )}

        {searched && !loading && visibleResults.length === 0 && !error && (
          <div className="py-16 text-center text-zinc-500">
            검색 결과가 없어요. 키워드나 필터를 조정해보세요.
          </div>
        )}

        <ul className="space-y-3">
          {visibleResults.map((r) => (
            <PolicyCard
              key={r.id}
              item={r}
              canScrap={Boolean(currentUser)}
              isScrapped={scrappedIds.has(r.id)}
              onToggleScrap={toggleScrap}
            />
          ))}
        </ul>

      </main>

      {chatOpen && (
        <div className="fixed inset-x-4 bottom-24 top-20 z-40 flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950 sm:left-auto sm:right-6 sm:top-auto sm:h-[600px] sm:max-h-[calc(100vh-7rem)] sm:w-[400px]">
          <ChatPanel
            messages={chatMessages}
            input={chatInput}
            setInput={setChatInput}
            loading={chatLoading}
            error={chatError}
            onSend={handleChatSend}
            onClose={() => setChatOpen(false)}
            currentUser={currentUser}
            scrappedIds={scrappedIds}
            onToggleScrap={toggleScrap}
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => setChatOpen((open) => !open)}
        aria-label={chatOpen ? "챗봇 닫기" : "챗봇 열기"}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-white shadow-lg ring-1 ring-zinc-200 transition-transform hover:scale-105 dark:bg-zinc-900 dark:ring-zinc-700"
      >
        {chatOpen ? (
          <span className="text-3xl leading-none text-zinc-600 dark:text-zinc-300">
            ×
          </span>
        ) : (
          <Image
            src="/chatbot_icon.png"
            alt=""
            width={56}
            height={56}
            className="h-full w-full rounded-full object-cover"
          />
        )}
      </button>
    </div>
  );
}

function ChatPanel({
  messages,
  input,
  setInput,
  loading,
  error,
  onSend,
  onClose,
  currentUser,
  scrappedIds,
  onToggleScrap,
}: {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  error: string | null;
  onSend: () => void;
  onClose: () => void;
  currentUser: User | null;
  scrappedIds: Set<number>;
  onToggleScrap: (annId: number) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="flex items-center gap-3">
          <Image
            src="/chatbot_icon.png"
            alt="PolicyRec 챗봇"
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-full border border-zinc-200 bg-white object-cover dark:border-zinc-700"
          />
          <div>
            <h3 className="text-sm font-semibold">PolicyRec 챗봇</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              자연어로 물어보세요
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="챗봇 닫기"
          className="rounded-md p-1 text-2xl leading-none text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !loading && (
          <p className="text-sm text-zinc-500">
            예: &quot;청년 창업 지원&quot; / &quot;서울 25살 주거 정책&quot; /
            &quot;예비창업자 자금 지원&quot;
          </p>
        )}

        <ul className="space-y-4">
          {messages.map((msg, idx) => (
            <li
              key={idx}
              className={
                msg.role === "user" ? "flex justify-end" : "flex gap-2"
              }
            >
              {msg.role === "assistant" && (
                <Image
                  src="/chatbot_icon.png"
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 rounded-full border border-zinc-200 bg-white object-cover dark:border-zinc-700"
                />
              )}
              {msg.role === "user" ? (
                <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-blue-600 px-4 py-2 text-sm text-white">
                  {msg.content}
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {msg.content}
                  </p>
                  {msg.results && msg.results.length > 0 && (
                    <ul className="mt-3 space-y-3">
                      {msg.results.map((r) => (
                        <PolicyCard
                          key={r.id}
                          item={r}
                          canScrap={Boolean(currentUser)}
                          isScrapped={scrappedIds.has(r.id)}
                          onToggleScrap={onToggleScrap}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {loading && (
          <p className="mt-3 text-sm text-zinc-500">검색 중...</p>
        )}
      </div>

      {error && (
        <p className="px-4 pb-1 text-xs text-red-500">{error}</p>
      )}

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="예: 청년 창업 지원"
            disabled={loading}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={loading || !input.trim()}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {loading ? "전송 중..." : "전송"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthPanel({
  authMode,
  setAuthMode,
  loginId,
  setLoginId,
  password,
  setPassword,
  currentUser,
  authLoading,
  authMessage,
  savedFilter,
  onSubmit,
  onLogout,
  onSaveFilter,
  onApplyFilter,
  scrapCount,
  showScrappedOnly,
  onToggleScrappedOnly,
}: {
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  loginId: string;
  setLoginId: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  currentUser: User | null;
  authLoading: boolean;
  authMessage: string | null;
  savedFilter: SavedFilter | null;
  onSubmit: () => void;
  onLogout: () => void;
  onSaveFilter: () => void;
  onApplyFilter: () => void;
  scrapCount: number;
  showScrappedOnly: boolean;
  onToggleScrappedOnly: () => void;
}) {
  if (currentUser) {
    return (
      <section className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900 sm:w-80">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-medium">{currentUser.login_id}</span>
          <button
            onClick={onLogout}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            로그아웃
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onSaveFilter}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            현재 필터 저장
          </button>
          <button
            onClick={onApplyFilter}
            disabled={!savedFilter}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            저장 필터 적용
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-950">
          <span className="text-zinc-500 dark:text-zinc-400">
            스크랩 {scrapCount}개
          </span>
          <button
            type="button"
            onClick={onToggleScrappedOnly}
            disabled={!showScrappedOnly && scrapCount === 0}
            className={`rounded-md border px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              showScrappedOnly
                ? "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                : "border-zinc-300 text-zinc-600 hover:bg-white dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            }`}
          >
            {showScrappedOnly ? "전체 결과 보기" : "스크랩만 보기"}
          </button>
        </div>
        <p className="mt-2 min-h-4 text-xs text-zinc-500">
          {authMessage ??
            (savedFilter ? "저장된 필터가 있습니다." : "저장된 필터가 없습니다.")}
        </p>
      </section>
    );
  }

  return (
    <section className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900 sm:w-80">
      <div className="mb-2 flex gap-1">
        <button
          onClick={() => setAuthMode("login")}
          className={`rounded-md px-2 py-1 text-xs ${
            authMode === "login"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          로그인
        </button>
        <button
          onClick={() => setAuthMode("signup")}
          className={`rounded-md px-2 py-1 text-xs ${
            authMode === "signup"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          회원가입
        </button>
      </div>
      <div className="grid gap-2">
        <input
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="아이디"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          placeholder="비밀번호"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          onClick={onSubmit}
          disabled={authLoading || !loginId.trim() || !password}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {authLoading
            ? "처리 중..."
            : authMode === "login"
              ? "로그인"
              : "회원가입"}
        </button>
      </div>
      <p className="mt-2 min-h-4 text-xs text-zinc-500">{authMessage}</p>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

function PolicyCard({
  item,
  canScrap,
  isScrapped,
  onToggleScrap,
}: {
  item: SearchResult;
  canScrap: boolean;
  isScrapped: boolean;
  onToggleScrap: (annId: number) => void;
}) {
  const sourceBadge = getSourceBadge(item.source);
  const status = recruitmentStatus(item.apply_start_dt, item.apply_end_dt);
  const statusBadge = STATUS_BADGE_STYLES[status];
  const dday = dDayLabel(item.apply_end_dt);
  const targetAgeLabel = formatTargetAgeRange(
    item.target_age_min,
    item.target_age_max
  );
  const similarityLabel =
    item.similarity > 0
      ? `유사도 ${(item.similarity * 100).toFixed(1)}%`
      : "조건 일치";

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {sourceBadge && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${sourceBadge.bg} ${sourceBadge.text}`}
            >
              {sourceBadge.label}
            </span>
          )}
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadge.bg} ${statusBadge.text}`}
          >
            {status}
          </span>
          <span className="text-xs text-zinc-400">{dday}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-zinc-400">
            {similarityLabel}
          </span>
          <button
            type="button"
            onClick={() => onToggleScrap(item.id)}
            disabled={!canScrap}
            title={canScrap ? "스크랩" : "로그인 후 스크랩할 수 있습니다"}
            className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
              isScrapped
                ? "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                : "border-zinc-300 text-zinc-500 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {isScrapped ? "★ 스크랩" : "☆ 스크랩"}
          </button>
        </div>
      </div>

      <h2 className="mb-2 text-lg font-semibold leading-tight">
        {item.detail_url ? (
          <a
            href={item.detail_url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h2>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {item.s_category && (
          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {item.s_category}
          </span>
        )}
        {item.region && (
          <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-300">
            {item.region}
          </span>
        )}
        {item.support_type && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            {item.support_type}
          </span>
        )}
        {item.target_tags?.slice(0, 3).map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            #{tag}
          </span>
        ))}
      </div>

      {item.summary && (
        <p className="mb-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
          {item.summary}
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500">
        {item.provider && <span>제공: {item.provider}</span>}
        <span>
          마감:{" "}
          {item.apply_end_dt ? formatDate(item.apply_end_dt) : "상시/확인필요"}
        </span>
        <span>대상 연령: {targetAgeLabel}</span>
      </div>
    </li>
  );
}
