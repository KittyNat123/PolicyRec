from __future__ import annotations

from datetime import date
from html import escape, unescape
from pathlib import Path
import re

import pandas as pd
import streamlit as st


# 팀 공유 기준인 PolicyRec_v1.1.ipynb의 정규화 결과를 읽습니다.
CSV_PATH = Path("data/clean/combined_normalized_v1_1.csv")

SOURCE_LABELS = {
    "biz": "기업마당",
    "kst": "K-Startup",
    "youth": "온통청년",
}

SOURCE_BADGE_COLORS = {
    "biz": "#778DA9",
    "kst": "#415A77",
    "youth": "#1B263B",
}

PALETTE = {
    "button": "#415A77",
    "tag": "#778DA9",
    "urgent": "#1B263B",
    "bookmark": "#0D1B2A",
    "line": "#E0E1DD",
}

REQUIRED_NORMALIZED_COLUMNS = [
    "source",
    "source_id",
    "title",
    "summary",
    "category",
    "region",
    "target_group",
    "target_age_min",
    "target_age_max",
    "start_date",
    "end_date",
    "detail_url",
]


def first_value(row: pd.Series, columns: list[str], default: str = "") -> str:
    """여러 후보 컬럼 중 첫 번째 유효값을 문자열로 반환합니다."""
    for column in columns:
        if column not in row.index:
            continue

        value = row.get(column)
        if pd.notna(value) and str(value).strip():
            return str(value).strip()

    return default


