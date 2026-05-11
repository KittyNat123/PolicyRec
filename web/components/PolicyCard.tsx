"use client";

import { useState, type ReactNode } from "react";
import {
  formatDate,
  dDayLabel,
  recruitmentStatus,
  getSourceBadge,
  STATUS_BADGE_STYLES,
  formatTargetAgeRange,
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
    <div className="grid gap-1 sm:grid-cols-[120px_1fr]">
      <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300">
        {children}
      </dd>
    </div>
  );
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
  const sourceBadge = getSourceBadge(item.source);
  const status = recruitmentStatus(item.apply_start_dt, item.apply_end_dt);
  const statusBadge = STATUS_BADGE_STYLES[status];
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
  const similarityLabel =
    item.similarity > 0
      ? `유사도 ${(item.similarity * 100).toFixed(1)}%`
      : "조건 일치";
  const youthFallbackUrl = youthDetailUrl(item);
  const detailUrl = isYouth ? youthFallbackUrl ?? item.detail_url : item.detail_url;
  const hasTargetTags = Boolean(item.target_tags?.length);
  const endDateLabel = item.apply_end_dt
    ? formatDate(item.apply_end_dt)
    : "상시/확인필요";
  const statusSummary =
    status === "마감"
      ? "지원 종료"
      : status === "모집예정"
        ? "모집 예정"
        : "지원 가능";
  const ddayTone =
    status === "마감"
      ? "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
      : dday === "D-day" || /^D-[1-7]$/.test(dday)
        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
  const primaryTags = [
    item.s_category,
    item.region,
    item.support_type,
    ...(item.target_tags?.slice(0, 3).map((tag) => `#${tag}`) ?? []),
  ].filter((tag): tag is string => hasText(tag));
  // 신청방법·제출서류는 항상 자세히 보기에 표시하므로 버튼은 항상 활성화
  const hasExpandableDetails = true;

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge.bg} ${statusBadge.text}`}
            >
              {statusSummary}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${ddayTone}`}
            >
              {dday}
            </span>
            <span className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              마감 {endDateLabel}
            </span>
            {sourceBadge && (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${sourceBadge.bg} ${sourceBadge.text}`}
              >
                {sourceBadge.label}
              </span>
            )}
            {!detailUrl && (
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                상세 링크 없음
              </span>
            )}
          </div>

          <h2 className="text-lg font-semibold leading-snug text-zinc-950 dark:text-zinc-50 sm:text-xl">
            {detailUrl ? (
              <a
                href={detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h2>

          {primaryTags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {primaryTags.map((tag, i) => (
                <span
                  key={`${tag}-${i}`}
                  className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
          {showSimilarityScore && (
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {similarityLabel}
            </span>
          )}
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
            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 ${
              isScrapped
                ? "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100"
                : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {isScrapped ? "스크랩됨" : "스크랩"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 border-t border-zinc-100 pt-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300 sm:grid-cols-3">
        <div>
          <span className="block text-xs font-medium text-zinc-400">
            제공 기관
          </span>
          <span className="line-clamp-1">{provider || "확인필요"}</span>
        </div>
        <div>
          <span className="block text-xs font-medium text-zinc-400">
            대상 연령
          </span>
          <span>{targetAgeLabel}</span>
        </div>
        <div>
          <span className="block text-xs font-medium text-zinc-400">
            상태
          </span>
          <span>{status === "마감" ? "마감된 공고" : status}</span>
        </div>
      </div>

      {summary && (
        <p className="mt-3 line-clamp-2 rounded-md bg-zinc-50 px-3 py-2 text-sm leading-6 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
          {summary}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {detailUrl && (
          <a
            href={detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            상세 페이지 열기
          </a>
        )}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          disabled={!hasExpandableDetails}
          aria-expanded={expanded}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {expanded ? "접기" : "자세히 보기"}
        </button>
      </div>

      {expanded && (
        <dl className="mt-4 space-y-3 rounded-md bg-zinc-50 p-4 dark:bg-zinc-950">
          {summary && <DetailRow label="요약">{summary}</DetailRow>}
          <DetailRow label="신청 방법">
            {applicationMethod ?? "공고문/상세 링크 확인 필요"}
          </DetailRow>
          <DetailRow label="제출 서류">
            {requiredDocuments ?? "공고문 확인 필요"}
          </DetailRow>
          {additionalConditions && (
            <DetailRow label="추가 조건">{additionalConditions}</DetailRow>
          )}
          {provider && (
            <DetailRow label="제공 기관">{provider}</DetailRow>
          )}
          {targetGroup && (
            <DetailRow label="대상">{targetGroup}</DetailRow>
          )}
          {hasTargetTags && (
            <DetailRow label="대상 태그">
              {item.target_tags?.map((tag) => `#${tag}`).join(" ")}
            </DetailRow>
          )}
        </dl>
      )}
    </li>
  );
}
