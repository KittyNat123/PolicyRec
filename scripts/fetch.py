"""
전체 수집 실행 스크립트입니다.

이 스크립트의 목표:
- Bizinfo, K-Startup, Youthcenter 수집기를 순서대로 실행합니다.
- 하나가 실패해도 나머지는 계속 진행합니다.
- 어떤 source 가 성공했고, 무엇이 실패했고, 무엇이 캐시로 건너뛰었는지 분명하게 보여줍니다.
- 필요하면 정규화 단계까지 이어서 실행할 수 있게 합니다.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


# scripts/fetch.py 를 직접 실행할 때도 app/ 패키지를 import 할 수 있도록
# 프로젝트 루트를 sys.path 에 추가합니다.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.collectors.biz import fetch_bizinfo
from app.collectors.kst import fetch_kstartup
from app.collectors.youth import fetch_youthcenter
from app.norm import save_combined_csv


def parse_args() -> argparse.Namespace:
    """
    목적:
    - 명령줄 인자를 읽어 실행 옵션을 정리합니다.

    입력:
    - 없음

    출력:
    - argparse.Namespace: 사용자가 전달한 옵션이 담긴 객체입니다.
    """
    parser = argparse.ArgumentParser(description="PolicyRec raw 데이터 수집 스크립트")
    parser.add_argument(
        "--sources",
        nargs="+",
        default=["biz", "kst", "youth"],
        choices=["biz", "kst", "youth"],
        help="실행할 source 목록입니다. 기본값은 biz kst youth 입니다.",
    )
    parser.add_argument(
        "--page",
        type=int,
        default=1,
        help="가져올 페이지 번호입니다. 기본값은 1 입니다.",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=10,
        help="한 번에 가져올 개수입니다. 기본값은 10 입니다.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="기존 캐시가 있어도 다시 API 를 호출합니다.",
    )
    parser.add_argument(
        "--normalize",
        action="store_true",
        help="수집 후 combined.csv 생성까지 이어서 실행합니다.",
    )
    return parser.parse_args()


def print_summary(results: list[dict]) -> None:
    """
    목적:
    - 실행 결과를 사람이 읽기 쉬운 요약 형태로 출력합니다.

    입력:
    - results (list[dict]): 각 수집기 함수가 돌려준 결과 목록입니다.

    출력:
    - 없음 (None)
    """
    print("\n===== 수집 결과 요약 =====")
    for result in results:
        status = "성공"
        if not result["success"]:
            status = "실패"
        elif result["skipped"]:
            status = "건너뜀"

        print(f"- {result['source']}: {status}")
        print(f"  설명: {result['message']}")
        if result["path"]:
            print(f"  파일: {result['path']}")


def main() -> int:
    """
    목적:
    - 전체 수집 실행 흐름을 관리합니다.

    입력:
    - 없음

    출력:
    - int: 종료 코드입니다. 모두 성공하면 0, 하나라도 실패하면 1 을 반환합니다.
    """
    args = parse_args()
    results: list[dict] = []

    fetch_functions = {
        "biz": lambda: fetch_bizinfo(page=args.page, page_size=args.page_size, force=args.force),
        "kst": lambda: fetch_kstartup(page=args.page, page_size=args.page_size, force=args.force),
        "youth": lambda: fetch_youthcenter(page=args.page, page_size=args.page_size, force=args.force),
    }

    print("PolicyRec 수집을 시작합니다.")
    print(f"실행 대상 source: {', '.join(args.sources)}")
    print(f"page={args.page}, page_size={args.page_size}, force={args.force}")

    for source_name in args.sources:
        print(f"\n--- {source_name} 수집 시작 ---")

        try:
            result = fetch_functions[source_name]()
        except Exception as exc:
            # 수집기 내부에서도 예외를 최대한 처리하지만,
            # 혹시 예상 못 한 예외가 올라와도 전체 파이프라인은 계속 가게 합니다.
            result = {
                "success": False,
                "skipped": False,
                "source": source_name,
                "path": None,
                "message": f"예상하지 못한 예외: {exc}",
            }

        results.append(result)

    print_summary(results)

    if args.normalize:
        print("\n===== 정규화 시작 =====")
        try:
            output_csv = save_combined_csv()
            print(f"정규화 완료: {output_csv}")
        except Exception as exc:
            print(f"정규화 실패: {exc}")

    any_failure = any(not result["success"] for result in results)
    return 1 if any_failure else 0


if __name__ == "__main__":
    raise SystemExit(main())
