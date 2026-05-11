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
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AuthDialog } from "@/components/AuthDialog";
import { PolicyCard } from "@/components/PolicyCard";
import { ALL_OPTION, CATEGORIES, REGIONS, TARGET_OPTIONS } from "@/lib/profile-options";
import { recruitmentStatus, type RecruitmentStatus } from "@/lib/utils";
import type {
  ChatMessage,
  SavedChat,
  SavedFilter,
  SearchResult,
  User,
} from "@/lib/types";

const ALL = ALL_OPTION;

const STATUSES: (RecruitmentStatus | typeof ALL)[] = [
  ALL,
  "모집중",
  "마감",
  "모집예정",
  "상시",
];

const TARGET_AGE_PRESETS: Record<string, string> = {
  청년: "25",
  중장년: "45",
  노인: "65",
};

const TARGET_SEARCH_TERMS: Record<string, string> = {
  장애인: "장애인 대상 지원",
  저소득: "저소득 취약계층 지원",
  학생: "학생 대상 지원",
  "예비 창업자": "예비창업자 지원",
  재직자: "재직자 지원",
  구직자: "구직자 취업 지원",
  기업: "기업 지원 사업",
};

type SortBy = "end_date_asc" | "start_date_desc" | "similarity_desc" | "scrap_count_desc";
type ServerSortBy = Exclude<SortBy, "similarity_desc" | "scrap_count_desc">;

const CATEGORY_OPTIONS = [ALL, "주거", "창업", "취업", "교육", "복지", "금융", "문화"] as const;
const CATEGORY_API_MAP: Record<string, string> = {
  취업: "인력/일자리",
  금융: "자금",
};
const REGION_OPTIONS = [
  ALL,
  "서울특별시",
  "경기도",
  "인천광역시",
  "부산광역시",
  "대구광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
] as const;

function parseTargetAge(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 120) return null;
  return parsed;
}

function savedRegionToUi(region: string | undefined): string {
  if (!region || region === "전국") return ALL;
  return (REGIONS as readonly string[]).includes(region) ? region : ALL;
}

function savedCategoryToUi(category: string | undefined): string {
  if (!category) return ALL;
  if (category === "인력/일자리") return "취업";
  if (category === "자금") return "금융";
  return (CATEGORIES as readonly string[]).includes(category) ? category : ALL;
}

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return data.error ?? fallback;
}

function formatSavedChatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function collectChatAnnIds(messages: ChatMessage[]): number[] {
  return Array.from(
    new Set(
      messages.flatMap((message) =>
        (message.results ?? [])
          .map((result) => result.id)
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    )
  );
}

function isLowSignalChatInput(value: string) {
  const normalized = value.trim().replace(/\s+/g, "");
  if (normalized.length < 2) return true;
  if (!/[0-9A-Za-z가-힣]/.test(normalized)) return true;
  if (/^[ㅋㅎㅠㅜㅗㅓㅏㅣㅡㄱ-ㅎㅏ-ㅣ!?.,~]+$/.test(normalized)) return true;
  if (/^(.)\1{2,}$/.test(normalized)) return true;
  return false;
}

const CHAT_INPUT_GUIDE =
  "원하시는 정책을 검색해보세요!\n예: 서울 거주 25살 예비창업자 자금 지원, 청년 주거 지원, 구직자 교육 지원";

function buildChatTranscript(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const speaker = message.role === "user" ? "사용자" : "PolicyRec";
      const annIds = collectChatAnnIds([message]);
      const recommended =
        annIds.length > 0 ? `\n추천 정책 ID: ${annIds.join(", ")}` : "";
      return `${speaker}\n${message.content}${recommended}`;
    })
    .join("\n\n---\n\n");
}

// buildChatTranscript 의 역방향 — 저장된 텍스트를 ChatMessage[] 로 복원
// results(PolicyCard 데이터)는 텍스트에 없으므로 content만 복원됩니다.
function parseChatTranscript(transcript: string): ChatMessage[] {
  return transcript
    .split("\n\n---\n\n")
    .map((block) => {
      const newlineIdx = block.indexOf("\n");
      if (newlineIdx === -1) return null;
      const speaker = block.slice(0, newlineIdx).trim();
      // "추천 정책 ID: ..." 줄은 content에서 제거
      const body = block
        .slice(newlineIdx + 1)
        .replace(/\n추천 정책 ID:.*$/m, "")
        .trim();
      if (!body) return null;
      const role: ChatMessage["role"] = speaker === "사용자" ? "user" : "assistant";
      return { role, content: body } satisfies ChatMessage;
    })
    .filter((m): m is ChatMessage => m !== null);
}

// 키워드 검색 결과처럼 클라이언트에서 재정렬할 때 사용
function sortResultsClientSide(
  results: SearchResult[],
  sortBy: SortBy
): SearchResult[] {
  const copy = [...results];
  if (sortBy === "similarity_desc") {
    copy.sort((a, b) => b.similarity - a.similarity);
  } else if (sortBy === "scrap_count_desc") {
    copy.sort((a, b) => (b.scrap_count ?? 0) - (a.scrap_count ?? 0));
  } else if (sortBy === "end_date_asc") {
    // 마감 임박순: apply_end_dt 오름차순. null/빈값은 뒤로
    copy.sort((a, b) => {
      const aEnd = a.apply_end_dt || "9999-12-31";
      const bEnd = b.apply_end_dt || "9999-12-31";
      return aEnd.localeCompare(bEnd);
    });
  } else {
    // 새 공고순: apply_start_dt 내림차순. null/빈값은 뒤로
    copy.sort((a, b) => {
      const aStart = a.apply_start_dt || "";
      const bStart = b.apply_start_dt || "";
      // 빈값은 뒤로
      if (!aStart && !bStart) return 0;
      if (!aStart) return 1;
      if (!bStart) return -1;
      return bStart.localeCompare(aStart);
    });
  }
  return copy;
}

function toServerSortBy(sortBy: SortBy): ServerSortBy {
  return sortBy === "similarity_desc" || sortBy === "scrap_count_desc"
    ? "end_date_asc"
    : sortBy;
}

const SORT_LABELS: Record<SortBy, string> = {
  end_date_asc: "마감 가까운 순",
  start_date_desc: "새로 올라온 순",
  similarity_desc: "유사도 순",
  scrap_count_desc: "스크랩 많은 순",
};

