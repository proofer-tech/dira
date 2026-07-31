#!/usr/bin/env python3
"""참견 입구(FIFO) 자체검증: 스트리밍 입력 엔진일 때만 입구가 서는가.

진짜 claude를 부르지 않는다 -- stdin JSONL을 받아 적고 `result` 줄을 뱉은 뒤 스스로는
안 끝나는 가짜 스트림 엔진으로 판정한다(그게 실측된 진짜 엔진의 행동이다).
실패하면 assert로 죽는다.
"""
import os
import re
import sys
import json
import stat
import time
import shutil
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
PY = os.path.join(HERE, "tickets.py")

WORKER = """\
#!/bin/bash
TICKET_NAME="strm"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/fake-stream.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

# 가짜 스트림 엔진: 최초 프롬프트를 받아 적고 -> result가 아닌 줄을 마지막에 세운 채 참견을
# 기다리고 -> 진짜 result를 뱉고 -> 스스로는 안 끝난다(sleep 60). 진짜 엔진의 행동이 이렇다.
#   기다리는 4초 = 스트림이 멎었다고 죽이면 참견을 못 받고 잘린다(아래 2줄 단언이 깨진다).
#   result 줄 = 실측된 키 순서(`is_error`가 먼저). 접두사 매치로는 안 잡힌다.
ENGINE = """\
#!/bin/bash
IFS= read -r first
printf '%s\\n' "$first" >> "{tmp}/engine-stdin.jsonl"
printf '{{"type":"system","subtype":"init"}}\\n'
cat "{tmp}/decoy.jsonl"
sleep 4
IFS= read -r -t 20 more && printf '%s\\n' "$more" >> "{tmp}/engine-stdin.jsonl"
printf '{{"is_error":false,"num_turns":3,"session_id":"%s","type":"result","subtype":"success"}}\\n' "$1"
sleep 60
"""


def mk(root, name, fm=""):
    d = os.path.join(root, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\ntitle: t\n{}---\n\n## Goal\ntest\n".format(name, fm))
    return p


def fm_get(path, key):
    with open(path, encoding="utf-8") as f:
        for line in f.read().split("\n")[1:]:
            if line.strip() == "---":
                break
            m = re.match(r"^" + key + r":\s*(.*)$", line)
            if m:
                return m.group(1).strip()
    return ""


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    os.makedirs(os.path.join(root, "workers"), exist_ok=True)
    w = os.path.join(root, "workers", "strm.sh")
    with open(w, "w", encoding="utf-8") as f:
        f.write(WORKER.format(tmp=tmp, tick=TICK))
    os.chmod(w, 0o755)
    with open(os.path.join(tmp, "decoy.jsonl"), "w", encoding="utf-8") as f:
        f.write(json.dumps({"type": "assistant", "message": {"role": "assistant",
                            "content": "일하는 중"}},
                           ensure_ascii=False, separators=(",", ":")) + "\n")
    eng = os.path.join(tmp, "fake-stream.sh")
    with open(eng, "w", encoding="utf-8") as f:
        f.write(ENGINE.format(tmp=tmp))
    os.chmod(eng, 0o755)

    wip = mk(root, "feed0001")[:-3] + ".wip.md"
    env = dict(os.environ, TICKET_LOCAL=local)
    started = time.time()
    proc = subprocess.Popen([w, "tick"], stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, env=env)

    # 1) 도는 동안 fm에 inbox: 가 있고 그 경로가 진짜 FIFO다
    inbox = ""
    for _ in range(120):
        if os.path.exists(wip):
            inbox = fm_get(wip, "inbox")
            if inbox:
                break
        time.sleep(0.25)
    assert inbox, "도는 동안 fm에 inbox:가 안 써졌다"
    assert stat.S_ISFIFO(os.stat(inbox).st_mode), "inbox 경로가 FIFO가 아니다: " + inbox

    # 2) 그 입구로 참견 한 줄을 밀어 넣으면 엔진의 stdin에 도착한다
    with open(inbox, "w", encoding="utf-8") as f:
        f.write('{"type":"user","message":{"role":"user",'
                '"content":"참견-마커"}}\n')

    proc.wait(timeout=90)
    elapsed = time.time() - started
    # 엔진은 result 뒤 60초를 잔다. tick.sh가 result 줄을 보고 죽이지 않으면 여기서 걸린다.
    assert elapsed < 45, "result 줄을 보고 안 끝냈다({:.1f}s)".format(elapsed)

    with open(os.path.join(tmp, "engine-stdin.jsonl"), encoding="utf-8") as f:
        lines = [l for l in f.read().split("\n") if l.strip()]
    assert len(lines) == 2, "엔진 stdin에 2줄이 안 왔다: {}".format(lines)
    assert '"type":"user"' in lines[0] and "please pick up feed0001" in lines[0], \
        "최초 프롬프트가 FIFO에 JSON 한 줄로 안 갔다: " + lines[0]
    assert "참견-마커" in lines[1], "참견이 도는 세션에 안 닿았다: " + lines[1]

    # 3) 세션이 끝나면 FIFO는 남지 않는다
    assert not os.path.exists(inbox), "세션 뒤에 FIFO가 남았다: " + inbox

    # 4) result가 성공이면 RC(우리가 죽여서 143)와 무관하게 성공 처리다 -- 할당이 안 풀린다
    with open(os.path.join(root, "workers", "runner.log"), encoding="utf-8") as f:
        rlog = f.read()
    assert "DISPATCH feed0001" in rlog and "DONE feed0001" in rlog, \
        "result 줄로 성공 판정을 못 했다\n" + rlog
    assert fm_get(wip, "session_id"), "성공했는데 할당이 회수됐다"

    # 5) clear는 session_id·pid와 함께 inbox도 비운다
    subprocess.run([sys.executable, PY, "clear", wip], check=True, timeout=30)
    assert fm_get(wip, "inbox") == "", "clear가 inbox를 안 비웠다"
    assert fm_get(wip, "session_id") == "", "clear가 session_id를 안 비웠다"

    print("PASS 참견 입구(FIFO)·최초 프롬프트 JSONL·result 종료·clear")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
