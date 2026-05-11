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
import { PolicyCard } from "@/components/PolicyCard";
import { recruitmentStatus, type RecruitmentStatus } from "@/lib/utils";
import type {
  ChatMessage,
  SavedChat,
  SavedFilter,
  SearchResult,
  User,
} from "@/lib/types";

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

type AuthMode = "login" | "signup";
type SortBy = "end_date_asc" | "start_date_desc" | "similarity_desc";
type ServerSortBy = Exclude<SortBy, "similarity_desc">;

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
  return sortBy === "similarity_desc" ? "end_date_asc" : sortBy;
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
  const [signupRegion, setSignupRegion] = useState<string>(ALL);
  const [signupCategory, setSignupCategory] = useState<string>(ALL);
  const [signupAge, setSignupAge] = useState("");
  const [signupUserType, setSignupUserType] = useState("선택 안함");
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
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
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
      setAuthMessage(
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
      setAuthMessage(`필터 조회 오류: ${data.filter_error}`);
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

  function handleSortChange(next: SortBy) {
    if (next === sortBy) return;
    setSortBy(next);
    if (next === "similarity_desc") {
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

  async function handleAuthSubmit() {
    setAuthLoading(true);
    setAuthMessage(null);
    try {
      let payload: Record<string, unknown> = { login_id: loginId, password };
      if (authMode === "signup") {
        const targetAge = parseTargetAge(signupAge);
        if (signupAge.trim() && targetAge === null) {
          setAuthMessage("나이는 0~120 사이의 숫자로 입력해주세요.");
          setAuthLoading(false);
          return;
        }
        payload = { ...payload, region: signupRegion, category: signupCategory, target_age: targetAge, user_type: signupUserType };
      }
      const res = await fetch(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      if (authMode === "signup") {
        setSignupRegion(ALL);
        setSignupCategory(ALL);
        setSignupAge("");
        setSignupUserType("선택 안함");
        setAuthMode("login");
      }
      setAuthMessage(authMode === "login" ? "로그인했습니다." : "회원가입했습니다.");
      // 로그인/회원가입 시 챗봇 초기화 (이전 비로그인 컨텍스트 답변 비우기)
      setChatMessages([]);
      setChatInput("");
      setChatError(null);
      setActiveChatId(null);
      await loadSession();
    } catch (e) {
      setAuthMessage(e instanceof Error ? e.message : "인증 오류가 발생했어요.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    // 진행 중인 대화가 있으면 이탈 확인 팝업 먼저 표시
    if (chatMessages.length > 0) {
      setLeaveAction("logout");
      return;
    }
    await doLogout();
  }

  async function doLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    setSavedFilter(null);
    setScrappedIds(new Set());
    setScrappedItems([]);
    setSavedChats([]);
    setSavedChatsSetupRequired(false);
    setShowScrappedOnly(false);
    setAuthMessage("로그아웃했습니다.");
    // 챗봇 상태 초기화 (로그인 사용자 컨텍스트로 받았던 답변 비우기)
    setChatMessages([]);
    setChatInput("");
    setChatError(null);
    setActiveChatId(null);
    setLeaveAction(null);
  }

  async function toggleScrap(annId: number) {
    if (!currentUser) {
      setAuthMessage("스크랩하려면 먼저 로그인해주세요.");
      return;
    }

    const isScrapped = scrappedIds.has(annId);
    const res = await fetch("/api/mypage/scraps", {
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
    if (isScrapped) {
      setScrappedItems((prev) => prev.filter((item) => item.id !== annId));
    }
    setAuthMessage(isScrapped ? "스크랩을 해제했습니다." : "스크랩했습니다.");
  }

  async function saveCurrentChat(silent = false): Promise<boolean> {
    if (!currentUser) {
      setAuthMessage("로그인하면 저장 가능해요.");
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
      setAuthMessage(message);
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
    } else {
      await loadSavedChats();
    }
    setAuthMessage("챗봇 대화를 저장했습니다.");
    // silent 모드(자동저장)에서는 성공 토스트 생략 — 새 채팅 시작 토스트만 보이게
    if (!silent) showToast("챗봇 대화를 저장했습니다.");
    return true;
  }

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
      void doLogout();
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
    setLeaveAction(null);
    showToast(`"${chat.title ?? "저장된 대화"}"를 불러왔습니다.`);
  }

  function startNewChat() {
    // ✅ 자동저장: 로그인 상태이고 저장할 대화가 있을 때 백그라운드에서 저장
    // void로 호출 = fire-and-forget. 저장 성공/실패 여부와 무관하게 새 채팅 즉시 진행
    if (currentUser && chatMessages.length > 0) {
      void saveCurrentChat(true); // silent=true: 자동저장이므로 토스트 생략
    }
    doStartNewChat();
  }

  async function deleteSavedChat(id: number) {
    const res = await fetch("/api/user/saved-chats", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      setAuthMessage(await readApiError(res, "저장 답변 삭제에 실패했어요."));
      return;
    }

    setSavedChats((prev) => prev.filter((chat) => chat.id !== id));
    if (activeChatId === id) {
      setActiveChatId(null);
    }
    setAuthMessage("저장 답변을 삭제했습니다.");
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
          setAuthMessage(
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

  async function handleSearch(options?: {
    sortOverride?: ServerSortBy;
    appendOffset?: number; // 더보기용. 지정 시 append 모드
  }) {
    const trimmed = query.trim();
    const targetAge = parseTargetAge(filterAge);

    const isAppend = options?.appendOffset !== undefined;
    const effectiveSortBy: ServerSortBy =
      options?.sortOverride ?? toServerSortBy(sortBy);
    const effectiveOffset = options?.appendOffset ?? 0;
    // 검색어 없는 필터-only 조회에서 기본은 마감 제외 결과를 요청한다.
    // (마감 포함 조회를 원하는 경우: 모집상태=마감 또는 showClosed=true)
    const includeOnlyOpen =
      trimmed === "" && filterStatus !== "마감" && !showClosed;
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
          query: trimmed,
          filter_category: filterCategory,
          filter_region: filterRegion,
          user_age: targetAge,
          // 검색어 없을 때만 정렬/페이지네이션 적용 (키워드 검색은 similarity 정렬 + 10개 고정)
          ...(trimmed === "" && {
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
        setLastSearchQuery(trimmed);
      }
      // 검색어 없을 때만 페이지네이션 상태 업데이트
      if (trimmed === "") {
        setBrowseHasMore(Boolean(data.hasMore));
        setBrowseOffset(effectiveOffset + newResults.length);
        if (options?.sortOverride) setSortBy(options.sortOverride);
      } else {
        setBrowseHasMore(false);
        setBrowseOffset(0);
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
    setFilterCategory(ALL);
    setFilterRegion(ALL);
    setFilterAge("");
    setFilterStatus(ALL);
    setError(null);
    setLastSearchQuery("");
    // 검색 모드 종료 → 첫 화면(모집중 공고)으로 복귀
    setSearched(false);
    void loadOpenAnnouncements(0, toServerSortBy(sortBy), false);
  }

  async function handleChatSend() {
    const trimmed = chatInput.trim();
    if (!trimmed || chatLoading) return;

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
        ? scrappedIds.size === 0
          ? []
          : scrappedItems
        : (scrappedIds.size === 0 ? [] : scrappedItems).filter(
          (r) =>
            recruitmentStatus(r.apply_start_dt, r.apply_end_dt) ===
            filterStatus
        )
      )
      : statusFilteredResults;
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
            signupRegion={signupRegion}
            setSignupRegion={setSignupRegion}
            signupCategory={signupCategory}
            setSignupCategory={setSignupCategory}
            signupAge={signupAge}
            setSignupAge={setSignupAge}
            signupUserType={signupUserType}
            setSignupUserType={setSignupUserType}
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
            onToggleScrappedOnly={() => {
              setShowScrappedOnly((value) => {
                const next = !value;
                if (next) setSearched(true);
                return next;
              });
            }}
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
              onClick={() => handleSearch()}
              disabled={loading}
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
                마감 공고도 확인하기
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
            {showScrappedOnly && currentUser ? "스크랩한 공고" : "검색 결과"}{" "}
            {visibleResults.length}건
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

        {/* 정렬 토글 — 스크랩만 보기/에러 외에 항상 표시 (키워드 검색은 클라이언트 재정렬) */}
        {!showScrappedOnly && !error && results.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-zinc-500">
              {!searched ? (
                <>
                  모집중 공고 {results.length}건
                  {browseHasMore && (
                    <span className="text-zinc-400"> (더 보기 가능)</span>
                  )}
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {searched && lastSearchQuery !== "" && (
                <button
                  type="button"
                  onClick={() => handleSortChange("similarity_desc")}
                  className={`rounded-md px-3 py-1 transition-colors ${sortBy === "similarity_desc"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                >
                  유사도순
                </button>
              )}
              <button
                type="button"
                onClick={() => handleSortChange("end_date_asc")}
                className={`rounded-md px-3 py-1 transition-colors ${sortBy === "end_date_asc"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
              >
                마감 임박순
              </button>
              <button
                type="button"
                onClick={() => handleSortChange("start_date_desc")}
                className={`rounded-md px-3 py-1 transition-colors ${sortBy === "start_date_desc"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
              >
                새 공고순
              </button>
            </div>
          </div>
        )}

        {searched && !loading && !scrapsLoading && visibleResults.length === 0 && !error && (
          <div className="py-16 text-center text-zinc-500">
            {showScrappedOnly && currentUser
              ? "아직 스크랩한 정책이 없어요."
              : "검색 결과가 없어요. 키워드나 필터를 조정해보세요."}
          </div>
        )}

        {scrapsLoading && scrappedIds.size > 0 && showScrappedOnly && currentUser && (
          <div className="py-16 text-center text-zinc-500">
            스크랩한 공고를 불러오는 중...
          </div>
        )}

        {/* 첫 화면 모드 로딩/빈 상태 */}
        {!searched && browseLoading && results.length === 0 && (
          <div className="py-16 text-center text-zinc-500">
            모집중인 공고를 불러오는 중...
          </div>
        )}

        {!searched && !browseLoading && results.length === 0 && !error && (
          <div className="py-16 text-center text-zinc-500">
            현재 모집중인 공고가 없어요.
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

        {/* 더 보기 버튼 — 첫 화면 모드 + 필터-only 검색 모드에서 표시 */}
        {browseHasMore && !showScrappedOnly && !error && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={browseLoading || loading}
              className="rounded-md border border-zinc-300 bg-white px-6 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {(browseLoading || loading) ? "불러오는 중..." : "더 보기"}
            </button>
          </div>
        )}

      </main>

      {toastMessage && (
        <div
          role="status"
          className="fixed left-1/2 top-5 z-[60] -translate-x-1/2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
        >
          {toastMessage}
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
              궁금한 걸 물어보세요! 정책 추천도 가능합니다.
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

      <div className="flex flex-wrap gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
        <button
          type="button"
          onClick={onNewChat}
          disabled={messages.length === 0 && !input.trim()}
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          새 채팅 시작
        </button>
        <button
          type="button"
          onClick={() => setShowSavedChats((value) => !value)}
          disabled={!currentUser}
          title={currentUser ? "저장한 대화 보기" : "로그인하면 저장 가능"}
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          저장 목록
        </button>
        {!currentUser && (
          <span className="self-center text-[11px] text-zinc-500">
            로그인하면 저장 가능
          </span>
        )}
      </div>

      {/* 저장 목록 패널 — 채팅 영역과 분리된 독립 섹션 */}
      {showSavedChats && (
        <div className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-2 px-4 py-2">
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              저장한 대화 {savedChats.length}개
            </p>
            <button
              type="button"
              onClick={() => setShowSavedChats(false)}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              닫기
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto px-3 pb-3">
            {!currentUser ? (
              <p className="text-xs text-zinc-500">로그인하면 저장 목록을 볼 수 있어요.</p>
            ) : savedChatsSetupRequired ? (
              <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                saved_chats 테이블 접근이 필요합니다.
                Database/ERD_table_info_v1.md 기준 DB 구조를 확인해주세요.
              </p>
            ) : savedChatsLoading ? (
              <p className="text-xs text-zinc-500">불러오는 중...</p>
            ) : savedChats.length === 0 ? (
              <p className="text-xs text-zinc-500">아직 저장한 대화가 없습니다.</p>
            ) : (
              <ul className="space-y-1.5">
                {savedChats.map((chat) => (
                  <li
                    key={chat.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    <div className="min-w-0 flex-1">
                      {/* 제목: title 있으면 title, 없으면 content 앞부분 fallback */}
                      <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                        {chat.title ?? chat.content.slice(0, 40)}
                      </p>
                      <time className="text-[11px] text-zinc-400">
                        {formatSavedChatDate(chat.created_dt)}
                      </time>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {/* 이 대화로 돌아가기 — 현재 대화 있으면 이탈 확인 팝업 경유 */}
                      <button
                        type="button"
                        onClick={() => onRestoreChat(chat)}
                        className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
                      >
                        돌아가기
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSavedChat(chat.id)}
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
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !loading && (
          <div className="space-y-3">
            {currentUser && hasSavedFilter ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
                <p className="font-medium">
                  저장된 필터로 맞춤 추천 가능 ✨
                </p>
                <p className="mt-1 text-xs text-blue-800 dark:text-blue-300">
                  {savedFilterParts.join(" · ")}
                </p>
                <p className="mt-2 text-xs">
                  &quot;나에게 맞는 정책 추천해줘&quot;라고 물어보면 위 정보로 답변해드려요!
                </p>
              </div>
            ) : currentUser ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <p className="font-medium">어떤 정책이 궁금하세요?</p>
                <p className="mt-1 text-xs">
                  거주지·나이·관심분야를 알려주시면 더 정확히 추천해드릴게요.
                  홈 화면에서 필터를 저장하면 챗봇에 자동 적용돼요!
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <p className="font-medium">어떤 정책이 궁금하세요?</p>
                <p className="mt-1 text-xs">
                  거주지·나이·관심분야를 알려주시면 더 정확히 추천해드릴게요.
                  예: &quot;25살 서울에서 창업하려고 해요&quot;
                </p>
              </div>
            )}
            <p className="px-1 text-xs text-zinc-500">
              💡 다른 예: &quot;청년 창업 지원&quot;, &quot;충남 청년 주거&quot;,
              &quot;예비창업자 자금&quot;
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
            {loading ? "답변 생성 중..." : "전송"}
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
  signupRegion,
  setSignupRegion,
  signupCategory,
  setSignupCategory,
  signupAge,
  setSignupAge,
  signupUserType,
  setSignupUserType,
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
  signupRegion: string;
  setSignupRegion: (value: string) => void;
  signupCategory: string;
  setSignupCategory: (value: string) => void;
  signupAge: string;
  setSignupAge: (value: string) => void;
  signupUserType: string;
  setSignupUserType: (value: string) => void;
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
    const isAdmin = currentUser.role === "admin";
    return (
      <section className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900 sm:w-80">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-medium">{currentUser.login_id}</span>
          <div className="flex items-center gap-1">
            <a
              href="/mypage"
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              마이페이지
            </a>
            {isAdmin && (
              <a
                href="/admin"
                className="rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900"
              >
                관리자페이지
              </a>
            )}
            <button
              onClick={onLogout}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              로그아웃
            </button>
          </div>
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
            className={`rounded-md border px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${showScrappedOnly
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
          className={`rounded-md px-2 py-1 text-xs ${authMode === "login"
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
        >
          로그인
        </button>
        <button
          onClick={() => setAuthMode("signup")}
          className={`rounded-md px-2 py-1 text-xs ${authMode === "signup"
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
        {authMode === "signup" && (
          <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              관심정보를 입력하면 맞춤 추천에 바로 활용돼요. (선택)
            </p>
            <label className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <span>사용자 유형</span>
              <select
                value={signupUserType}
                onChange={(e) => setSignupUserType(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {["선택 안함", "청년", "예비 창업자", "창업자", "기업"].map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <span>지역</span>
              <select
                value={signupRegion}
                onChange={(e) => setSignupRegion(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {REGIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <span>관심 카테고리</span>
              <select
                value={signupCategory}
                onChange={(e) => setSignupCategory(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {CATEGORIES.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <span>나이</span>
              <input
                type="number"
                min={0}
                max={120}
                value={signupAge}
                onChange={(e) => setSignupAge(e.target.value)}
                placeholder="예: 25"
                className="w-24 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>
        )}
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
