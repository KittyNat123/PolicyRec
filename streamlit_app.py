from __future__ import annotations

from datetime import date
from html import escape, unescape
from pathlib import Path
import re

import pandas as pd
import streamlit as st


# data/clean 안의 combined_normalized_v*.csv 중 가장 높은 버전을 자동으로 사용합니다.
# 예: combined_normalized_v1_1_2.csv -> v1.1.2
DATA_CLEAN_DIR = Path("data/clean")
NORMALIZED_CSV_RE = re.compile(r"^combined_normalized_v(?P<version>\d+(?:[._]\d+)*)\.csv$")

NAV_ITEMS = ["정책찾기", "스크랩"]
NAV_HELP_TEXT = {
    "정책찾기": "지역, 대상, 분야, 기관을 기준으로 정책과 지원사업을 탐색합니다.",
    "스크랩": "스크랩한 정책을 카드 형태로 다시 확인합니다.",
}

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
    "line": "#E0E1DD",
    "bookmark": "#0D1B2A",
}

# target_group은 source마다 표현이 조금 다릅니다.
# CSV 원본은 유지하고, 화면 표시/필터에서만 같은 의미의 짧은 alias를 합칩니다.
TARGET_GROUP_ALIASES = {
    "대학": "대학생",
}

REQUIRED_NORMALIZED_COLUMNS = [
    "source",
    "source_id",
    "title",
    "summary",
    "category",
    "region",
    "provider",
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
    """HTML 태그와 줄바꿈을 카드 표시용 문장으로 정리합니다."""
    if pd.isna(value):
        return ""

    text = unescape(str(value))
    text = re.sub(r"(?i)<br\s*/?>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\r", " ").replace("\n", " ").replace("\t", " ")
    return re.sub(r"\s+", " ", text).strip()


def split_target_group(value: object) -> list[str]:
    """
    target_group 원본 문자열을 화면 표시와 필터에 쓸 태그 목록으로 나눕니다.

    CSV 원본값은 바꾸지 않습니다.
    Streamlit 화면에서만 "대학생,일반인,1인 창조기업"을
    ["대학생", "일반인", "1인 창조기업"]처럼 잠시 나눠 사용합니다.
    """
    text = clean_text(value)
    if not text or text == "대상 미확인":
        return []

    tags = []
    seen = set()
    for part in text.split(","):
        tag = part.strip()
        if tag and tag not in seen:
            tags.append(tag)
            seen.add(tag)

    return tags


def normalize_target_group_tag(tag: str) -> str:
    """대상 태그의 표시/필터용 alias를 표준 라벨로 바꿉니다."""
    normalized = clean_text(tag)
    return TARGET_GROUP_ALIASES.get(normalized, normalized)


def normalize_target_group_tags(tags: list[str]) -> list[str]:
    """대상 태그 목록에서 alias를 합치고 중복을 제거합니다."""
    normalized_tags = []
    seen = set()
    for tag in tags:
        normalized = normalize_target_group_tag(tag)
        if normalized and normalized not in seen:
            normalized_tags.append(normalized)
            seen.add(normalized)
    return normalized_tags


def format_target_group_display(tags: list[str], fallback: str = "대상 미확인") -> str:
    """대상 태그 목록을 필터/검색에 읽기 좋은 문자열로 바꿉니다."""
    if not tags:
        return fallback
    return " · ".join(tags)


def parse_date(value: object) -> pd.Timestamp | pd.NaT:
    """CSV의 날짜 값을 Timestamp로 변환합니다."""
    if pd.isna(value):
        return pd.NaT

    text = str(value).strip()
    if not text or text in {"연중", "상시", "예산 소진시까지", "확인필요", "추후공지"}:
        return pd.NaT

    return pd.to_datetime(text, errors="coerce")


def format_date(value: pd.Timestamp | pd.NaT) -> str:
    """화면 표시용 날짜 문자열을 만듭니다."""
    if pd.isna(value):
        return "미정"

    return value.strftime("%Y-%m-%d")


def parse_version_tuple(path: Path) -> tuple[int, ...]:
    """파일명의 버전 번호를 비교 가능한 숫자 튜플로 바꿉니다."""
    match = NORMALIZED_CSV_RE.match(path.name)
    if not match:
        return ()

    version_text = match.group("version").replace("_", ".")
    return tuple(int(part) for part in version_text.split("."))


def version_label_from_path(path: Path) -> str:
    """선택된 CSV 파일명에서 화면 표시용 버전 문구를 만듭니다."""
    version = parse_version_tuple(path)
    if not version:
        return "현재"

    return "v" + ".".join(str(part) for part in version)


def resolve_csv_path() -> Path:
    """data/clean 폴더에서 가장 최신 버전의 정규화 CSV를 찾습니다."""
    candidates = []
    for path in DATA_CLEAN_DIR.glob("combined_normalized_v*.csv"):
        version = parse_version_tuple(path)
        if version:
            candidates.append((version, path.stat().st_mtime, path))

    if not candidates:
        return DATA_CLEAN_DIR / "combined_normalized_v1_1_2.csv"

    # 버전 번호가 가장 높은 파일을 우선하고, 같은 버전이면 더 최근 파일을 씁니다.
    return max(candidates, key=lambda item: (item[0], item[1]))[2]


def format_target_age(row: pd.Series) -> str:
    """target_age_min/max를 카드에 읽기 쉬운 문구로 바꿉니다."""
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
    """CSV에 일부 컬럼이 없어도 화면이 멈추지 않도록 빈 컬럼을 보강합니다."""
    df = df.copy()
    for column in REQUIRED_NORMALIZED_COLUMNS:
        if column not in df.columns:
            df[column] = ""
    return df


def normalize_for_display(normalized_df: pd.DataFrame) -> pd.DataFrame:
    """정규화 CSV를 카드와 필터에 필요한 표시용 컬럼으로 정리합니다."""
    normalized_df = ensure_normalized_columns(normalized_df)
    records = []

    for index, row in normalized_df.iterrows():
        source = first_value(row, ["source"], "unknown")
        source_id = first_value(row, ["source_id"], str(index))
        title = clean_text(first_value(row, ["title"], "제목 없음"))
        summary = clean_text(first_value(row, ["summary"], title))
        category = clean_text(first_value(row, ["category"], "분류 미정"))
        region = clean_text(first_value(row, ["region"], "지역 미정"))
        provider = clean_text(first_value(row, ["provider"], "기관 미정"))
        target_group = clean_text(first_value(row, ["target_group"], "대상 미확인"))
        target_group_tags = normalize_target_group_tags(split_target_group(target_group))
        target_group_display = format_target_group_display(target_group_tags)

        records.append(
            {
                "row_id": f"{source}-{source_id}-{index}",
                "source": source,
                "source_name": SOURCE_LABELS.get(source, source),
                "category": category,
                "title": title,
                "summary": summary,
                "region": region,
                "provider": provider,
                "target_group": target_group,
                "target_group_tags": target_group_tags,
                "target_group_display": target_group_display,
                "target_age": format_target_age(row),
                "apply_start": parse_date(row.get("start_date")),
                "apply_end": parse_date(row.get("end_date")),
                "detail_url": first_value(row, ["detail_url"], ""),
            }
        )

    return pd.DataFrame(records)


@st.cache_data
def load_policy_data(csv_path: str) -> pd.DataFrame:
    """CSV를 읽고 Streamlit 화면에서 바로 쓸 수 있는 형태로 변환합니다."""
    normalized_df = pd.read_csv(csv_path, encoding="utf-8-sig")
    return normalize_for_display(normalized_df)


def unique_options(df: pd.DataFrame, column: str, excluded: set[str] | None = None) -> list[str]:
    """필터에 사용할 값을 빈 값 없이 정렬해서 반환합니다."""
    excluded = excluded or set()
    if column not in df.columns:
        return []

    options = []
    for value in df[column].dropna():
        if isinstance(value, list):
            for item in value:
                text = str(item).strip()
                if text and text not in excluded:
                    options.append(text)
            continue

        text = str(value).strip()
        if text and text not in excluded:
            options.append(text)

    return sorted(set(options))


def d_day_label(end_date: pd.Timestamp | pd.NaT) -> str:
    """마감일 기준 D-day 문구를 반환합니다."""
    if pd.isna(end_date):
        return "상시/미정"

    days_left = (end_date.date() - date.today()).days
    if days_left < 0:
        return "마감"
    if days_left == 0:
        return "D-Day"
    return f"D-{days_left}"


def deadline_status(end_date: pd.Timestamp | pd.NaT) -> str:
    """마감일을 필터용 상태값으로 바꿉니다."""
    if pd.isna(end_date):
        return "상시/미정"

    days_left = (end_date.date() - date.today()).days
    if days_left < 0:
        return "마감"
    if days_left <= 7:
        return "마감임박"
    return "접수중"


def sort_policies(df: pd.DataFrame, sort_option: str) -> pd.DataFrame:
    """정렬 옵션에 맞게 결과를 정렬합니다."""
    if sort_option == "마감 임박순":
        sorted_df = df.assign(
            _deadline_order=df["apply_end"].apply(
                lambda value: 999999 if pd.isna(value) else (value.date() - date.today()).days
            )
        )
        sorted_df = sorted_df[sorted_df["_deadline_order"] >= 0]
        return sorted_df.sort_values("_deadline_order").drop(columns="_deadline_order")

    if sort_option == "신규 시작일순":
        return df.sort_values("apply_start", ascending=False, na_position="last")

    if sort_option == "제목순":
        return df.sort_values("title", ascending=True, na_position="last")

    return df


def inject_styles() -> None:
    """서비스형 탐색 화면의 CSS를 주입합니다."""
    st.markdown(
        f"""
        <style>
            .stApp {{
                background: #FFFFFF;
                color: #0D1B2A;
            }}
            .block-container {{
                max-width: 1260px;
                padding-top: 2.2rem;
            }}
            [data-testid="stSidebar"] {{
                background: #F8F9FA;
                border-right: 1px solid {PALETTE["line"]};
            }}
            .top-nav {{
                align-items: center;
                border-bottom: 1px solid {PALETTE["line"]};
                box-sizing: border-box;
                display: flex;
                justify-content: space-between;
                margin-bottom: 16px;
                min-height: 64px;
                overflow: visible;
                padding: 8px 0 12px;
            }}
            .brand {{
                color: #1B263B;
                font-size: 22px;
                font-weight: 900;
                white-space: nowrap;
            }}
            .version-pill {{
                border: 1px solid #2457FF;
                border-radius: 999px;
                color: #2457FF;
                font-size: 13px;
                font-weight: 800;
                padding: 9px 14px;
                white-space: nowrap;
            }}
            .nav-control {{
                margin: 2px 0 18px;
            }}
            div[data-testid="stSegmentedControl"] button {{
                font-size: 14px;
                font-weight: 800;
                min-height: 38px;
            }}
            .page-title {{
                color: #0D1B2A;
                font-size: 26px;
                font-weight: 900;
                margin: 22px 0 4px;
            }}
            .page-subtitle {{
                color: #5D6B7C;
                font-size: 14px;
                margin-bottom: 18px;
            }}
            .filter-shell {{
                border-bottom: 1px solid {PALETTE["line"]};
                border-top: 1px solid {PALETTE["line"]};
                margin-bottom: 26px;
                padding: 14px 0 10px;
            }}
            .result-head {{
                align-items: baseline;
                display: flex;
                gap: 16px;
                justify-content: space-between;
                margin: 18px 0;
            }}
            .result-title {{
                color: #0D1B2A;
                font-size: 25px;
                font-weight: 900;
            }}
            .result-count {{
                color: #5D6B7C;
                font-size: 14px;
                font-weight: 700;
            }}
            .policy-card {{
                background: #FFFFFF;
                border: 1px solid #D8DEE8;
                border-radius: 8px;
                box-shadow: 0 6px 18px rgba(13, 27, 42, 0.04);
                margin-bottom: 12px;
                min-height: 342px;
                padding: 18px;
            }}
            .card-top {{
                align-items: center;
                display: flex;
                gap: 8px;
                justify-content: space-between;
                margin-bottom: 15px;
            }}
            .chip-row {{
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                min-width: 0;
            }}
            .badge, .tag {{
                border-radius: 999px;
                color: #FFFFFF;
                font-size: 12px;
                font-weight: 800;
                line-height: 1;
                max-width: 150px;
                overflow: hidden;
                padding: 5px 10px;
                text-overflow: ellipsis;
                white-space: nowrap;
            }}
            .tag {{
                background: {PALETTE["tag"]};
            }}
            .scrap-mark {{
                color: #B8C0CC;
                flex: 0 0 auto;
                font-size: 20px;
                text-align: right;
                width: 28px;
            }}
            .scrap-mark.active {{
                color: {PALETTE["bookmark"]};
            }}
            .dday {{
                color: #2457FF;
                display: inline-block;
                font-size: 14px;
                font-weight: 900;
                margin-bottom: 10px;
            }}
            .policy-title {{
                color: #0D1B2A;
                font-size: 18px;
                font-weight: 900;
                line-height: 1.35;
                margin-bottom: 8px;
                min-height: 72px;
            }}
            .provider-line {{
                color: #334155;
                font-size: 14px;
                font-weight: 800;
                margin-bottom: 8px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }}
            .summary-line {{
                color: #415A77;
                display: -webkit-box;
                font-size: 13px;
                line-height: 1.45;
                margin-bottom: 12px;
                min-height: 56px;
                overflow: hidden;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: 3;
            }}
            .meta-line {{
                color: #26384F;
                font-size: 13px;
                line-height: 1.45;
                margin: 6px 0;
            }}
            .target-tags {{
                align-items: center;
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                margin: 7px 0;
            }}
            .target-chip {{
                background: #F1F5F9;
                border: 1px solid #D8DEE8;
                border-radius: 999px;
                color: #26384F;
                display: inline-block;
                font-size: 12px;
                font-weight: 800;
                line-height: 1;
                max-width: 132px;
                overflow: hidden;
                padding: 5px 8px;
                text-overflow: ellipsis;
                white-space: nowrap;
            }}
            .empty {{
                background: #FFFFFF;
                border: 1px dashed {PALETTE["line"]};
                border-radius: 8px;
                color: #415A77;
                font-weight: 800;
                padding: 48px 24px;
                text-align: center;
            }}
            .sidebar-count {{
                background: #FFFFFF;
                border: 1px solid {PALETTE["line"]};
                border-radius: 8px;
                color: #26384F;
                font-size: 14px;
                font-weight: 800;
                margin-bottom: 12px;
                padding: 12px;
            }}
            .sidebar-help {{
                color: #2F3B4C;
                font-size: 14px;
                line-height: 1.55;
                margin-bottom: 12px;
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
                justify-content: center;
                text-align: center;
                width: 100%;
            }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def ensure_session_state() -> None:
    """스크랩 상태를 세션에 보관합니다."""
    if "scraps" not in st.session_state:
        st.session_state.scraps = {}


def render_top_nav(version_label: str) -> None:
    """서비스 상단 브랜드 영역을 표시합니다."""
    st.markdown(
        f"""
        <div class="top-nav">
            <div class="brand">PolicyRec</div>
            <div class="version-pill">{escape(version_label)} 데이터</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_nav_control() -> str:
    """정책찾기와 스크랩 화면을 전환합니다."""
    st.markdown('<div class="nav-control">', unsafe_allow_html=True)
    selected_page = st.segmented_control("화면", NAV_ITEMS, default="정책찾기", label_visibility="collapsed")
    st.markdown("</div>", unsafe_allow_html=True)
    return selected_page or "정책찾기"


def render_sidebar(policy_df: pd.DataFrame, selected_page: str) -> list[str]:
    """스크랩 개수와 사이트 필터를 표시합니다."""
    scraps = st.session_state.scraps

    st.sidebar.subheader(f"스크랩한 정책 ({len(scraps)}개)")
    st.sidebar.markdown(
        f'<div class="sidebar-count">현재 {len(scraps)}개를 스크랩했습니다.</div>',
        unsafe_allow_html=True,
    )
    st.sidebar.markdown(
        f'<div class="sidebar-help">{escape(NAV_HELP_TEXT.get(selected_page, ""))}</div>',
        unsafe_allow_html=True,
    )

    st.sidebar.divider()
    st.sidebar.subheader("사이트")
    source_options = unique_options(policy_df, "source_name")
    return st.sidebar.multiselect("K-Startup / 기업마당 / 온통청년", source_options)


def render_filter_bar(policy_df: pd.DataFrame) -> tuple[str, str, str, str, str, str, str]:
    """상단 조건 바와 상세조건을 표시합니다."""
    st.markdown('<div class="filter-shell">', unsafe_allow_html=True)
    col_region, col_target, col_category, col_search = st.columns([1.15, 1.15, 1.15, 1.7], gap="small")

    with col_region:
        region = st.selectbox("지역 선택", ["전체"] + unique_options(policy_df, "region", {"지역 미정"}))
    with col_target:
        target = st.selectbox("대상 선택", ["전체"] + unique_options(policy_df, "target_group_tags", {"대상 미확인"}))
    with col_category:
        category = st.selectbox("분야 선택", ["전체"] + unique_options(policy_df, "category", {"분류 미정"}))
    with col_search:
        search_text = st.text_input("검색어 입력", placeholder="사업명, 요약, 기관, 지역 검색")

    with st.expander("상세조건", expanded=False):
        detail_col1, detail_col2, detail_col3 = st.columns(3, gap="small")
        with detail_col1:
            status = st.selectbox("모집 상태", ["전체", "접수중", "마감임박", "상시/미정", "마감"])
        with detail_col2:
            provider = st.selectbox("기관", ["전체"] + unique_options(policy_df, "provider", {"기관 미정"}))
        with detail_col3:
            sort_option = st.selectbox("정렬", ["기본", "마감 임박순", "신규 시작일순", "제목순"])

    st.markdown("</div>", unsafe_allow_html=True)
    return region, target, category, search_text, status, provider, sort_option


def apply_filters(
    policy_df: pd.DataFrame,
    selected_sources: list[str],
    region: str,
    target: str,
    category: str,
    search_text: str,
    status: str,
    provider: str,
) -> pd.DataFrame:
    """사용자가 고른 조건을 순서대로 적용합니다."""
    filtered_df = policy_df.copy()

    if selected_sources:
        filtered_df = filtered_df[filtered_df["source_name"].isin(selected_sources)]
    if region != "전체":
        filtered_df = filtered_df[filtered_df["region"] == region]
    if target != "전체":
        filtered_df = filtered_df[filtered_df["target_group_tags"].apply(lambda tags: target in tags)]
    if category != "전체":
        filtered_df = filtered_df[filtered_df["category"] == category]
    if provider != "전체":
        filtered_df = filtered_df[filtered_df["provider"] == provider]
    if status != "전체":
        filtered_df = filtered_df[filtered_df["apply_end"].apply(deadline_status) == status]

    if search_text.strip():
        pattern = search_text.strip()
        search_target = (
            filtered_df["title"].str.contains(pattern, case=False, na=False, regex=False)
            | filtered_df["summary"].str.contains(pattern, case=False, na=False, regex=False)
            | filtered_df["region"].str.contains(pattern, case=False, na=False, regex=False)
            | filtered_df["provider"].str.contains(pattern, case=False, na=False, regex=False)
            | filtered_df["target_group_display"].str.contains(pattern, case=False, na=False, regex=False)
        )
        filtered_df = filtered_df[search_target]

    return filtered_df


def render_target_group_tags(tags: list[str], fallback: str) -> str:
    """카드 안의 target_group을 작은 태그 묶음으로 렌더링합니다."""
    if not tags:
        return f'<div class="meta-line">대상: {escape(fallback)}</div>'

    chips = "".join(f'<span class="target-chip">{escape(tag)}</span>' for tag in tags)
    return f'<div class="target-tags">{chips}</div>'


def render_card(policy: pd.Series) -> None:
    """정책 카드 하나를 표시합니다."""
    scraps = st.session_state.scraps
    row_id = str(policy["row_id"])
    is_scraped = row_id in scraps
    source_color = SOURCE_BADGE_COLORS.get(policy["source"], PALETTE["tag"])
    scrap_class = "scrap-mark active" if is_scraped else "scrap-mark"

    source_name = escape(str(policy["source_name"]))
    category = escape(str(policy["category"]))
    title = escape(str(policy["title"]))
    provider = escape(str(policy["provider"]))
    summary = escape(str(policy["summary"]))
    region = escape(str(policy["region"]))
    target_group_raw = str(policy["target_group"])
    target_group_tags = policy.get("target_group_tags", [])
    if not isinstance(target_group_tags, list):
        target_group_tags = split_target_group(target_group_raw)
    target_group_html = render_target_group_tags(target_group_tags, target_group_raw)
    target_age = escape(str(policy["target_age"]))
    apply_start = escape(format_date(policy["apply_start"]))
    apply_end = escape(format_date(policy["apply_end"]))
    dday_text = escape(d_day_label(policy["apply_end"]))

    st.markdown(
        f"""
        <div class="policy-card">
            <div class="card-top">
                <div class="chip-row">
                    <span class="badge" style="background:{source_color};">{source_name}</span>
                    <span class="tag">{category}</span>
                </div>
                <div class="{scrap_class}">☆</div>
            </div>
            <div class="dday">{dday_text}</div>
            <div class="policy-title">{title}</div>
            <div class="provider-line">{provider}</div>
            <div class="summary-line">{summary}</div>
            <div class="meta-line">지역: {region}</div>
            {target_group_html}
            <div class="meta-line">연령: {target_age}</div>
            <div class="meta-line">기간: {apply_start} ~ {apply_end}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    button_type = "primary" if is_scraped else "secondary"
    if st.button("스크랩", key=f"scrap-{row_id}", type=button_type, use_container_width=True):
        if is_scraped:
            scraps.pop(row_id, None)
        else:
            scraps[row_id] = {
                "title": policy["title"],
                "source_name": policy["source_name"],
                "detail_url": policy["detail_url"],
            }
        st.rerun()

    if policy["detail_url"]:
        st.link_button("자세히 보기", policy["detail_url"], use_container_width=True)
    else:
        st.button("자세히 보기", disabled=True, use_container_width=True, key=f"disabled-{row_id}")


def render_card_grid(filtered_df: pd.DataFrame, empty_text: str = "검색 결과가 없습니다") -> None:
    """정책 데이터프레임을 3열 카드 목록으로 표시합니다."""
    if filtered_df.empty:
        st.markdown(f'<div class="empty">{escape(empty_text)}</div>', unsafe_allow_html=True)
        return

    rows = [filtered_df.iloc[index : index + 3] for index in range(0, len(filtered_df), 3)]
    for row in rows:
        columns = st.columns(3, gap="large")
        for column, (_, policy) in zip(columns, row.iterrows()):
            with column:
                render_card(policy)


def render_results(filtered_df: pd.DataFrame) -> None:
    """정책찾기 결과 영역을 표시합니다."""
    st.markdown(
        f"""
        <div class="result-head">
            <div class="result-title">지금 신청 가능한 정책과 지원사업</div>
            <div class="result-count">총 {len(filtered_df):,}건</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    render_card_grid(filtered_df)


def render_scrap_page(policy_df: pd.DataFrame) -> None:
    """스크랩한 정책만 카드로 모아 표시합니다."""
    scraped_ids = set(st.session_state.scraps.keys())
    scraped_df = policy_df[policy_df["row_id"].astype(str).isin(scraped_ids)]

    st.markdown(
        f"""
        <div class="result-head">
            <div class="result-title">스크랩한 정책</div>
            <div class="result-count">총 {len(scraped_df):,}건</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    render_card_grid(scraped_df, "스크랩한 정책이 없습니다")


def main() -> None:
    st.set_page_config(page_title="PolicyRec 정책 탐색", page_icon="🔎", layout="wide")
    inject_styles()
    ensure_session_state()

    csv_path = resolve_csv_path()
    version_label = version_label_from_path(csv_path)

    if not csv_path.exists():
        st.error(f"정규화 CSV 파일을 찾을 수 없습니다: {csv_path}")
        st.stop()

    policy_df = load_policy_data(str(csv_path))

    render_top_nav(version_label)
    selected_page = render_nav_control()
    selected_sources = render_sidebar(policy_df, selected_page)

    page_title = "스크랩한 정책을 확인하세요" if selected_page == "스크랩" else "나에게 맞는 정책과 지원사업을 찾아보세요"
    st.markdown(f'<div class="page-title">{escape(page_title)}</div>', unsafe_allow_html=True)
    st.markdown(
        f'<div class="page-subtitle">{escape(version_label)} 정규화 데이터 · {escape(NAV_HELP_TEXT[selected_page])}</div>',
        unsafe_allow_html=True,
    )

    if selected_page == "스크랩":
        render_scrap_page(policy_df)
        return

    region, target, category, search_text, status, provider, sort_option = render_filter_bar(policy_df)
    filtered_df = apply_filters(
        policy_df,
        selected_sources,
        region,
        target,
        category,
        search_text,
        status,
        provider,
    )
    filtered_df = sort_policies(filtered_df, sort_option)

    render_results(filtered_df)


if __name__ == "__main__":
    main()
