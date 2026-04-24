from __future__ import annotations

import base64
import os
import time
from html import escape
from pathlib import Path
from urllib.parse import quote_plus, urlparse

import pandas as pd
import streamlit as st
from dotenv import load_dotenv
from google import genai
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from streamlit_app import (
    d_day_label,
    format_date,
    load_policy_data,
    resolve_csv_path,
    unique_options,
    version_label_from_path,
)

load_dotenv()

st.set_page_config(page_title="PolicyRec", page_icon="🔎", layout="wide")


# ============================================================
# Modern & Minimal 팔레트
# ============================================================
SLATE_TEXT = "#4A5568"       # 주요 텍스트 / 프레임
BODY_TEXT = "#718096"        # 본문 / 보조 텍스트
POINT_PURPLE = "#805AD5"     # 포인트 액션
POINT_PURPLE_DEEP = "#6B46C1"
BG_WHITE = "#FFFFFF"
BG_LIGHT = "#F7FAFC"         # 섹션 / 카드 내부 구분
BORDER_LIGHT = "#E2E8F0"
TAG_BG = "#F3E8FF"           # 연한 퍼플 (태그 배경)

# source별 배지 — 저채도 소프트 톤
SOURCE_BADGE_STYLES = {
    "biz": ("#EDF2F7", SLATE_TEXT),
    "kst": ("#F3E8FF", POINT_PURPLE),
    "youth": ("#EBF4FF", "#3182CE"),
}

MIN_POLICY_SCORE = 0.08

POLICY_INTENT_KEYWORDS = (
    "정책",
    "지원",
    "지원금",
    "사업",
    "공고",
    "모집",
    "신청",
    "자격",
    "청년",
    "창업",
    "취업",
    "교육",
    "대출",
    "기업",
)

GREETING_KEYWORDS = (
    "안녕",
    "안녕하세요",
    "반가워",
    "반가워요",
    "하이",
    "hello",
    "hi",
    "ㅎㅇ",
)

THANKS_KEYWORDS = ("고마워", "감사", "thanks", "thx")

HELP_KEYWORDS = (
    "도움말",
    "사용법",
    "뭐 할 수",
    "무엇을 할 수",
    "뭘 물어봐",
    "예시",
)


# ============================================================
# 챗봇용 헬퍼 (proto_streamlit_app.py 로직 재사용)
# ============================================================
def build_search_text(row: pd.Series) -> str:
    parts = [str(row.get(c, "")) for c in ["title", "summary", "category", "region", "target_group"]]
    return " ".join(p for p in parts if p and p != "nan")


@st.cache_resource
def build_vectorizer(texts_tuple: tuple[str, ...]):
    texts = list(texts_tuple)
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4))
    matrix = vec.fit_transform(texts)
    return vec, matrix


@st.cache_resource
def get_genai_client():
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return None
    return genai.Client(api_key=key)


@st.cache_data
def load_chat_icon_b64() -> str | None:
    """챗봇 아이콘 PNG를 base64로 인코딩해 CSS background로 꽂기 위함."""
    candidates = [
        Path("chatbot_icon.png"),
        Path("권희민") / "chatbot_icon.png",
    ]
    for path in candidates:
        if path.exists():
            return base64.b64encode(path.read_bytes()).decode()
    return None


def search_top5_tfidf(df: pd.DataFrame, vectorizer, matrix, query: str) -> pd.DataFrame:
    query = str(query or "").strip()
    if not query:
        return df.iloc[0:0].copy()

    q_vec = vectorizer.transform([query])
    scores = cosine_similarity(q_vec, matrix)[0]
    top_idx = scores.argsort()[::-1][:5]
    return df.iloc[top_idx].assign(score=scores[top_idx])


def _safe_text(value) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def _normalize_query(text: str) -> str:
    return " ".join(str(text or "").strip().lower().split())


def _has_policy_intent(text: str) -> bool:
    q = _normalize_query(text)
    return any(keyword in q for keyword in POLICY_INTENT_KEYWORDS)


def get_smalltalk_reply(user_text: str) -> str | None:
    """
    검색 의도가 아닌 일반 대화(인사/감사/도움말)를 먼저 처리해서
    챗봇이 더 자연스럽게 보이도록 하는 규칙 기반 응답.
    """
    q = _normalize_query(user_text)
    if not q:
        return "궁금한 정책을 자유롭게 물어보세요. 예: 서울 청년 창업 지원"

    has_intent = _has_policy_intent(q)
    if any(k in q for k in GREETING_KEYWORDS) and not has_intent and len(q) <= 20:
        return (
            "안녕하세요! 반가워요. "
            "지역·대상·분야 중 하나만 알려주시면 바로 정책을 찾아드릴게요. "
            "예: 서울 청년 창업 지원"
        )

    if any(k in q for k in THANKS_KEYWORDS) and not has_intent:
        return "천만에요. 원하는 조건을 한 줄로 알려주시면 바로 이어서 찾아드릴게요."

    if any(k in q for k in HELP_KEYWORDS):
        return (
            "저는 정책 검색 도우미예요. "
            "지역, 대상, 분야, 키워드를 말해주시면 관련 정책 Top 5를 추천해드릴 수 있어요. "
            "예: 경기도 예비창업자 교육 지원"
        )

    return None


