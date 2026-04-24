from __future__ import annotations

import json
import os
from html import escape
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

try:
    from supabase import Client, create_client
except ModuleNotFoundError:  # pragma: no cover
    Client = Any  # type: ignore[assignment]
    create_client = None

from streamlit_app import d_day_label, ensure_normalized_columns, format_date, normalize_for_display, unique_options
from streamlit_app2 import (
    BG_LIGHT,
    SLATE_TEXT,
    SOURCE_BADGE_STYLES,
    build_search_text,
    build_vectorizer,
    ensure_session,
    generate_chat_response,
    get_genai_client,
    get_smalltalk_reply,
    inject_chat_icon,
    inject_styles,
    is_low_confidence,
    load_chat_icon_b64,
    make_widget_key,
    render_card_grid,
    resolve_detail_url,
    search_top5_tfidf,
    toggle_scrap,
)

load_dotenv()

SUPABASE_TABLE = "announcements"
SUPABASE_PAGE_SIZE = 1000
SUPABASE_CACHE_TTL = 300
PROFILE_PATH = Path("data/app/user_pref_demo.json")

PAGE_SEARCH = "search"
PAGE_PROFILE = "profile"
ALL = "전체"

FILTER_DEFAULTS = {
    "search": "",
    "region": ALL,
    "target": ALL,
    "category": ALL,
    "provider": ALL,
    "recruitment_status": ALL,
}

RECRUITMENT_STATUSES = [ALL, "모집중", "모집임박", "마감", "모집예정"]
SAVED_FILTER_INTENT_KEYWORDS = ("내 필터", "저장한 필터", "설정한 필터", "내 조건", "저장된 조건")
REGION_ALIASES = {
    "서울": "서울특별시",
    "부산": "부산광역시",
    "대구": "대구광역시",
    "인천": "인천광역시",
    "광주": "광주광역시",
    "대전": "대전광역시",
    "울산": "울산광역시",
    "세종": "세종특별자치시",
    "경기": "경기도",
    "강원": "강원특별자치도",
    "충북": "충청북도",
    "충남": "충청남도",
    "전북": "전북특별자치도",
    "전남": "전라남도",
    "경북": "경상북도",
    "경남": "경상남도",
    "제주": "제주특별자치도",
}
TARGET_KEYWORDS = {
    "청년": "청년",
    "대학생": "대학생",
    "예비창업자": "예비창업자",
    "중소기업": "중소기업",
    "소상공인": "소상공인",
}
TARGET_EXPANSIONS = {
    "청년": ["청년", "대학생", "대학", "예비창업자", "사회초년생", "취업준비생"],
    "대학생": ["대학생", "대학"],
    "예비창업자": ["예비창업자", "창업", "초기창업"],
    "중소기업": ["중소기업"],
    "소상공인": ["소상공인"],
}


def get_supabase_credentials() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_KEY", "").strip() or os.getenv("SUPABASE_ANON_KEY", "").strip()
    return url, key


@st.cache_resource
def get_supabase_client(url: str, key: str) -> Client:
    if create_client is None:
        raise ModuleNotFoundError("supabase package is not installed")
    return create_client(url, key)


@st.cache_data(ttl=SUPABASE_CACHE_TTL, show_spinner=False)
def fetch_supabase_rows(url: str, key: str, table_name: str = SUPABASE_TABLE) -> tuple[list[dict[str, Any]], int | None]:
    if create_client is None:
        raise ModuleNotFoundError("supabase package is not installed")

    client = create_client(url, key)
    columns = ",".join(
        [
            "source",
            "source_id",
            "source_file",
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
            "provider",
            "created_at",
            "updated_at",
        ]
    )

    rows: list[dict[str, Any]] = []
    total_count: int | None = None
    start = 0

    while True:
        response = (
            client.table(table_name)
            .select(columns, count="exact")
            .range(start, start + SUPABASE_PAGE_SIZE - 1)
            .execute()
        )
        batch = response.data or []
        if total_count is None:
            total_count = getattr(response, "count", None)
        rows.extend(batch)
        if len(batch) < SUPABASE_PAGE_SIZE:
            break
        start += SUPABASE_PAGE_SIZE

    return rows, total_count


