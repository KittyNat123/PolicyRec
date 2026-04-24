from __future__ import annotations

import os
from typing import Any

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

try:
    from supabase import Client, create_client
except ModuleNotFoundError:  # pragma: no cover
    Client = Any  # type: ignore[assignment]
    create_client = None

from streamlit_app import ensure_normalized_columns, normalize_for_display, unique_options
from streamlit_app2 import (
    build_search_text,
    build_vectorizer,
    chatbot_dialog,
    ensure_session,
    get_genai_client,
    inject_chat_icon,
    inject_styles,
    load_chat_icon_b64,
    render_brand,
    render_card_grid,
    render_chat_bubble,
    render_hero,
    resolve_detail_url,
)

load_dotenv()


SUPABASE_TABLE = "announcements"
SUPABASE_PAGE_SIZE = 1000
SUPABASE_CACHE_TTL = 300

FILTER_DEFAULTS = {
    "search": "",
    "region": "?꾩껜",
    "target": "?꾩껜",
    "category": "?꾩껜",
    "provider": "?꾩껜",
    "recruitment_status": "?꾩껜",
}


def get_supabase_credentials() -> tuple[str, str]:
    """Supabase ?묒냽???꾩슂??URL怨?KEY瑜??쎈뒗??"""
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_KEY", "").strip() or os.getenv("SUPABASE_ANON_KEY", "").strip()
    return url, key


@st.cache_resource
def get_supabase_client(url: str, key: str) -> Client:
    """???꾩껜?먯꽌 ?ъ궗?⑺븷 Supabase ?대씪?댁뼵?몃? 留뚮뱺??"""
    if create_client is None:
        raise ModuleNotFoundError("supabase package is not installed")
    return create_client(url, key)


