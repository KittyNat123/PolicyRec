"""
Normalize the latest raw API responses into one combined CSV file.

The goal of this module is simple:
1. Read the newest raw JSON file from each source.
2. Map each source's field names into common columns.
3. Save one easy-to-filter `combined.csv`.

We keep `raw_json` too, so we can always look back at the original item.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from app.collectors.base import PROJECT_ROOT, ensure_dir, log
from app.schema import COMMON_COLUMNS


RAW_DIR = PROJECT_ROOT / "data" / "raw"
CLEAN_DIR = PROJECT_ROOT / "data" / "clean"
OUTPUT_CSV = CLEAN_DIR / "combined.csv"


def empty_record(source: str, raw_item: Any) -> dict[str, str]:
    record = {column: "" for column in COMMON_COLUMNS}
    record["source"] = source
    record["raw_json"] = json.dumps(raw_item, ensure_ascii=False)
    return record


def _split_period_text(period_text: str) -> tuple[str, str]:
    if not period_text:
        return "", ""

    for separator in ["~", " - ", " to "]:
        if separator in period_text:
            left, right = period_text.split(separator, 1)
            return left.strip(), right.strip()

    return period_text.strip(), ""


def _join_nonempty(values: list[Any], separator: str = " | ") -> str:
    parts: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if text:
            parts.append(text)
    return separator.join(parts)


def _format_age_range(min_age: Any, max_age: Any, fallback: Any = "") -> str:
    min_text = str(min_age or "").strip()
    max_text = str(max_age or "").strip()

    if min_text and max_text:
        return f"만 {min_text}세 ~ 만 {max_text}세"
    if min_text:
        return f"만 {min_text}세 이상"
    if max_text:
        return f"만 {max_text}세 이하"

    return str(fallback or "").strip()


def _format_income_condition(item: dict[str, Any]) -> str:
    parts: list[str] = []

    condition_code = str(item.get("earnCndSeCd", "")).strip()
    if condition_code:
        parts.append(f"소득조건코드={condition_code}")

    min_amount = str(item.get("earnMinAmt", "")).strip()
    max_amount = str(item.get("earnMaxAmt", "")).strip()
    if min_amount or max_amount:
        parts.append(f"소득범위={min_amount or '-'}~{max_amount or '-'}")

    extra = str(item.get("earnEtcCn", "")).strip()
    if extra:
        parts.append(extra)

    return " / ".join(parts)


def _pick_first_url(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def get_latest_raw_json_file(source_name: str) -> Path | None:
    source_dir = RAW_DIR / source_name
    if not source_dir.exists():
        return None

    json_files = list(source_dir.glob("*.json"))
    if not json_files:
        return None

    return max(json_files, key=lambda path: (path.stat().st_mtime, path.name))


def load_latest_json_payload(source_name: str) -> list[tuple[Path, Any]]:
    latest_file = get_latest_raw_json_file(source_name)
    if latest_file is None:
        log("norm", f"{source_name}: latest raw JSON file was not found.")
        return []

    try:
        with latest_file.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except Exception as exc:
        log("norm", f"{source_name}: failed to read raw JSON. file={latest_file} error={exc}")
        return []

    log("norm", f"{source_name}: using latest raw file {latest_file.name}")
    return [(latest_file, payload)]


def normalize_biz_payload(payload: Any, raw_path: Path) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    items: list[Any] = []

    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        if isinstance(payload.get("jsonArray"), list):
            items = payload["jsonArray"]
        elif isinstance(payload.get("item"), list):
            items = payload["item"]
        elif isinstance(payload.get("item"), dict):
            items = [payload["item"]]
        elif isinstance(payload.get("items"), list):
            items = payload["items"]
        else:
            items = [payload]
    else:
        items = [payload]

    for item in items:
        record = empty_record("biz", item)

        if isinstance(item, dict):
            record["source_id"] = str(item.get("pblancId", "") or item.get("id", ""))
            record["title"] = str(item.get("pblancNm", "") or item.get("title", ""))
            record["summary"] = str(item.get("bsnsSumryCn", "") or item.get("summary", ""))
            record["category"] = str(item.get("pldirSportRealmLclasCodeNm", "") or item.get("category", ""))
            record["subcategory"] = str(item.get("pldirSportRealmMlsfcCodeNm", ""))
            record["region"] = str(item.get("jrsdInsttNm", "") or item.get("region", ""))
            record["operating_agency"] = str(item.get("excInsttNm", ""))
            record["target_group"] = str(item.get("trgetNm", ""))
            record["support_type"] = str(
                item.get("pldirSportRealmMlsfcCodeNm", "") or item.get("support_type", "")
            )
            record["application_method"] = str(item.get("reqstMthPapersCn", ""))
            record["required_documents"] = str(item.get("reqstMthPapersCn", ""))
            record["detail_url"] = _pick_first_url(
                item.get("pblancUrl", ""),
                item.get("rceptEngnHmpgUrl", ""),
                item.get("url", ""),
                item.get("link", ""),
            )

            period_text = str(
                item.get("reqstBeginEndDe", "")
                or item.get("pbancBgngYmd", "")
                or item.get("period", "")
            )
            apply_start, apply_end = _split_period_text(period_text)
            record["apply_start"] = apply_start
            record["apply_end"] = apply_end

        records.append(record)

    log("norm", f"biz: normalized {len(records)} rows from {raw_path.name}")
    return records


def normalize_kst_payload(payload: Any, raw_path: Path) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    items: list[Any] = []

    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            items = payload["data"]
        elif isinstance(payload.get("items"), list):
            items = payload["items"]
        else:
            items = [payload]
    else:
        items = [payload]

    for item in items:
        record = empty_record("kst", item)

        if isinstance(item, dict):
            record["source_id"] = str(item.get("pbanc_sn", "") or item.get("id", ""))
            record["title"] = str(item.get("intg_pbanc_biz_nm", "") or item.get("pbanc_nm", ""))
            record["summary"] = str(item.get("pbanc_ctnt", ""))
            record["category"] = str(item.get("supt_biz_clsfc", ""))
            record["subcategory"] = str(item.get("supt_biz_clsfc", ""))
            record["region"] = str(item.get("supt_regin", ""))
            record["supervising_agency"] = str(item.get("sprv_inst", ""))
            record["operating_agency"] = str(
                item.get("biz_prch_dprt_nm", "") or item.get("pbanc_ntrp_nm", "")
            )
            record["target_group"] = str(item.get("aply_trgt", ""))
            record["target_age"] = str(item.get("biz_trgt_age", ""))
            record["target_detail"] = _join_nonempty(
                [item.get("aply_trgt_ctnt", ""), item.get("aply_excl_trgt_ctnt", "")],
                separator="\n\n",
            )
            record["startup_stage"] = str(item.get("biz_enyy", ""))
            record["support_type"] = str(item.get("supt_biz_clsfc", ""))
            record["application_method"] = _join_nonempty(
                [
                    f"온라인 접수: {item.get('aply_mthd_onli_rcpt_istc', '')}",
                    f"이메일 접수: {item.get('aply_mthd_eml_rcpt_istc', '')}",
                    f"팩스 접수: {item.get('aply_mthd_fax_rcpt_istc', '')}",
                    f"우편 접수: {item.get('aply_mthd_pssr_rcpt_istc', '')}",
                    f"방문 접수: {item.get('aply_mthd_vst_rcpt_istc', '')}",
                    f"기타 접수: {item.get('aply_mthd_etc_istc', '')}",
                ],
                separator="\n",
            )
            record["apply_start"] = str(item.get("pbanc_rcpt_bgng_dt", ""))
            record["apply_end"] = str(item.get("pbanc_rcpt_end_dt", ""))
            record["detail_url"] = _pick_first_url(
                item.get("detl_pg_url", ""),
                item.get("biz_gdnc_url", ""),
                item.get("biz_aply_url", ""),
            )

        records.append(record)

    log("norm", f"kst: normalized {len(records)} rows from {raw_path.name}")
    return records


def _extract_youth_items(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload

    if isinstance(payload, dict):
        result = payload.get("result")
        if isinstance(result, dict):
            if isinstance(result.get("youthPolicyList"), list):
                return result["youthPolicyList"]
            if isinstance(result.get("list"), list):
                return result["list"]
            if isinstance(result.get("items"), list):
                return result["items"]
        if isinstance(result, list):
            return result
        if isinstance(payload.get("data"), list):
            return payload["data"]
        if isinstance(payload.get("items"), list):
            return payload["items"]
        return [payload]

    return [payload]


def normalize_youth_payload(payload: Any, raw_path: Path) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    items = _extract_youth_items(payload)

    for item in items:
        record = empty_record("youth", item)

        if isinstance(item, dict):
            record["source_id"] = str(item.get("id", "") or item.get("plcyNo", ""))
            record["title"] = str(item.get("title", "") or item.get("plcyNm", ""))
            record["summary"] = str(item.get("summary", "") or item.get("plcyExplnCn", ""))
            record["category"] = str(
                item.get("lclsfNm", "") or item.get("category", "") or item.get("plcyKywdNm", "")
            )
            record["subcategory"] = str(item.get("mclsfNm", ""))
            record["region"] = str(item.get("rgtrInstCdNm", "") or item.get("zipCd", "") or item.get("region", ""))
            record["supervising_agency"] = str(item.get("sprvsnInstCdNm", ""))
            record["operating_agency"] = str(item.get("operInstCdNm", ""))
            record["target_group"] = _join_nonempty(
                [item.get("ptcpPrpTrgtCn", ""), item.get("jobCd", ""), item.get("schoolCd", "")],
                separator=" | ",
            )
            record["target_age"] = _format_age_range(
                item.get("sprtTrgtMinAge", ""),
                item.get("sprtTrgtMaxAge", ""),
                fallback=item.get("targetAge", ""),
            )
            record["target_detail"] = str(item.get("addAplyQlfcCndCn", ""))
            record["income_condition"] = _format_income_condition(item)
            record["support_type"] = str(item.get("plcySprtCn", ""))
            record["application_method"] = str(item.get("plcyAplyMthdCn", ""))
            record["required_documents"] = str(item.get("sbmsnDcmntCn", ""))
            record["additional_conditions"] = _join_nonempty(
                [item.get("addAplyQlfcCndCn", ""), item.get("etcMttrCn", "")],
                separator="\n\n",
            )
            record["apply_start"] = str(item.get("aplyYmd", "") or item.get("bizPrdBgngYmd", ""))
            record["apply_end"] = str(item.get("bizPrdEndYmd", ""))
            record["detail_url"] = _pick_first_url(
                item.get("aplyUrlAddr", ""),
                item.get("refUrlAddr1", ""),
                item.get("refUrlAddr2", ""),
                item.get("detailUrl", ""),
                item.get("url", ""),
            )

        records.append(record)

    log("norm", f"youth: normalized {len(records)} rows from {raw_path.name}")
    return records


def build_dedup_key(record: dict[str, str]) -> tuple[str, ...]:
    source = (record.get("source") or "").strip()
    source_id = (record.get("source_id") or "").strip()
    detail_url = (record.get("detail_url") or "").strip()
    title = (record.get("title") or "").strip()
    apply_start = (record.get("apply_start") or "").strip()
    apply_end = (record.get("apply_end") or "").strip()
    raw_json = (record.get("raw_json") or "").strip()

    if source_id:
        return ("source_id", source, source_id)
    if detail_url:
        return ("detail_url", source, detail_url)
    if title:
        return ("title_period", source, title, apply_start, apply_end)
    return ("raw_json", source, raw_json)


def deduplicate_records(records: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
    unique_records: list[dict[str, str]] = []
    seen_keys: set[tuple[str, ...]] = set()
    removed_count = 0

    for record in records:
        dedup_key = build_dedup_key(record)
        if dedup_key in seen_keys:
            removed_count += 1
            continue

        seen_keys.add(dedup_key)
        unique_records.append(record)

    return unique_records, removed_count


def normalize_all_sources() -> pd.DataFrame:
    all_records: list[dict[str, str]] = []

    for raw_path, payload in load_latest_json_payload("biz"):
        all_records.extend(normalize_biz_payload(payload, raw_path))

    for raw_path, payload in load_latest_json_payload("kst"):
        all_records.extend(normalize_kst_payload(payload, raw_path))

    for raw_path, payload in load_latest_json_payload("youth"):
        all_records.extend(normalize_youth_payload(payload, raw_path))

    before_count = len(all_records)
    unique_records, removed_count = deduplicate_records(all_records)
    after_count = len(unique_records)

    log("norm", f"before dedup: {before_count}")
    log("norm", f"removed duplicates: {removed_count}")
    log("norm", f"after dedup: {after_count}")

    return pd.DataFrame(unique_records, columns=COMMON_COLUMNS)


def save_combined_csv() -> Path:
    ensure_dir(CLEAN_DIR)
    dataframe = normalize_all_sources()
    dataframe.to_csv(OUTPUT_CSV, index=False, encoding="utf-8-sig")
    log("norm", f"saved combined csv: {OUTPUT_CSV}")
    log("norm", f"row count: {len(dataframe)}")
    return OUTPUT_CSV


if __name__ == "__main__":
    save_combined_csv()
