"""
공통 수집 유틸리티 모음입니다.

이 파일의 목표는 아주 단순합니다.
각 API 수집기에서 반복되는 아래 작업을 한곳에 모아 두는 것입니다.

1. 폴더가 없으면 자동으로 만들기
2. GET 요청 보내기
3. 초보자도 이해할 수 있는 로그 출력하기
4. raw 응답을 타임스탬프가 붙은 파일로 저장하기
5. 이미 받은 파일이 있으면 다시 호출하지 않고 건너뛰기 쉽게 만들기

중요:
- 이 파일은 "복잡한 프레임워크"가 아니라 "읽기 쉬운 도구 상자" 역할만 합니다.
- API별 차이는 각 수집기 파일에서 처리하고, 여기서는 공통 동작만 다룹니다.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import requests


# 이 프로젝트의 실제 루트 폴더를 계산합니다.
# 현재 파일 위치는 app/collectors/base.py 이므로,
# parents[2] 는 policyrec_codex/ 폴더를 가리킵니다.
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def log(source: str, message: str) -> None:
    """
    목적:
    - 로그 메시지를 같은 형식으로 출력합니다.
    - 어떤 source에서 나온 메시지인지 한눈에 보이게 합니다.

    입력:
    - source (str): 로그를 출력하는 주체 이름입니다. 예: "Bizinfo", "K-Startup"
    - message (str): 실제로 출력할 메시지입니다.

    출력:
    - 없음 (None)
    """
    print(f"[{source}] {message}")


def ensure_dir(path: str | Path) -> Path:
    """
    목적:
    - 폴더가 없으면 자동으로 생성합니다.
    - 이미 폴더가 있으면 아무 일도 하지 않습니다.

    입력:
    - path (str | Path): 만들고 싶은 폴더 경로입니다.

    출력:
    - Path: Path 객체로 변환된 폴더 경로를 돌려줍니다.
    """
    path_obj = Path(path)
    path_obj.mkdir(parents=True, exist_ok=True)
    return path_obj


def make_timestamp() -> str:
    """
    목적:
    - 파일 이름에 붙일 현재 시각 문자열을 만듭니다.
    - 같은 이름의 raw 파일이 덮어써지지 않도록 도와줍니다.

    입력:
    - 없음

    출력:
    - str: 예를 들어 "20260420_153045" 같은 문자열을 돌려줍니다.
    """
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def mask_params(params: dict[str, Any] | None) -> dict[str, Any]:
    """
    목적:
    - 로그에 API 키가 그대로 찍히지 않도록 민감한 값을 가립니다.

    입력:
    - params (dict | None): 요청 파라미터 사전입니다.

    출력:
    - dict: 민감한 값이 일부 가려진 새 사전을 돌려줍니다.
    """
    if not params:
        return {}

    masked: dict[str, Any] = {}
    for key, value in params.items():
        lowered_key = str(key).lower()

        # 키 이름에 key, auth, token, secret 같은 단어가 들어가면
        # 실제 값을 로그에 남기지 않고 "***" 로 가립니다.
        if any(word in lowered_key for word in ["key", "auth", "token", "secret"]):
            masked[key] = "***"
        else:
            masked[key] = value

    return masked


def get_latest_cached_file(out_dir: str | Path, prefix: str) -> Path | None:
    """
    목적:
    - 같은 prefix 로 저장된 기존 raw 파일이 있는지 찾습니다.
    - 가장 최근에 저장된 파일 하나만 돌려줍니다.

    입력:
    - out_dir (str | Path): raw 파일이 저장되는 폴더입니다.
    - prefix (str): 파일 이름 앞부분입니다. 예: "bizinfo_page1_size10"

    출력:
    - Path | None:
      - 기존 파일이 있으면 가장 최근 파일 경로를 반환합니다.
      - 없으면 None 을 반환합니다.
    """
    folder = Path(out_dir)
    if not folder.exists():
        return None

    candidates: list[Path] = []
    for extension in ["json", "xml", "txt"]:
        candidates.extend(sorted(folder.glob(f"{prefix}_*.{extension}")))

    if not candidates:
        return None

    return candidates[-1]


def should_skip_fetch(out_dir: str | Path, prefix: str, force: bool = False) -> Path | None:
    """
    목적:
    - 이미 같은 요청 결과를 받은 적이 있는지 확인하고,
      다시 API 를 호출할지 아니면 건너뛸지 판단할 수 있게 도와줍니다.

    입력:
    - out_dir (str | Path): raw 파일 저장 폴더입니다.
    - prefix (str): 같은 요청을 식별하기 위한 파일명 prefix 입니다.
    - force (bool): True 이면 기존 캐시를 무시하고 다시 호출합니다.

    출력:
    - Path | None:
      - 건너뛸 수 있는 기존 파일이 있으면 그 파일 경로를 반환합니다.
      - 새로 호출해야 하면 None 을 반환합니다.
    """
    if force:
        return None

    return get_latest_cached_file(out_dir, prefix)


def request_get(
    source: str,
    url: str,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> requests.Response:
    """
    목적:
    - GET 요청을 보내고, 실패하면 이해하기 쉬운 에러 로그를 남깁니다.

    입력:
    - source (str): 어떤 수집기에서 호출했는지 나타내는 이름입니다.
    - url (str): 요청할 주소입니다.
    - params (dict | None): 쿼리 파라미터입니다.
    - timeout (int): 최대 대기 시간(초)입니다.

    출력:
    - requests.Response: 성공한 HTTP 응답 객체를 돌려줍니다.

    참고:
    - 실패 시 예외를 다시 발생시킵니다.
    - 즉, 이 함수를 호출하는 쪽에서 try/except 로 한 source 의 실패를 개별 처리할 수 있습니다.
    """
    log(source, f"GET 요청을 보냅니다: {url}")
    log(source, f"요청 파라미터: {mask_params(params)}")
    if headers:
        log(source, f"요청 헤더: {headers}")

    try:
        response = requests.get(url, params=params, headers=headers, timeout=timeout)
        response.raise_for_status()
        log(source, f"응답 성공: HTTP {response.status_code}")
        return response

    except requests.exceptions.Timeout as exc:
        log(source, "응답 대기 시간이 초과되었습니다.")
        raise RuntimeError(f"{source} 요청 시간 초과: {exc}") from exc

    except requests.exceptions.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else "알 수 없음"
        body_preview = ""
        if exc.response is not None:
            body_preview = exc.response.text[:300]
        log(source, f"HTTP 오류가 발생했습니다. status={status_code}")
        if body_preview:
            log(source, f"응답 미리보기: {body_preview}")
        raise RuntimeError(f"{source} HTTP 오류: {exc}") from exc

    except requests.exceptions.RequestException as exc:
        log(source, f"네트워크 요청 중 오류가 발생했습니다: {exc}")
        raise RuntimeError(f"{source} 요청 실패: {exc}") from exc


def try_parse_json(source: str, response: requests.Response) -> Any | None:
    """
    목적:
    - 응답 본문을 JSON 으로 해석해 봅니다.
    - JSON 이 아니면 None 을 반환하여 호출한 쪽에서 다른 저장 방식을 선택하게 합니다.

    입력:
    - source (str): 어떤 수집기인지 표시하기 위한 이름입니다.
    - response (requests.Response): HTTP 응답 객체입니다.

    출력:
    - Any | None:
      - JSON 파싱 성공 시 dict 또는 list 같은 Python 객체를 반환합니다.
      - 실패 시 None 을 반환합니다.
    """
    try:
        return response.json()
    except ValueError:
        preview = response.text[:300]
        log(source, "응답을 JSON 으로 해석하지 못했습니다. raw 텍스트를 저장합니다.")
        if preview:
            log(source, f"응답 미리보기: {preview}")
        return None


def save_raw_json(data: Any, out_dir: str | Path, prefix: str) -> Path:
    """
    목적:
    - Python 객체(dict, list 등)를 raw JSON 파일로 저장합니다.

    입력:
    - data (Any): 저장할 데이터입니다.
    - out_dir (str | Path): 저장 폴더입니다.
    - prefix (str): 파일명 앞부분입니다.

    출력:
    - Path: 실제로 저장된 파일 경로를 반환합니다.
    """
    folder = ensure_dir(out_dir)
    file_path = folder / f"{prefix}_{make_timestamp()}.json"

    with file_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)

    return file_path


def save_raw_text(text: str, out_dir: str | Path, prefix: str, extension: str = "txt") -> Path:
    """
    목적:
    - JSON 으로 파싱되지 않은 응답 원문을 그대로 저장합니다.
    - XML 응답이나 HTML 오류 페이지도 일단 남겨서 나중에 분석할 수 있게 합니다.

    입력:
    - text (str): 저장할 원문 문자열입니다.
    - out_dir (str | Path): 저장 폴더입니다.
    - prefix (str): 파일명 앞부분입니다.
    - extension (str): 확장자입니다. 예: "xml", "txt"

    출력:
    - Path: 실제로 저장된 파일 경로를 반환합니다.
    """
    folder = ensure_dir(out_dir)
    file_path = folder / f"{prefix}_{make_timestamp()}.{extension}"

    with file_path.open("w", encoding="utf-8") as file:
        file.write(text)

    return file_path
