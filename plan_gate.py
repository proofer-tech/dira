#!/usr/bin/env python3
"""P536 PreToolUse 훅: 지금 티켓의 마지막 `## 진행 계획` 절이 어긋나면 도구 호출을 막는다.

stdin은 훅 입력 JSON, 환경은 DIRA_PLAN_GATE_FILE(지금 티켓 경로가 든 런타임 파일),
DIRA_PLAN_GATE_LOG(runner.log), TICKET_PLAN_GATE_GRACE(초, 기본 120). 막으면 exit 2와 stderr 한 줄,
그 밖의 모든 경우(판정 실패 포함)는 exit 0이다. 표준 라이브러리만 쓴다.
"""
import json
import os
import re
import sys
import time
from datetime import datetime

MSG = {
    "section": "## 진행 계획을 먼저 세우고, 지금 하는 항목 줄 끝에 시작 시각(date +%FT%T%z)을 붙이세요.",
    "open": "지금 하는 ## 진행 계획 항목 줄 끝에 시작 시각(date +%FT%T%z)을 붙이세요. 끝난 항목이 있으면 먼저 켜세요.",
    "multi": "진행중 항목은 하나여야 합니다. 끝난 항목을 끝 시각과 함께 켜세요.",
}
BOX = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s*(.*)$")
STARTED = re.compile(r"\(\s*\d{4}-\d\d-\d\dT[^)>]*\)\s*$")


def last_plan_section(text):
    """마지막 `## 진행 계획` 절의 줄들. 없으면 None."""
    lines = text.split("\n")
    idx = [i for i, l in enumerate(lines) if re.match(r"^##\s+진행 계획\s*$", l)]
    if not idx:
        return None
    out = []
    for l in lines[idx[-1] + 1:]:
        if l.startswith("## "):
            break
        out.append(l)
    return out


def classify(sec):
    """(미착수, 진행중) 개수. 완료와 취소는 안 센다."""
    todo = doing = 0
    for l in sec:
        m = BOX.match(l)
        if not m or m.group(1) != " ":
            continue
        rest = m.group(2).strip()
        if rest.startswith("~~"):
            continue
        if STARTED.search(rest) and "->" not in rest:
            doing += 1
        else:
            todo += 1
    return todo, doing


def assigned_at(text):
    m = re.search(r"^assigned_at:\s*(\S+)", text.split("\n---", 2)[0], re.M)
    if not m:
        return None
    try:
        return datetime.fromisoformat(m.group(1)).timestamp()
    except ValueError:
        return None


def judge(text, grace, now):
    """막을 갈래(section|open|multi) 또는 None."""
    sec = last_plan_section(text)
    if sec is None:
        at = assigned_at(text)
        return "section" if at is not None and now - at > grace else None
    todo, doing = classify(sec)
    if doing >= 2:
        return "multi"
    if todo >= 1 and doing == 0:
        return "open"
    return None


def exempt(data, thash):
    """결정 3: 도구 입력에 티켓 해시가 있거나 Bash 첫 낱말이 date."""
    ti = data.get("tool_input")
    if thash in json.dumps(ti, ensure_ascii=False):
        return True
    if data.get("tool_name") == "Bash" and isinstance(ti, dict):
        words = str(ti.get("command", "")).split()
        return bool(words) and words[0] == "date"
    return False


def main():
    try:
        data = json.load(sys.stdin)
        with open(os.environ["DIRA_PLAN_GATE_FILE"], encoding="utf-8") as f:
            path = f.read().strip()
        thash = os.path.basename(path).split(".")[0]
        if not thash or exempt(data, thash):
            return 0
        with open(path, encoding="utf-8") as f:
            text = f.read()
        grace = float(os.environ.get("TICKET_PLAN_GATE_GRACE") or 120)
        kind = judge(text, grace, time.time())
    except Exception:
        return 0  # 결정 5: 판정 실패는 통과
    if kind is None:
        return 0
    log = os.environ.get("DIRA_PLAN_GATE_LOG")
    if log:
        try:
            with open(log, "a", encoding="utf-8") as f:
                f.write("%s [plan_gate] GATE %s %s\n" % (time.strftime("%F %T"), thash, kind))
        except OSError:
            pass
    sys.stderr.write(MSG[kind] + "\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