@st.cache_data(ttl=SUPABASE_CACHE_TTL, show_spinner=False)
def fetch_supabase_rows(url: str, key: str, table_name: str = SUPABASE_TABLE) -> tuple[list[dict[str, Any]], int | None]:
    """
    announcements ?뚯씠釉붿쓣 ?섏씠吏 ?⑥쐞濡??쎌뼱? ?섎굹??由ъ뒪?몃줈 ?⑹튇??
    Streamlit rerun????린 ?뚮Ц??罹먯떆瑜??먯뼱 怨쇳븳 ?몄텧??以꾩씤??
    """
    if create_client is None:
        raise ModuleNotFoundError("supabase package is not installed")

    client = create_client(url, key)
    select_columns = ",".join(
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
            .select(select_columns, count="exact")
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


def ensure_app3_session() -> None:
    """app3 ?꾩슜 ?몄뀡 ?곹깭瑜?珥덇린?뷀븳??"""
    if "app3_show_admin_panel" not in st.session_state:
        st.session_state.app3_show_admin_panel = False
    if "app3_saved_filters" not in st.session_state:
        st.session_state.app3_saved_filters = FILTER_DEFAULTS.copy()
    if "app3_applied_filters" not in st.session_state:
        st.session_state.app3_applied_filters = FILTER_DEFAULTS.copy()
    if "app3_use_saved_filters" not in st.session_state:
        st.session_state.app3_use_saved_filters = False
    if "app3_use_saved_filters_prev" not in st.session_state:
        st.session_state.app3_use_saved_filters_prev = False

    widget_defaults = {
        "app3_filter_search": FILTER_DEFAULTS["search"],
        "app3_filter_region": FILTER_DEFAULTS["region"],
        "app3_filter_target": FILTER_DEFAULTS["target"],
        "app3_filter_category": FILTER_DEFAULTS["category"],
        "app3_filter_provider": FILTER_DEFAULTS["provider"],
        "app3_filter_recruitment_status": FILTER_DEFAULTS["recruitment_status"],
    }
    for key, default_value in widget_defaults.items():
        if key not in st.session_state:
            st.session_state[key] = default_value


def build_supabase_version_label(raw_df: pd.DataFrame) -> str:
    """理쒖떊 updated_at??湲곗??쇰줈 DB ?숆린???쒖젏??蹂댁뿬以??"""
    if raw_df.empty or "updated_at" not in raw_df.columns:
        return "v1.2.x (Supabase)"

    updated_series = pd.to_datetime(raw_df["updated_at"], errors="coerce")
    latest = updated_series.max()
    if pd.isna(latest):
        return "v1.2.x (Supabase)"

    return f"v1.2.x (Supabase) / {latest.strftime('%Y-%m-%d %H:%M')} sync"


def resolve_recruitment_status(row: pd.Series) -> str:
    """
    start/end_date瑜?諛뷀깢?쇰줈 紐⑥쭛 ?곹깭瑜?怨꾩궛?쒕떎.
    '紐⑥쭛?덉젙'???곕줈 ?먮뒗 ?댁쑀??誘몃옒 怨듦퀬瑜?紐⑥쭛以묒쑝濡?蹂댁씠寃??섏? ?딄린 ?꾪빐?쒕떎.
    """
    today = pd.Timestamp.now().date()
    start_date = pd.to_datetime(row.get("apply_start"), errors="coerce")
    end_date = pd.to_datetime(row.get("apply_end"), errors="coerce")

    start_day = start_date.date() if pd.notna(start_date) else None
    end_day = end_date.date() if pd.notna(end_date) else None

    if end_day is not None and end_day < today:
        return "留덇컧"
    if start_day is not None and start_day > today:
        return "紐⑥쭛?덉젙"
    if end_day is not None:
        days_left = (end_day - today).days
        if 0 <= days_left <= 7:
            return "紐⑥쭛?꾨컯"
        return "紐⑥쭛以?
    return "紐⑥쭛以?


def prepare_policy_dataframe(raw_df: pd.DataFrame) -> pd.DataFrame:
    """
    Supabase row瑜?app2 UI媛 洹몃?濡??ъ슜?????덈뒗 ?쒖떆??DataFrame?쇰줈 諛붽씔??
    利? ?곗씠???뚯뒪??DB濡?諛붽씀???붾㈃ 援ъ“??app2瑜?理쒕????좎??쒕떎.
    """
    normalized_df = ensure_normalized_columns(raw_df.copy())
    display_df = normalize_for_display(normalized_df).copy()

    if "source_id" in normalized_df.columns:
        display_df["source_id"] = normalized_df["source_id"].fillna("").astype(str).tolist()
    else:
        display_df["source_id"] = ""

    if "source_file" in normalized_df.columns:
        display_df["source_file"] = normalized_df["source_file"].fillna("").astype(str).tolist()
    else:
        display_df["source_file"] = ""

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


def get_current_filter_inputs() -> dict[str, str]:
    """?꾩옱 ?꾪꽣 ?낅젰李쎌쓽 媛믪쓣 ?쎈뒗??"""
    return {
        "search": str(st.session_state.get("app3_filter_search", "")).strip(),
        "region": str(st.session_state.get("app3_filter_region", "?꾩껜")),
        "target": str(st.session_state.get("app3_filter_target", "?꾩껜")),
        "category": str(st.session_state.get("app3_filter_category", "?꾩껜")),
        "provider": str(st.session_state.get("app3_filter_provider", "?꾩껜")),
        "recruitment_status": str(st.session_state.get("app3_filter_recruitment_status", "?꾩껜")),
    }


def sync_filter_widgets(values: dict[str, str]) -> None:
    """??ν븳 ?꾪꽣 媛믪쓣 ?붾㈃ ?꾩젽??諛섏쁺?쒕떎."""
    st.session_state["app3_filter_search"] = values.get("search", FILTER_DEFAULTS["search"])
    st.session_state["app3_filter_region"] = values.get("region", FILTER_DEFAULTS["region"])
    st.session_state["app3_filter_target"] = values.get("target", FILTER_DEFAULTS["target"])
    st.session_state["app3_filter_category"] = values.get("category", FILTER_DEFAULTS["category"])
    st.session_state["app3_filter_provider"] = values.get("provider", FILTER_DEFAULTS["provider"])
    st.session_state["app3_filter_recruitment_status"] = values.get(
        "recruitment_status",
        FILTER_DEFAULTS["recruitment_status"],
    )


def ensure_widget_value_in_options(widget_key: str, options: list[str], default: str = "?꾩껜") -> None:
    """??λ맂 ?꾪꽣 媛믪씠 ?꾩옱 ?듭뀡???놁쑝硫??덉쟾?섍쾶 湲곕낯媛믪쑝濡??섎룎由곕떎."""
    current_value = str(st.session_state.get(widget_key, default))
    if current_value not in options:
        st.session_state[widget_key] = default


def apply_app3_filters(df: pd.DataFrame, filters: dict[str, str]) -> pd.DataFrame:
    """寃??踰꾪듉?쇰줈 ?뺤젙???꾪꽣留??곸슜?쒕떎."""
    out = df.copy()

    region = filters.get("region", "?꾩껜")
    target = filters.get("target", "?꾩껜")
    category = filters.get("category", "?꾩껜")
    provider = filters.get("provider", "?꾩껜")
    recruitment_status = filters.get("recruitment_status", "?꾩껜")
    search = filters.get("search", "").strip()

    if region != "?꾩껜":
        out = out[out["region"] == region]
    if target != "?꾩껜":
        out = out[out["target_group_tags"].apply(lambda tags: isinstance(tags, list) and target in tags)]
    if category != "?꾩껜":
        out = out[out["category"] == category]
    if provider != "?꾩껜":
        out = out[out["provider"] == provider]
    if recruitment_status != "?꾩껜":
        out = out[out["recruitment_status"] == recruitment_status]
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


def render_filter_bar_app3(df: pd.DataFrame) -> dict[str, str]:
    """
    ?ъ슜?먯슜 ?꾪꽣 諛?
    - 寃?됱? 踰꾪듉???뚮??????곸슜
    - '???꾪꽣 遺덈윭?ㅺ린'??泥댄겕 利됱떆 ??λ맂 議곌굔???곸슜
    """
    saved_filters = st.session_state.app3_saved_filters

    load_saved = st.checkbox(
        "???꾪꽣 遺덈윭?ㅺ린",
        key="app3_use_saved_filters",
        help="??ν빐 ??媛쒖씤 ?꾪꽣瑜??꾩옱 寃??議곌굔??諛붾줈 ?곸슜?⑸땲??",
    )

    if load_saved != st.session_state.app3_use_saved_filters_prev:
        if load_saved:
            sync_filter_widgets(saved_filters)
            st.session_state.app3_applied_filters = saved_filters.copy()
        st.session_state.app3_use_saved_filters_prev = load_saved
        st.rerun()

    region_options = ["?꾩껜"] + unique_options(df, "region", {"吏??誘명솗??})
    target_options = ["?꾩껜"] + unique_options(df, "target_group_tags", {"???誘명솗??})
    category_options = ["?꾩껜"] + unique_options(df, "category", {"遺꾨쪟 誘몄젙"})
    provider_options = ["?꾩껜"] + unique_options(df, "provider", {"湲곌? 誘명솗??})
    recruitment_options = ["?꾩껜", "紐⑥쭛以?, "紐⑥쭛?꾨컯", "留덇컧", "紐⑥쭛?덉젙"]

    ensure_widget_value_in_options("app3_filter_region", region_options)
    ensure_widget_value_in_options("app3_filter_target", target_options)
    ensure_widget_value_in_options("app3_filter_category", category_options)
    ensure_widget_value_in_options("app3_filter_provider", provider_options)
    ensure_widget_value_in_options("app3_filter_recruitment_status", recruitment_options)

    st.markdown('<div class="filter-shell">', unsafe_allow_html=True)
    with st.form("app3_filter_form", clear_on_submit=False):
        col_search, col_region, col_target = st.columns([2.1, 1, 1], gap="small")
        with col_search:
            st.text_input(
                "寃?됱뼱 ?낅젰",
                placeholder="?ъ뾽紐? ?붿빟, 湲곌?, 吏??寃??,
                key="app3_filter_search",
            )
        with col_region:
            st.selectbox("吏???좏깮", region_options, key="app3_filter_region")
        with col_target:
            st.selectbox("????좏깮", target_options, key="app3_filter_target")

        col_category, col_provider, col_status = st.columns([1, 1.2, 1], gap="small")
        with col_category:
            st.selectbox("遺꾩빞 ?좏깮", category_options, key="app3_filter_category")
        with col_provider:
            st.selectbox("湲곌? ?좏깮", provider_options, key="app3_filter_provider")
        with col_status:
            st.selectbox("紐⑥쭛 ?곹깭", recruitment_options, key="app3_filter_recruitment_status")

        action_col1, action_col2, action_col3 = st.columns([1, 1, 1], gap="small")
        with action_col1:
            submit_search = st.form_submit_button("寃??, use_container_width=True, type="primary")
        with action_col2:
            save_filters = st.form_submit_button("?꾩옱 ?꾪꽣 ???, use_container_width=True)
        with action_col3:
            reset_filters = st.form_submit_button("珥덇린??, use_container_width=True)
    st.markdown("</div>", unsafe_allow_html=True)

    current_filters = get_current_filter_inputs()

    if save_filters:
        st.session_state.app3_saved_filters = current_filters.copy()
        st.toast("?꾩옱 ?꾪꽣瑜???ν뻽?댁슂.")

    if reset_filters:
        st.session_state.app3_use_saved_filters = False
        st.session_state.app3_use_saved_filters_prev = False
        sync_filter_widgets(FILTER_DEFAULTS.copy())
        st.session_state.app3_applied_filters = FILTER_DEFAULTS.copy()
        st.rerun()

    if submit_search:
        st.session_state.app3_applied_filters = current_filters.copy()

    return st.session_state.app3_applied_filters


def render_supabase_status(raw_df: pd.DataFrame, total_count: int | None) -> None:
    """
    媛쒕컻/愿由ъ옄 ?뺤씤???⑤꼸.
    ?ъ슜???붾㈃ 湲곗??쇰줈???④린怨? ?꾨줈?좏????먭????꾩슂???뚮쭔 ?곕떎.
    """
    with st.sidebar.expander("媛쒕컻???꾧뎄", expanded=False):
        show_admin = st.checkbox(
            "Supabase ?곹깭 蹂닿린",
            key="app3_show_admin_panel",
            help="DB ?곌껐 ?곹깭? ?섑뵆 row瑜??뺤씤?섎뒗 寃?섏슜 ?⑤꼸?낅땲??",
        )

        if not show_admin:
            st.caption("?ъ슜???붾㈃?먯꽌???④꺼 ?먮뒗 ?뺣낫?낅땲??")
            return

        if raw_df.empty:
            st.warning("?꾩옱 遺덈윭???뺤콉 ?곗씠?곌? ?놁뒿?덈떎.")
            return

        st.success("?곌껐 ?꾨즺")
        st.caption(f"?뚯씠釉? {SUPABASE_TABLE}")
        st.caption(f"遺덈윭?????? {len(raw_df):,}")
        if total_count is not None:
            st.caption(f"DB 珥????? {total_count:,}")

        if st.button("DB ?덈줈怨좎묠", use_container_width=True):
            fetch_supabase_rows.clear()
            st.rerun()

        preview_columns = [
            column
            for column in ["source", "title", "category", "region", "target_group", "detail_url", "updated_at"]
            if column in raw_df.columns
        ]
        st.dataframe(raw_df[preview_columns].head(20), use_container_width=True, hide_index=True)


def main() -> None:
    inject_styles()
    ensure_session()
    ensure_app3_session()

    if create_client is None:
        st.error("`supabase` ?⑦궎吏媛 ?ㅼ튂?섏뼱 ?덉? ?딆뒿?덈떎. `pip install -r requirements.txt` ???ㅼ떆 ?ㅽ뻾??二쇱꽭??")
        st.stop()

    supabase_url, supabase_key = get_supabase_credentials()
    if not supabase_url or not supabase_key:
        st.error("Supabase ?섍꼍 蹂?섍? 鍮꾩뼱 ?덉뒿?덈떎. .env??SUPABASE_URL / SUPABASE_SERVICE_KEY瑜??뺤씤??二쇱꽭??")
        st.stop()

    try:
        get_supabase_client(supabase_url, supabase_key)
        rows, total_count = fetch_supabase_rows(supabase_url, supabase_key, SUPABASE_TABLE)
    except Exception as exc:
        st.error("Supabase?먯꽌 ?뺤콉 ?곗씠?곕? ?쎌? 紐삵뻽?듬땲??")
        st.exception(exc)
        st.stop()

    raw_df = pd.DataFrame(rows)
    render_supabase_status(raw_df, total_count)

    if raw_df.empty:
        st.warning("Supabase announcements ?뚯씠釉붿? ?곌껐?섏뿀吏留??쒖떆???곗씠?곌? ?놁뒿?덈떎.")
        st.stop()

    policy_df = prepare_policy_dataframe(raw_df)
    version_label = build_supabase_version_label(raw_df)

    texts = tuple(policy_df.apply(build_search_text, axis=1).tolist())
    vectorizer, matrix = build_vectorizer(texts)
    client = get_genai_client()

    icon_b64 = load_chat_icon_b64()
    inject_chat_icon(icon_b64)

    render_brand(version_label)

    tab_search, tab_scrap = st.tabs(["?뺤콉 寃??, f"?ㅽ겕??({len(st.session_state.scraps)})"])

    with tab_search:
        render_hero()
        applied_filters = render_filter_bar_app3(policy_df)
        filtered = apply_app3_filters(policy_df, applied_filters)

        st.markdown(
            f"""
            <div class="result-head">
                <div class="result-title">Supabase 湲곕컲 ?뺤콉 ?먯깋 寃곌낵</div>
                <div class="result-count">珥?{len(filtered):,}嫄?/div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        render_card_grid(filtered, context_key="supabase-search-tab")

    with tab_scrap:
        scraped_ids = set(st.session_state.scraps.keys())
        scraped_df = policy_df[policy_df["row_id"].astype(str).isin(scraped_ids)]
        st.markdown(
            f"""
            <div class="result-head">
                <div class="result-title">?ㅽ겕?⑺븳 ?뺤콉</div>
                <div class="result-count">珥?{len(scraped_df):,}嫄?/div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        render_card_grid(
            scraped_df,
            empty_text="?ㅽ겕?⑺븳 ?뺤콉???놁뒿?덈떎.",
            context_key="supabase-scrap-tab",
        )

    render_chat_bubble()

    with st.container(key="chatbot_fab"):
        if st.button(" ", key="chat_fab_btn", help="梨쀫큸 ?닿린"):
            st.session_state.chat_open = True
            st.session_state.chat_bubble_visible = False
            st.rerun()

    if st.session_state.get("chat_open", False):
        chatbot_dialog(policy_df, vectorizer, matrix, client)


if __name__ == "__main__":
    main()