def clean_text(value: object) -> str:
    """카드에 보여주기 전에 HTML 태그와 줄바꿈을 사람이 읽기 쉬운 문장으로 정리합니다."""
    if pd.isna(value):
        return ""

    text = unescape(str(value))
    text = re.sub(r"(?i)<br\s*/?>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\r", " ").replace("\n", " ").replace("\t", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_date(value: object) -> pd.Timestamp | pd.NaT:
    """다양한 날짜 표현을 pandas Timestamp로 변환합니다."""
    if pd.isna(value):
        return pd.NaT

    text = str(value).strip()
    if not text:
        return pd.NaT

    if text in {"연중", "상시", "예산 소진시까지"}:
        return pd.NaT

    return pd.to_datetime(text, errors="coerce")


def format_date(value: pd.Timestamp | pd.NaT) -> str:
    """화면 표시용 날짜 문자열을 만듭니다."""
    if pd.isna(value):
        return "미정"

    return value.strftime("%Y-%m-%d")


def format_target_age(row: pd.Series) -> str:
    """v1.1의 숫자 연령 컬럼을 화면용 문구로 바꿉니다."""
    min_text = first_value(row, ["target_age_min"])
    max_text = first_value(row, ["target_age_max"])

    try:
        min_age = int(float(min_text)) if min_text else 0
        max_age = int(float(max_text)) if max_text else 99
    except ValueError:
        return "연령 제한 미확인"

    if min_age <= 0 and max_age >= 99:
        return "전연령"
    if min_age > 0 and max_age >= 99:
        return f"{min_age}세 이상"
    if min_age <= 0 and max_age < 99:
        return f"{max_age}세 이하"
    return f"{min_age}~{max_age}세"


def ensure_normalized_columns(df: pd.DataFrame) -> pd.DataFrame:
    """v1.1 CSV에 일부 컬럼이 없어도 화면이 멈추지 않도록 빈 컬럼을 보강합니다."""
    df = df.copy()
    for column in REQUIRED_NORMALIZED_COLUMNS:
        if column not in df.columns:
            df[column] = ""
    return df


def normalize_for_display(normalized_df: pd.DataFrame) -> pd.DataFrame:
    """v1.1 정규화 CSV를 카드 화면에 필요한 표시용 컬럼으로 정리합니다."""
    normalized_df = ensure_normalized_columns(normalized_df)
    records = []

    for index, row in normalized_df.iterrows():
        source = first_value(row, ["source"], "unknown")
        source_id = first_value(row, ["source_id"], str(index))
        title = clean_text(first_value(row, ["title"], "제목 없음"))
        summary = clean_text(first_value(row, ["summary"], title))
        category = clean_text(first_value(row, ["category"], "분류 미정"))
        target_group = clean_text(first_value(row, ["target_group"], "대상 미확인"))
        target_age = format_target_age(row)
        start_date = parse_date(row.get("start_date"))
        end_date = parse_date(row.get("end_date"))
        detail_url = first_value(row, ["detail_url"], "")

        records.append(
            {
                "row_id": f"{source}-{source_id}-{index}",
                "source": source,
                "source_name": SOURCE_LABELS.get(source, source),
                "category": category,
                "title": title,
                "summary": summary,
                "target_group": target_group,
                "target_age": target_age,
                "apply_start": start_date,
                "apply_end": end_date,
                "detail_url": detail_url,
            }
        )

    return pd.DataFrame(records)


def d_day_label(end_date: pd.Timestamp | pd.NaT) -> tuple[str, str]:
    """마감일 기준 D-day 문구와 상태를 반환합니다."""
    if pd.isna(end_date):
        return "상시/미정", "neutral"

    days_left = (end_date.date() - date.today()).days
    if days_left < 0:
        return "마감", "closed"
    if days_left == 0:
        return "D-Day", "urgent"

    return f"D-{days_left}", "urgent" if days_left <= 7 else "normal"


def inject_styles() -> None:
    st.markdown(
        f"""
        <style>
            .stApp {{
                background: #FFFFFF;
                color: #0D1B2A;
            }}
            .block-container {{
                padding-top: 2rem;
                max-width: 1180px;
            }}
            [data-testid="stSidebar"] {{
                background: #F8F9FA;
                border-right: 1px solid {PALETTE["line"]};
            }}
            .main-title {{
                font-size: 30px;
                font-weight: 800;
                color: #0D1B2A;
                margin-bottom: 4px;
            }}
            .subtle {{
                color: #566;
                font-size: 14px;
                margin-bottom: 18px;
            }}
            .policy-card {{
                border: 1px solid {PALETTE["line"]};
                border-radius: 16px;
                padding: 18px;
                min-height: 292px;
                background: #FFFFFF;
                box-shadow: 0 8px 22px rgba(13, 27, 42, 0.06);
                margin-bottom: 12px;
            }}
            .card-top {{
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 16px;
            }}
            .chip-row {{
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                min-width: 0;
            }}
            .badge, .tag {{
                border-radius: 999px;
                color: #FFFFFF;
                font-size: 12px;
                font-weight: 700;
                padding: 5px 10px;
                line-height: 1;
                max-width: 150px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }}
            .tag {{
                background: {PALETTE["tag"]};
            }}
            .bookmark-static {{
                color: {PALETTE["bookmark"]};
                font-size: 22px;
                width: 30px;
                text-align: right;
                flex: 0 0 auto;
            }}
            .bookmark-off {{
                color: #B8C0CC;
            }}
            .dday {{
                display: inline-block;
                color: {PALETTE["urgent"]};
                font-size: 14px;
                font-weight: 900;
                margin-bottom: 10px;
            }}
            .policy-title {{
                font-size: 19px;
                font-weight: 800;
                line-height: 1.35;
                color: #0D1B2A;
                min-height: 72px;
                margin-bottom: 10px;
            }}
            .summary-line {{
                color: #415A77;
                font-size: 13px;
                line-height: 1.45;
                min-height: 56px;
                margin-bottom: 12px;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }}
            .meta-line {{
                color: #26384F;
                font-size: 14px;
                line-height: 1.45;
                margin: 7px 0;
            }}
            .empty {{
                border: 1px dashed {PALETTE["line"]};
                border-radius: 16px;
                padding: 48px 24px;
                text-align: center;
                color: #415A77;
                font-weight: 700;
                background: #FFFFFF;
            }}
            div.stButton > button[kind="primary"] {{
                background: {PALETTE["bookmark"]};
                border-color: {PALETTE["bookmark"]};
                color: #FFFFFF;
            }}
            div.stLinkButton > a {{
                background: {PALETTE["button"]};
                border-color: {PALETTE["button"]};
                color: #FFFFFF;
                width: 100%;
                text-align: center;
                justify-content: center;
            }}
        </style>
        """,
        unsafe_allow_html=True,
    )


@st.cache_data
def load_policy_data(csv_path: str) -> pd.DataFrame:
    normalized_df = pd.read_csv(csv_path, encoding="utf-8-sig")
    return normalize_for_display(normalized_df)


def render_card(policy: pd.Series) -> None:
    row_id = policy["row_id"]
    is_scraped = row_id in st.session_state.scraps
    dday_text, _ = d_day_label(policy["apply_end"])
    source_color = SOURCE_BADGE_COLORS.get(policy["source"], PALETTE["tag"])
    bookmark_class = "bookmark-static" if is_scraped else "bookmark-static bookmark-off"
    source_name = escape(str(policy["source_name"]))
    category = escape(str(policy["category"]))
    title = escape(str(policy["title"]))
    summary = escape(str(policy["summary"]))
    target_group = escape(str(policy["target_group"]))
    target_age = escape(str(policy["target_age"]))
    apply_start = escape(format_date(policy["apply_start"]))
    apply_end = escape(format_date(policy["apply_end"]))

    st.markdown(
        f"""
        <div class="policy-card">
            <div class="card-top">
                <div class="chip-row">
                    <span class="badge" style="background:{source_color};">{source_name}</span>
                    <span class="tag">{category}</span>
                </div>
                <div class="{bookmark_class}">🔖</div>
            </div>
            <div class="dday">{dday_text}</div>
            <div class="policy-title">{title}</div>
            <div class="summary-line">{summary}</div>
            <div class="meta-line">👥 대상: {target_group}</div>
            <div class="meta-line">🎯 연령: {target_age}</div>
            <div class="meta-line">📅 기간: {apply_start} ~ {apply_end}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    button_type = "primary" if is_scraped else "secondary"
    if st.button("🔖 스크랩", key=f"scrap-{row_id}", type=button_type, use_container_width=True):
        if is_scraped:
            st.session_state.scraps.pop(row_id, None)
        else:
            st.session_state.scraps[row_id] = {
                "title": policy["title"],
                "source_name": policy["source_name"],
                "detail_url": policy["detail_url"],
            }
        st.rerun()

    if policy["detail_url"]:
        st.link_button("자세히 보기", policy["detail_url"], use_container_width=True)
    else:
        st.button("자세히 보기", disabled=True, use_container_width=True, key=f"disabled-{row_id}")


def main() -> None:
    st.set_page_config(page_title="PolicyRec 정책정보", page_icon="🔖", layout="wide")
    inject_styles()

    if "scraps" not in st.session_state:
        st.session_state.scraps = {}

    st.sidebar.subheader(f"스크랩한 정책 ({len(st.session_state.scraps)}개)")
    if st.session_state.scraps:
        for item in st.session_state.scraps.values():
            st.sidebar.markdown(f"- **[{item['source_name']}]** {item['title']}")
    else:
        st.sidebar.caption("아직 스크랩한 정책이 없습니다.")

    st.markdown('<div class="main-title">정책정보 통합검색</div>', unsafe_allow_html=True)
    st.markdown(
        '<div class="subtle">v1.1 정규화 CSV를 기반으로 정책 카드를 표시합니다.</div>',
        unsafe_allow_html=True,
    )

    if not CSV_PATH.exists():
        st.error(f"CSV 파일을 찾을 수 없습니다: {CSV_PATH}")
        st.stop()

    policy_df = load_policy_data(str(CSV_PATH))
    st.caption(f"데이터 파일: {CSV_PATH}")

    search_text = st.text_input(
        "통합검색",
        placeholder="사업명이나 summary 키워드로 검색해보세요",
        label_visibility="collapsed",
    )

    filtered_df = policy_df.copy()
    if search_text.strip():
        pattern = re.escape(search_text.strip())
        filtered_df = filtered_df[
            filtered_df["title"].str.contains(pattern, case=False, na=False, regex=True)
            | filtered_df["summary"].str.contains(pattern, case=False, na=False, regex=True)
        ]

    st.markdown(f"**총 {len(filtered_df):,}건의 정책정보가 있습니다**")

    if filtered_df.empty:
        st.markdown('<div class="empty">검색 결과가 없습니다</div>', unsafe_allow_html=True)
        return

    rows = [filtered_df.iloc[i : i + 3] for i in range(0, len(filtered_df), 3)]
    for row in rows:
        columns = st.columns(3, gap="large")
        for column, (_, policy) in zip(columns, row.iterrows()):
            with column:
                render_card(policy)


if __name__ == "__main__":
    main()