def is_low_confidence(top_df: pd.DataFrame, min_score: float = MIN_POLICY_SCORE) -> bool:
    """TF-IDF 점수가 낮으면 의도가 불명확한 질문으로 간주."""
    if top_df.empty or "score" not in top_df.columns:
        return True
    return float(top_df["score"].max()) < min_score


def make_widget_key(value: str) -> str:
    """Streamlit widget key에 안전하게 쓸 수 있도록 문자 정리."""
    return "".join(ch if ch.isalnum() else "_" for ch in str(value))


def toggle_scrap(row_id: str, title: str, source_name: str, detail_url: str) -> None:
    """바깥 카드와 챗봇 카드가 같은 방식으로 스크랩 상태를 변경하도록 공통 처리."""
    row_id = _safe_text(row_id)
    if not row_id:
        return

    scraps = st.session_state.scraps
    if row_id in scraps:
        scraps.pop(row_id, None)
    else:
        scraps[row_id] = {
            "title": title,
            "source_name": source_name,
            "detail_url": detail_url,
        }


def _looks_like_detail_link(source: str, url: str) -> bool:
    """URL이 공고/정책 상세로 바로 들어가는지 휴리스틱으로 판별."""
    if not url:
        return False

    low = url.lower()
    detail_signals = [
        "pblancid=",
        "pbancsn=",
        "benefitsrvcdtl",
        "svcseq=",
        "policy_id=",
        "mapngid=",
        "do?",
        "view",
        "detail",
        "dtl",
        "contents/",
        "board",
    ]
    if any(sig in low for sig in detail_signals):
        return True

    parsed = urlparse(url)
    path = (parsed.path or "").lower().strip("/")
    # youth의 /nsm/main, /index.htm 류는 랜딩으로 간주
    landing_like = {"", "main", "index", "index.html", "index.htm", "nsm/main"}
    if source == "youth" and path in landing_like and not parsed.query:
        return False

    # 경로가 2단계 이상이면 상세/내부 페이지일 가능성이 높아 그대로 사용
    path_depth = len([p for p in path.split("/") if p])
    if path_depth >= 2:
        return True

    return bool(parsed.query)


def resolve_detail_url(source: str, source_id: str, title: str, detail_url: str) -> tuple[str, bool]:
    """상세 링크가 랜딩 페이지일 때 source별 fallback URL을 생성."""
    source = _safe_text(source)
    source_id = _safe_text(source_id)
    title = _safe_text(title)
    current = _safe_text(detail_url)

    if _looks_like_detail_link(source, current):
        return current, False

    if source == "biz" and source_id:
        return (
            f"https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId={source_id}",
            True,
        )

    if source == "kst" and source_id:
        return (
            f"https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn={source_id}",
            True,
        )

    if source == "youth":
        host = urlparse(current).netloc or "www.youthcenter.go.kr"
        query = quote_plus(f"{title} 지원 자격 신청")
        return (f"https://www.google.com/search?q=site:{host}+{query}", True)

    return current, False


SYSTEM_PROMPT = """당신은 PolicyRec의 정책 추천 AI 어드바이저입니다.
사용자와 자연스럽게 대화하며 적절한 정부 정책·지원사업을 안내해주세요.

규칙:
- 친근하고 도움이 되는 톤으로 존댓말을 써주세요.
- 아래 '참고 정책' 목록에 있는 내용을 우선해서 답변해주세요.
- 정책 이름을 언급할 때는 원문 그대로 정확히 써주세요.
- 참고 정책 외의 내용을 지어내지 마세요. 없으면 "현재 데이터에서는 찾지 못했어요"라고 답하세요.

[질문이 모호할 때]
- 사용자의 질문이 너무 포괄적이어서 답하기 어려우면, 되묻기를 먼저 하세요.
  예) "청년인데 창업 지원금 있어?" → "어느 지역에 거주하고 계신가요? 혹은 창업 분야가 정해져 있으신가요?"
- 또는 일반적인 답변을 먼저 주고 끝에 보완 질문을 덧붙여도 됩니다.
  예) "관련 정책 몇 가지가 있어요. 다만 지역이나 업종을 알려주시면 더 맞는 걸 찾아드릴 수 있어요."

[답변 구조]
1) 짧고 자연스러운 핵심 답변 (2~4문장)
2) 필요 시 추가 조건 되묻기 한 줄
3) 마지막 줄: "정확한 신청 조건과 최신 정보는 해당 기관 홈페이지에서 확인해 주세요." 같은 안내

너무 길게 쓰지 말고 간결하게 답해주세요.
"""


def _call_gemini(client, prompt: str, max_retries: int = 3) -> str | None:
    """gemini-3-flash-preview 우선 시도, 실패 시 gemini-2.5-flash로 fallback."""
    for attempt in range(max_retries):
        try:
            res = client.models.generate_content(
                model="gemini-3-flash-preview",
                contents=prompt,
            )
            return res.text
        except Exception:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)

    try:
        res = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return res.text
    except Exception as e:
        return f"답변 생성 실패: {e}"


