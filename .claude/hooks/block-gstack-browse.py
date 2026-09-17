#!/usr/bin/env python3
"""PreToolUse 후크: gstack browse 실행 경로를 문 Bash 명령을 막는다.

배경과 계약은 티켓 63572557 (.dira/tickets/), 정본은 docs/DESIGN.md
§브라우저는 내장이 기본이다 결정 4. gstack browse는 풀 슬롯 밖에 자기
크로미움을 띄우므로(§실측 (1)) §11-11 미러가 못 읽는다 - 큐 안에서 뜨는
브라우저는 전부 .dira/browse.sh(풀 슬롯)를 거쳐야 사람이 볼 수 있다.

block-outside-worktree.py와 판정 방식이 다르다 - 여기는 exit code 2 +
stderr 한 줄로 막는다(Claude Code PreToolUse 훅의 "blocking error" 형식).
fail open이 계약이다 - 파싱을 못 하거나 패턴이 안 맞으면 항상 통과(exit 0).
"""
import json
import re
import sys

# 실사용 빈도로 확인한 모양 셋(§실측 (1)(2), 여러 host-tool 변형 - .claude/.agents/
# .cursor/.opencode 등 - 이 전부 "skills/gstack/browse/..."로 끝난다):
#   dist/browse       - 컴파일된 browse 바이너리 자체 ($B가 가리키는 자리)
#   dist/find-browse  - 컴파일된 탐색기, bin/find-browse 셈이 위임하는 자리
#   bin/find-browse   - 셸 shim, dist가 없을 때 폴백 탐색까지 한다
#   src/server.ts     - bun run으로 데몬을 직접 띄우는 모양(§실측 (1) 서른 개의 부모)
_PATTERNS = [re.compile(r"skills/gstack/browse/" + p) for p in (
    r"dist/browse\b",
    r"dist/find-browse\b",
    r"bin/find-browse\b",
    r"src/server\.ts\b",
)]

_MESSAGE = (
    "gstack browse는 풀 밖에 자기 크로미움을 띄워 §11-11 화면 미러에 안 뜬다 - "
    "대신 bash .dira/browse.sh <해시> <같은 명령>을 쓴다."
)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return  # 파싱 실패 - 통과

    if payload.get("tool_name") != "Bash":
        return

    command = (payload.get("tool_input") or {}).get("command")
    if not command:
        return

    if not any(p.search(command) for p in _PATTERNS):
        return  # 우리 것(.dira/browse.sh - .dira/browser.sh 등)은 여기 안 걸린다

    sys.stderr.write(_MESSAGE + "\n")
    sys.exit(2)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        pass  # 무슨 에러든 통과 (fail open)
    sys.exit(0)
