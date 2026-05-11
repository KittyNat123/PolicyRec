"use client";

import { useState } from "react";
import { ALL_OPTION, CATEGORIES, REGIONS, USER_TYPES } from "@/lib/profile-options";

type AuthMode = "login" | "signup";
type AuthAction = "login" | "signup";

function parseTargetAge(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 120) return null;
  return parsed;
}

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return data.error ?? fallback;
}

export function AuthDialog({
  open,
  initialMode = "login",
  onClose,
  onSuccess,
}: {
  open: boolean;
  initialMode?: AuthMode;
  onClose: () => void;
  onSuccess?: (action: AuthAction) => void | Promise<void>;
}) {
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupRegion, setSignupRegion] = useState<string>(ALL_OPTION);
  const [signupCategory, setSignupCategory] = useState<string>(ALL_OPTION);
  const [signupAge, setSignupAge] = useState("");
  const [signupUserType, setSignupUserType] = useState<string>(USER_TYPES[0]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit() {
    setLoading(true);
    setMessage(null);
    try {
      let payload: Record<string, unknown> = { login_id: loginId, password };
      if (authMode === "signup") {
        const targetAge = parseTargetAge(signupAge);
        if (signupAge.trim() && targetAge === null) {
          setMessage("나이는 0~120 사이의 숫자로 입력해주세요.");
          setLoading(false);
          return;
        }
        payload = {
          ...payload,
          nickname: signupName,
          email: signupEmail,
          phone: signupPhone,
          region: signupRegion,
          category: signupCategory,
          target_age: targetAge,
          user_type: signupUserType,
        };
      }

      const response = await fetch(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            authMode === "login" ? "로그인에 실패했어요." : "회원가입에 실패했어요."
          )
        );
      }

      await onSuccess?.(authMode);
      setPassword("");
      setMessage(authMode === "login" ? "로그인했습니다." : "회원가입했습니다.");
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인증 중 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4"
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-blue-600">PolicyRec 계정</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-950">
              {authMode === "login" ? "로그인" : "회원가입"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        </div>

        <div className="mt-5 flex rounded-xl bg-slate-100 p-1">
          {(["login", "signup"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAuthMode(mode)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                authMode === mode
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {mode === "login" ? "로그인" : "회원가입"}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-3">
          <input
            value={loginId}
            onChange={(event) => setLoginId(event.target.value)}
            placeholder="아이디"
            className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="비밀번호"
            className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />

          {authMode === "signup" && (
            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs leading-5 text-slate-500">
                가입 정보를 저장해 기본 필터와 챗봇 맞춤 추천에 바로 사용합니다.
              </p>
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                <span>이름</span>
                <input
                  value={signupName}
                  onChange={(event) => setSignupName(event.target.value)}
                  placeholder="예: 김지현"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                <span>이메일</span>
                <input
                  type="email"
                  value={signupEmail}
                  onChange={(event) => setSignupEmail(event.target.value)}
                  placeholder="name@example.com"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                <span>휴대폰 번호</span>
                <input
                  type="tel"
                  value={signupPhone}
                  onChange={(event) => setSignupPhone(event.target.value)}
                  placeholder="010-1234-5678"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <SelectRow
                label="사용자 유형"
                value={signupUserType}
                onChange={setSignupUserType}
                options={USER_TYPES}
              />
              <SelectRow
                label="지역"
                value={signupRegion}
                onChange={setSignupRegion}
                options={REGIONS}
              />
              <SelectRow
                label="관심 카테고리"
                value={signupCategory}
                onChange={setSignupCategory}
                options={CATEGORIES}
              />
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                <span>나이</span>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={signupAge}
                  onChange={(event) => setSignupAge(event.target.value)}
                  placeholder="예: 25"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={
              loading ||
              !loginId.trim() ||
              !password ||
              (authMode === "signup" && (!signupName.trim() || !signupEmail.trim() || !signupPhone.trim()))
            }
            className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "처리 중..." : authMode === "login" ? "로그인" : "회원가입"}
          </button>
        </div>

        <p className="mt-3 min-h-5 text-sm text-slate-500">{message}</p>
      </div>
    </div>
  );
}

function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