def load_profile_preferences() -> dict[str, str]:
    if not PROFILE_PATH.exists():
        return FILTER_DEFAULTS.copy()
    try:
        data = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return FILTER_DEFAULTS.copy()

    saved = FILTER_DEFAULTS.copy()
    for key in saved:
        saved[key] = str(data.get(key, saved[key]) or saved[key])
    return saved


def save_profile_preferences(filters: dict[str, str]) -> None:
    PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = FILTER_DEFAULTS.copy()
    payload.update({key: str(value) for key, value in filters.items() if key in payload})
    PROFILE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def ensure_app3_2_session() -> None:
    saved_filters = load_profile_preferences()

    defaults = {
        "app3_2_page": PAGE_SEARCH,
        "app3_2_show_admin_panel": False,
        "app3_2_saved_filters": saved_filters,
        "app3_2_applied_filters": FILTER_DEFAULTS.copy(),
        "app3_2_use_saved_filters": False,
        "app3_2_use_saved_filters_prev": False,
        "app3_2_pending_reset_saved_toggle": False,
        "app3_2_chat_history": [],
        "chat_open": False,
        "chat_bubble_visible": True,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value

    widget_defaults = {
        "app3_2_filter_search": FILTER_DEFAULTS["search"],
        "app3_2_filter_region": FILTER_DEFAULTS["region"],
        "app3_2_filter_target": FILTER_DEFAULTS["target"],
        "app3_2_filter_category": FILTER_DEFAULTS["category"],
        "app3_2_filter_provider": FILTER_DEFAULTS["provider"],
        "app3_2_filter_recruitment_status": FILTER_DEFAULTS["recruitment_status"],
    }
    for key, value in widget_defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def build_version_label(raw_df: pd.DataFrame) -> str:
    if raw_df.empty or "updated_at" not in raw_df.columns:
        return "v1.2.x (Supabase)"
    updated = pd.to_datetime(raw_df["updated_at"], errors="coerce")
    latest = updated.max()
    if pd.isna(latest):
        return "v1.2.x (Supabase)"
    return f"v1.2.x (Supabase) / {latest.strftime('%Y-%m-%d %H:%M')} sync"


def resolve_recruitment_status(row: pd.Series) -> str:
    today = pd.Timestamp.now().date()
    start_date = pd.to_datetime(row.get("apply_start"), errors="coerce")
    end_date = pd.to_datetime(row.get("apply_end"), errors="coerce")

    start_day = start_date.date() if pd.notna(start_date) else None
    end_day = end_date.date() if pd.notna(end_date) else None

    if end_day is not None and end_day < today:
        return "마감"
    if start_day is not None and start_day > today:
        return "모집예정"
    if end_day is not None and 0 <= (end_day - today).days <= 7:
        return "모집임박"
    return "모집중"


def prepare_policy_dataframe(raw_df: pd.DataFrame) -> pd.DataFrame:
    normalized_df = ensure_normalized_columns(raw_df.copy())
    display_df = normalize_for_display(normalized_df).copy()

    if "source_id" in normalized_df.columns:
        display_df["source_id"] = normalized_df["source_id"].fillna("").astype(str)
    else:
        display_df["source_id"] = ""

    resolved_pairs = display_df.apply(
        lambda row: resolve_detail_url(
            row.get("source", ""),
            row.get("source_id", ""),
            row.get("title", ""),
            row.get("detail_url", ""),
        ),
        axis=1,
    )
    display_df["resolved_detail_url"] = [pair[0] for pair in resolved_pairs]
    display_df["detail_url_is_fallback"] = [pair[1] for pair in resolved_pairs]
    display_df["recruitment_status"] = display_df.apply(resolve_recruitment_status, axis=1)
    return display_df


def get_filter_options(df: pd.DataFrame) -> dict[str, list[str]]:
    return {
        "region": [ALL] + unique_options(df, "region"),
        "target": [ALL] + unique_options(df, "target_group_tags"),
        "category": [ALL] + unique_options(df, "category"),
        "provider": [ALL] + unique_options(df, "provider"),
        "recruitment_status": RECRUITMENT_STATUSES,
    }


def sync_search_widgets(filters: dict[str, str]) -> None:
    st.session_state["app3_2_filter_search"] = filters.get("search", "")
    st.session_state["app3_2_filter_region"] = filters.get("region", ALL)
    st.session_state["app3_2_filter_target"] = filters.get("target", ALL)
    st.session_state["app3_2_filter_category"] = filters.get("category", ALL)
    st.session_state["app3_2_filter_provider"] = filters.get("provider", ALL)
    st.session_state["app3_2_filter_recruitment_status"] = filters.get("recruitment_status", ALL)


def get_search_widget_filters() -> dict[str, str]:
    return {
        "search": str(st.session_state.get("app3_2_filter_search", "")).strip(),
        "region": str(st.session_state.get("app3_2_filter_region", ALL)),
        "target": str(st.session_state.get("app3_2_filter_target", ALL)),
        "category": str(st.session_state.get("app3_2_filter_category", ALL)),
        "provider": str(st.session_state.get("app3_2_filter_provider", ALL)),
        "recruitment_status": str(st.session_state.get("app3_2_filter_recruitment_status", ALL)),
    }


def save_saved_filters(filters: dict[str, str]) -> None:
    saved = FILTER_DEFAULTS.copy()
    saved.update(filters)
    st.session_state["app3_2_saved_filters"] = saved
    save_profile_preferences(saved)


def reset_search_filters() -> None:
    st.session_state["app3_2_pending_reset_saved_toggle"] = True
    st.session_state["app3_2_applied_filters"] = FILTER_DEFAULTS.copy()


def reset_saved_filters() -> None:
    save_saved_filters(FILTER_DEFAULTS.copy())


def on_chat_dialog_dismiss_app3_2() -> None:
    st.session_state["chat_open"] = False
    st.session_state["chat_bubble_visible"] = True


def apply_filters(df: pd.DataFrame, filters: dict[str, str]) -> pd.DataFrame:
    out = df.copy()

    if filters.get("region") not in {"", ALL}:
        out = out[out["region"] == filters["region"]]
    if filters.get("target") not in {"", ALL}:
        out = out[out["target_group_tags"].apply(lambda tags: isinstance(tags, list) and filters["target"] in tags)]
    if filters.get("category") not in {"", ALL}:
        out = out[out["category"] == filters["category"]]
    if filters.get("provider") not in {"", ALL}:
        out = out[out["provider"] == filters["provider"]]
    if filters.get("recruitment_status") not in {"", ALL}:
        out = out[out["recruitment_status"] == filters["recruitment_status"]]

    search = str(filters.get("search", "")).strip()
    if search:
        out = out[
            out["title"].str.contains(search, case=False, na=False, regex=False)
            | out["summary"].str.contains(search, case=False, na=False, regex=False)
            | out["region"].str.contains(search, case=False, na=False, regex=False)
            | out["provider"].str.contains(search, case=False, na=False, regex=False)
            | out["target_group_display"].str.contains(search, case=False, na=False, regex=False)
            | out["category"].str.contains(search, case=False, na=False, regex=False)
        ]
    return out


def has_meaningful_saved_filters(filters: dict[str, str]) -> bool:
    return any(str(value).strip() not in {"", ALL} for value in filters.values())


def user_requests_saved_filter(text: str) -> bool:
    normalized = str(text or "").strip()
    return any(keyword in normalized for keyword in SAVED_FILTER_INTENT_KEYWORDS)


def build_saved_filter_query(saved_filters: dict[str, str], user_input: str) -> str:
    parts = [saved_filters.get(key, "") for key in ("region", "target", "category", "provider", "recruitment_status")]
    merged = " ".join(part for part in parts if part and part != ALL)
    return " ".join(part for part in [merged, str(user_input or "").strip()] if part)


def extract_query_filters(user_input: str) -> dict[str, str]:
    text = str(user_input or "").strip()
    found = {
        "region": ALL,
        "target": ALL,
        "recruitment_status": ALL,
    }

    for alias, canonical in REGION_ALIASES.items():
        if alias in text or canonical in text:
            found["region"] = canonical
            break

    for keyword, canonical in TARGET_KEYWORDS.items():
        if keyword in text:
            found["target"] = canonical
            break

    if "모집임박" in text or "마감임박" in text:
        found["recruitment_status"] = "모집임박"
    elif "모집중" in text:
        found["recruitment_status"] = "모집중"
    elif "모집예정" in text:
        found["recruitment_status"] = "모집예정"
    elif "마감" in text:
        found["recruitment_status"] = "마감"

    return found


def apply_query_filters(df: pd.DataFrame, query_filters: dict[str, str]) -> pd.DataFrame:
    narrowed = df.copy()

    region = query_filters.get("region", ALL)
    if region != ALL and "region" in narrowed.columns:
        narrowed = narrowed[narrowed["region"] == region]

    target = query_filters.get("target", ALL)
    if target != ALL and "target_group_tags" in narrowed.columns:
        accepted_terms = TARGET_EXPANSIONS.get(target, [target])
        narrowed = narrowed[
            narrowed["target_group_tags"].apply(
                lambda tags: isinstance(tags, list)
                and any(any(term in str(tag) for term in accepted_terms) for tag in tags)
            )
        ]

    status = query_filters.get("recruitment_status", ALL)
    if status != ALL and "recruitment_status" in narrowed.columns:
        narrowed = narrowed[narrowed["recruitment_status"] == status]

    return narrowed


def has_explicit_query_filters(query_filters: dict[str, str]) -> bool:
    return any(str(value).strip() not in {"", ALL} for value in query_filters.values())


def describe_query_filters(query_filters: dict[str, str]) -> str:
    labels = []
    if query_filters.get("region", ALL) != ALL:
        labels.append(query_filters["region"])
    if query_filters.get("target", ALL) != ALL:
        labels.append(query_filters["target"])
    if query_filters.get("recruitment_status", ALL) != ALL:
        labels.append(query_filters["recruitment_status"])
    return " / ".join(labels)


def rank_chat_results(top_df: pd.DataFrame) -> pd.DataFrame:
    if top_df.empty:
        return top_df
    ranked = top_df.copy()
    if "detail_url_is_fallback" in ranked.columns:
        ranked["detail_rank"] = ranked["detail_url_is_fallback"].astype(int)
    else:
        ranked["detail_rank"] = 0
    if "score" not in ranked.columns:
        ranked["score"] = 0.0
    ranked = ranked.sort_values(["detail_rank", "score"], ascending=[True, False])
    return ranked.drop(columns=["detail_rank"], errors="ignore")


def choose_chat_candidate_df(df: pd.DataFrame, saved_filters: dict[str, str], user_input: str) -> tuple[pd.DataFrame, str, str | None]:
    query_filters = extract_query_filters(user_input)

    if user_requests_saved_filter(user_input):
        if not has_meaningful_saved_filters(saved_filters):
            return df.iloc[0:0].copy(), "", "저장된 내 필터가 아직 없습니다. 먼저 통합검색에서 조건을 고른 뒤 '현재 필터 저장'을 눌러주세요."

        candidate_df = apply_filters(df, saved_filters)
        candidate_df = apply_query_filters(candidate_df, query_filters)
        if candidate_df.empty:
            filter_desc = describe_query_filters(query_filters)
            if filter_desc:
                return candidate_df, "", f"저장된 내 필터와 `{filter_desc}` 조건을 함께 적용했을 때는 현재 맞는 정책이 없습니다. 조건을 조금 넓혀서 다시 찾아보면 좋아요."
            return candidate_df, "", "저장된 내 필터 기준으로는 현재 맞는 정책이 없습니다. 필터를 조금 넓혀서 다시 찾아보면 좋아요."
        return candidate_df, build_saved_filter_query(saved_filters, user_input), None

    candidate_df = apply_query_filters(df, query_filters)
    if candidate_df.empty:
        if has_explicit_query_filters(query_filters):
            filter_desc = describe_query_filters(query_filters)
            return candidate_df, str(user_input or "").strip(), f"현재 `{filter_desc}` 조건으로 보이는 정책은 많지 않습니다. 지금 기준으로 확인되는 정책만 보여드리거나, 조건을 조금 넓혀서 다시 찾는 게 좋아요."
        return df, str(user_input or "").strip(), None
    return candidate_df, str(user_input or "").strip(), None


def render_topbar(version_label: str) -> None:
    st.markdown(
        f"""
        <div class="brand-bar" style="margin-bottom:18px;">
            <div class="brand-name">PolicyRec</div>
            <div class="version-tag">{escape(version_label)}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_sidebar_navigation() -> None:
    with st.sidebar:
        st.markdown("### 메뉴")
        current_page = st.session_state["app3_2_page"]
        if st.button("통합검색", key="app3_2_nav_search", use_container_width=True, type="primary" if current_page == PAGE_SEARCH else "secondary"):
            st.session_state["app3_2_page"] = PAGE_SEARCH
            st.rerun()
        if st.button("내 프로필", key="app3_2_nav_profile", use_container_width=True, type="primary" if current_page == PAGE_PROFILE else "secondary"):
            st.session_state["app3_2_page"] = PAGE_PROFILE
            st.rerun()


def render_filter_chips(filters: dict[str, str]) -> None:
    labels = {
        "region": "지역",
        "target": "대상",
        "category": "분야",
        "provider": "기관",
        "recruitment_status": "모집상태",
        "search": "검색어",
    }
    chips: list[str] = []
    for key, label in labels.items():
        value = str(filters.get(key, "")).strip()
        if value and value != ALL:
            chips.append(f"<span class='tag'>{label}: {escape(value)}</span>")
    if chips:
        st.markdown(f"<div class='chip-row' style='margin-bottom:12px;'>{''.join(chips)}</div>", unsafe_allow_html=True)


def build_personalized_examples(saved_filters: dict[str, str]) -> list[str]:
    region = saved_filters.get("region", ALL)
    target = saved_filters.get("target", ALL)
    category = saved_filters.get("category", ALL)
    status = saved_filters.get("recruitment_status", ALL)

    region_part = region if region != ALL else "서울"
    target_part = target if target != ALL else "청년"
    category_part = category if category != ALL else "창업"
    status_part = status if status != ALL else "모집중"

    return [
        f"{region_part} {target_part} {category_part} 지원사업 알려줘",
        f"{target_part} 대상 {status_part} 정책 추천해줘",
        f"{region_part}에서 신청 가능한 {category_part} 공고 보여줘",
    ]


def render_search_filters(df: pd.DataFrame) -> dict[str, str]:
    saved_filters = st.session_state["app3_2_saved_filters"]
    options = get_filter_options(df)

    if st.session_state.get("app3_2_pending_reset_saved_toggle", False):
        sync_search_widgets(FILTER_DEFAULTS.copy())
        st.session_state["app3_2_use_saved_filters"] = False
        st.session_state["app3_2_use_saved_filters_prev"] = False
        st.session_state["app3_2_pending_reset_saved_toggle"] = False

    load_saved = st.checkbox("내 필터 불러오기", key="app3_2_use_saved_filters", help="저장된 내 필터를 현재 검색창에 반영합니다.")
    if load_saved != st.session_state["app3_2_use_saved_filters_prev"]:
        if load_saved:
            sync_search_widgets(saved_filters)
            st.session_state["app3_2_applied_filters"] = saved_filters.copy()
        st.session_state["app3_2_use_saved_filters_prev"] = load_saved
        st.rerun()

    st.markdown('<div class="filter-shell">', unsafe_allow_html=True)
    with st.form("app3_2_search_form", clear_on_submit=False):
        col_search, col_region, col_target = st.columns([2.1, 1, 1], gap="small")
        with col_search:
            st.text_input("검색어 입력", placeholder="사업명, 요약, 기관, 지역 검색", key="app3_2_filter_search")
        with col_region:
            st.selectbox("지역 선택", options["region"], key="app3_2_filter_region")
        with col_target:
            st.selectbox("대상 선택", options["target"], key="app3_2_filter_target")

        col_category, col_provider, col_status = st.columns([1, 1.2, 1], gap="small")
        with col_category:
            st.selectbox("분야 선택", options["category"], key="app3_2_filter_category")
        with col_provider:
            st.selectbox("기관 선택", options["provider"], key="app3_2_filter_provider")
        with col_status:
            st.selectbox("모집 상태", options["recruitment_status"], key="app3_2_filter_recruitment_status")

        action_a, action_b, action_c = st.columns([1, 1, 1], gap="small")
        with action_a:
            submit_search = st.form_submit_button("검색", use_container_width=True, type="primary")
        with action_b:
            save_current = st.form_submit_button("현재 필터 저장", use_container_width=True)
        with action_c:
            reset_filters = st.form_submit_button("초기화", use_container_width=True)
    st.markdown("</div>", unsafe_allow_html=True)

    current_filters = get_search_widget_filters()
    if submit_search:
        st.session_state["app3_2_applied_filters"] = current_filters.copy()
    if save_current:
        save_saved_filters(current_filters.copy())
        st.toast("현재 필터를 저장했어요.")
    if reset_filters:
        reset_search_filters()
        st.rerun()

    return st.session_state["app3_2_applied_filters"]


def render_profile_page(df: pd.DataFrame) -> None:
    saved_filters = st.session_state["app3_2_saved_filters"]
    st.markdown("### 내 프로필")
    st.caption("저장된 내 필터와 스크랩한 정책을 확인할 수 있습니다.")

    title_col, action_col = st.columns([6, 1], gap="small")
    with title_col:
        st.markdown("#### 저장된 내 필터")
    with action_col:
        if st.button("초기화", key="app3_2_reset_saved_filters", use_container_width=True):
            reset_saved_filters()
            st.toast("저장된 내 필터를 초기화했어요.")
            st.rerun()

    render_filter_chips(saved_filters)
    if not has_meaningful_saved_filters(saved_filters):
        st.info("아직 저장된 내 필터가 없습니다. 통합검색에서 조건을 고른 뒤 '현재 필터 저장'을 눌러보세요.")

    st.markdown("#### 스크랩한 정책")
    scraped_ids = set(st.session_state.scraps.keys())
    scraped_df = df[df["row_id"].astype(str).isin(scraped_ids)]
    render_card_grid(scraped_df, empty_text="스크랩한 정책이 아직 없습니다.", context_key="profile-scrap")


def render_supabase_status(raw_df: pd.DataFrame, total_count: int | None) -> None:
    with st.sidebar.expander("개발자 도구", expanded=False):
        show_admin = st.checkbox("Supabase 상태 보기", key="app3_2_show_admin_panel")
        if not show_admin:
            st.caption("프로토타입에서는 기본적으로 숨겨둡니다.")
            return

        if raw_df.empty:
            st.warning("불러온 데이터가 없습니다.")
            return

        st.success("연결 완료")
        st.caption(f"테이블: {SUPABASE_TABLE}")
        st.caption(f"불러온 행 수: {len(raw_df):,}")
        if total_count is not None:
            st.caption(f"DB 전체 행 수: {total_count:,}")

        if st.button("DB 새로고침", key="app3_2_refresh_db", use_container_width=True):
            fetch_supabase_rows.clear()
            st.rerun()

        preview_columns = [col for col in ["source", "title", "category", "region", "target_group", "detail_url", "updated_at"] if col in raw_df.columns]
        st.dataframe(raw_df[preview_columns].head(20), use_container_width=True, hide_index=True)


def inject_app3_2_styles() -> None:
    st.markdown(
        """
        <style>
            div[data-testid="stDialog"] > div[role="dialog"] {
                min-height: 78vh;
            }
            div[data-testid="stChatInput"] {
                position: sticky;
                bottom: 0;
                background: #FFFFFF;
                padding-top: 8px;
            }
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_chat_policy_item(policy: dict[str, Any], key_prefix: str) -> None:
    row_id = str(policy.get("row_id", "")).strip()
    title = str(policy.get("title", "")).strip()
    provider = str(policy.get("provider", "")).strip()
    region = str(policy.get("region", "")).strip()
    category = str(policy.get("category", "")).strip()
    source_name = str(policy.get("source_name", "")).strip()
    detail_link = str(policy.get("resolved_detail_url", policy.get("detail_url", ""))).strip()
    is_fallback = bool(policy.get("detail_url_is_fallback", False))
    target_display = str(policy.get("target_group_display", "")).strip()
    target_age = str(policy.get("target_age", "")).strip()
    end_date = str(policy.get("end_date", "")).strip()
    dday_text = str(policy.get("dday_text", "")).strip()
    source = str(policy.get("source", "")).strip()
    is_scraped = row_id in st.session_state.scraps if row_id else False

    badge_bg, badge_text = SOURCE_BADGE_STYLES.get(source, (BG_LIGHT, SLATE_TEXT))
    safe_key = make_widget_key(f"{key_prefix}_{row_id}")

    with st.container(key=f"app3_2_chat_policy_{safe_key}", border=True):
        top_col, action_col = st.columns([8, 1], gap="small")
        with top_col:
            st.markdown(
                f"""
                <div class="chip-row">
                    <span class="tag" style="background:{badge_bg}; color:{badge_text};">{escape(source_name)}</span>
                    <span class="tag">{escape(category)}</span>
                    <span class="tag">{escape(dday_text)}</span>
                </div>
                """,
                unsafe_allow_html=True,
            )
        with action_col:
            if row_id and st.button("★" if is_scraped else "☆", key=f"app3_2_chat_scrap_{safe_key}", help="스크랩"):
                toggle_scrap(row_id, title, source_name, detail_link)
                st.rerun()

        st.markdown(f"**{escape(title)}**")
        meta = " / ".join(part for part in [provider, region, target_display, target_age, end_date] if part)
        if meta:
            st.caption(meta)
        if detail_link:
            link_label = "상세 공고 보기" if not is_fallback else "검색 링크 보기"
            st.markdown(f'<a href="{escape(detail_link, quote=True)}" target="_blank">{link_label}</a>', unsafe_allow_html=True)


def render_chat_history_block(history: list[dict[str, Any]]) -> None:
    with st.container(height=420, border=True):
        if not history:
            with st.chat_message("assistant"):
                st.markdown("안녕하세요! PolicyRec입니다. 지역, 대상, 분야 같은 조건이나 원하는 정책을 자연어로 편하게 물어보세요.")

        for msg_idx, msg in enumerate(history):
            with st.chat_message(msg["role"]):
                st.markdown(msg["content"])
                for idx, policy in enumerate(msg.get("policies", [])):
                    render_chat_policy_item(policy, f"hist-{msg_idx}-{idx}")


@st.dialog("PolicyRec 챗봇", width="large", on_dismiss=on_chat_dialog_dismiss_app3_2)
def chatbot_dialog_app3_2(df: pd.DataFrame, client, saved_filters: dict[str, str]) -> None:
    history_key = "app3_2_chat_history"
    history = st.session_state[history_key]
    examples = build_personalized_examples(saved_filters)

    col_hint, col_reset, col_close = st.columns([3, 1, 1])
    with col_hint:
        st.caption("정책 추천이나 조건 기반 탐색을 자연어로 물어보세요.")
    with col_reset:
        if st.button("대화 초기화", key="app3_2_reset_chat", use_container_width=True):
            st.session_state[history_key] = []
            st.rerun()
    with col_close:
        if st.button("닫기", key="app3_2_close_chat", use_container_width=True):
            st.session_state["chat_open"] = False
            st.session_state["chat_bubble_visible"] = True
            st.rerun()

    pills = "".join(f"<span class='tag'>{escape(text)}</span>" for text in examples)
    st.markdown("##### 챗봇 질문 예시")
    st.markdown(f"<div class='chip-row' style='margin-bottom:14px;'>{pills}</div>", unsafe_allow_html=True)

    render_chat_history_block(history)

    user_input = st.chat_input("예: 서울 청년 창업 지원사업 알려줘")
    if user_input:
        history.append({"role": "user", "content": user_input})
        st.rerun()

    if not history or history[-1]["role"] != "user":
        return

    last_user = history[-1]["content"]
    top_policies: list[dict[str, Any]] = []

    quick_reply = get_smalltalk_reply(last_user)
    if quick_reply is not None:
        response_text = quick_reply
    else:
        candidate_df, query_text, warning_message = choose_chat_candidate_df(df, saved_filters, last_user)
        if warning_message is not None:
            response_text = warning_message
        elif candidate_df.empty:
            response_text = "조건에 맞는 정책을 찾지 못했어요. 지역이나 대상을 조금 넓혀보면 더 잘 찾을 수 있어요."
        else:
            candidate_texts = tuple(candidate_df.apply(build_search_text, axis=1).tolist())
            candidate_vectorizer, candidate_matrix = build_vectorizer(candidate_texts)
            top_df = search_top5_tfidf(candidate_df, candidate_vectorizer, candidate_matrix, query_text)
            top_df = rank_chat_results(top_df)

            if is_low_confidence(top_df):
                response_text = "원하는 정책을 더 정확히 찾을 수 있도록 지역, 대상, 분야를 함께 적어주세요."
            else:
                top_policies = [
                    {
                        "row_id": row.get("row_id", ""),
                        "source_name": row.get("source_name", ""),
                        "title": row.get("title", ""),
                        "summary": row.get("summary", ""),
                        "source": row.get("source", ""),
                        "provider": row.get("provider", ""),
                        "region": row.get("region", ""),
                        "category": row.get("category", ""),
                        "target_group_display": row.get("target_group_display", ""),
                        "target_age": row.get("target_age", ""),
                        "end_date": format_date(row.get("apply_end")),
                        "dday_text": d_day_label(row.get("apply_end")),
                        "detail_url": row.get("detail_url", ""),
                        "resolved_detail_url": row.get("resolved_detail_url", row.get("detail_url", "")),
                        "detail_url_is_fallback": bool(row.get("detail_url_is_fallback", False)),
                    }
                    for _, row in top_df.iterrows()
                ]
                with st.spinner("추천 내용을 정리하고 있어요..."):
                    response_text = generate_chat_response(client, history, top_df)

    history.append({"role": "assistant", "content": response_text, "policies": top_policies})
    st.rerun()


def render_search_page(policy_df: pd.DataFrame) -> None:
    st.markdown(
        """
        <div class="hero">
            <div class="hero-title">나에게 맞는 정책과 지원사업을 찾아보세요</div>
            <div class="hero-sub">Supabase 기반 정책 데이터를 토대로 지역, 대상, 분야, 기관을 탐색합니다.</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    applied_filters = render_search_filters(policy_df)
    render_filter_chips(applied_filters)
    filtered = apply_filters(policy_df, applied_filters)

    st.markdown(
        f"""
        <div class="result-head">
            <div class="result-title">검색 결과</div>
            <div class="result-count">총 {len(filtered):,}건</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    render_card_grid(filtered, empty_text="검색 결과가 없습니다.", context_key="search-page")


def main() -> None:
    inject_styles()
    inject_app3_2_styles()
    ensure_session()
    ensure_app3_2_session()

    if create_client is None:
        st.error("`supabase` 패키지가 없습니다. `pip install -r requirements.txt` 후 다시 실행해주세요.")
        st.stop()

    supabase_url, supabase_key = get_supabase_credentials()
    if not supabase_url or not supabase_key:
        st.error("`.env`에 `SUPABASE_URL`과 `SUPABASE_SERVICE_KEY`를 설정해주세요.")
        st.stop()

    try:
        get_supabase_client(supabase_url, supabase_key)
        rows, total_count = fetch_supabase_rows(supabase_url, supabase_key, SUPABASE_TABLE)
    except Exception as exc:
        st.error("Supabase 데이터를 불러오는 중 오류가 발생했습니다.")
        st.exception(exc)
        st.stop()

    raw_df = pd.DataFrame(rows)
    render_sidebar_navigation()
    render_supabase_status(raw_df, total_count)

    if raw_df.empty:
        st.warning("Supabase announcements 테이블에 데이터가 없습니다.")
        st.stop()

    policy_df = prepare_policy_dataframe(raw_df)
    version_label = build_version_label(raw_df)
    client = get_genai_client()

    icon_b64 = load_chat_icon_b64()
    inject_chat_icon(icon_b64)
    render_topbar(version_label)

    if st.session_state["app3_2_page"] == PAGE_SEARCH:
        render_search_page(policy_df)
    else:
        render_profile_page(policy_df)

    with st.container(key="chatbot_fab"):
        if st.button(" ", key="chat_fab_btn", help="챗봇 열기"):
            st.session_state["chat_open"] = True
            st.session_state["chat_bubble_visible"] = False
            st.rerun()

    if st.session_state.get("chat_open", False):
        chatbot_dialog_app3_2(policy_df, client, st.session_state["app3_2_saved_filters"])


if __name__ == "__main__":
    main()
