"use client";

import Image from "next/image";
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

type NotificationSettings = {
  deadline_notice: boolean;
  recommendation_notice: boolean;
  scrap_activity_notice: boolean;
};

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  deadline_notice: true,
  recommendation_notice: true,
  scrap_activity_notice: false,
};
// ☑️수정: 알림 설정은 실제 DB/API 확인 전까지 프로필 화면에서 보류
const SHOW_NOTIFICATION_SETTINGS = false;

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return data.error ?? fallback;
}

function displayValue(value: string | null | undefined, fallback = "미설정") {
  return value && value.trim() ? value : fallback;
}

function categoryText(categories: readonly string[]) {
  return categories.length > 0 ? categories.join(", ") : "미설정";
}

export default function ProfilePage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [savedFilter, setSavedFilter] = useState<SavedFilter | null>(null);
  const [info, setInfo] = useState<UserInfo | null>(null);
  const [notifications, setNotifications] =
    useState<NotificationSettings>(DEFAULT_NOTIFICATIONS);
  const [notificationSetupRequired, setNotificationSetupRequired] = useState(false);
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

        const [infoRes, notificationRes] = await Promise.all([
          fetch("/api/mypage/info", { cache: "no-store" }),
          fetch("/api/user/notification-settings", { cache: "no-store" }),
        ]);

        if (!infoRes.ok && infoRes.status !== 401) {
          throw new Error(await readApiError(infoRes, "프로필 정보를 불러오지 못했어요."));
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

        if (notificationRes.ok) {
          const notificationData = await notificationRes.json().catch(() => ({}));
          setNotifications(
            (notificationData.settings ?? DEFAULT_NOTIFICATIONS) as NotificationSettings
          );
          setNotificationSetupRequired(Boolean(notificationData.setup_required));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "프로필 정보를 불러오지 못했어요.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const displayName = info?.name || info?.nickname || currentUser?.login_id || "사용자";
  const nickname = info?.nickname || "미설정";
  const ageValue = info?.age_group || savedFilter?.target_age?.toString() || "";
  const age = ageValue ? `${ageValue}세` : "미설정";
  const region = displayValue(
    info?.region || info?.regions?.[0] || savedFilter?.regions?.[0]
  );
  const userType = displayValue(info?.user_type);
  const email = info?.email || `${currentUser?.login_id ?? "user"}@policyrec.local`;
  const phone = info?.phone || "미입력";
  const categories = info?.categories?.length ? info.categories : savedFilter?.categories ?? [];
  const primaryCategory = categories[0] ?? "미설정";
  const summaryChips = [
    `나이 ${age}`,
    `지역 ${region}`,
    `유형 ${userType}`,
    `관심분야 ${primaryCategory}`,
  ];

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

      if (data.success === false) {
        throw new Error(data.warning ?? data.error ?? "프로필 일부 항목이 DB에 저장되지 않았습니다.");
      }

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
      if (data.filter) setSavedFilter(data.filter as SavedFilter);
      setFormName(nextInfo.name ?? nextInfo.nickname ?? "");
      setFormNickname(nextInfo.nickname ?? nextInfo.name ?? "");
      setFormEmail(nextInfo.email ?? "");
      setFormPhone(nextInfo.phone ?? "");
      setFormAge(nextInfo.age_group ?? "");
      setFormRegion(nextInfo.region ?? nextInfo.regions?.[0] ?? ALL_OPTION);
      setFormCategory(nextInfo.categories?.[0] ?? ALL_OPTION);
      setFormUserType(nextInfo.user_type ?? USER_TYPES[0]);
      setEditOpen(false);
      setMessage("프로필을 저장했습니다.");

      if (window.sessionStorage.getItem("policyrec-pending-chat-prompt")) {
        router.push("/");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "프로필 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function saveNotificationSettings(next: NotificationSettings) {
    setNotifications(next);
    setMessage(null);
    try {
      const res = await fetch("/api/user/notification-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotificationSetupRequired(Boolean(data.setup_required));
        throw new Error(data.error ?? "알림 설정 저장에 실패했습니다.");
      }
      setNotifications((data.settings ?? next) as NotificationSettings);
      setNotificationSetupRequired(Boolean(data.setup_required));
      setMessage("알림 설정을 저장했습니다.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "알림 설정 저장에 실패했습니다.");
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
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/20 ring-1 ring-white/20">
                    <Image
                      src="/login_icon.png"
                      alt=""
                      width={64}
                      height={64}
                      className="h-full w-full object-cover"
                      priority
                    />
                  </div>
                  <div className="min-w-0">
                    <h1 className="truncate text-2xl font-bold">{displayName}</h1>
                    <p className="mt-1 text-sm text-blue-100">{currentUser.login_id}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {summaryChips.map((item) => (
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
                  className="shrink-0 rounded-xl bg-white/15 px-4 py-2 text-sm font-bold hover:bg-white/25"
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

            {editOpen ? (
              <InfoPanel title="프로필 편집">
                <div className="grid gap-3 md:grid-cols-2">
                  <InputField label="이름" value={formName} onChange={setFormName} placeholder="이름을 입력해 주세요" />
                  <InputField label="닉네임" value={formNickname} onChange={setFormNickname} placeholder="닉네임을 입력해 주세요" />
                  <InputField label="이메일" value={formEmail} onChange={setFormEmail} placeholder="name@example.com" />
                  <InputField label="휴대폰 번호" value={formPhone} onChange={setFormPhone} placeholder="010-1234-5678" />
                  <InputField label="나이" value={formAge} onChange={setFormAge} placeholder="예: 25" type="number" />
                  <SelectField label="사용자 유형" value={formUserType} onChange={setFormUserType} options={USER_TYPES} />
                  <SelectField label="지역" value={formRegion} onChange={setFormRegion} options={REGIONS} />
                  <SelectField label="관심 분야" value={formCategory} onChange={setFormCategory} options={CATEGORIES} />
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
            ) : (
              <>
                <InfoPanel title="기본 정보">
                  <InfoRow label="이름" value={displayName} />
                  <InfoRow label="닉네임" value={nickname} />
                  <InfoRow label="이메일" value={email} />
                  <InfoRow label="휴대폰 번호" value={phone} />
                  <InfoRow label="나이" value={age} />
                  <InfoRow label="지역" value={region} />
                  <InfoRow label="사용자 유형" value={userType} />
                  <InfoRow label="관심 분야" value={categoryText(categories)} />
                </InfoPanel>

                {/* ☑️수정: 알림 기능은 실제 DB/API 확인 전까지 오해를 줄이기 위해 화면에서 보류 */}
                {SHOW_NOTIFICATION_SETTINGS && (
                  <InfoPanel title="알림 설정">
                  {notificationSetupRequired && (
                    <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-700">
                      알림 설정 테이블 적용이 필요합니다. 설정 화면은 사용할 수 있지만 DB 저장은 SQL 반영 후 활성화됩니다.
                    </p>
                  )}
                  <ToggleRow
                    label="마감 임박 알림"
                    sub="스크랩한 정책의 마감일이 가까워지면 알려드립니다."
                    active={notifications.deadline_notice}
                    onToggle={() =>
                      void saveNotificationSettings({
                        ...notifications,
                        deadline_notice: !notifications.deadline_notice,
                      })
                    }
                  />
                  <ToggleRow
                    label="추천 업데이트 알림"
                    sub="내 조건에 맞는 새 정책이 들어오면 알려드립니다."
                    active={notifications.recommendation_notice}
                    onToggle={() =>
                      void saveNotificationSettings({
                        ...notifications,
                        recommendation_notice: !notifications.recommendation_notice,
                      })
                    }
                  />
                  <ToggleRow
                    label="스크랩 활동 알림"
                    sub="저장한 정책 상태가 바뀌면 알려드립니다."
                    active={notifications.scrap_activity_notice}
                    onToggle={() =>
                      void saveNotificationSettings({
                        ...notifications,
                        scrap_activity_notice: !notifications.scrap_activity_notice,
                      })
                    }
                  />
                  </InfoPanel>
                )}
              </>
            )}
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
      <span className="text-right font-semibold text-slate-900">{value}</span>
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