def generate_chat_response(client, history: list[dict], top_df: pd.DataFrame) -> str:
    """대화 히스토리 + 검색된 후보 정책을 함께 넘겨 자연스러운 답을 생성."""
    if client is None:
        return "Gemini API 키가 없어서 답변을 생성할 수 없어요. 대신 아래 후보 정책 목록을 확인해보세요."

    candidates = "\n".join(
        f"- {r['title']} | 기관: {r['provider']} | 지역: {r['region']} | 분야: {r['category']}"
        for _, r in top_df.iterrows()
    )

    conversation = "\n".join(
        f"{'사용자' if m['role'] == 'user' else '어시스턴트'}: {m['content']}"
        for m in history
    )

    prompt = (
        f"{SYSTEM_PROMPT}\n\n"
        f"=== 참고 정책 (현재 질문 기준 상위 5개) ===\n"
        f"{candidates}\n\n"
        f"=== 대화 기록 ===\n"
        f"{conversation}\n\n"
        f"어시스턴트:"
    )

    return _call_gemini(client, prompt) or "답변을 생성하지 못했어요. 다시 시도해주세요."


# ============================================================
# 스타일
# ============================================================
def inject_styles() -> None:
    st.markdown(
        f"""
        <style>
            /* ===== Base ===== */
            .stApp {{ background: {BG_WHITE}; color: {SLATE_TEXT}; }}
            .block-container {{ max-width: 1240px; padding-top: 3rem; padding-bottom: 6rem; }}
            header[data-testid="stHeader"] {{ background: transparent; }}

            /* ===== 상단 브랜드 바 ===== */
            .brand-bar {{
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 14px 0 18px;
                border-bottom: 1px solid {BORDER_LIGHT};
                margin-bottom: 28px;
                background: {BG_WHITE};
            }}
            .brand-name {{
                font-size: 22px;
                font-weight: 800;
                color: {SLATE_TEXT};
                letter-spacing: -0.4px;
            }}
            .version-tag {{
                border: 1px solid {BORDER_LIGHT};
                color: {BODY_TEXT};
                font-size: 12px;
                font-weight: 600;
                padding: 6px 12px;
                border-radius: 999px;
                background: {BG_LIGHT};
            }}

            /* ===== 히어로 (Modern: 화이트/라이트 그레이) ===== */
            .hero {{
                background: {BG_LIGHT};
                border: 1px solid {BORDER_LIGHT};
                border-radius: 16px;
                padding: 32px 28px;
                margin-bottom: 28px;
            }}
            .hero-title {{
                color: {SLATE_TEXT};
                font-size: 24px;
                font-weight: 800;
                margin-bottom: 6px;
                letter-spacing: -0.4px;
            }}
            .hero-sub {{
                color: {BODY_TEXT};
                font-size: 14px;
                font-weight: 400;
            }}

            /* ===== 탭 ===== */
            div[data-baseweb="tab-list"] {{
                gap: 2px;
                border-bottom: 1px solid {BORDER_LIGHT};
                margin-bottom: 24px;
            }}
            button[data-baseweb="tab"] {{
                font-weight: 600;
                font-size: 15px;
                color: {BODY_TEXT};
            }}
            button[data-baseweb="tab"][aria-selected="true"] {{
                color: {POINT_PURPLE} !important;
                font-weight: 700;
            }}
            div[data-baseweb="tab-highlight"] {{
                background-color: {POINT_PURPLE} !important;
                height: 2px !important;
            }}

            /* ===== 필터 바 ===== */
            .filter-shell {{
                background: {BG_WHITE};
                border: 1px solid {BORDER_LIGHT};
                border-radius: 14px;
                padding: 16px 18px 8px;
                margin-bottom: 24px;
            }}
            .stTextInput input,
            .stSelectbox > div > div {{
                border-radius: 12px !important;
                border-color: {BORDER_LIGHT} !important;
            }}
            .stTextInput input:focus,
            .stSelectbox > div > div:focus-within {{
                border-color: {POINT_PURPLE} !important;
                box-shadow: 0 0 0 3px rgba(128, 90, 213, 0.12) !important;
            }}

            /* ===== 결과 헤더 ===== */
            .result-head {{
                display: flex;
                justify-content: space-between;
                align-items: baseline;
                margin: 12px 0 18px;
            }}
            .result-title {{
                font-size: 20px;
                font-weight: 800;
                color: {SLATE_TEXT};
                letter-spacing: -0.3px;
            }}
            .result-count {{
                color: {BODY_TEXT};
                font-size: 14px;
                font-weight: 500;
            }}

            /* ===== 카드 ===== */
            .policy-card {{
                background: {BG_WHITE};
                border: 1px solid {BORDER_LIGHT};
                border-radius: 14px;
                padding: 20px;
                margin-bottom: 12px;
                height: 330px;
                box-sizing: border-box;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                transition: box-shadow .2s, border-color .2s, transform .2s;
            }}
            .policy-card:hover {{
                border-color: {POINT_PURPLE};
                box-shadow: 0 8px 24px rgba(74, 85, 104, 0.08);
                transform: translateY(-2px);
            }}
            .card-top {{
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 14px;
            }}
            .chip-row {{ display: flex; gap: 6px; flex-wrap: wrap; }}

            /* 소프트 태그 (저채도) */
            .badge, .tag {{
                border-radius: 8px;
                font-size: 11px;
                font-weight: 600;
                padding: 4px 10px;
                white-space: nowrap;
                letter-spacing: 0.1px;
            }}
            .tag {{
                background: {TAG_BG};
                color: {POINT_PURPLE};
            }}

            .scrap-mark {{ color: #CBD5E0; font-size: 18px; font-weight: 700; }}
            .scrap-mark.active {{ color: {POINT_PURPLE}; }}

            .dday {{
                color: {POINT_PURPLE};
                font-size: 13px;
                font-weight: 700;
                margin-bottom: 10px;
                letter-spacing: 0.3px;
            }}
            .policy-title {{
                font-size: 16px;
                font-weight: 700;
                color: {SLATE_TEXT};
                line-height: 1.4;
                margin-bottom: 10px;
                height: 64px;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                letter-spacing: -0.2px;
            }}
            .provider-line {{
                font-size: 13px;
                color: {SLATE_TEXT};
                font-weight: 600;
                margin-bottom: 10px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }}
            .summary-line {{
                font-size: 12px;
                color: {BODY_TEXT};
                line-height: 1.55;
                margin-bottom: 12px;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                height: 38px;
            }}
            .meta-line {{
                font-size: 12px;
                color: {BODY_TEXT};
                margin: 5px 0;
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }}

            /* ===== 버튼 ===== */
            div.stButton > button {{
                border-radius: 10px !important;
                font-weight: 600 !important;
            }}
            div.stButton > button[kind="primary"] {{
                background: {POINT_PURPLE} !important;
                border-color: {POINT_PURPLE} !important;
                color: #FFFFFF !important;
            }}
            div.stButton > button[kind="primary"]:hover {{
                background: {POINT_PURPLE_DEEP} !important;
                border-color: {POINT_PURPLE_DEEP} !important;
            }}
            div.stLinkButton > a {{
                background: {BG_WHITE} !important;
                border: 1px solid {BORDER_LIGHT} !important;
                color: {SLATE_TEXT} !important;
                border-radius: 10px !important;
                font-weight: 600 !important;
            }}
            div.stLinkButton > a:hover {{
                border-color: {POINT_PURPLE} !important;
                color: {POINT_PURPLE} !important;
                background: {BG_WHITE} !important;
            }}

            /* ===== 챗봇 플로팅 버튼 ===== */
            .st-key-chatbot_fab {{
                position: fixed !important;
                bottom: 24px !important;
                right: 24px !important;
                left: auto !important;
                top: auto !important;
                z-index: 999 !important;
                width: 72px !important;
                max-width: 72px !important;
            }}
            .st-key-chatbot_fab > div {{ width: 72px !important; }}
            .st-key-chatbot_fab button {{
                width: 72px !important;
                height: 72px !important;
                border-radius: 50% !important;
                background-color: transparent !important;
                background-size: contain !important;
                background-position: center !important;
                background-repeat: no-repeat !important;
                color: transparent !important;
                border: none !important;
                box-shadow: 0 8px 24px rgba(74, 85, 104, 0.20) !important;
                padding: 0 !important;
            }}
            .st-key-chatbot_fab button:hover {{
                transform: scale(1.06);
                transition: transform .15s;
                box-shadow: 0 12px 32px rgba(128, 90, 213, 0.35) !important;
            }}

            /* ===== 챗봇 말풍선 ===== */
            .st-key-chat_bubble {{
                position: fixed !important;
                bottom: 112px !important;
                right: 24px !important;
                left: auto !important;
                top: auto !important;
                z-index: 998 !important;
                width: 246px !important;
                max-width: 246px !important;
                background: {BG_WHITE} !important;
                border: 1px solid {BORDER_LIGHT} !important;
                border-radius: 16px !important;
                padding: 12px 14px 10px 16px !important;
                box-shadow: 0 8px 24px rgba(74, 85, 104, 0.12) !important;
            }}
            .st-key-chat_bubble::before {{
                content: '';
                position: absolute;
                bottom: -9px;
                right: 28px;
                width: 0;
                height: 0;
                border-left: 10px solid transparent;
                border-right: 10px solid transparent;
                border-top: 10px solid {BORDER_LIGHT};
            }}
            .st-key-chat_bubble::after {{
                content: '';
                position: absolute;
                bottom: -8px;
                right: 29px;
                width: 0;
                height: 0;
                border-left: 9px solid transparent;
                border-right: 9px solid transparent;
                border-top: 9px solid {BG_WHITE};
            }}
            .st-key-chat_bubble p {{
                margin: 0;
                font-size: 13px;
                font-weight: 600;
                color: {SLATE_TEXT};
                line-height: 1.5;
            }}
            .st-key-chat_bubble div[data-testid="stVerticalBlock"] {{ gap: 0 !important; }}
            .st-key-chat_bubble button {{
                background: transparent !important;
                color: #A0AEC0 !important;
                border: none !important;
                padding: 0 !important;
                min-height: unset !important;
                height: 22px !important;
                font-size: 13px !important;
                font-weight: 700 !important;
                box-shadow: none !important;
            }}
            .st-key-chat_bubble button:hover {{
                color: {POINT_PURPLE} !important;
                background: transparent !important;
            }}

            /* ===== Empty ===== */
            .empty {{
                background: {BG_LIGHT};
                border: 1px dashed {BORDER_LIGHT};
                border-radius: 14px;
                color: {BODY_TEXT};
                text-align: center;
                padding: 56px 24px;
                font-weight: 600;
            }}

            /* ===== 챗봇 다이얼로그 ===== */
            div[data-testid="stDialog"] h2,
            div[data-testid="stDialog"] h3 {{ color: {SLATE_TEXT}; font-weight: 700; }}
            div[data-testid="stChatInput"] textarea {{
                border-radius: 12px !important;
            }}
            [class*="st-key-chat_policy_card_"] {{
                border: 1px solid #BBD0FF !important;
                border-radius: 12px !important;
                background: {BG_WHITE} !important;
                padding: 12px 14px !important;
                margin: 8px 0 10px !important;
                min-height: 148px !important;
            }}
            [class*="st-key-chat_policy_card_"] div[data-testid="stVerticalBlock"] {{
                gap: 0.35rem !important;
            }}
            .chat-mini-chip-row {{
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                margin-bottom: 2px;
            }}
            .chat-mini-badge,
            .chat-mini-tag {{
                border-radius: 7px;
                font-size: 10px;
                font-weight: 700;
                padding: 3px 7px;
                white-space: nowrap;
            }}
            .chat-mini-tag {{
                background: {TAG_BG};
                color: {POINT_PURPLE};
            }}
            .chat-mini-title {{
                color: {SLATE_TEXT};
                font-size: 13px;
                font-weight: 800;
                line-height: 1.35;
                height: 36px;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
            }}
            .chat-mini-summary {{
                color: {BODY_TEXT};
                font-size: 11px;
                line-height: 1.45;
                height: 32px;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
            }}
            .chat-mini-meta {{
                color: {BODY_TEXT};
                font-size: 10.5px;
                line-height: 1.5;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }}
            .chat-mini-link {{
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-height: 28px;
                padding: 5px 10px;
                border: 1px solid {BORDER_LIGHT};
                border-radius: 8px;
                color: {SLATE_TEXT} !important;
                text-decoration: none !important;
                font-size: 11px;
                font-weight: 700;
                background: {BG_WHITE};
            }}
            .chat-mini-link:hover {{
                color: {POINT_PURPLE} !important;
                border-color: {POINT_PURPLE};
            }}
            [class*="st-key-chat_star_"] button {{
                min-height: 28px !important;
                height: 28px !important;
                width: 28px !important;
                padding: 0 !important;
                border: none !important;
                background: transparent !important;
                box-shadow: none !important;
                color: #A0AEC0 !important;
                font-size: 18px !important;
                line-height: 1 !important;
            }}
            [class*="st-key-chat_star_on_"] button {{
                color: {POINT_PURPLE} !important;
            }}
            [class*="st-key-chat_star_"] button:hover {{
                color: {POINT_PURPLE} !important;
                background: transparent !important;
            }}
        </style>
        """,
        unsafe_allow_html=True,
    )


