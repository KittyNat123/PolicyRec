"""
Bizinfo(기업마당) 수집기입니다.

이 파일은 "처음부터 완벽한 정규화"가 목적이 아니라,
"공식 API 에 연결해서 작은 raw 응답을 안전하게 저장하는 것"이 목적입니다.

현재 설계 원칙:
- API 키는 환경변수에서만 읽습니다.
- 처음에는 page=1, page_size=10 정도의 작은 호출만 합니다.
- raw 응답은 그대로 data/raw/biz/ 에 저장합니다.
- 과한 파싱은 하지 않고, 본격적인 컬럼 매핑은 norm.py 에서 처리합니다.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from .base import (
    PROJECT_ROOT,
    log,
    request_get,
    save_raw_json,
    save_raw_text,
    should_skip_fetch,
    try_parse_json,
)


load_dotenv()


# Bizinfo 공식 Open API 안내에서 확인한 기본 endpoint 입니다.
# 만약 이후 문서가 바뀌면 이 값만 수정하면 됩니다.
BIZINFO_URL = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"

# raw 응답을 저장할 폴더입니다.
OUT_DIR = PROJECT_ROOT / "data" / "raw" / "biz"


def fetch_bizinfo(page: int = 1, page_size: int = 10, force: bool = False) -> dict:
    """
    목적:
    - Bizinfo API 의 작은 첫 요청을 보내고 raw 응답을 로컬 파일에 저장합니다.
    - 이미 같은 요청을 저장한 파일이 있으면 다시 호출하지 않고 건너뛸 수 있습니다.

    입력:
    - page (int): 요청할 페이지 번호입니다. 기본값은 1 입니다.
    - page_size (int): 한 번에 가져올 개수입니다. 기본값은 10 입니다.
    - force (bool): True 이면 기존 캐시가 있어도 다시 API 를 호출합니다.

    출력:
    - dict:
      - success (bool): 성공 여부
      - skipped (bool): 캐시 때문에 건너뛰었는지 여부
      - source (str): source 이름
      - path (str | None): 저장된 파일 경로
      - message (str): 사람이 읽기 쉬운 설명
    """
    source = "Bizinfo"
    prefix = f"bizinfo_page{page}_size{page_size}"

    # 먼저 같은 요청 결과가 이미 있는지 확인합니다.
    cached_file = should_skip_fetch(OUT_DIR, prefix, force=force)
    if cached_file is not None:
        log(source, f"기존 raw 파일이 있어서 API 호출을 건너뜁니다: {cached_file}")
        return {
            "success": True,
            "skipped": True,
            "source": source,
            "path": str(cached_file),
            "message": "기존 캐시 파일을 재사용했습니다.",
        }

    api_key = os.getenv("BIZINFO_API_KEY", "").strip()
    if not api_key:
        log(source, "환경변수 BIZINFO_API_KEY 가 비어 있습니다.")
        log(source, ".env 파일에 BIZINFO_API_KEY=발급받은키 형태로 입력한 뒤 다시 실행해 주세요.")
        return {
            "success": False,
            "skipped": False,
            "source": source,
            "path": None,
            "message": "BIZINFO_API_KEY 가 없습니다.",
        }

    # Bizinfo 문서에서 확인된 기본 파라미터 이름을 사용합니다.
    # dataType=json 으로 요청해서 가능하면 JSON 을 바로 받도록 시도합니다.
    params = {
        "crtfcKey": api_key,
        "dataType": "json",
        "pageUnit": page_size,
        "pageIndex": page,
    }

    try:
        response = request_get(source=source, url=BIZINFO_URL, params=params, timeout=30)
        data = try_parse_json(source, response)

        if data is not None:
            saved_path = save_raw_json(data, OUT_DIR, prefix)
            log(source, f"raw JSON 저장 완료: {saved_path}")
            return {
                "success": True,
                "skipped": False,
                "source": source,
                "path": str(saved_path),
                "message": "Bizinfo raw JSON 저장에 성공했습니다.",
            }

        # TODO:
        # Bizinfo 에서 dataType=json 요청에도 JSON 대신 다른 형식이 내려오는 경우가 있다면,
        # 아래처럼 원문을 그대로 저장해 두고 실제 응답 내용을 확인해서 수정하면 됩니다.
        saved_path = save_raw_text(response.text, OUT_DIR, prefix, extension="xml")
        log(source, f"JSON 파싱에 실패하여 raw 텍스트를 저장했습니다: {saved_path}")
        return {
            "success": True,
            "skipped": False,
            "source": source,
            "path": str(saved_path),
            "message": "JSON 대신 원문 텍스트를 저장했습니다.",
        }

    except Exception as exc:
        log(source, f"수집 실패: {exc}")
        return {
            "success": False,
            "skipped": False,
            "source": source,
            "path": None,
            "message": str(exc),
        }


if __name__ == "__main__":
    result = fetch_bizinfo()
    print(result)
