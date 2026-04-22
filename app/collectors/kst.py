"""
K-Startup 수집기입니다.

이번 버전에서는 실제 확인된 값만 코드에 반영했습니다.

확인한 내용:
- endpoint: https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01
- 인증 파라미터명: serviceKey
- 페이지 파라미터명: page
- 페이지 크기 파라미터명: perPage
- JSON 응답 파라미터: returnType=json

즉, 이 파일은 이제 "단순한 뼈대"가 아니라
"작은 raw JSON 을 실제로 받아 저장하는 기본 수집기" 역할을 합니다.
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


# 공공데이터포털 K-Startup 조회서비스 실제 호출 기준으로 확인한 값입니다.
KSTARTUP_API_URL = "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01"
KSTARTUP_API_KEY_PARAM = "serviceKey"
KSTARTUP_PAGE_PARAM = "page"
KSTARTUP_PAGE_SIZE_PARAM = "perPage"

# 실제 테스트에서 returnType=json 으로 JSON 응답이 오는 것을 확인했습니다.
KSTARTUP_FORMAT_PARAM = "returnType"
KSTARTUP_FORMAT_VALUE = "json"

OUT_DIR = PROJECT_ROOT / "data" / "raw" / "kst"


def fetch_kstartup(page: int = 1, page_size: int = 10, force: bool = False) -> dict:
    """
    목적:
    - K-Startup API raw 응답을 받아 로컬 JSON 파일로 저장합니다.
    - 이미 같은 요청 결과가 있으면 캐시를 재사용해 중복 호출을 줄입니다.

    입력:
    - page (int): 요청할 페이지 번호입니다.
    - page_size (int): 한 번에 가져올 개수입니다.
    - force (bool): True 이면 기존 캐시를 무시하고 다시 호출합니다.

    출력:
    - dict:
      - success (bool): 성공 여부
      - skipped (bool): 캐시 때문에 건너뛰었는지 여부
      - source (str): source 이름
      - path (str | None): 저장된 파일 경로
      - message (str): 사람이 읽기 쉬운 설명
    """
    source = "K-Startup"
    prefix = f"kstartup_page{page}_size{page_size}"

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

    api_key = os.getenv("KSTARTUP_API_KEY", "").strip()
    if not api_key:
        log(source, "환경변수 KSTARTUP_API_KEY 가 비어 있습니다.")
        log(source, ".env 파일에 KSTARTUP_API_KEY=발급받은키 형태로 입력해 주세요.")
        return {
            "success": False,
            "skipped": False,
            "source": source,
            "path": None,
            "message": "KSTARTUP_API_KEY 가 없습니다.",
        }

    params = {
        KSTARTUP_API_KEY_PARAM: api_key,
        KSTARTUP_PAGE_PARAM: page,
        KSTARTUP_PAGE_SIZE_PARAM: page_size,
    }

    # JSON 응답을 직접 받기 위해 returnType=json 을 추가합니다.
    if KSTARTUP_FORMAT_PARAM and KSTARTUP_FORMAT_VALUE:
        params[KSTARTUP_FORMAT_PARAM] = KSTARTUP_FORMAT_VALUE

    try:
        response = request_get(source=source, url=KSTARTUP_API_URL, params=params, timeout=30)
        data = try_parse_json(source, response)

        if data is not None:
            saved_path = save_raw_json(data, OUT_DIR, prefix)
            log(source, f"raw JSON 저장 완료: {saved_path}")
            return {
                "success": True,
                "skipped": False,
                "source": source,
                "path": str(saved_path),
                "message": "K-Startup raw JSON 저장에 성공했습니다.",
            }

        # 예외적으로 JSON 파싱이 실패하더라도 원문을 버리지 않고 저장합니다.
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
    result = fetch_kstartup()
    print(result)
