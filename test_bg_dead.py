#!/usr/bin/env python3
"""P547 결정 1 자체검증 - result 직후 스스로 끝난 세션도 밀림을 판정해 FAIL에 reason=bg를 단다.
픽스처는 proofer 티켓 39382196의 실제 로그(2회차 w3, 3회차 w6)에서 result 앞뒤 줄만 잘랐다.
가짜 엔진은 init을 뱉고 프롬프트 한 줄을 읽은 뒤 픽스처를 그대로 흘리고 바로 끝난다.
실패하면 assert로 죽는다.
"""
__import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())
import os
import shutil
import subprocess
import tempfile
import time
import re

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
FIX = os.path.join(HERE, "fixtures")

WORKER = """\
#!/bin/bash
TICKET_NAME="bg"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_PLAN_NUDGE=0
TICKET_REUSE=0
TICKET_BG_GRACE=3
TICKET_BG_MAX=2
TICKET_ENGINE=("{tmp}/fake-stream.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

ENGINE = """\
#!/bin/bash
printf '{{"type":"system","subtype":"init"}}\\n'
IFS= read -r _first
cat "{fixture}"
"""

RESULT_ONLY = """\
{"type":"assistant","message":{"content":[{"type":"text","text":"done for now"}]}}
{"type":"result","subtype":"success","is_error":false,"session_id":"fake-sid","result":"ok"}
{"type":"system","subtype":"background_tasks_changed","tasks":[]}
"""

FAIL_TAIL = "세션이 ok로 끝났는데 .wip을 남겼다"


def run(fixture):
    tmp = os.path.realpath(tempfile.mkdtemp())
    try:
        root = os.path.join(tmp, "dira")
        local = os.path.join(tmp, "local")
        os.makedirs(local)
        os.makedirs(os.path.join(root, "workers"))
        os.makedirs(os.path.join(root, "protocols"))
        os.makedirs(os.path.join(root, "tickets"))
        shutil.copy2(os.path.join(HERE, "packages", "dira-protocols", "CORE.md"),
                     os.path.join(root, "protocols", "CORE.md"))
        w = os.path.join(root, "workers", "bg.sh")
        with open(w, "w", encoding="utf-8") as f:
            f.write(WORKER.format(tmp=tmp, tick=TICK))
        os.chmod(w, 0o755)
        eng = os.path.join(tmp, "fake-stream.sh")
        with open(eng, "w", encoding="utf-8") as f:
            f.write(ENGINE.format(fixture=fixture))
        os.chmod(eng, 0o755)
        with open(os.path.join(root, "tickets", "bg0001.md"), "w", encoding="utf-8") as f:
            f.write("---\nticket: bg0001\ntitle: t\n---\n\n## Goal\ntest\n")
        env = dict(os.environ, TICKET_LOCAL=local)
        subprocess.run([w, "tick"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       env=env, timeout=120)
        lg = os.path.join(root, "workers", "runner.log")
        return open(lg, encoding="utf-8").read() if os.path.exists(lg) else ""
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def fail_line(log):
    ls = [l for l in log.split("\n") if FAIL_TAIL in l]
    assert ls, "종전 FAIL 줄이 없다\n" + log
    return ls[-1]


for name in ("bg_dead_w3_39382196.jsonl", "bg_dead_w6_39382196.jsonl"):
    log = run(os.path.join(FIX, name))
    assert "reason=bg" in fail_line(log), name + ": 스스로 끝난 세션인데 reason=bg가 없다\n" + log
    print("PASS - " + name + " -> FAIL reason=bg")

tmp = tempfile.mkdtemp()
p = os.path.join(tmp, "plain.jsonl")
open(p, "w", encoding="utf-8").write(RESULT_ONLY)
log = run(p)
shutil.rmtree(tmp, ignore_errors=True)
assert "reason=bg" not in fail_line(log), "밀림 문구가 없는데 reason=bg가 붙었다\n" + log
print("PASS - 밀림 문구 없는 픽스처는 reason=bg 없는 FAIL")

# bg_pending이 Monitor 문구만 있는 구간에서 참이다(함수만 떼어 본다).
src = open(TICK, encoding="utf-8").read()
fn = re.search(r"^bg_pending\(\) \{.*?^\}", src, re.S | re.M).group(0)
tmp = tempfile.mkdtemp()
out = os.path.join(tmp, "o.jsonl")
tp = os.path.join(tmp, "t.wip.md")
open(tp, "w").write("x")
open(out, "w").write('{"type":"user","message":"Monitor started (task abc, expires in 5m)"}\n')
r = subprocess.run(["bash", "-c", fn + '\nbg_pending ok'], env=dict(os.environ, OUTF=out, OUTOFFSET="0", TPATH=tp))
shutil.rmtree(tmp, ignore_errors=True)
assert r.returncode == 0, "Monitor started (task 만 있는 구간인데 bg_pending이 거짓이다"
print("PASS - bg_pending: Monitor started (task 만 있어도 참")
