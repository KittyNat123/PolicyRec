"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ALL_OPTION, CATEGORIES, REGIONS, USER_TYPES } from "@/lib/profile-options";
import type { SavedFilter, User } from "@/lib/types";

type UserInfo = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  nickname?: string | null;
  age_group?: string | null;
  region?: string | null;
  regions?: string[] | null;
  categories?: string[] | null;
  user_type?: string | null;
};

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return data.error ?? fallback;
}

export default function ProfilePage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [savedFilter, setSavedFilter] = useState<SavedFilter | null>(null);
  const [info, setInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formNickname, setFormNickname] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAge, setFormAge] = useState("");
  const [formRegion, setFormRegion] = useState(ALL_OPTION);
  const [formCategory, setFormCategory] = useState(ALL_OPTION);
  const [formUserType, setFormUserType] = useState<string>(USER_TYPES[0]);
  const [deadlineNotice, setDeadlineNotice] = useState(true);
  const [recommendNotice, setRecommendNotice] = useState(true);
  const [applicationNotice, setApplicationNotice] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const meRes = await fetch("/api/auth/me", { cache: "no-store" });
        const meData = await meRes.json().catch(() => ({}));
        const user = (meData.user ?? null) as User | null;
        setCurrentUser(user);
        setSavedFilter((meData.filter ?? null) as SavedFilter | null);

        if (!user) {
          router.replace("/?auth=login");
          return;
        }

        const infoRes = await fetch("/api/mypage/info", { cache: "no-store" });
        if (!infoRes.ok && infoRes.status !== 401) {
          throw new Error(await readApiError(infoRes, "프로필 정보를 불러오지 못했습니다."));
        }

        const infoData = await infoRes.json().catch(() => ({}));
        const loadedInfo = (infoData.info ?? null) as UserInfo | null;
        setInfo(loadedInfo);
        setFormName(loadedInfo?.name ?? loadedInfo?.nickname ?? "");
        setFormNickname(loadedInfo?.nickname ?? loadedInfo?.name ?? "");
        setFormEmail(loadedInfo?.email ?? "");
        setFormPhone(loadedInfo?.phone ?? "");
        setFormAge(loadedInfo?.age_group ?? "");
        setFormRegion(loadedInfo?.region ?? loadedInfo?.regions?.[0] ?? ALL_OPTION);
        setFormCategory(loadedInfo?.categories?.[0] ?? ALL_OPTION);
        setFormUserType(loadedInfo?.user_type ?? USER_TYPES[0]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "프로필 정보를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const displayName = info?.name || info?.nickname || currentUser?.login_id || "사용자";
  const nickname = info?.nickname || displayName;
  const age = info?.age_group || savedFilter?.target_age?.toString() || "미입력";
  const region = info?.region || info?.regions?.[0] || savedFilter?.regions?.[0] || "미설정";
  const userType = info?.user_type || "미설정";
  const email = info?.email || `${currentUser?.login_id ?? "user"}@policyrec.local`;
  const phone = info?.phone || "미입력";
  const categories = info?.categories?.length ? info.categories : savedFilter?.categories ?? [];
  const targets = [userType, age === "미입력" ? null : `${age}세`, region].filter(Boolean) as string[];

  async function saveProfile() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/mypage/info", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          nickname: formNickname || formName,
          email: formEmail,
          phone: formPhone,
          age_group: formAge,
          region: formRegion === ALL_OPTION ? null : formRegion,
          regions: formRegion === ALL_OPTION ? [] : [formRegion],
          categories: formCategory === ALL_OPTION ? [] : [formCategory],
          user_type: formUserType === USER_TYPES[0] ? null : formUserType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "프로필 저장에 실패했습니다.");

      const nextInfo = (data.info ?? {
        ...info,
        name: formName,
        nickname: formNickname || formName,
        email: formEmail,
        phone: formPhone,
        age_group: formAge,
        region: formRegion === ALL_OPTION ? null : formRegion,
        regions: formRegion === ALL_OPTION ? [] : [formRegion],
        categories: formCategory === ALL_OPTION ? [] : [formCategory],
        user_type: formUserType === USER_TYPES[0] ? null : formUserType,
      }) as UserInfo;

      setInfo(nextInfo);
      if (data.filter) {
        setSavedFilter(data.filter as SavedFilter);
      }
      setFormName(nextInfo.name ?? nextInfo.nickname ?? "");
      setFormNickname(nextInfo.nickname ?? nextInfo.name ?? "");
      setFormEmail(nextInfo.email ?? "");
      setFormPhone(nextInfo.phone ?? "");
      setFormAge(nextInfo.age_group ?? "");
      setFormRegion(nextInfo.region ?? nextInfo.regions?.[0] ?? ALL_OPTION);
      setFormCategory(nextInfo.categories?.[0] ?? ALL_OPTION);
      setFormUserType(nextInfo.user_type ?? USER_TYPES[0]);
      setEditOpen(false);

      if (data.setup_required && Array.isArray(data.missing_columns)) {
        setMessage(`일부 컬럼이 DB에 아직 반영되지 않았습니다: ${data.missing_columns.join(", ")}`);
      } else {
        setMessage("프로필을 저장했습니다.");
      }
      if (
        !data.setup_required &&
        window.sessionStorage.getItem("policyrec-pending-chat-prompt")
      ) {
        router.push("/");
        return;
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "프로필 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AppHeader currentUser={currentUser} />
      <main className="mx-auto max-w-3xl px-4 py-7 sm:px-6">
        {loading && (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">
            프로필 정보를 불러오는 중입니다.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !currentUser && (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            로그인 후 프로필을 확인할 수 있습니다.
          </div>
        )}

        {!loading && currentUser && (
          <div className="space-y-4">
            <section className="rounded-[24px] bg-gradient-to-br from-blue-600 to-blue-800 p-6 text-white">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 text-2xl font-bold">
                    {displayName.slice(0, 1)}
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold">{displayName}</h1>
                    <p className="mt-1 text-sm text-blue-100">{currentUser.login_id}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {targets.map((item) => (
                        <span key={item} className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditOpen((value) => !value)}
                  className="rounded-xl bg-white/15 px-4 py-2 text-sm font-bold hover:bg-white/25"
                >
                  {editOpen ? "닫기" : "편집"}
                </button>
              </div>
            </section>

            {message && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-700">
                {message}
              </div>
            )}

            {editOpen && (
              <InfoPanel title="프로필 편집">
                <div className="grid gap-3 md:grid-cols-2">
                  <InputField label="이름" value={formName} onChange={setFormName} placeholder="이름을 입력해 주세요" />
                  <InputField label="닉네임" value={formNickname} onChange={setFormNickname} placeholder="닉네임을 입력해 주세요" />
                  <InputField label="이메일" value={formEmail} onChange={setFormEmail} placeholder="name@example.com" />
                  <InputField label="휴대폰 번호" value={formPhone} onChange={setFormPhone} placeholder="010-1234-5678" />
                  <InputField label="나이" value={formAge} onChange={setFormAge} placeholder="예: 25" type="number" />
                  <SelectField label="사용자 유형" value={formUserType} onChange={setFormUserType} options={USER_TYPES} />
                  <SelectField label="지역" value={formRegion} onChange={setFormRegion} options={REGIONS} />
                  <SelectField label="관심 카테고리" value={formCategory} onChange={setFormCategory} options={CATEGORIES} />
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveProfile()}
                    disabled={saving}
                    className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </InfoPanel>
            )}

            <InfoPanel title="기본 정보">
              <InfoRow label="이름" value={displayName} />
              <InfoRow label="닉네임" value={nickname} />
              <InfoRow label="이메일" value={email} />
              <InfoRow label="휴대폰 번호" value={phone} />
              <InfoRow label="나이" value={age === "미입력" ? age : `${age}세`} />
            </InfoPanel>

            <InfoPanel title="정책 설정 정보">
              <InfoRow label="지역" value={region} />
              <InfoRow label="사용자 유형" value={userType} />
            </InfoPanel>

            <InfoPanel title="정책 관심 설정">
              <ChipSet label="내가 관심있는 대상" values={targets} activeValues={targets} />
              <ChipSet
                label="관심분야"
                values={CATEGORIES.filter((value) => value !== ALL_OPTION)}
                activeValues={categories}
              />
            </InfoPanel>

            <InfoPanel title="알림 설정">
              <ToggleRow label="마감 임박 알림" sub="스크랩한 정책의 마감일이 가까워지면 알려드립니다." active={deadlineNotice} onToggle={() => setDeadlineNotice((value) => !value)} />
              <ToggleRow label="추천 업데이트 알림" sub="내 조건에 맞는 새 정책이 들어오면 알려드립니다." active={recommendNotice} onToggle={() => setRecommendNotice((value) => !value)} />
              <ToggleRow label="스크랩 활동 알림" sub="저장한 정책 상태가 바뀌면 알려드립니다." active={applicationNotice} onToggle={() => setApplicationNotice((value) => !value)} />
            </InfoPanel>
          </div>
        )}
      </main>
    </div>
  );
}

function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-slate-700">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

function SelectField({
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
    <label className="grid gap-2 text-sm font-semibold text-slate-700">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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

function ChipSet({
  label,
  values,
  activeValues,
}: {
  label: string;
  values: string[];
  activeValues: readonly string[];
}) {
  return (
    <div>
      <p className="mb-2 text-sm text-slate-500">{label}</p>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => {
          const active = activeValues.includes(value);
          return (
            <span
              key={value}
              className={`rounded-full border px-3 py-2 text-sm font-bold ${
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 text-slate-600"
              }`}
            >
              {value}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  sub,
  active,
  onToggle,
}: {
  label: string;
  sub: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-bold text-slate-800">{label}</p>
        <p className="mt-1 text-xs text-slate-400">{sub}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={`h-6 w-11 rounded-full p-1 transition ${active ? "bg-blue-600" : "bg-slate-200"}`}
      >
        <span className={`block h-4 w-4 rounded-full bg-white transition ${active ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}
