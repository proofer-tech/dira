#!/usr/bin/env python3
"""디스패치 감시자 판정 - docs/DESIGN.md `§디스패치 감시자` §사람을 부르는 자리는 좁다
(P428-3, 티켓 4eb963cd).

`alert()`가 유일한 진입점이다. `diagnose()`(watchdog_gates)가 낸 줄 중 **`사람`** 줄과,
`자력`인데 `recover`(P428-2, watchdog_gates와 같은 디렉터리의 `<루트>/workers/.watchdog-<코드>`
표식 파일로 이미 한 번 손댄 적이 있는데도 여전히 걸리는 줄만 사람을 부른다. `recover`가
아직 없어도(표식 파일이 없으면) 안전한 쪽으로 - 자력 줄은 그냥 넘어간다.

부르는 방법 둘 다 이 파일이 낸다 - `kind: feedback`/`persona: pm` 티켓 한 장(코드마다 하나,
열려 있으면 새로 안 냄)과 `osascript` 알림(있든 없든 티켓 발행은 그대로 끝난다).
"""
import json
import os
import subprocess
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import watchdog_gates as _gates  # noqa: E402


# ponytail: 코드별 처방을 아는 만큼만 적는다. 모르는 코드는 관측 줄을 그대로 읽고 로그를
# 직접 보라는 일반 문구로 떨어진다 - 표를 새 코드마다 늘릴 필요가 없다.
COMMANDS = {
    "G2": "GUI에서 이 프로젝트를 다시 등록해 전용 워크트리를 만들어 준다",
    "G3": "계정을 늘리거나 tokens.json의 소진된 토큰이 풀릴 때까지 기다려 준다",
    "G4": "claude setup-token",
    "G6": "GUI의 워커 화면에서 그 워커 줄의 '재등록' 버튼을 눌러 crontab 줄을 다시 심어 준다",
    "G7": "이 줄의 원문대로 사람 세션에서 git을 한 번 실행해 도구 라이선스에 동의해 준다",
}
DEFAULT_COMMAND = "자동 복구가 이미 한 번 실패했다. workers/runner.log에서 원인을 직접 확인해 준다"

TEMPLATE = """---
ticket: {hash}
title: 감시자 - {code} 사람이 쳐야 풀린다
kind: feedback
persona: pm
watchdog_code: {code}
---

## Goal
디스패치 감시자(`watchdog.sh alert`)가 스스로 못 고치는 멎음을 봤다. 계약은
`docs/DESIGN.md` §디스패치 감시자가 정본이다.

## 관측
{code} {who} {text}

## 사람이 칠 명령
{command}
"""


def parse_line(line):
    """`<코드> <자력|사람> <한 줄>`을 셋으로 가른다."""
    code, who, text = line.split(" ", 2)
    return code, who, text


def needs_alert(code, who, root):
    """`사람` 줄이면 무조건, `자력` 줄이면 recover 표식이 이미 있을 때만."""
    if who == "사람":
        return True
    marker = os.path.join(root, "workers", f".watchdog-{code}")
    return os.path.isfile(marker)


def command_for(code):
    return COMMANDS.get(code, DEFAULT_COMMAND)


def open_ticket_codes(tickets_dir):
    """열린(`.done.md` 아닌) 티켓 중 `watchdog_code:` 프론트매터가 있는 코드 집합."""
    codes = set()
    if not os.path.isdir(tickets_dir):
        return codes
    for name in os.listdir(tickets_dir):
        if not name.endswith(".md") or name.endswith(".done.md"):
            continue
        path = os.path.join(tickets_dir, name)
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                for _ in range(20):
                    line = f.readline()
                    if not line:
                        break
                    line = line.strip()
                    if line.startswith("watchdog_code:"):
                        codes.add(line.split(":", 1)[1].strip())
                        break
        except OSError:
            continue
    return codes


def write_ticket(tickets_dir, code, who, text, command):
    """8자 hex 파일명으로 `tickets/`에 직접 새 파일을 만든다(O_EXCL, 하위 디렉터리 없음)."""
    os.makedirs(tickets_dir, exist_ok=True)
    for _ in range(5):
        h = uuid.uuid4().hex[:8]
        path = os.path.join(tickets_dir, f"{h}.md")
        body = TEMPLATE.format(hash=h, code=code, who=who, text=text, command=command)
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            continue
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
        return h
    return None


def notify_real(title, message):
    try:
        subprocess.run(
            ["osascript", "-e",
             f"display notification {json.dumps(message)} with title {json.dumps(title)}"],
            capture_output=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        pass


def alert(root, diagnose_lines=None, notify_fn=notify_real):
    """사람을 불러야 할 줄마다 알림 + (코드당 하나) 티켓. 새로 낸 해시 목록을 반환한다."""
    if diagnose_lines is None:
        diagnose_lines = _gates.diagnose(root)
    tickets_dir = os.path.join(root, "tickets")
    existing = open_ticket_codes(tickets_dir)
    created = []
    for line in diagnose_lines:
        code, who, text = parse_line(line)
        if not needs_alert(code, who, root):
            continue
        notify_fn(f"dira 감시자: {code} 사람이 필요하다", text)
        if code in existing:
            continue
        h = write_ticket(tickets_dir, code, who, text, command_for(code))
        if h:
            created.append(h)
            existing.add(code)
    return created


def main(argv):
    root = argv[1] if len(argv) > 1 else os.getcwd()
    for h in alert(root):
        print(h)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