const SORT_DESCRIPTIONS: Record<SortBy, string> = {
  end_date_asc: "신청 마감이 빠른 정책부터 보여드려요.",
  start_date_desc: "최근 등록된 정책부터 보여드려요.",
  similarity_desc: "나와 더 잘 맞는 정책부터 보여드려요.",
  scrap_count_desc: "현재 불러온 결과 안에서 스크랩이 많은 정책부터 보여드려요.",
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [filterCategories, setFilterCategories] = useState<string[]>([ALL]);
  const [filterRegion, setFilterRegion] = useState<string[]>([ALL]);
  const [filterTargets, setFilterTargets] = useState<string[]>([ALL]);
  const [filterAge, setFilterAge] = useState("");
  const [filterStatus, setFilterStatus] = useState<string[]>([ALL]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [savedFilter, setSavedFilter] = useState<SavedFilter | null>(null);
  const [scrappedIds, setScrappedIds] = useState<Set<number>>(new Set());
  const [scrappedItems, setScrappedItems] = useState<SearchResult[]>([]);
  const [scrapsLoading, setScrapsLoading] = useState(false);
  const [showScrappedOnly, setShowScrappedOnly] = useState(false);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [savedChatsLoading, setSavedChatsLoading] = useState(false);
  const [savedChatsSetupRequired, setSavedChatsSetupRequired] = useState(false);
  const [uiMessage, setUiMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<"login" | "signup">("login");
  const [recommendPrompt, setRecommendPrompt] = useState<"profile" | "scrap" | null>(null);
  const [highlightFilter, setHighlightFilter] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const lastSavedTranscriptRef = useRef("");
  const autoFilterReadyRef = useRef(false);
  // 이탈 확인 팝업 — 어떤 액션을 확인 중인지 함께 기억
  // null = 팝업 닫힘 / "new" = 새 채팅 / "logout" = 로그아웃 / restore = 저장 대화 복원
  type LeaveAction = "new" | "logout" | { type: "restore"; chat: SavedChat };
  const [leaveAction, setLeaveAction] = useState<LeaveAction | null>(null);

  const [showClosed, setShowClosed] = useState(false);

  // 첫 화면 모집중 공고 모드 (검색어/필터 없이 진입했을 때)
  const PAGE_SIZE = 20;
  const [sortBy, setSortBy] = useState<SortBy>("end_date_asc");
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  // 마지막 검색에 사용된 query (정렬 토글 표시 조건 판단용 — ""면 필터-only 검색)
  const [lastSearchQuery, setLastSearchQuery] = useState("");

  const loadScraps = useCallback(async () => {
    const res = await fetch("/api/mypage/scraps", { cache: "no-store" });
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

  const loadSavedChats = useCallback(async () => {
    setSavedChatsLoading(true);
    try {
      const res = await fetch("/api/user/saved-chats", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) {
          setSavedChats([]);
          setSavedChatsSetupRequired(false);
          return;
        }
        throw new Error(await readApiError(res, "저장 답변을 불러오지 못했어요."));
      }
      const data = await res.json().catch(() => ({}));
      setSavedChats((data.saved_chats ?? []) as SavedChat[]);
      setSavedChatsSetupRequired(Boolean(data.setup_required));
    } catch (e) {
      setSavedChats([]);
      setSavedChatsSetupRequired(false);
      setUiMessage(
        e instanceof Error ? e.message : "저장 답변을 불러오지 못했어요."
      );
    } finally {
      setSavedChatsLoading(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setCurrentUser(data.user ?? null);
    setSavedFilter(data.filter ?? null);
    if (data.user) {
      await Promise.all([loadScraps(), loadSavedChats()]);
    } else {
      setScrappedIds(new Set());
      setScrappedItems([]);
      setSavedChats([]);
      setSavedChatsSetupRequired(false);
    }
    if (data.filter_error) {
      setUiMessage(`필터 조회 오류: ${data.filter_error}`);
    }
  }, [loadSavedChats, loadScraps]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSession();
  }, [loadSession]);

  // 첫 화면 모집중 공고 로드 (검색어 없이 진입 시)
  const loadOpenAnnouncements = useCallback(
    async (
      offset: number,
      sort: ServerSortBy,
      append: boolean
    ) => {
      setBrowseLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: "",
            only_open: true,
            sort_by: sort,
            offset,
            limit: PAGE_SIZE,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "공고를 불러오지 못했어요.");
        }
        const newResults = (data.results ?? []) as SearchResult[];
        if (append) {
          setResults((prev) => [...prev, ...newResults]);
        } else {
          setResults(newResults);
        }
        setBrowseHasMore(Boolean(data.hasMore));
        setBrowseOffset(offset + newResults.length);
      } catch (e) {
        setError(e instanceof Error ? e.message : "공고를 불러오지 못했어요.");
        if (!append) setResults([]);
      } finally {
        setBrowseLoading(false);
      }
    },
    []
  );

  // 첫 진입 시 자동 호출
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOpenAnnouncements(0, toServerSortBy(sortBy), false);
    // 첫 진입 시 1회만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoFilterReadyRef.current) {
      autoFilterReadyRef.current = true;
      return;
    }

    const timer = window.setTimeout(() => {
      void handleSearch();
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCategories, filterRegion, filterTargets, filterAge, filterStatus, showClosed]);

  function handleSortChange(next: SortBy) {
    if (next === sortBy) return;
    setSortBy(next);
    if (next === "similarity_desc" || next === "scrap_count_desc") {
      if (!searched || lastSearchQuery === "") return;
      setResults((prev) => sortResultsClientSide(prev, next));
      return;
    }
    if (searched) {
      if (lastSearchQuery === "") {
        // 필터-only 검색 모드: handleSearch 다시 호출 (서버 정렬)
        void handleSearch({ sortOverride: next });
      } else {
        // 키워드 검색 모드: 클라이언트에서 재정렬 (similarity 결과 10개를 정렬)
        setResults((prev) => sortResultsClientSide(prev, next));
      }
    } else {
      // 첫 화면 모드
      void loadOpenAnnouncements(0, next, false);
    }
  }

  function handleLoadMore() {
    if (browseLoading || loading || !browseHasMore) return;
    if (searched) {
      // 검색 모드 더보기
      void handleSearch({ appendOffset: browseOffset });
    } else {
      // 첫 화면 모드 더보기
      void loadOpenAnnouncements(browseOffset, toServerSortBy(sortBy), true);
    }
  }

  function showToast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => {
      setToastMessage((current) => (current === message ? null : current));
    }, 2500);
  }

  async function clearSessionState(message?: string) {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setCurrentUser(null);
    setSavedFilter(null);
    setScrappedIds(new Set());
    setScrappedItems([]);
    setSavedChats([]);
    setSavedChatsSetupRequired(false);
    setShowScrappedOnly(false);
    setQuery("");
    setFilterCategories([ALL]);
    setFilterRegion([ALL]);
    setFilterTargets([ALL]);
    setFilterAge("");
    setFilterStatus([ALL]);
    setShowClosed(false);
    setSearched(false);
    setLastSearchQuery("");
    setSortBy("end_date_asc");
    setError(null);
    setUiMessage(message ?? null);
    // 챗봇 상태 초기화 (로그인 사용자 컨텍스트로 받았던 답변 비우기)
    setChatMessages([]);
    setChatInput("");
    setChatLoading(false);
    setChatError(null);
    setChatOpen(false);
    setActiveChatId(null);
    setLeaveAction(null);
    await loadOpenAnnouncements(0, "end_date_asc", false);
  }

  function openAuthDialog(mode: "login" | "signup") {
    setAuthDialogMode(mode);
    setAuthDialogOpen(true);
  }

  function openChatWithPrompt(prompt: string) {
    setChatOpen(true);
    setChatInput(prompt);
  }

  function hasSavedProfile() {
    return Boolean(
      savedFilter?.user_type ||
        savedFilter?.regions?.length ||
        savedFilter?.categories?.length ||
        typeof savedFilter?.target_age === "number"
    );
  }

  function requestProfileRecommendation() {
    if (!currentUser) {
      openAuthDialog("signup");
      return;
    }
    if (!hasSavedProfile()) {
      setRecommendPrompt("profile");
      return;
    }
    openChatWithPrompt("내 저장 정보와 스크랩 이력을 바탕으로 지금 신청할 만한 정책을 추천해줘.");
  }

  function requestScrapRecommendation() {
    if (!currentUser) {
      openAuthDialog("signup");
      return;
    }
    if (scrappedIds.size === 0) {
      setRecommendPrompt("scrap");
      return;
    }
    openChatWithPrompt("내가 스크랩한 정책과 비슷한 정책 중 지금 신청 가능한 공고를 추천해줘.");
  }

  async function handleHeaderAuthChange(action: "login" | "signup" | "logout") {
    if (action === "logout") {
      await clearSessionState("로그아웃했습니다.");
      return;
    }
    setUiMessage(action === "login" ? "로그인했습니다." : "회원가입했습니다.");
    setChatMessages([]);
    setChatInput("");
    setChatError(null);
    setActiveChatId(null);
    await loadSession();
  }

  async function toggleScrap(annId: number) {
    if (!currentUser) {
      setUiMessage("스크랩하려면 먼저 로그인해주세요.");
      return;
    }

    const isScrapped = scrappedIds.has(annId);
    const res = await fetch("/api/mypage/scraps", {
      method: isScrapped ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ann_id: annId }),
    });

    if (!res.ok) {
      setUiMessage(await readApiError(res, "스크랩 처리에 실패했어요."));
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
    if (isScrapped) {
      setScrappedItems((prev) => prev.filter((item) => item.id !== annId));
    }
    setUiMessage(isScrapped ? "스크랩을 해제했습니다." : "스크랩했습니다.");
  }

  async function saveCurrentChat(silent = false): Promise<boolean> {
    if (!currentUser) {
      setUiMessage("로그인하면 저장 가능해요.");
      return false;
    }
    if (chatMessages.length === 0) {
      // silent 모드(자동저장)에서는 "저장할 대화 없음" 토스트 생략
      if (!silent) showToast("저장할 대화가 없습니다.");
      return false;
    }

    const content = buildChatTranscript(chatMessages);
    const annIds = collectChatAnnIds(chatMessages);
    // 첫 번째 사용자 메시지를 제목으로 사용 (최대 40자 + 말줄임)
    const firstUserMsg = chatMessages.find((m) => m.role === "user")?.content ?? "";
    const title = firstUserMsg.length > 40 ? `${firstUserMsg.slice(0, 40)}...` : firstUserMsg;
    const targetChatId = activeChatId;

    const res = await fetch("/api/user/saved-chats", {
      method: targetChatId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: targetChatId,
        title,
        content,
        ann_ids: annIds,
      }),
    });

    if (!res.ok) {
      const message = await readApiError(res, "챗봇 대화 저장에 실패했어요.");
      if (res.status === 503) {
        setSavedChatsSetupRequired(true);
      }
      setUiMessage(message);
      // silent 모드(자동저장)에서는 실패 토스트도 생략 — 새 채팅 흐름을 방해하지 않기 위해
      if (!silent) showToast(message);
      return false;
    }

    const data = await res.json().catch(() => ({}));
    if (data.saved_chat) {
      const savedChat = data.saved_chat as SavedChat;
      setSavedChats((prev) =>
        targetChatId
          ? prev.map((chat) => (chat.id === savedChat.id ? savedChat : chat))
          : [savedChat, ...prev]
      );
      setActiveChatId(savedChat.id);
      lastSavedTranscriptRef.current = content;
    } else {
      await loadSavedChats();
    }
    setUiMessage("챗봇 대화를 저장했습니다.");
    // silent 모드(자동저장)에서는 성공 토스트 생략 — 새 채팅 시작 토스트만 보이게
    if (!silent) showToast("챗봇 대화를 저장했습니다.");
    return true;
  }

  useEffect(() => {
    if (!currentUser || chatMessages.length === 0 || chatLoading) return;

    const content = buildChatTranscript(chatMessages);
    if (!content || lastSavedTranscriptRef.current === content) return;

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = window.setTimeout(async () => {
      const annIds = collectChatAnnIds(chatMessages);
      const targetChatId = activeChatId;
      const res = await fetch("/api/user/saved-chats", {
        method: targetChatId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: targetChatId,
          content,
          ann_ids: annIds,
        }),
      });

      if (!res.ok) {
        if (res.status === 503) setSavedChatsSetupRequired(true);
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (data.saved_chat) {
        const savedChat = data.saved_chat as SavedChat;
        setSavedChats((prev) =>
          targetChatId
            ? prev.map((chat) => (chat.id === savedChat.id ? savedChat : chat))
            : [savedChat, ...prev]
        );
        setActiveChatId(savedChat.id);
        lastSavedTranscriptRef.current = content;
      }
    }, 900);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [activeChatId, chatLoading, chatMessages, currentUser]);

  // "새 채팅 시작" 버튼 클릭 — 대화 내용이 있으면 무조건 확인 팝업 먼저
  function requestNewChat() {
    if (chatMessages.length > 0 || chatLoading) {
      setLeaveAction("new");
      return;
    }
    doStartNewChat();
  }

  // "이전 대화로 돌아가기" 클릭 — 현재 대화 있으면 확인 팝업, 없으면 바로 복원
  function requestRestoreChat(chat: SavedChat) {
    if (chatMessages.length > 0 || chatLoading) {
      setLeaveAction({ type: "restore", chat });
      return;
    }
    doRestoreChat(chat);
  }

  // 팝업에서 "그냥 이동 / 이동할게요" 확정 시 — leaveAction에 따라 분기
  function confirmLeave() {
    if (leaveAction === "new") {
      doStartNewChat();
    } else if (leaveAction === "logout") {
      void clearSessionState("로그아웃했습니다.");
    } else if (leaveAction && typeof leaveAction === "object" && leaveAction.type === "restore") {
      doRestoreChat(leaveAction.chat);
    }
  }

  // 팝업에서 "저장하고 이동" (로그인 시에만 노출)
  async function saveAndLeave() {
    if (chatMessages.length === 0) {
      confirmLeave();
      return;
    }
    const saved = await saveCurrentChat(false);
    if (saved) {
      confirmLeave();
    }
  }

  function doStartNewChat() {
    // 진행 중인 답변 요청 취소 — 응답이 새 채팅에 섞이지 않도록
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setChatLoading(false);
    setChatMessages([]);
    setChatInput("");
    setChatError(null);
    setActiveChatId(null);
    lastSavedTranscriptRef.current = "";
    setLeaveAction(null);
    showToast("새 채팅을 시작했습니다.");
  }

  // 저장된 대화를 현재 채팅에 복원
  function doRestoreChat(chat: SavedChat) {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setChatLoading(false);
    // content(텍스트 전문) → ChatMessage 배열로 파싱해서 복원
    const restored = parseChatTranscript(chat.content);
    setChatMessages(restored);
    setChatInput("");
    setChatError(null);
    setActiveChatId(chat.id);
    lastSavedTranscriptRef.current = chat.content;
    setLeaveAction(null);
    showToast(`"${chat.title ?? "저장된 대화"}"를 불러왔습니다.`);
  }

  async function deleteSavedChat(id: number) {
    const res = await fetch("/api/user/saved-chats", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      setUiMessage(await readApiError(res, "저장 답변 삭제에 실패했어요."));
      return;
    }

    setSavedChats((prev) => prev.filter((chat) => chat.id !== id));
    if (activeChatId === id) {
      setActiveChatId(null);
    }
    setUiMessage("저장 답변을 삭제했습니다.");
    showToast("저장 답변을 삭제했습니다.");
  }

  useEffect(() => {
    if (!showScrappedOnly || !currentUser) {
      return;
    }

    const ids = Array.from(scrappedIds);
    if (ids.length === 0) {
      return;
    }

    let ignore = false;
    async function loadScrappedItems() {
      setScrapsLoading(true);
      try {
        const res = await fetch("/api/announcements/by-ids", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) {
          throw new Error(await readApiError(res, "스크랩 공고를 불러오지 못했어요."));
        }
        const data = await res.json().catch(() => ({}));
        if (!ignore) {
          setScrappedItems((data.results ?? []) as SearchResult[]);
        }
      } catch (e) {
        if (!ignore) {
          setUiMessage(
            e instanceof Error ? e.message : "스크랩 공고를 불러오지 못했어요."
          );
          setScrappedItems([]);
        }
      } finally {
        if (!ignore) {
          setScrapsLoading(false);
        }
      }
    }

    void loadScrappedItems();
    return () => {
      ignore = true;
    };
  }, [currentUser, scrappedIds, showScrappedOnly]);

  async function saveCurrentFilter() {
    setUiMessage(null);
    const targetAge = parseTargetAge(filterAge);
    if (filterAge.trim() && targetAge === null) {
      setUiMessage("나이는 0~120 사이의 숫자로 입력해주세요.");
      return;
    }

    const res = await fetch("/api/user/filter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        region: filterRegion.filter((value) => value !== ALL)[0] ?? ALL,
        category:
          CATEGORY_API_MAP[filterCategories.filter((value) => value !== ALL)[0] ?? ""] ??
          filterCategories.filter((value) => value !== ALL)[0] ??
          ALL,
        target_age: targetAge,
      }),
    });

    if (!res.ok) {
      setUiMessage(await readApiError(res, "필터 저장에 실패했어요."));
      return;
    }

    const data = await res.json();
    setSavedFilter(data.filter);
    setUiMessage("현재 필터를 저장했습니다.");
  }

