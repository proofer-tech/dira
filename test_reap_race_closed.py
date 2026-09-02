#!/usr/bin/env python3
"""P360-2 자체검증(엔진 회로): 세션이 죽어 `$TPATH`가 사라졌을 때, 부모가 그 이유를
`.done`(자력 완료)과 리퍼 경합 패배로 갈라 적는가. `tick.sh` 전 구간을 실제로 태운다.
실패하면 assert로 죽는다.
"""
import os
import sys
import shutil
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{cwd}"
TICKET_INPROGRESS=".wip"
TICKET_DONE=".done"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{engine}" "{{prompt}}" "{{sid}}")
. "{tick}"
"""

# rc!=0으로 죽으면서, 죽기 **직전** $TPATH를 넘겨받은 자리로 옮긴다(파일이 사라진 뒤에야
# 부모가 `[ -f "$TPATH" ]`를 잰다 - 이 스크립트의 mv가 그 경합의 이긴 쪽을 흉내낸다).
ENGINE = """\
#!/bin/bash
printf '{{"session_id":"%s"}}\\n' "$2"
mv "{src}" "{dst}"
exit 1
"""


def mk(root, h):
    d = os.path.join(root, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\n---\n\n## 목표\n테스트\n".format(h))
    return p


def mkworker(root, name, body):
    d = os.path.join(root, "workers")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".sh")
    with open(p, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(p, 0o755)
    return p


def run(worker, local, timeout=30):
    env = dict(os.environ, TICKET_LOCAL=local)
    r = subprocess.run([worker, "tick"], capture_output=True, text=True, env=env, timeout=timeout)
    return r.returncode, r.stdout + r.stderr


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    # 사례 1: 세션이 스스로 `.done`까지 닫고 죽었다 -> 부모가 DONE으로 적어야 한다(진짜 완료)
    root1 = os.path.join(tmp, "closed", ".dira")
    mk(root1, "beef0001")
    eng1 = os.path.join(tmp, "engine-closed.sh")
    with open(eng1, "w", encoding="utf-8") as f:
        f.write(ENGINE.format(
            src=os.path.join(root1, "tickets", "beef0001.wip.md"),
            dst=os.path.join(root1, "tickets", "beef0001.done.md")))
    os.chmod(eng1, 0o755)
    w1 = mkworker(root1, "w1", WORKER.format(cwd=tmp, engine=eng1, tick=TICK))
    local1 = os.path.join(tmp, "local1")
    os.makedirs(local1)
    rc, out = run(w1, local1)
    with open(os.path.join(root1, "workers", "runner.log"), encoding="utf-8") as f:
        text1 = f.read()
    assert "DONE beef0001" in text1, "자력 완료를 DONE으로 안 적었다\n" + text1
    assert "세션은 rc=" in text1, "자력 완료 사유(rc로 죽었다)가 안 붙었다\n" + text1

    # 사례 2: 세션이 죽고, 그 사이 남의 리퍼가 파일을 열림으로 먼저 가져갔다(경합 패배)
    #    -> DONE을 적으면 안 된다(P360-2 결함 재현: 옛 코드는 여기서도 DONE을 적었다)
    root2 = os.path.join(tmp, "raced", ".dira")
    mk(root2, "beef0002")
    eng2 = os.path.join(tmp, "engine-raced.sh")
    with open(eng2, "w", encoding="utf-8") as f:
        f.write(ENGINE.format(
            src=os.path.join(root2, "tickets", "beef0002.wip.md"),
            dst=os.path.join(root2, "tickets", "beef0002.md")))   # 리퍼가 접미사 없이 되돌린 모양
    os.chmod(eng2, 0o755)
    w2 = mkworker(root2, "w1", WORKER.format(cwd=tmp, engine=eng2, tick=TICK))
    local2 = os.path.join(tmp, "local2")
    os.makedirs(local2)
    rc, out = run(w2, local2)
    with open(os.path.join(root2, "workers", "runner.log"), encoding="utf-8") as f:
        text2 = f.read()
    assert "DONE beef0002" not in text2, \
        "경합 패배인데 DONE으로 적었다(한도로 죽은 세션이 완료로 남는 결함 재발)\n" + text2
    assert "리퍼가 먼저 가져갔다" in text2, "경합 패배 사유가 안 적혔다\n" + text2

    print("PASS 2/2")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
