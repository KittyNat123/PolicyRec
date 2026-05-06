"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  formatDate,
  dDayLabel,
  recruitmentStatus,
  getSourceBadge,
  STATUS_BADGE_STYLES,
  formatTargetAgeRange,
} from "@/lib/utils";
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

function compactYouthKeyword(title: string) {
  return title.replace(/[\s"'`()[\]{}<>·,.:;!?~\-_/\\]/g, "").slice(0, 8);
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
}: {
  item: SearchResult;
  canScrap: boolean;
  isScrapped: boolean;
  onToggleScrap: (annId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
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
  const searchKeyword = useMemo(
    () =>
      [item.title, item.provider || item.region]
        .filter((value): value is string => hasText(value))
        .join(" "),
    [item.provider, item.region, item.title]
  );
  const youthFallbackUrl = youthDetailUrl(item);
  const detailUrl = item.detail_url ?? youthFallbackUrl;
  const youthSearchKeyword = compactYouthKeyword(item.title) || searchKeyword;
  const youthSearchUrl = `https://www.youthcenter.go.kr/totalSearch/search?keyword=${encodeURIComponent(
    youthSearchKeyword
  )}`;
  const hasTargetTags = Boolean(item.target_tags?.length);
  const hasExpandableDetails =
    hasText(item.summary) ||
    hasText(item.application_method) ||
    hasText(item.required_documents) ||
    hasText(item.additional_conditions) ||
    hasText(item.provider) ||
    hasText(item.target_group) ||
    hasTargetTags;

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
          {!item.detail_url && youthFallbackUrl && (
            <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              온통청년 상세 후보
            </span>
          )}
          {!item.detail_url && !youthFallbackUrl && (
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              상세 링크 없음
            </span>
          )}
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
        {detailUrl ? (
          <a
            href={detailUrl}
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          disabled={!hasExpandableDetails}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {expanded ? "접기" : "자세히 보기"}
        </button>
        {!item.detail_url && youthFallbackUrl && (
          <>
            <a
              href={youthFallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-sky-200 px-3 py-1.5 text-sm text-sky-700 transition-colors hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950"
            >
              온통청년 상세 보기
            </a>
            <a
              href={youthSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-green-200 px-3 py-1.5 text-sm text-green-700 transition-colors hover:bg-green-50 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950"
            >
              온통청년에서 검색
            </a>
          </>
        )}
      </div>

      {expanded && (
        <dl className="mt-4 space-y-3 rounded-md bg-zinc-50 p-4 dark:bg-zinc-950">
          {hasText(item.summary) && (
            <DetailRow label="요약">{item.summary}</DetailRow>
          )}
          {hasText(item.application_method) && (
            <DetailRow label="신청 방법">{item.application_method}</DetailRow>
          )}
          {hasText(item.required_documents) && (
            <DetailRow label="제출 서류">{item.required_documents}</DetailRow>
          )}
          {hasText(item.additional_conditions) && (
            <DetailRow label="추가 조건">
              {item.additional_conditions}
            </DetailRow>
          )}
          {hasText(item.provider) && (
            <DetailRow label="제공 기관">{item.provider}</DetailRow>
          )}
          {hasText(item.target_group) && (
            <DetailRow label="대상">{item.target_group}</DetailRow>
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
