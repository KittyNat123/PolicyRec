"""
온통청년(Youthcenter) 수집기입니다.

현재 상태:
- API 키는 아직 발급 전이라고 사용자가 알려 주었습니다.
- 따라서 가장 중요한 목표는 "나중에 키를 받았을 때 쉽게 연결할 수 있는 단순한 구조"입니다.

보수적 구현 원칙:
- 키가 없으면 초보자도 이해할 수 있는 안내 메시지를 보여줍니다.
- 공식 안내에서 확인한 endpoint / 파라미터를 사용합니다.
- 응답 구조가 확실하지 않으므로 과한 파싱을 하지 않고 raw 저장에 집중합니다.

참고:
- 공식 문서 기준 상수는 아래 값이 맞는 것으로 확인했습니다.
- 다만 현재 실제 호출 시 서버가 302 응답으로 http://www.youthcenter.go.kr:8080/ 로
  리다이렉트되는 현상을 확인했습니다.
- 즉, "상수 이름" 문제라기보다 "실서버 동작 또는 접근 경로" 문제일 가능성이 있습니다.
"""

from __future__ import annotations

import os

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


# 공식 문서의 청년정책 오픈 API 예시에 나온 endpoint 입니다.
YOUTHCENTER_URL = "https://www.youthcenter.go.kr/go/ythip/getPlcy"

# 공식 문서의 요청 예시에 나온 파라미터 이름입니다.
YOUTHCENTER_API_KEY_PARAM = "apiKeyNm"
YOUTHCENTER_RETURN_TYPE_PARAM = "rtnType"
YOUTHCENTER_PAGE_PARAM = "pageNum"
YOUTHCENTER_PAGE_SIZE_PARAM = "pageSize"

YOUTHCENTER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    )
}

OUT_DIR = PROJECT_ROOT / "data" / "raw" / "youth"


def fetch_youthcenter(page: int = 1, page_size: int = 10, force: bool = False) -> dict:
    """
    목적:
    - 온통청년 API 의 raw 응답을 저장합니다.
    - 아직 키가 없으면 사용자가 다음에 무엇을 해야 하는지 분명하게 안내합니다.

    입력:
    - page (int): 요청할 페이지 번호입니다.
    - page_size (int): 한 번에 가져올 개수입니다.
    - force (bool): True 이면 기존 캐시가 있어도 다시 호출합니다.

    출력:
    - dict:
      - success (bool): 성공 여부
      - skipped (bool): 캐시 때문에 건너뛴 여부
      - source (str): source 이름
      - path (str | None): 저장된 파일 경로
      - message (str): 사람이 읽기 쉬운 설명
    """
    source = "Youthcenter"
    prefix = f"youthcenter_page{page}_size{page_size}"

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

    api_key = os.getenv("YOUTHCENTER_API_KEY", "").strip()
    if not api_key:
        log(source, "환경변수 YOUTHCENTER_API_KEY 가 아직 비어 있습니다.")
        log(source, "지금은 정상입니다. 아직 API 키가 발급되지 않았기 때문입니다.")
        log(source, "다음 순서로 진행하면 됩니다.")
        log(source, "1) 온통청년 API 키 발급 완료")
        log(source, "2) .env 파일에 YOUTHCENTER_API_KEY=발급받은키 입력")
        log(source, "3) 다시 scripts/fetch.py 실행")
        return {
            "success": False,
            "skipped": False,
            "source": source,
            "path": None,
            "message": "YOUTHCENTER_API_KEY 가 아직 없습니다.",
        }

    params = {
        YOUTHCENTER_API_KEY_PARAM: api_key,
        YOUTHCENTER_RETURN_TYPE_PARAM: "json",
        YOUTHCENTER_PAGE_PARAM: page,
        YOUTHCENTER_PAGE_SIZE_PARAM: page_size,
    }

    try:
        response = request_get(
            source=source,
            url=YOUTHCENTER_URL,
            params=params,
            headers=YOUTHCENTER_HEADERS,
            timeout=30,
        )
        data = try_parse_json(source, response)

        if data is not None:
            saved_path = save_raw_json(data, OUT_DIR, prefix)
            log(source, f"raw JSON 저장 완료: {saved_path}")
            return {
                "success": True,
                "skipped": False,
                "source": source,
                "path": str(saved_path),
                "message": "온통청년 raw JSON 저장에 성공했습니다.",
            }

        # TODO:
        # 온통청년 공식 안내 자료에는 XML 결과 예시가 있어,
        # 실제 호출 시 JSON 이 아니라 XML 이 올 가능성을 열어 둡니다.
        # 이 경우 데이터를 버리지 않고 원문 XML 을 저장해 두었다가
        # 나중에 실제 응답 구조를 보고 매퍼를 수정하면 됩니다.
        saved_path = save_raw_text(response.text, OUT_DIR, prefix, extension="xml")
        log(source, f"JSON 파싱에 실패하여 raw XML 텍스트를 저장했습니다: {saved_path}")
        return {
            "success": True,
            "skipped": False,
            "source": source,
            "path": str(saved_path),
            "message": "JSON 대신 원문 XML 텍스트를 저장했습니다.",
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
    result = fetch_youthcenter()
    print(result)