# ============================================================
# 세션
# ============================================================
def ensure_session() -> None:
    if "scraps" not in st.session_state:
        st.session_state.scraps = {}
    if "chat_bubble_visible" not in st.session_state:
        st.session_state.chat_bubble_visible = True
    if "chat_open" not in st.session_state:
        st.session_state.chat_open = False


def on_chat_dialog_dismiss() -> None:
    """X 버튼으로 닫았을 때도 상태를 닫힘으로 동기화."""
    st.session_state.chat_open = False
    st.session_state.chat_bubble_visible = True


def inject_chat_icon(icon_b64: str | None) -> None:
    """챗봇 아이콘 PNG를 플로팅 버튼 배경으로 주입."""
    if not icon_b64:
        return
    st.markdown(
        f"""
        <style>
            .st-key-chatbot_fab button {{
                background-image: url('data:image/png;base64,{icon_b64}') !important;
            }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_chat_bubble() -> None:
    """챗봇 옆에 뜨는 유도 말풍선. X로 닫을 수 있음."""
    if not st.session_state.get("chat_bubble_visible", True):
        return

    with st.container(key="chat_bubble"):
        col_text, col_close = st.columns([14, 1], gap="small")
        with col_text:
            st.markdown(
                "<p>나에게 맞는 정책과 지원사업을<br>챗봇에서 찾아보세요</p>",
                unsafe_allow_html=True,
            )
        with col_close:
            if st.button("✕", key="chat_bubble_close"):
                st.session_state.chat_bubble_visible = False
                st.rerun()


# ============================================================
# UI 렌더
# ============================================================
def render_brand(version_label: str) -> None:
    st.markdown(
        f"""
        <div class="brand-bar">
            <div class="brand-name">🔎 PolicyRec</div>
            <div class="version-tag">{escape(version_label)} 데이터</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_hero() -> None:
    st.markdown(
        """
        <div class="hero">
            <div class="hero-title">나에게 맞는 정책과 지원사업을 찾아보세요</div>
            <div class="hero-sub">지역 · 대상 · 분야 · 기관을 골라 지금 신청할 수 있는 사업을 한눈에</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_filter_bar(df: pd.DataFrame):
    st.markdown('<div class="filter-shell">', unsafe_allow_html=True)
    col_search, col_region, col_target, col_category, col_provider = st.columns(
        [2, 1.1, 1.1, 1.1, 1.3], gap="small"
    )
    with col_search:
        search = st.text_input("검색어", placeholder="사업명·요약·기관 검색", label_visibility="visible")
    with col_region:
        region = st.selectbox("지역", ["전체"] + unique_options(df, "region", {"지역 미정"}))
    with col_target:
        target = st.selectbox("대상", ["전체"] + unique_options(df, "target_group_tags", {"대상 미확인"}))
    with col_category:
        category = st.selectbox("분야", ["전체"] + unique_options(df, "category", {"분류 미정"}))
    with col_provider:
        provider = st.selectbox("기관", ["전체"] + unique_options(df, "provider", {"기관 미정"}))
    st.markdown("</div>", unsafe_allow_html=True)
    return search, region, target, category, provider


def apply_filters(
    df: pd.DataFrame,
    search: str,
    region: str,
    target: str,
    category: str,
    provider: str,
) -> pd.DataFrame:
    out = df.copy()
    if region != "전체":
        out = out[out["region"] == region]
    if target != "전체":
        out = out[out["target_group_tags"].apply(lambda t: isinstance(t, list) and target in t)]
    if category != "전체":
        out = out[out["category"] == category]
    if provider != "전체":
        out = out[out["provider"] == provider]
    if search.strip():
        p = search.strip()
        mask = (
            out["title"].str.contains(p, case=False, na=False, regex=False)
            | out["summary"].str.contains(p, case=False, na=False, regex=False)
            | out["region"].str.contains(p, case=False, na=False, regex=False)
            | out["provider"].str.contains(p, case=False, na=False, regex=False)
            | out["target_group_display"].str.contains(p, case=False, na=False, regex=False)
        )
        out = out[mask]
    return out


def render_card(policy: pd.Series, context_key: str = "search") -> None:
    scraps = st.session_state.scraps
    row_id = str(policy["row_id"])
    safe_context = make_widget_key(context_key)
    card_key = f"{safe_context}-{make_widget_key(row_id)}"
    is_scraped = row_id in scraps
    badge_bg, badge_text = SOURCE_BADGE_STYLES.get(
        policy["source"], (BG_LIGHT, SLATE_TEXT)
    )

    source_name = escape(str(policy["source_name"]))
    category = escape(str(policy["category"]))
    title = escape(str(policy["title"]))
    provider = escape(str(policy["provider"]))
    summary = escape(str(policy["summary"])[:160])
    region = escape(str(policy["region"]))
    target_display = escape(str(policy.get("target_group_display", "")))
    target_age = escape(str(policy["target_age"]))
    end_date = escape(format_date(policy["apply_end"]))
    dday_text = escape(d_day_label(policy["apply_end"]))
    scrap_icon = "★" if is_scraped else "☆"
    scrap_class = "scrap-mark active" if is_scraped else "scrap-mark"

    st.markdown(
        f"""
        <div class="policy-card">
            <div class="card-top">
                <div class="chip-row">
                    <span class="badge" style="background:{badge_bg}; color:{badge_text};">{source_name}</span>
                    <span class="tag">{category}</span>
                </div>
                <div class="{scrap_class}">{scrap_icon}</div>
            </div>
            <div class="dday">{dday_text}</div>
            <div class="policy-title">{title}</div>
            <div class="provider-line">{provider}</div>
            <div class="summary-line">{summary}</div>
            <div class="meta-line">📍 {region}</div>
            <div class="meta-line">👤 {target_display} · {target_age}</div>
            <div class="meta-line">📅 {end_date} 마감</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    col_a, col_b = st.columns(2, gap="small")
    with col_a:
        btn_label = "스크랩 해제" if is_scraped else "스크랩"
        btn_type = "primary" if is_scraped else "secondary"
        if st.button(btn_label, key=f"{card_key}-scrap", type=btn_type, use_container_width=True):
            detail_link = _safe_text(policy.get("resolved_detail_url", policy.get("detail_url", "")))
            toggle_scrap(row_id, policy["title"], policy["source_name"], detail_link)
            st.rerun()
    with col_b:
        detail_link = _safe_text(policy.get("resolved_detail_url", policy.get("detail_url", "")))
        is_fallback = bool(policy.get("detail_url_is_fallback", False))
        if detail_link:
            st.link_button(
                "상세 찾기" if is_fallback else "자세히",
                detail_link,
                key=f"{card_key}-detail",
                use_container_width=True,
            )
        else:
            st.button(
                "자세히",
                disabled=True,
                key=f"{card_key}-detail-disabled",
                use_container_width=True,
            )


def render_card_grid(
    df: pd.DataFrame,
    empty_text: str = "검색 결과가 없습니다",
    context_key: str = "search",
) -> None:
    if df.empty:
        st.markdown(f'<div class="empty">{escape(empty_text)}</div>', unsafe_allow_html=True)
        return

    for start in range(0, len(df), 3):
        chunk = df.iloc[start:start + 3]
        cols = st.columns(3, gap="medium")
        for col, (_, policy) in zip(cols, chunk.iterrows()):
            with col:
                render_card(policy, context_key=f"{context_key}-{start}")


# ============================================================
# 챗봇 다이얼로그
# ============================================================
@st.dialog("🤖 PolicyRec 챗봇", width="large", on_dismiss=on_chat_dialog_dismiss)
def chatbot_dialog(df: pd.DataFrame, vectorizer, matrix, client) -> None:
    """자연어 대화형 챗봇. TF-IDF로 Top-5를 찾아 컨텍스트로 넣고 대화 생성."""
    if "chat_history" not in st.session_state:
        st.session_state.chat_history = []

    # 상단: 리셋 버튼
    col_hint, col_reset, col_close = st.columns([3, 1, 1])
    with col_hint:
        st.caption("정책 이름·분야·상황 어떤 식으로든 물어보세요. 예: `청년 창업 지원 있어?`")
    with col_reset:
        if st.button("🔄 초기화", key="reset_chat", use_container_width=True):
            st.session_state.chat_history = []
            st.rerun()
    with col_close:
        if st.button("닫기", key="close_chat", use_container_width=True):
            st.session_state.chat_open = False
            st.session_state.chat_bubble_visible = True
            st.rerun()

    # 대화 히스토리 렌더
    if not st.session_state.chat_history:
        with st.chat_message("assistant"):
            st.markdown(
                "안녕하세요! 어떤 정책이 궁금하신가요?\n\n"
                "원하시는 조건(지역·대상·분야 등)을 말씀해주시면 관련 정책을 찾아드릴게요."
            )

    def render_chat_policy_item(policy: dict, key_prefix: str) -> None:
        """챗봇 후보 정책 카드 렌더 + 스크랩 토글."""
        row_id = _safe_text(policy.get("row_id"))
        title = _safe_text(policy.get("title"))
        provider = _safe_text(policy.get("provider"))
        region = _safe_text(policy.get("region"))
        category = _safe_text(policy.get("category"))
        source_name = _safe_text(policy.get("source_name", "출처"))
        detail_link = _safe_text(policy.get("resolved_detail_url", policy.get("detail_url", "")))
        is_fallback = bool(policy.get("detail_url_is_fallback", False))

        summary = _safe_text(policy.get("summary"))[:110]
        target_display = _safe_text(policy.get("target_group_display"))
        target_age = _safe_text(policy.get("target_age"))
        end_date = _safe_text(policy.get("end_date"))
        dday_text = _safe_text(policy.get("dday_text"))
        source = _safe_text(policy.get("source"))
        is_scraped = row_id in st.session_state.scraps if row_id else False
        badge_bg, badge_text = SOURCE_BADGE_STYLES.get(source, (BG_LIGHT, SLATE_TEXT))
        safe_key = make_widget_key(f"{key_prefix}_{row_id}")
        star_state = "on" if is_scraped else "off"

        with st.container(key=f"chat_policy_card_{safe_key}", border=True):
            top_col, star_col = st.columns([8, 1], gap="small")
            with top_col:
                st.markdown(
                    f"""
                    <div class="chat-mini-chip-row">
                        <span class="chat-mini-badge" style="background:{badge_bg}; color:{badge_text};">{escape(source_name)}</span>
                        <span class="chat-mini-tag">{escape(category)}</span>
                        <span class="chat-mini-tag">{escape(dday_text)}</span>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )
            with star_col:
                if row_id and st.button(
                    "★" if is_scraped else "☆",
                    key=f"chat_star_{star_state}_{safe_key}",
                    help="스크랩 해제" if is_scraped else "스크랩",
                ):
                    toggle_scrap(row_id, title, source_name, detail_link)
                    st.rerun()

            st.markdown(
                f"""
                <div class="chat-mini-title">{escape(title)}</div>
                <div class="chat-mini-summary">{escape(summary)}</div>
                <div class="chat-mini-meta">기관 {escape(provider)} · 지역 {escape(region)}</div>
                <div class="chat-mini-meta">대상 {escape(target_display)} · {escape(target_age)} · 마감 {escape(end_date)}</div>
                """,
                unsafe_allow_html=True,
            )
            if detail_link:
                link_label = "상세 찾기" if is_fallback else "자세히 보기"
                st.markdown(
                    f'<a class="chat-mini-link" href="{escape(detail_link, quote=True)}" target="_blank">{link_label}</a>',
                    unsafe_allow_html=True,
                )
        return

        scraps = st.session_state.scraps
        is_scraped = row_id in scraps if row_id else False

        with st.container(border=True):
            st.markdown(f"**{title}**")
            st.caption(f"{source_name} · {provider} · {region} · {category}")

            act_col1, act_col2 = st.columns([1, 1], gap="small")
            with act_col1:
                if detail_link:
                    st.markdown(
                        f"[{'상세 찾기 →' if is_fallback else '자세히 보기 →'}]({detail_link})"
                    )
            with act_col2:
                if row_id:
                    btn_label = "스크랩 해제" if is_scraped else "스크랩"
                    btn_type = "primary" if is_scraped else "secondary"
                    if st.button(
                        btn_label,
                        key=f"chat-scrap-{key_prefix}-{row_id}",
                        type=btn_type,
                        use_container_width=True,
                    ):
                        if is_scraped:
                            scraps.pop(row_id, None)
                        else:
                            scraps[row_id] = {
                                "title": title,
                                "source_name": source_name,
                                "detail_url": detail_link,
                            }
                        st.rerun()

    for msg_idx, msg in enumerate(st.session_state.chat_history):
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
            for idx, p in enumerate(msg.get("policies", [])):
                render_chat_policy_item(p, f"hist-{msg_idx}-{idx}")

    # 입력 → 사용자 메시지만 먼저 추가하고 rerun (내 채팅이 먼저 뜨게)
    user_input = st.chat_input("정책에 대해 물어보세요")
    if user_input:
        st.session_state.chat_history.append({"role": "user", "content": user_input})
        st.rerun()

    # 마지막 메시지가 user면 이번 rerun에서 답변 생성
    history = st.session_state.chat_history
    if not history or history[-1]["role"] != "user":
        return

    last_user = history[-1]["content"]

    top_df = pd.DataFrame()
    top_policies: list[dict] = []
    response_text = ""

    # 1) 인사/감사/도움말 같은 일반 대화는 규칙 기반으로 즉시 응답
    quick_reply = get_smalltalk_reply(last_user)
    if quick_reply is not None:
        response_text = quick_reply
    else:
        # 2) 정책 의도 질문이면 TF-IDF 검색 후 점수 기반으로 처리
        top_df = search_top5_tfidf(df, vectorizer, matrix, last_user)
        if is_low_confidence(top_df):
            response_text = (
                "좋은 질문이에요. 지금 질문만으로는 범위가 넓어서 정확한 정책을 고르기 어려워요. "
                "지역·대상·분야 중 하나를 같이 알려주시면 더 정확하게 찾아드릴게요. "
                "예: 서울 청년 창업 지원"
            )
        else:
            top_policies = [
                {
                    "row_id": row.get("row_id", ""),
                    "source_name": row.get("source_name", ""),
                    "title": row["title"],
                    "summary": row.get("summary", ""),
                    "source": row.get("source", ""),
                    "provider": row["provider"],
                    "region": row["region"],
                    "category": row["category"],
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

            # 3) 검색 결과가 충분히 맞을 때만 LLM으로 자연어 응답 생성
            with st.spinner("답변 생성 중..."):
                response_text = generate_chat_response(client, history, top_df)

    with st.chat_message("assistant"):
        st.markdown(response_text)
        for idx, p in enumerate(top_policies):
            render_chat_policy_item(p, f"live-{idx}")

    history.append({
        "role": "assistant",
        "content": response_text,
        "policies": top_policies,
    })


# ============================================================
# 메인
# ============================================================
def main() -> None:
    inject_styles()
    ensure_session()

    csv_path = resolve_csv_path()
    if not csv_path.exists():
        st.error(f"정규화 CSV를 찾을 수 없습니다: {csv_path}")
        st.stop()

    policy_df = load_policy_data(str(csv_path)).copy()
    version_label = version_label_from_path(csv_path)

    # 상세 링크가 랜딩 페이지(메인)인 경우 source별 fallback 링크를 함께 준비
    resolved_pairs = policy_df.apply(
        lambda row: resolve_detail_url(
            row.get("source", ""),
            row.get("source_id", ""),
            row.get("title", ""),
            row.get("detail_url", ""),
        ),
        axis=1,
    )
    policy_df["resolved_detail_url"] = [pair[0] for pair in resolved_pairs]
    policy_df["detail_url_is_fallback"] = [pair[1] for pair in resolved_pairs]

    # 챗봇용 벡터라이저/클라이언트 준비
    texts = tuple(policy_df.apply(build_search_text, axis=1).tolist())
    vectorizer, matrix = build_vectorizer(texts)
    client = get_genai_client()

    icon_b64 = load_chat_icon_b64()
    inject_chat_icon(icon_b64)

    render_brand(version_label)

    tab_search, tab_scrap = st.tabs(
        ["🔍 정책찾기", f"⭐ 스크랩 ({len(st.session_state.scraps)})"]
    )

    with tab_search:
        render_hero()
        search, region, target, category, provider = render_filter_bar(policy_df)
        filtered = apply_filters(policy_df, search, region, target, category, provider)

        st.markdown(
            f"""
            <div class="result-head">
                <div class="result-title">지금 신청 가능한 정책과 지원사업</div>
                <div class="result-count">총 {len(filtered):,}건</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        render_card_grid(filtered, context_key="search-tab")

    with tab_scrap:
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
        render_card_grid(scraped_df, "스크랩한 정책이 없습니다", context_key="scrap-tab")

    # 우측 하단 유도 말풍선 + 플로팅 챗봇 버튼
    render_chat_bubble()

    with st.container(key="chatbot_fab"):
        if st.button(" ", key="chat_fab_btn", help="챗봇 열기"):
            st.session_state.chat_open = True
            st.session_state.chat_bubble_visible = False
            st.rerun()

    # 입력 후 rerun 되더라도 열림 상태를 유지해서 대화창이 닫히지 않도록 처리
    if st.session_state.get("chat_open", False):
        chatbot_dialog(policy_df, vectorizer, matrix, client)


if __name__ == "__main__":
    main()