function applySavedFilter() {
    if (!savedFilter) return;
    setFilterRegion([savedRegionToUi(savedFilter.regions?.[0])]);
    setFilterCategories([savedCategoryToUi(savedFilter.categories?.[0])]);
    setFilterTargets([ALL]);
    setFilterAge(
      typeof savedFilter.target_age === "number" ? String(savedFilter.target_age) : ""
    );
    setUiMessage("저장된 필터를 적용했습니다.");
  }

  async function handleSearch(options?: {
    sortOverride?: ServerSortBy;
    appendOffset?: number; // 더보기용. 지정 시 append 모드
  }) {
    const trimmed = query.trim();
    const selectedCategories = filterCategories.filter((value) => value !== ALL);
    const selectedRegions = filterRegion.filter((value) => value !== ALL);
    const selectedStatuses = filterStatus.filter((value) => value !== ALL);
    const selectedTargets = filterTargets.filter((value) => value !== ALL);
    const categorySearchTerm =
      selectedCategories.length > 1 ? selectedCategories.join(" ") : "";
    const regionSearchTerm = selectedRegions.length > 1 ? selectedRegions.join(" ") : "";
    const targetSearchTerm = selectedTargets
      .map((target) => TARGET_SEARCH_TERMS[target] ?? target)
      .join(" ");
    const hardFilterCategory =
      selectedCategories.length === 1
        ? CATEGORY_API_MAP[selectedCategories[0]] ?? selectedCategories[0]
        : ALL;
    const hardFilterRegion = selectedRegions.length === 1 ? selectedRegions[0] : ALL;
    const effectiveQuery = [trimmed, categorySearchTerm, regionSearchTerm, targetSearchTerm]
      .filter(Boolean)
      .join(" ");
    const targetAge = parseTargetAge(filterAge);

    const isAppend = options?.appendOffset !== undefined;
    const effectiveSortBy: ServerSortBy =
      options?.sortOverride ?? toServerSortBy(sortBy);
    const effectiveOffset = options?.appendOffset ?? 0;
    // 검색어 없는 필터-only 조회에서 기본은 마감 제외 결과를 요청한다.
    // (마감 포함 조회를 원하는 경우: 모집상태=마감 또는 showClosed=true)
    const includeOnlyOpen =
      effectiveQuery === "" && !selectedStatuses.includes("마감") && !showClosed;
    if (filterAge.trim() && targetAge === null) {
      setError("나이는 0~120 사이의 숫자로 입력해주세요.");
      return;
    }

    setLoading(true);
    setError(null);
    setSearched(true);
    // 검색/필터 시 스크랩만 보기 자동 해제 (append 시는 유지)
    if (!isAppend) {
      setShowScrappedOnly(false);
    }
    try {
      const res = await fetch("/api/search", {
        method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          query: effectiveQuery,
          filter_category: hardFilterCategory,
          filter_region: hardFilterRegion,
          user_age: targetAge,
          // 검색어 없을 때만 정렬/페이지네이션 적용 (키워드 검색은 similarity 정렬 + 10개 고정)
          ...(effectiveQuery === "" && {
            sort_by: effectiveSortBy,
            offset: effectiveOffset,
            limit: PAGE_SIZE,
            only_open: includeOnlyOpen,
          }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "검색 중 오류가 발생했어요.");
      }
      const newResults = (data.results ?? []) as SearchResult[];
      if (isAppend) {
        setResults((prev) => [...prev, ...newResults]);
      } else {
        setResults(newResults);
        setLastSearchQuery(effectiveQuery);
      }
      // 검색어 없을 때만 페이지네이션 상태 업데이트
      if (effectiveQuery === "") {
        setBrowseHasMore(Boolean(data.hasMore));
        setBrowseOffset(effectiveOffset + newResults.length);
        if (!isAppend) setSortBy(options?.sortOverride ?? effectiveSortBy);
      } else {
        setBrowseHasMore(false);
        setBrowseOffset(0);
        if (!isAppend) setSortBy("similarity_desc");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
      if (!isAppend) setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleResetFilters() {
    setQuery("");
    setFilterCategories([ALL]);
    setFilterRegion([ALL]);
    setFilterTargets([ALL]);
    setFilterAge("");
    setFilterStatus([ALL]);
    setError(null);
    setLastSearchQuery("");
    setSortBy("end_date_asc");
    // 검색 모드 종료 → 첫 화면(모집중 공고)으로 복귀
    setSearched(false);
    void loadOpenAnnouncements(0, "end_date_asc", false);
  }

  async function handleChatSend() {
    const trimmed = chatInput.trim();
    if (!trimmed || chatLoading) return;

    if (isLowSignalChatInput(trimmed)) {
      const guideMessage: ChatMessage = { role: "assistant", content: CHAT_INPUT_GUIDE };
      setChatMessages((prev) => [...prev, guideMessage]);
      setChatInput("");
      setChatError(null);
      return;
    }

    // 이전 요청이 남아있으면 취소
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
    }
    const controller = new AbortController();
    chatAbortRef.current = controller;

    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);

    try {
      const res = await fetch("/api/chat/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: chatMessages.slice(-8),
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "챗봇 답변 생성 중 오류가 발생했어요.");
      }
      // 새 채팅으로 갈아탔거나 다른 요청이 시작됐으면 결과 무시
      if (chatAbortRef.current !== controller) return;
      const top = ((data.results ?? []) as SearchResult[])
        .filter(
          (r) =>
            recruitmentStatus(r.apply_start_dt, r.apply_end_dt) !== "마감"
        )
        .slice(0, 5);
      const reply: ChatMessage = {
        role: "assistant",
        content:
          typeof data.reply === "string" && data.reply.trim()
            ? data.reply
            : "관련 정책을 찾았어요. 아래 후보를 확인해보세요.",
        results: top,
      };
      setChatMessages((prev) => [...prev, reply]);
    } catch (e) {
      // AbortError는 사용자가 새 채팅 시작/재요청한 정상 흐름 — 무시
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error(e);
      if (chatAbortRef.current !== controller) return;
      const message = "에러 발생. 다시 시도해주세요.";
      setChatError(message);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: message },
      ]);
    } finally {
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
        setChatLoading(false);
      }
    }
  }

  const statusFilteredResults =
    filterStatus.includes(ALL)
      ? showClosed
        ? results
        : results.filter(
          (r) =>
            recruitmentStatus(r.apply_start_dt, r.apply_end_dt) !== "마감"
        )
      : results.filter((r) => filterStatus.includes(recruitmentStatus(r.apply_start_dt, r.apply_end_dt)));

  // 스크랩만 보기 모드에서는 "마감 제외" 기본 동작을 우회한다.
  // 자기가 스크랩한 정책은 마감 여부 상관없이 보여주는 게 자연스럽기 때문.
  // 단, 사용자가 모집상태 dropdown을 명시 선택했으면 그 필터는 적용한다.
  const visibleResults =
    showScrappedOnly && currentUser
      ? (filterStatus.includes(ALL)
        ? scrappedIds.size === 0
          ? []
          : scrappedItems
        : (scrappedIds.size === 0 ? [] : scrappedItems).filter((r) => filterStatus.includes(recruitmentStatus(r.apply_start_dt, r.apply_end_dt)))
      )
      : statusFilteredResults;

  const resultHeading = showScrappedOnly && currentUser
    ? "스크랩한 공고"
    : searched
      ? "검색 결과"
      : "지금 신청 가능한 정책";
  const isInitialLoading = !searched && browseLoading && results.length === 0;
  const isAdmin = currentUser?.role === "admin";
  const canSortBySimilarity = searched && lastSearchQuery !== "";
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AppHeader currentUser={currentUser} onAuthChange={handleHeaderAuthChange} />
      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
        <section className="mb-6 overflow-hidden rounded-[24px] bg-gradient-to-br from-blue-600 to-blue-800 px-5 py-10 text-center text-white shadow-sm sm:px-8 sm:py-12">
          <h1 className="text-2xl font-bold sm:text-3xl">나에게 맞는 정책을 찾아보세요</h1>
          <p className="mt-3 text-sm text-blue-100">전국 정책을 한 곳에서 탐색하고 스크랩하세요</p>
          <div className="mx-auto mt-7 flex max-w-2xl items-center gap-2 rounded-2xl bg-white p-2 shadow-lg">
            <span className="pl-3 text-slate-400">⌕</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="정책명, 키워드, 기관명으로 검색하세요"
              className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-left text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={() => handleSearch()}
              disabled={loading}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "검색중" : "검색"}
            </button>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="font-semibold text-blue-100">인기 검색어:</span>
            {["청년 월세 지원", "창업 지원금", "취업 수당", "문화누리카드"].map((keyword) => (
              <button
                key={keyword}
                type="button"
                onClick={() => setQuery(keyword)}
                className="rounded-full bg-white/15 px-3 py-1.5 font-semibold text-white hover:bg-white/25"
              >
                {keyword}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-6 grid gap-5 lg:grid-cols-[1.35fr_0.95fr]">
          <div className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-bold text-blue-600">오늘의 AI 추천</p>
                <h2 className="mt-2 text-xl font-bold text-slate-950">
                  내 조건에 맞는 정책을 먼저 골라볼까요?
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                  지역, 나이, 관심 분야와 스크랩 이력을 바탕으로 지금 확인할 만한 공고를 좁혀드립니다.
                </p>
              </div>
              {currentUser ? (
                <button
                  type="button"
                  onClick={requestProfileRecommendation}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700"
                >
                  AI에게 추천받기
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuthDialog("signup")}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700"
                >
                  나만의 맞춤 정보 받기
                </button>
              )}
            </div>
            <div className="grid gap-3 border-t border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={requestProfileRecommendation}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50"
              >
                내 조건 기반
              </button>
              <button
                type="button"
                onClick={requestScrapRecommendation}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50"
              >
                스크랩 취향 반영
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-950">10초 컷 추천</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              정책을 고를 때 더 중요한 기준을 하나만 골라보세요.
            </p>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={requestProfileRecommendation}
                className="rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50"
              >
                내 조건에 맞는 정책이 좋아요
              </button>
              <button
                type="button"
                onClick={requestScrapRecommendation}
                className="rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50"
              >
                내가 저장한 정책과 비슷하면 좋아요
              </button>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <aside
            className={`h-fit rounded-lg border bg-white shadow-sm transition ${
              highlightFilter
                ? "border-blue-400 ring-4 ring-blue-100"
                : "border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
              <h2 className="text-base font-bold text-slate-950">필터</h2>
              <button type="button" onClick={handleResetFilters} className="text-xs font-bold text-slate-400 hover:text-blue-700">
                초기화
              </button>
            </div>

            <div className="space-y-5 p-4">
              <MultiChipFilter
                label="분야"
                values={filterCategories}
                options={CATEGORY_OPTIONS}
                onChange={setFilterCategories}
              />
              <div>
                <p className="mb-3 text-sm font-bold text-slate-700">대상</p>
                <div className="flex flex-wrap gap-2">
                  <MultiChipFilter
                    label=""
                    values={filterTargets}
                    options={TARGET_OPTIONS}
                    onChange={(values) => {
                      setFilterTargets(values);
                      const ageTargets = values.filter((value) => TARGET_AGE_PRESETS[value]);
                      if (ageTargets.length === 1) {
                        setFilterAge(TARGET_AGE_PRESETS[ageTargets[0]]);
                      }
                    }}
                    hideLabel
                  />
                </div>
              </div>
              <MultiChipFilter
                label="지역"
                values={filterRegion}
                options={REGION_OPTIONS}
                onChange={setFilterRegion}
              />
              <MultiChipFilter
                label="상태"
                values={filterStatus}
                options={STATUSES as readonly string[]}
                onChange={setFilterStatus}
              />
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-700">나이</span>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={filterAge}
                  onChange={(e) => setFilterAge(e.target.value)}
                  placeholder="예: 25"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    checked={showClosed}
                    onChange={(e) => setShowClosed(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  마감 공고 포함
                </label>

              <div className="border-t border-slate-100 pt-5">
                {currentUser && (
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => void saveCurrentFilter()}
                      className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      현재 필터 저장
                    </button>
                    <button
                      type="button"
                      onClick={applySavedFilter}
                      disabled={!savedFilter}
                      className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      저장 필터 적용
                    </button>
                  </div>
                )}

                <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-700">
                      스크랩 {scrappedIds.size}개
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowScrappedOnly((value) => {
                          const next = !value;
                          if (next) setSearched(true);
                          return next;
                        });
                      }}
                      disabled={!showScrappedOnly && scrappedIds.size === 0}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        showScrappedOnly
                          ? "border-amber-300 bg-amber-100 text-amber-800"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {showScrappedOnly ? "전체 결과 보기" : "스크랩만 보기"}
                    </button>
                  </div>
                  {uiMessage && (
                    <p className="mt-3 text-xs leading-5 text-slate-500">{uiMessage}</p>
                  )}
                </div>
              </div>
            </div>
          </aside>

          <section className="min-w-0">

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <p className="font-semibold">검색을 완료하지 못했어요.</p>
            <p className="mt-1">{error}</p>
          </div>
        )}

        {/* 정렬 토글 — 스크랩만 보기/에러 외에 항상 표시 (키워드 검색은 클라이언트 재정렬) */}
        {!error && (results.length > 0 || searched) && (
          <section className="mb-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {resultHeading}
                  </h2>
                </div>
              </div>
              {!showScrappedOnly && results.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    정렬
                  </span>
                  <div className="flex flex-wrap items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                  {canSortBySimilarity && (
                    <button
                        type="button"
                        aria-pressed={sortBy === "similarity_desc"}
                        title={SORT_DESCRIPTIONS.similarity_desc}
                        onClick={() => handleSortChange("similarity_desc")}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${sortBy === "similarity_desc"
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
                          }`}
                      >
                        {SORT_LABELS.similarity_desc}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-pressed={sortBy === "scrap_count_desc"}
                      title={SORT_DESCRIPTIONS.scrap_count_desc}
                      onClick={() => handleSortChange("scrap_count_desc")}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${sortBy === "scrap_count_desc"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
                        }`}
                    >
                      {SORT_LABELS.scrap_count_desc}
                    </button>
                    <button
                      type="button"
                      aria-pressed={sortBy === "end_date_asc"}
                      title={SORT_DESCRIPTIONS.end_date_asc}
                      onClick={() => handleSortChange("end_date_asc")}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${sortBy === "end_date_asc"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
                        }`}
                    >
                      {SORT_LABELS.end_date_asc}
                    </button>
                    <button
                      type="button"
                      aria-pressed={sortBy === "start_date_desc"}
                      title={SORT_DESCRIPTIONS.start_date_desc}
                      onClick={() => handleSortChange("start_date_desc")}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${sortBy === "start_date_desc"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
                        }`}
                    >
                      {SORT_LABELS.start_date_desc}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {searched && !loading && !scrapsLoading && visibleResults.length === 0 && !error && (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-14 text-center dark:border-zinc-700 dark:bg-zinc-950">
            <p className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
              {showScrappedOnly && currentUser
                ? "아직 스크랩한 정책이 없어요."
                : "조건에 맞는 정책을 찾지 못했어요."}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              {showScrappedOnly && currentUser
                ? "관심 있는 정책 카드에서 스크랩을 눌러두면 여기에서 다시 볼 수 있어요."
                : "지역이나 카테고리를 전체로 바꾸거나, 검색어를 조금 더 넓게 입력해보세요."}
            </p>
            {!showScrappedOnly && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-5 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                조건 전체 초기화
              </button>
            )}
          </div>
        )}

        {scrapsLoading && scrappedIds.size > 0 && showScrappedOnly && currentUser && (
          <div className="rounded-lg border border-zinc-200 bg-white px-6 py-14 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            스크랩한 공고를 불러오고 있어요.
          </div>
        )}

        {/* 첫 화면 모드 로딩/빈 상태 */}
        {isInitialLoading && (
          <div className="rounded-lg border border-zinc-200 bg-white px-6 py-14 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            지금 신청 가능한 정책을 불러오고 있어요.
          </div>
        )}

        {!searched && !browseLoading && results.length === 0 && !error && (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-14 text-center dark:border-zinc-700 dark:bg-zinc-950">
            <p className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
              현재 모집중인 공고가 없어요.
            </p>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              마감 공고 포함을 켜거나 검색어를 입력해 다시 확인해보세요.
            </p>
          </div>
        )}

        <ul className="space-y-4">
          {visibleResults.map((r) => (
            <PolicyCard
              key={r.id}
              item={r}
              canScrap={Boolean(currentUser)}
              isScrapped={scrappedIds.has(r.id)}
              onToggleScrap={toggleScrap}
              showSimilarityScore={isAdmin}
            />
          ))}
        </ul>

        {/* 더 보기 버튼 — 첫 화면 모드 + 필터-only 검색 모드에서 표시 */}
        {browseHasMore && !showScrappedOnly && !error && (
          <div className="mt-7 flex justify-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={browseLoading || loading}
              className="rounded-md border border-zinc-300 bg-white px-6 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {(browseLoading || loading) ? "더 불러오는 중..." : "정책 더 보기"}
            </button>
          </div>
        )}

          </section>
        </div>
      </main>

      {toastMessage && (
        <div
          role="status"
          className="fixed left-1/2 top-5 z-[60] -translate-x-1/2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
        >
          {toastMessage}
        </div>
      )}

      {authDialogOpen && (
        <AuthDialog
          key={authDialogMode}
          open={authDialogOpen}
          initialMode={authDialogMode}
          onClose={() => setAuthDialogOpen(false)}
          onSuccess={handleHeaderAuthChange}
        />
      )}

      {recommendPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/45 px-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-950">
              {recommendPrompt === "profile"
                ? "맞춤 조건을 먼저 설정할까요?"
                : "스크랩 취향을 먼저 만들어볼까요?"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {recommendPrompt === "profile"
                ? "마이페이지에서 지역, 나이, 사용자 유형, 관심 분야를 저장하면 AI 추천이 더 정확해집니다."
                : "관심 있는 정책을 스크랩해두면 비슷한 공고를 더 잘 찾아드릴 수 있습니다."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRecommendPrompt(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                아니요
              </button>
              <button
                type="button"
                onClick={() => {
                  if (recommendPrompt === "profile") {
                    window.location.href = "/mypage";
                    return;
                  }
                  setRecommendPrompt(null);
                  setHighlightFilter(true);
                  window.setTimeout(() => setHighlightFilter(false), 1800);
                }}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                예
              </button>
            </div>
          </div>
        </div>
      )}

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
            savedFilter={savedFilter}
            savedChats={savedChats}
            savedChatsLoading={savedChatsLoading}
            savedChatsSetupRequired={savedChatsSetupRequired}
            scrappedIds={scrappedIds}
            onToggleScrap={toggleScrap}
            onDeleteSavedChat={deleteSavedChat}
            onNewChat={requestNewChat}
            onRestoreChat={requestRestoreChat}
          />
        </div>
      )}

      {leaveAction !== null && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4"
          onClick={() => setLeaveAction(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {leaveAction === "logout"
                ? "로그아웃할까요?"
                : leaveAction === "new"
                  ? "새 채팅을 시작할까요?"
                  : "이 대화로 돌아갈까요?"}
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              이동하면 지금까지 나눈 내용은 삭제됩니다. 이동할까요?
            </p>
            {!currentUser && (
              <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                💡 회원가입 후 로그인하면 대화 내용을 저장할 수 있습니다.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              {/* 로그인 상태일 때만 "저장하고 이동" 노출 */}
              {currentUser && (
                <button
                  type="button"
                  onClick={() => void saveAndLeave()}
                  className="rounded-md border border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950"
                >
                  저장하고 이동
                </button>
              )}
              <button
                type="button"
                onClick={confirmLeave}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                그냥 이동
              </button>
              <button
                type="button"
                onClick={() => setLeaveAction(null)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                머무르기
              </button>
            </div>
          </div>
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

function toggleMultiValue(current: string[], option: string, options: readonly string[]) {
  if (option === ALL) return [ALL];
  const withoutAll = current.filter((value) => value !== ALL);
  const next = withoutAll.includes(option)
    ? withoutAll.filter((value) => value !== option)
    : [...withoutAll, option];
  const selectableOptions = options.filter((value) => value !== ALL);
  if (selectableOptions.length > 0 && selectableOptions.every((value) => next.includes(value))) {
    return [ALL];
  }
  return next.length === 0 ? [ALL] : next;
}

function MultiChipFilter({
  label,
  values,
  options,
  onChange,
  hideLabel = false,
}: {
  label: string;
  values: readonly string[];
  options: readonly string[];
  onChange: (values: string[]) => void;
  hideLabel?: boolean;
}) {
  const normalizedValues = values.length > 0 ? values : [ALL];
  return (
    <div>
      {!hideLabel && <p className="mb-3 text-sm font-bold text-slate-700">{label}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = normalizedValues.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(toggleMultiValue([...normalizedValues], option, options))}
              className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
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
  savedFilter,
  savedChats,
  savedChatsLoading,
  savedChatsSetupRequired,
  scrappedIds,
  onToggleScrap,
  onDeleteSavedChat,
  onNewChat,
  onRestoreChat,
}: {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  error: string | null;
  onSend: () => void;
  onClose: () => void;
  currentUser: User | null;
  savedFilter: SavedFilter | null;
  savedChats: SavedChat[];
  savedChatsLoading: boolean;
  savedChatsSetupRequired: boolean;
  scrappedIds: Set<number>;
  onToggleScrap: (annId: number) => void;
  onDeleteSavedChat: (id: number) => void;
  onNewChat: () => void;
  onRestoreChat: (chat: SavedChat) => void;
}) {
  const [showSavedChats, setShowSavedChats] = useState(false);
  // 빈 대화 상태 안내 분기용 — 저장된 필터 요약
  const savedFilterParts: string[] = [];
  if (savedFilter?.user_type) {
    savedFilterParts.push(`유형 ${savedFilter.user_type}`);
  }
  if (savedFilter?.regions?.[0] && savedFilter.regions[0] !== "전국") {
    savedFilterParts.push(`지역 ${savedFilter.regions[0]}`);
  }
  if (savedFilter?.categories?.[0]) {
    savedFilterParts.push(`카테고리 ${savedFilter.categories[0]}`);
  }
  if (typeof savedFilter?.target_age === "number") {
    savedFilterParts.push(`나이 ${savedFilter.target_age}세`);
  }
  const hasSavedFilter = savedFilterParts.length > 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="flex items-center gap-3">
          {showSavedChats && (
            <button
              type="button"
              onClick={() => setShowSavedChats(false)}
              aria-label="채팅으로 돌아가기"
              className="rounded-full p-1 text-xl leading-none text-zinc-500 hover:bg-zinc-100"
            >
              ‹
            </button>
          )}
          <Image
            src="/chatbot_icon.png"
            alt="PolicyRec 챗봇"
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-full border border-zinc-200 bg-white object-cover dark:border-zinc-700"
          />
          <div>
            <h3 className="text-sm font-semibold">
              {showSavedChats ? "대화" : "PolicyRec 챗봇"}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {showSavedChats ? "저장된 대화를 이어서 볼 수 있어요." : "정책 조건을 알려주시면 맞춤 추천을 도와드려요."}
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

      {!showSavedChats && (
      <div className="flex flex-wrap gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
        <button
          type="button"
          onClick={() => {
            setShowSavedChats(false);
            onNewChat();
          }}
          disabled={messages.length === 0 && !input.trim()}
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          새 채팅 시작
        </button>
        {!currentUser && (
          <span className="self-center text-[11px] text-zinc-500">
            로그인하면 저장 가능
          </span>
        )}
      </div>
      )}

      {showSavedChats && (
        <div className="flex-1 overflow-y-auto bg-zinc-50 p-4 dark:bg-zinc-900">
            {!currentUser ? (
              <p className="text-xs text-zinc-500">로그인하면 저장 목록을 볼 수 있어요.</p>
            ) : savedChatsSetupRequired ? (
              <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                저장 대화 접근 확인이 필요합니다. Supabase에서 chat_history 테이블과
                스키마 캐시 갱신 여부를 확인해주세요.
              </p>
            ) : savedChatsLoading ? (
              <p className="text-xs text-zinc-500">불러오는 중...</p>
            ) : savedChats.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
                아직 저장한 대화가 없습니다.
              </div>
            ) : (
              <ul className="space-y-2">
                {savedChats.map((chat) => (
                  <li
                    key={chat.id}
                    onClick={() => {
                      setShowSavedChats(false);
                      onRestoreChat(chat);
                    }}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left shadow-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {chat.title ?? chat.content.slice(0, 40)}
                      </p>
                      <time className="text-[11px] text-zinc-400">
                        {formatSavedChatDate(chat.created_dt)}
                      </time>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteSavedChat(chat.id);
                        }}
                        className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}

      {!showSavedChats && (
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !loading && (
          <div className="space-y-3">
            {currentUser && hasSavedFilter ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
                <p className="font-medium">
                  저장된 조건을 바탕으로 추천을 시작합니다.
                </p>
                <p className="mt-1 text-xs text-blue-800 dark:text-blue-300">
                  {savedFilterParts.join(" · ")}
                </p>
                <p className="mt-2 text-xs">
                  예: 지금 신청 가능한 정책 3개만 골라줘.
                </p>
              </div>
            ) : currentUser ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <p className="font-medium">추천에 필요한 조건을 알려주세요.</p>
                <p className="mt-1 text-xs">
                  지역, 나이, 관심 분야, 현재 상황을 함께 적으면 더 정확하게 좁혀드릴게요.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <p className="font-medium">상황을 한 문장으로 적어주세요.</p>
                <p className="mt-1 text-xs">
                  예: 서울 거주 25살 예비창업자인데 자금 지원을 찾고 있어요.
                </p>
              </div>
            )}
            <p className="px-1 text-xs text-zinc-500">
              다른 예: &quot;청년 창업 지원&quot;, &quot;충남 청년 주거&quot;, &quot;구직자 교육 지원&quot;
            </p>
          </div>
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
                  <p className="whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300">
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
                          showSimilarityScore={currentUser?.role === "admin"}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {loading && <p className="mt-3 text-sm text-zinc-500">답변 생성 중...</p>}
      </div>
      )}

      {!showSavedChats && error && (
        <p className="px-4 pb-1 text-xs text-red-500">{error}</p>
      )}

      {!showSavedChats && (
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
            {loading ? "답변 생성 중..." : "전송"}
          </button>
        </div>
      </div>
      )}

      <div className="grid grid-cols-2 border-t border-zinc-200 bg-white text-xs font-semibold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950">
        <button
          type="button"
          onClick={() => setShowSavedChats(false)}
          className={`py-3 ${!showSavedChats ? "text-blue-600" : "hover:text-zinc-800"}`}
        >
          Home
        </button>
        <button
          type="button"
          onClick={() => setShowSavedChats(true)}
          disabled={!currentUser}
          className={`py-3 disabled:opacity-40 ${showSavedChats ? "text-blue-600" : "hover:text-zinc-800"}`}
        >
          Messages
        </button>
      </div>
    </div>
  );
}








