#!/usr/bin/env python3
"""§4-12 §개정 2026-08-11 자체검증: FAIL 정리가 «남의 «산» 세션이 물고 있나»만 보는가.

죽은 세션의 부모가 wait에서 깨어나 FAIL 경로를 탈 때, 지금 그 티켓을 **남의 산 세션**이
물고 있으면 손대지 않아야 한다(존재만 보고 소유를 안 보면 6/6 재현 - §4-12 §얼마나 나나).
남의 세션이어도 죽었으면 종전대로 회수한다 - 조건(답 ef11d462)이 요구한 칸이다.

가짜 스트림 엔진 관용구는 test_cooldown.py에서 가져온다. 진짜 claude는 안 부른다.
실패하면 assert로 죽는다.
"""
import os
import shutil
import signal
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/fake-engine.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

# mode 파일이 갈래를 정한다:
#   own           = 정상 실패(내 sid) - 종전대로 회수돼야 한다
#   foreign_alive = 응답 전에 .wip의 session_id·pid를 산 프로세스로 바꿔치기 - 손대면 안 된다
#   foreign_dead  = 같은 바꿔치기인데 pid가 죽어 있다 - 그래도 회수돼야 한다(조건이 요구한 칸)
#   missing       = 응답 전에 .wip을 스스로 .done으로 닫는다(§4-10과 같은 자리)
# 바꿔치기는 tick.sh의 setpid(프롬프트 주입보다 먼저 적힌다)가 끝난 뒤에만 안전하다 -
# `pid:` 줄에 **숫자**가 뜰 때까지 기다린다(donedeath가 `inbox:`를 기다리는 것과 같은 이유인데,
# `pid:`는 그 앞의 assign이 이미 빈 값으로 만들어 둬서 키 존재만으로는 못 가른다 - 실측: 값을
# 안 보고 키만 보면 우리 바꿔치기가 setpid보다 먼저 끝나 setpid가 그 값을 덮어써 버린다).
ENGINE = """\
#!/bin/bash
IFS= read -r _first
printf '{{"type":"system","subtype":"init"}}\\n'
wip=$(ls -t "{tmp}/dira/tickets"/*.wip.md 2>/dev/null | head -1)
i=0
while [ "$i" -lt 25 ] && ! grep -qE '^pid: [0-9]' "$wip" 2>/dev/null; do sleep 0.2; i=$((i+1)); done
case "$(cat "{tmp}/mode")" in
  foreign_alive)
    sleep 30 &
    echo $! > "{tmp}/otherpid"
    sed -i.bak "s/^session_id:.*/session_id: foreign-fake-sid-alive/" "$wip"
    sed -i.bak "s/^pid:.*/pid: $(cat "{tmp}/otherpid")/" "$wip"
    rm -f "$wip.bak"
    ;;
  foreign_dead)
    ( exit 0 ) &
    DEADPID=$!
    wait "$DEADPID" 2>/dev/null
    sed -i.bak "s/^session_id:.*/session_id: foreign-fake-sid-dead/" "$wip"
    sed -i.bak "s/^pid:.*/pid: $DEADPID/" "$wip"
    rm -f "$wip.bak"
    ;;
  missing)
    mv "$wip" "${{wip%.wip.md}}.done.md"
    ;;
esac
printf '{{"is_error":true,"session_id":"%s","type":"result","subtype":"error_during_execution","terminal_reason":"aborted_streaming"}}\\n' "$1"
exec sleep 60
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    env = dict(os.environ, TICKET_LOCAL=local)
    tickets = os.path.join(root, "tickets")
    runlog = os.path.join(root, "workers", "runner.log")

    mkfile(os.path.join(tmp, "fake-engine.sh"), ENGINE.format(tmp=tmp), 0o755)
    w1 = mkfile(os.path.join(root, "workers", "w1.sh"),
                WORKER.format(tmp=tmp, tick=TICK), 0o755)

    def mode(m):
        mkfile(os.path.join(tmp, "mode"), m + "\n")

    def tick(**over):
        return subprocess.run([w1, "tick"], capture_output=True, text=True,
                              env=dict(env, **over), timeout=180)

    def log():
        try:
            with open(runlog, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def state_of(h):
        for name in os.listdir(tickets):
            if name.startswith(h):
                return name
        return None

    def new_ticket(h):
        mkfile(os.path.join(tickets, h + ".md"),
               "---\nticket: {}\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n".format(h))

    # --- 1: 내 sid - 종전대로 회수돼 백로그로 돌아온다 ---
    new_ticket("aaaa0001")
    mode("own")
    before = len(log())
    tick()
    added = log()[before:]
    assert "FAIL aaaa0001" in added, "own 실패가 FAIL로 안 떨어졌다:\n" + added
    assert "할당 회수 + 백로그 복귀" in added, "종전 꼬리 문구가 갈렸다:\n" + added
    assert state_of("aaaa0001") == "aaaa0001.md", \
        "내 sid 실패인데 백로그로 안 돌아왔다: " + str(state_of("aaaa0001"))
    os.remove(os.path.join(tickets, "aaaa0001.md"))

    # --- 2: 남의 sid + 산 pid - .wip이 그대로 남고 꼬리가 「회수 안 함」이다 ---
    new_ticket("bbbb0002")
    mode("foreign_alive")
    before = len(log())
    tick()
    added = log()[before:]
    assert "FAIL bbbb0002" in added, "foreign_alive가 FAIL로 안 떨어졌다:\n" + added
    assert "할당 회수 안 함 · 지금 claim은 남의 산 세션 것이다(sid=foreign-)" in added, \
        "산 남의 claim인데 회수 안 함 꼬리가 없다:\n" + added
    assert state_of("bbbb0002") == "bbbb0002.wip.md", \
        "산 남의 claim인데 .wip이 안 남았다: " + str(state_of("bbbb0002"))
    with open(os.path.join(tmp, "otherpid"), encoding="utf-8") as f:
        os.kill(int(f.read().strip()), signal.SIGKILL)
    os.remove(os.path.join(tickets, "bbbb0002.wip.md"))

    # --- 3: 남의 sid + 죽은 pid - 조건이 요구한 칸, 그래도 백로그로 돌아온다 ---
    new_ticket("cccc0003")
    mode("foreign_dead")
    before = len(log())
    tick()
    added = log()[before:]
    assert "FAIL cccc0003" in added, "foreign_dead가 FAIL로 안 떨어졌다:\n" + added
    assert "할당 회수 + 백로그 복귀" in added, "죽은 남의 claim인데 회수가 안 됐다:\n" + added
    assert state_of("cccc0003") == "cccc0003.md", \
        "죽은 남의 claim인데 백로그로 안 돌아왔다: " + str(state_of("cccc0003"))
    os.remove(os.path.join(tickets, "cccc0003.md"))

    # --- 4: 파일 없음(§4-10 회귀) - DONE ...세션은 rc=...로 죽었다 ---
    new_ticket("dddd0004")
    mode("missing")
    before = len(log())
    tick()
    added = log()[before:]
    assert "FAIL dddd0004" not in added, "닫힌 티켓인데 FAIL로 기록됐다:\n" + added
    assert "DONE dddd0004 sid=" in added and "(세션은 rc=" in added and "로 죽었다)" in added, \
        "DONE ...세션은 rc=...로 죽었다 표기가 없다:\n" + added
    assert state_of("dddd0004") == "dddd0004.done.md", \
        ".done으로 안 남았다: " + str(state_of("dddd0004"))

    print("OK - claim 소유 판정(내 sid 회수 · 산 남의 claim은 손 안 댐 · "
          "죽은 남의 claim은 회수 · 파일 없음 DONE)")
finally:
    subprocess.run(["pkill", "-f", os.path.join(tmp, "fake-engine.sh")], capture_output=True)
    otherpid = os.path.join(tmp, "otherpid")
    if os.path.exists(otherpid):
        try:
            with open(otherpid, encoding="utf-8") as f:
                os.kill(int(f.read().strip()), signal.SIGKILL)
        except (OSError, ValueError):
            pass
    shutil.rmtree(tmp, ignore_errors=True)
