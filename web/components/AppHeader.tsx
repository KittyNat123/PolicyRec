"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthDialog } from "@/components/AuthDialog";
import type { User } from "@/lib/types";

type MenuItem = {
  href: string;
  label: string;
  adminOnly?: boolean;
};

const MENU_ITEMS: MenuItem[] = [
  { href: "/mypage", label: "마이페이지" },
  { href: "/scraps", label: "스크랩" },
  { href: "/profile", label: "프로필" },
  { href: "/admin", label: "관리자", adminOnly: true },
];

const OPEN_CHAT_KEY = "policyrec-open-chat";
// ☑️수정: 알림 목록/읽음 API 연결 전까지 헤더 알림 UI는 보류
const SHOW_HEADER_NOTIFICATIONS = false;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SearchTabs({ pathname }: { pathname: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/"
        className={`flex h-10 items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition ${
          pathname === "/"
            ? "border-blue-200 bg-blue-50 text-blue-600 shadow-sm"
            : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"
        }`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m16.5 16.5 4 4" />
        </svg>
        <span>통합검색</span>
      </Link>
      <Link
        href="/?mode=filtered"
        className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-500 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M7 4h10a2 2 0 0 1 2 2v15l-7-4-7 4V6a2 2 0 0 1 2-2Z" />
        </svg>
        <span>조건검색</span>
      </Link>
    </div>
  );
}

export function AppHeader({
  currentUser,
  onAuthChange,
  centerSlot,
  hideGlobalChat = false,
}: {
  currentUser?: User | null;
  onAuthChange?: (action: "login" | "signup" | "logout") => void | Promise<void>;
  centerSlot?: ReactNode;
  hideGlobalChat?: boolean;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"login" | "signup">("login");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const authPromptHandledRef = useRef(false);
  const visibleItems = currentUser
    ? MENU_ITEMS.filter((item) => !item.adminOnly || currentUser.role === "admin")
    : [];
  const isAdmin = currentUser?.role === "admin" || currentUser?.login_id === "admin";

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      window.addEventListener("mousedown", handlePointerDown);
    }
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (authPromptHandledRef.current || currentUser) return;
    const params = new URLSearchParams(window.location.search);
    const authMode = params.get("auth");
    if (authMode === "login" || authMode === "signup") {
      authPromptHandledRef.current = true;
      openDialog(authMode);
    }
  }, [currentUser]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMenuOpen(false);
    if (onAuthChange) {
      await onAuthChange("logout");
      return;
    }
    window.location.reload();
  }

  async function handleAuthSuccess(action: "login" | "signup") {
    setMenuOpen(false);
    if (onAuthChange) {
      await onAuthChange(action);
      return;
    }
    window.location.reload();
  }

  function openDialog(mode: "login" | "signup") {
    setDialogMode(mode);
    setDialogOpen(true);
    setMenuOpen(false);
  }

  function openChatFromAnyPage() {
    window.sessionStorage.setItem(OPEN_CHAT_KEY, "1");
    if (pathname === "/") {
      window.dispatchEvent(new Event(OPEN_CHAT_KEY));
      return;
    }
    window.location.href = "/";
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image
              src="/logo_icon.png"
              alt="PolicyRec"
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg object-cover"
              priority
            />
            <span className="text-base font-bold text-slate-950">PolicyRec</span>
          </Link>

          <div className="hidden min-w-0 flex-1 items-center justify-center md:flex">
            {centerSlot ?? <SearchTabs pathname={pathname} />}
          </div>

          <div ref={menuRef} className="relative flex shrink-0 items-center gap-2">
            {/* ☑️수정: 알림 목록/읽음 API 연결 전까지 헤더 알림 버튼과 빨간 점은 숨김 */}
            {SHOW_HEADER_NOTIFICATIONS && currentUser && (
              <button
                type="button"
                title="알림"
                className="relative hidden h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 sm:flex"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />
              </button>
            )}
            {isAdmin && (
              <Link
                href="/admin"
                className="hidden rounded-xl bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 sm:inline-flex"
              >
                관리자
              </Link>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              title="프로필 메뉴"
              className={`flex h-9 items-center justify-center rounded-full transition ${
                currentUser
                  ? "w-9 overflow-hidden border border-slate-200 bg-white hover:bg-slate-50"
                  : "gap-2 bg-blue-600 px-3 text-sm font-bold text-white hover:bg-blue-700"
              }`}
            >
              <Image
                src="/login_icon.png"
                alt=""
                width={currentUser ? 36 : 22}
                height={currentUser ? 36 : 22}
                className={currentUser ? "h-9 w-9 object-cover" : "h-5 w-5 rounded-full object-cover"}
              />
              {!currentUser && <span>로그인</span>}
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-12 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <div className="border-b border-slate-100 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-950">
                    {currentUser ? currentUser.login_id : "방문자"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {currentUser
                      ? "저장한 정보와 스크랩을 바탕으로 맞춤 추천을 볼 수 있어요."
                      : "로그인하면 맞춤 추천과 스크랩을 사용할 수 있어요."}
                  </p>
                </div>

                <div className="py-2">
                  {visibleItems.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMenuOpen(false)}
                        className={`flex rounded-xl px-3 py-2 text-sm font-medium transition ${
                          active
                            ? "bg-blue-50 text-blue-700"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}

                  {currentUser ? (
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="mt-1 flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      로그아웃
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openDialog("login")}
                        className="mt-1 flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        로그인
                      </button>
                      <button
                        type="button"
                        onClick={() => openDialog("signup")}
                        className="mt-1 flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        회원가입
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {dialogOpen && (
        <AuthDialog
          key={dialogMode}
          open={dialogOpen}
          initialMode={dialogMode}
          onClose={() => setDialogOpen(false)}
          onSuccess={handleAuthSuccess}
        />
      )}

      {!hideGlobalChat && (
        <button
          type="button"
          onClick={openChatFromAnyPage}
          aria-label="챗봇 열기"
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-blue-100 bg-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
        >
          <Image src="/chatbot_icon.png" alt="" width={56} height={56} className="h-full w-full object-cover" />
        </button>
      )}
    </>
  );
}
