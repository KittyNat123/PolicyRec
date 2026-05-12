"use client";

import { useEffect, useMemo, useState } from "react";
import { ALL_OPTION, CATEGORIES, REGIONS, USER_TYPES } from "@/lib/profile-options";

type AuthMode = "login" | "signup";
type AuthAction = "login" | "signup";

const NAME_REGEX = /^[A-Za-z가-힣\s]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\d{2,4}-\d{3,4}-\d{4}$/;
const AGE_REGEX = /^\d{1,3}$/;

function parseTargetAge(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 120) return null;
  return parsed;
}

function validateName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "유효한 이름을 입력하세요.";
  if (!NAME_REGEX.test(trimmed)) return "유효한 이름을 입력하세요.";
  return null;
}

function validateEmail(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "유효한 이메일을 입력하세요.";
  if (!EMAIL_REGEX.test(trimmed)) return "유효한 이메일을 입력하세요.";
  return null;
}

function validatePhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "유효한 휴대폰번호를 입력하세요.";
  if (!PHONE_REGEX.test(trimmed)) return "유효한 휴대폰번호를 입력하세요.";
  return null;
}

function validateAge(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "유효한 나이를 입력하세요.";
  if (!AGE_REGEX.test(trimmed)) return "유효한 나이를 입력하세요.";
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 120) {
    return "유효한 나이를 입력하세요.";
  }
  return null;
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
  const [signupNickname, setSignupNickname] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupRegion, setSignupRegion] = useState<string>(ALL_OPTION);
  const [signupCategory, setSignupCategory] = useState<string>(ALL_OPTION);
  const [signupAge, setSignupAge] = useState("");
  const [signupUserType, setSignupUserType] = useState<string>(USER_TYPES[0]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const signupErrors = useMemo(
    () => ({
      name: validateName(signupName),
      email: validateEmail(signupEmail),
      phone: validatePhone(signupPhone),
      age: validateAge(signupAge),
    }),
    [signupAge, signupEmail, signupName, signupPhone]
  );

  const signupDisabled =
    loading ||
    !loginId.trim() ||
    !password.trim() ||
    !signupNickname.trim() ||
    Boolean(signupErrors.name) ||
    Boolean(signupErrors.email) ||
    Boolean(signupErrors.phone) ||
    Boolean(signupErrors.age);

  if (!open) return null;

  function markTouched(field: string) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  async function handleSubmit() {
    setLoading(true);
    setMessage(null);
    try {
      let payload: Record<string, unknown> = { login_id: loginId, password };
      if (authMode === "signup") {
        const targetAge = parseTargetAge(signupAge);
        const nextTouched = {
          name: true,
          email: true,
          phone: true,
          age: true,
        };
        setTouched((current) => ({ ...current, ...nextTouched }));

        if (
          signupErrors.name ||
          signupErrors.email ||
          signupErrors.phone ||
          signupErrors.age ||
          !signupNickname.trim()
        ) {
          setMessage("입력값을 다시 확인해 주세요.");
          setLoading(false);
          return;
        }

        payload = {
          ...payload,
          name: signupName.trim(),
          nickname: signupNickname.trim(),
          email: signupEmail.trim(),
          phone: signupPhone.trim(),
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
            authMode === "login" ? "로그인에 실패했습니다." : "회원가입에 실패했습니다."
          )
        );
      }

      await onSuccess?.(authMode);
      setPassword("");
      setMessage(authMode === "login" ? "로그인되었습니다." : "회원가입이 완료되었습니다.");
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/45 px-4 py-6"
    >
      <div className="mx-auto flex max-h-[calc(100vh-3rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-6 pb-5 pt-6">
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
                onClick={() => {
                  setAuthMode(mode);
                  setMessage(null);
                  setTouched({});
                }}
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
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                계정 정보
              </p>
              <div className="mt-3 grid gap-3">
                <input
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value)}
                  placeholder="아이디"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />

                {authMode === "signup" && (
                  <>
                    <ValidatedField
                      label="이름"
                      value={signupName}
                      onChange={setSignupName}
                      onBlur={() => markTouched("name")}
                      placeholder="이름을 입력해 주세요"
                      error={touched.name ? signupErrors.name : null}
                    />
                    <ValidatedField
                      label="닉네임"
                      value={signupNickname}
                      onChange={setSignupNickname}
                      placeholder="서비스에서 사용할 닉네임"
                    />
                    <ValidatedField
                      label="이메일"
                      type="email"
                      value={signupEmail}
                      onChange={setSignupEmail}
                      onBlur={() => markTouched("email")}
                      placeholder="a@b.com"
                      error={touched.email ? signupErrors.email : null}
                    />
                    <ValidatedField
                      label="휴대폰 번호"
                      type="tel"
                      value={signupPhone}
                      onChange={setSignupPhone}
                      onBlur={() => markTouched("phone")}
                      placeholder="010-1234-5678"
                      error={touched.phone ? signupErrors.phone : null}
                    />
                  </>
                )}
              </div>
            </div>

            {authMode === "signup" && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                  나머지 정보
                </p>
                <div className="mt-3 grid gap-3">
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
                  <ValidatedField
                    label="나이"
                    type="text"
                    inputMode="numeric"
                    value={signupAge}
                    onChange={setSignupAge}
                    onBlur={() => markTouched("age")}
                    placeholder="예: 25"
                    error={touched.age ? signupErrors.age : null}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={authMode === "login" ? loading || !loginId.trim() || !password.trim() : signupDisabled}
              className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "처리 중..." : authMode === "login" ? "로그인" : "회원가입 완료하기"}
            </button>
          </div>

          <p className={`mt-3 min-h-5 text-sm ${message ? "text-red-500" : "text-slate-500"}`}>{message}</p>
        </div>
      </div>
    </div>
  );
}

function ValidatedField({
  label,
  value,
  onChange,
  placeholder,
  error,
  type = "text",
  inputMode,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  error?: string | null;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  onBlur?: () => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={`rounded-xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:ring-2 ${
          error
            ? "border-red-300 focus:border-red-400 focus:ring-red-100"
            : "border-slate-200 focus:border-blue-500 focus:ring-blue-100"
        }`}
      />
      <span className="min-h-5 text-xs font-medium text-red-500">{error ?? ""}</span>
    </label>
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
