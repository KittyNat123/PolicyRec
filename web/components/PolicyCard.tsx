"use client";

import { useState, type ReactNode } from "react";
import {
  dDayLabel,
  formatDate,
  formatTargetAgeRange,
  recruitmentStatus,
} from "@/lib/utils";
import {
  cleanPolicyText,
  cleanTargetGroup,
  normalizeApplicationDetails,
} from "@/lib/policy-normalization";
import type { SearchResult } from "@/lib/types";

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

const HIDDEN_DETAIL_VALUE_LIST = [
  "",
  "-",
  "없음",
  "정보 없음",
  "정보없음",
  "해당 없음",
  "해당없음",
  "공고 본문에서 확인해 주세요",
  "공고를 확인하세요",
  "원문 공고 확인",
  "공고문 확인 필요",
  "연령 확인 필요",
];
const HIDDEN_DETAIL_VALUES = new Set(HIDDEN_DETAIL_VALUE_LIST);
const HIDDEN_DETAIL_VALUE_KEYS = new Set(
  HIDDEN_DETAIL_VALUE_LIST.map((value) => value.replace(/\s/g, ""))
);

function hasMeaningfulDetail(value: string | null | undefined) {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  const compact = normalized.replace(/\s/g, "");
  // ☑️수정: 상세 영역에서는 비어 있거나 안내용 기본 문구만 있는 항목을 숨김
  return Boolean(normalized) && !HIDDEN_DETAIL_VALUES.has(normalized) && !HIDDEN_DETAIL_VALUE_KEYS.has(compact);
}

function isYouthPolicy(item: SearchResult) {
  return item.source?.toLowerCase() === "youth";
}

function youthDetailUrl(item: SearchResult) {
  const sourceId = item.source_id?.trim();
  if (!isYouthPolicy(item) || !sourceId || !/^\d+$/.test(sourceId)) return null;
  return `https://www.youthcenter.go.kr/youthPolicy/ythPlcyTotalSearch/ythPlcyDetail/${sourceId}`;
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[96px_1fr]">
      <dt className="text-xs font-bold text-slate-500">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
        {children}
      </dd>
    </div>
  );
}

function categoryClass(category: string | null) {
  if (category === "주거") return "bg-orange-100 text-orange-700";
  if (category === "창업") return "bg-violet-100 text-violet-700";
  if (category === "취업" || category === "인력/일자리") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (category === "금융" || category === "자금") {
    return "bg-yellow-100 text-yellow-700";
  }
  if (category === "교육" || category === "복지") {
    return "bg-cyan-100 text-cyan-700";
  }
  return "bg-blue-50 text-blue-700";
}

