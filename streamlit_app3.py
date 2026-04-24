"""
streamlit_app3.py

Supabase / Gemini RAG 연동을 붙여 나갈 다음 단계의 Streamlit 진입점입니다.
현재는 streamlit_app2.py의 UI와 동작을 그대로 재사용하고,
데이터 소스와 검색 백엔드를 CSV/TF-IDF 기반에서 Supabase 기반으로 교체해 가는
작업 베이스 역할을 맡습니다.
"""

from streamlit_app2 import main


if __name__ == "__main__":
    main()
