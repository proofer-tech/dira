#!/usr/bin/env python3
"""PreToolUse hook: Edit/Write가 워크트리 밖 정본 트리를 건드리면 거부한다.

배경과 요구는 티켓 19b61c53 (.dira/tickets/), 관련 프로토콜은
.dira/protocols/AGENTS.md. 여기서는 fail open이 계약이다 - 이 스크립트가
죽거나 판정을 못 하면 항상 통과시킨다(exit 0, 출력 없음).
"""
import json
import os
import subprocess
import sys


def git(args, cwd):
    try:
        r = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True, timeout=5)
    except Exception:
        return None
    if r.returncode != 0:
        return None
    out = r.stdout.strip()
    return out or None


def under(path, root):
    path = path.rstrip(os.sep)
    root = root.rstrip(os.sep)
    return path == root or path.startswith(root + os.sep)


def deny(real, suggested):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                "이 경로는 정본 트리(push 대상)입니다: " + real + " - "
                "이 세션의 워크트리 경로를 대신 쓰세요: " + suggested
            ),
        }
    }))


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return  # 파싱 실패 - 통과

    if payload.get("tool_name") not in ("Edit", "Write"):
        return

    file_path = (payload.get("tool_input") or {}).get("file_path")
    if not file_path:
        return

    cwd = os.getcwd()
    if not os.path.isabs(file_path):
        file_path = os.path.join(cwd, file_path)
    real = os.path.realpath(file_path)

    git_dir = git(["rev-parse", "--path-format=absolute", "--git-dir"], cwd)
    git_common_dir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd)
    if not git_dir or not git_common_dir:
        return  # git 저장소가 아니다 - 이 훅의 관심사가 아니다

    if os.path.realpath(git_dir) == os.path.realpath(git_common_dir):
        return  # 정본 체크아웃 자신에서 뜬 세션 - 안 막는다

    worktree_root = git(["rev-parse", "--show-toplevel"], cwd)
    if not worktree_root:
        return
    worktree_root = os.path.realpath(worktree_root)
    main_root = os.path.realpath(os.path.dirname(git_common_dir))

    if under(real, worktree_root):
        return  # 워크트리 자신 - 허용

    dira_link = os.path.join(worktree_root, ".dira")
    if os.path.islink(dira_link) or os.path.isdir(dira_link):
        dira_real = os.path.realpath(dira_link)
        if under(real, dira_real):
            return  # 큐(.dira, 심링크 너머) - 허용

    if under(real, main_root):
        suggested = worktree_root + real[len(main_root):]
        deny(real, suggested)
        return

    # 정본 트리도 워크트리도 .dira도 아니다 - 이 훅의 관심사 밖, 허용
    return


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # 무슨 에러든 통과 (fail open)
    sys.exit(0)