export function PolicyCard({
  item,
  canScrap,
  isScrapped,
  onToggleScrap,
  showSimilarityScore = false,
}: {
  item: SearchResult;
  canScrap: boolean;
  isScrapped: boolean;
  onToggleScrap: (annId: number) => void;
  showSimilarityScore?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = recruitmentStatus(item.apply_start_dt, item.apply_end_dt);
  const dday = dDayLabel(item.apply_end_dt);
  const isYouth = isYouthPolicy(item);
  const summary = cleanPolicyText(item.summary);
  const provider = cleanPolicyText(item.provider);
  const targetGroup = cleanTargetGroup(item.target_group, item.target_tags);
  const additionalConditions = cleanPolicyText(item.additional_conditions);
  const applicationDetails = normalizeApplicationDetails(
    item.application_method,
    item.required_documents
  );
  const applicationMethod = applicationDetails.application_method;
  const requiredDocuments = applicationDetails.required_documents;
  const targetAgeLabel = formatTargetAgeRange(
    item.target_age_min,
    item.target_age_max
  );
  const showSummaryDetail = hasMeaningfulDetail(summary);
  const showApplicationMethod = hasMeaningfulDetail(applicationMethod);
  const showRequiredDocuments = hasMeaningfulDetail(requiredDocuments);
  const showAdditionalConditions = hasMeaningfulDetail(additionalConditions);
  const showTargetAge = hasMeaningfulDetail(targetAgeLabel);
  const showTargetGroup = hasMeaningfulDetail(targetGroup);
  const showProviderDetail = hasMeaningfulDetail(provider);
  const similarityLabel =
    item.similarity > 0
      ? `유사도 ${Math.round(item.similarity * 100)}%`
      : "유사도 정보";
  const youthFallbackUrl = youthDetailUrl(item);
  const detailUrl = isYouth ? youthFallbackUrl ?? item.detail_url : item.detail_url;
  const urgent = dday === "D-day" || /^D-[1-7]$/.test(dday);
  const statusLabel = urgent ? "마감임박" : status;
  const statusClass =
    status === "마감"
      ? "border-slate-200 bg-slate-100 text-slate-500"
      : urgent
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";
  const endDateLabel = item.apply_end_dt ? formatDate(item.apply_end_dt) : "상시";
  const primaryTags = [
    item.support_type,
    ...(item.target_tags?.slice(0, 3).map((tag) => `#${tag}`) ?? []),
  ].filter((tag): tag is string => hasText(tag));
  // ☑️수정: 상세 대상 태그도 의미 있는 값만 노출
  const detailTargetTags = item.target_tags?.filter(hasMeaningfulDetail) ?? [];
  const hasTargetTags = detailTargetTags.length > 0;
  const hasExpandedDetails =
    showSummaryDetail ||
    showApplicationMethod ||
    showRequiredDocuments ||
    showAdditionalConditions ||
    showProviderDetail ||
    showTargetAge ||
    showTargetGroup ||
    hasTargetTags;
  const supportSummary =
    item.support_type || additionalConditions || summary || "요약 정보 없음";

  return (
    <li className="group rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass}`}>
              {statusLabel}
            </span>
            {item.s_category && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${categoryClass(item.s_category)}`}>
                {item.s_category}
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
              대상
            </span>
          </div>

          <h2 className="line-clamp-2 text-lg font-bold leading-snug text-slate-950">
            {detailUrl ? (
              <a
                href={detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-700"
              >
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h2>
          <p className="mt-2 line-clamp-1 text-sm text-slate-500">
            {provider || "제공 기관 정보 없음"}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => onToggleScrap(item.id)}
            disabled={!canScrap}
            aria-pressed={isScrapped}
            aria-label={
              canScrap
                ? isScrapped
                  ? `${item.title} 스크랩 해제`
                  : `${item.title} 스크랩`
                : "로그인 후 스크랩할 수 있습니다"
            }
            title={canScrap ? "스크랩" : "로그인 후 스크랩할 수 있습니다"}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 ${
              isScrapped
                ? "bg-amber-50 text-amber-500"
                : "text-slate-400 hover:bg-amber-50 hover:text-amber-500"
            }`}
          >
            {isScrapped ? "★" : "☆"}
          </button>
          {showSimilarityScore && (
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
              {similarityLabel}
            </span>
          )}
        </div>
      </div>

      {summary && (
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-700">
          {summary}
        </p>
      )}

      <div className="mt-4 rounded-lg bg-blue-50 px-4 py-3">
        <p className="text-xs font-bold text-blue-700">지원 내용</p>
        <p className="mt-1 line-clamp-1 text-sm font-bold text-blue-800">
          {supportSummary}
        </p>
      </div>

      {primaryTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {primaryTags.slice(0, 3).map((tag, index) => (
            <span
              key={`${tag}-${index}`}
              className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="text-xs font-medium text-slate-500">
          {endDateLabel} 마감
        </span>
        <span className="text-xs font-medium text-slate-500">
          {item.region || "지역 미상"}
        </span>
        {detailUrl && (
          <a
            href={detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            공고 보기
          </a>
        )}
        {hasExpandedDetails && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            {expanded ? "접기" : "더보기"}
          </button>
        )}
      </div>

      {expanded && hasExpandedDetails && (
        <dl className="mt-4 space-y-3 rounded-md bg-slate-50 p-4">
          {showSummaryDetail && <DetailRow label="요약">{summary}</DetailRow>}
          {showApplicationMethod && (
            <DetailRow label="신청 방법">{applicationMethod}</DetailRow>
          )}
          {showRequiredDocuments && (
            <DetailRow label="제출 서류">{requiredDocuments}</DetailRow>
          )}
          {showAdditionalConditions && (
            <DetailRow label="추가 조건">{additionalConditions}</DetailRow>
          )}
          {showProviderDetail && <DetailRow label="제공 기관">{provider}</DetailRow>}
          {showTargetAge && <DetailRow label="연령 조건">{targetAgeLabel}</DetailRow>}
          {showTargetGroup && <DetailRow label="지원 대상 상세">{targetGroup}</DetailRow>}
          {hasTargetTags && (
            <DetailRow label="대상 태그">
              {detailTargetTags.map((tag) => `#${tag}`).join(" ")}
            </DetailRow>
          )}
        </dl>
      )}
    </li>
  );
}
