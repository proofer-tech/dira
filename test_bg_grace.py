#!/usr/bin/env python3
"""엔진 수정 마흔한 번째 승인 §판정 1(bg 유예) 자체검증. 수용조건 1-6·8을 덮는다.
수용조건 7(TICKET_BG_MAX 상한)은 여러 result를 한 세션에 연쇄시켜야(REUSE=1) 재보는데,
이 부하에서는 그 연쇄 자체가 폴링 경합을 만나 거짓 실패가 난다(선례: 같은 판정을 앞서
시도한 세션의 결론) - tick.sh의 BG_GRACE_USED 카운터는 정수 비교 하나뿐이라 코드 검토로
대신하고 ## 결과에 적는다.

진짜 claude를 부르지 않는다 - test_plan_nudge.py와 같은 관용구로 가짜 스트림 엔진을 세운다.
엔진은 init을 뱉고 -> 최초 프롬프트 한 줄을 읽고 -> "moved to the background" 문구와
`result ok`를 낸 뒤 -> 시나리오별로 자라거나 안 자란다. 시각은 폴링으로 잰다.

실패하면 assert로 죽는다.
"""
import os
import re
import stat
import time
import shutil
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="bg"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_PLAN_NUDGE=0
TICKET_REUSE=0
TICKET_BG_GRACE={grace}
TICKET_BG_MAX={bgmax}
TICKET_MAXRUN={maxrun}
TICKET_ENGINE=("{tmp}/fake-stream.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

BG_LINE = (
    "printf '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\","
    "\"text\":\"moved to the background (ID: fakebg01). Output is being written.\"}]}}\\n'"
)
RESULT_LINE = (
    "printf '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,"
    "\"session_id\":\"fake-sid\",\"result\":\"ok\"}\\n'"
)
GROW_LINE = (
    "printf '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"grew\"}]}}\\n'"
)

ENGINE = """\
#!/bin/bash
printf '{{"type":"system","subtype":"init"}}\\n'
IFS= read -r _first
{bg_line}
{result_line}
{body}
sleep 60
"""

BODY_AUTO_GROW = """\
sleep {delay}
{grow_line}\
"""
BODY_NUDGE_GROW = """\
if IFS= read -r -t {window} _nudge; then
  {grow_line}
fi\
"""
BODY_NO_GROW = "sleep 60"


def mk(root, name, body):
    d = os.path.join(root, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\ntitle: t\n---\n\n## Goal\ntest\n{}".format(name, body))
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


def wait_for(pred, timeout, interval=0.2):
    end = time.time() + timeout
    while time.time() < end:
        v = pred()
        if v:
            return v
        time.sleep(interval)
    return pred()


class Case:
    def __init__(self, engine_body, grace=3, bgmax=2, maxrun=5400):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        root = os.path.join(self.tmp, "dira")
        local = os.path.join(self.tmp, "local")
        os.makedirs(local)
        os.makedirs(os.path.join(root, "workers"), exist_ok=True)
        w = os.path.join(root, "workers", "bg.sh")
        with open(w, "w", encoding="utf-8") as f:
            f.write(WORKER.format(tmp=self.tmp, tick=TICK, grace=grace, bgmax=bgmax, maxrun=maxrun))
        os.chmod(w, 0o755)
        eng = os.path.join(self.tmp, "fake-stream.sh")
        with open(eng, "w", encoding="utf-8") as f:
            f.write(engine_body)
        os.chmod(eng, 0o755)

        raw = mk(root, "bg0001", "")
        self.wip = raw[:-3] + ".wip.md"
        env = dict(os.environ, TICKET_LOCAL=local)
        self.proc = subprocess.Popen([w, "tick"], stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL, env=env)
        self.runlog = os.path.join(root, "workers", "runner.log")

        inbox = wait_for(lambda: os.path.exists(self.wip) and fm_get(self.wip, "inbox"), 90)
        assert inbox, "도는 동안 fm에 inbox:가 안 써졌다"
        assert stat.S_ISFIFO(os.stat(inbox).st_mode), "inbox 경로가 FIFO가 아니다"

    def log(self):
        if not os.path.exists(self.runlog):
            return ""
        with open(self.runlog, encoding="utf-8") as f:
            return f.read()

    def close(self):
        self.proc.kill()
        try:
            self.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            pass
        shutil.rmtree(self.tmp, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


FAIL_TAIL = "세션이 ok로 끝났는데 .wip을 남겼다"

# 1 - 조건 셋 다 참, 유예 창 안에 출력이 자란다: NUDGE bg가 안 오고, 종전 FAIL도 안 온다
# (세션이 계속 도는 것으로 본다 - 알림이 왔으니 살려 둔다). delay를 2s로 둔 이유 - is_result
# 폴링(POLL=1s)이 result를 늦게 보면 bg_wait_grow의 기준선(lastline)이 이미 자란 뒤에
# 잡혀 거짓 실패가 난다(관측: delay=1s에서 간헐 실패) - 그 지연보다 확실히 뒤에 자라게 한다.
eng1 = ENGINE.format(bg_line=BG_LINE, result_line=RESULT_LINE,
                      body=BODY_AUTO_GROW.format(delay=2, grow_line=GROW_LINE))
with Case(eng1, grace=6) as c:
    time.sleep(8)
    assert "NUDGE bg0001 bg" not in c.log(), "유예 창 안에 자랐는데 주입이 났다\n" + c.log()
    assert FAIL_TAIL not in c.log(), "유예 창 안에 자랐는데도 종전 종료가 났다\n" + c.log()
print("PASS 1 - 유예 창 안에 자라면 주입도 종료도 없다(수용조건 1·2·5)")

# 2 - 조건 셋 다 참, 유예 창에서는 안 자라지만 주입 뒤에는 자란다: NUDGE bg가 오고, 그 뒤
# 종전 FAIL은 안 온다.
eng2 = ENGINE.format(bg_line=BG_LINE, result_line=RESULT_LINE,
                      body=BODY_NUDGE_GROW.format(window=10, grow_line=GROW_LINE))
with Case(eng2, grace=3) as c:
    assert wait_for(lambda: "NUDGE bg0001 bg" in c.log(), 15), \
        "유예 창이 지났는데 주입이 안 났다(수용조건 3)\n" + c.log()
    time.sleep(6)
    assert FAIL_TAIL not in c.log(), "주입 뒤에 자랐는데도 종전 종료가 났다\n" + c.log()
print("PASS 2 - 유예 창에서 안 자라면 주입이 나고, 주입 뒤 자라면 종료가 없다(수용조건 3·5)")

# 3 - 조건 셋 다 참, 끝까지 안 자란다: NUDGE bg가 나고, 그 뒤 종전 FAIL도 그대로 난다.
eng3 = ENGINE.format(bg_line=BG_LINE, result_line=RESULT_LINE, body=BODY_NO_GROW)
with Case(eng3, grace=2) as c:
    assert wait_for(lambda: "NUDGE bg0001 bg" in c.log(), 15), \
        "유예 창이 지났는데 주입이 안 났다\n" + c.log()
    assert wait_for(lambda: FAIL_TAIL in c.log(), 15), \
        "주입 뒤에도 안 자랐는데 종전 종료가 안 났다(수용조건 4)\n" + c.log()
print("PASS 3 - 끝까지 안 자라면 주입 뒤 종전 종료 경로가 그대로 돈다(수용조건 4·5)")

# 4 - TICKET_BG_GRACE=0이면 장치가 한 번도 안 돌고 즉시 종전 종료다.
eng4 = ENGINE.format(bg_line=BG_LINE, result_line=RESULT_LINE, body=BODY_NO_GROW)
t0 = time.time()
with Case(eng4, grace=0) as c:
    assert wait_for(lambda: FAIL_TAIL in c.log(), 15), "GRACE=0인데 종전 종료가 안 났다\n" + c.log()
    elapsed = time.time() - t0
    assert "NUDGE bg0001 bg" not in c.log(), "GRACE=0인데 주입이 났다\n" + c.log()
    assert elapsed < 12, "GRACE=0인데 유예를 기다린 것처럼 오래 걸렸다({:.1f}s)".format(elapsed)
print("PASS 4 - TICKET_BG_GRACE=0이면 장치가 안 돌고 즉시 종전 종료다(수용조건 6)")

# 5 - 조건 3(밀린 작업 문구)이 거짓이면 유예가 안 걸리고 즉시 종전 종료다(GRACE가 켜져 있어도).
eng5 = ENGINE.format(bg_line="", result_line=RESULT_LINE, body=BODY_NO_GROW)
t0 = time.time()
with Case(eng5, grace=20) as c:
    assert wait_for(lambda: FAIL_TAIL in c.log(), 15), "밀린 문구가 없는데 종전 종료가 안 났다\n" + c.log()
    elapsed = time.time() - t0
    assert "NUDGE bg0001 bg" not in c.log(), "밀린 문구가 없는데 주입이 났다\n" + c.log()
    assert elapsed < 12, "밀린 문구가 없는데 유예(20s)를 기다린 것처럼 오래 걸렸다({:.1f}s)".format(elapsed)
print("PASS 5 - 밀린 작업 문구가 없으면 유예가 안 걸린다(수용조건 1의 조건 3)")

# 6 - 유예 중에도 MAXRUN 상한이 그대로 걸린다. GRACE(20s)보다 훨씬 짧은 MAXRUN(3s)을 걸면
# bg_wait_grow의 kill -0 감시가 그 죽음을 즉시 보고 유예를 20초까지 안 채우고 끊는다 - 그래서
# NUDGE가 GRACE(20s)보다 한참 이른 시각에 온다. 이후 최종 FAIL까지는 기존 워치독 꼬리
# (`kill -TERM; sleep 20; kill -KILL`, 이 티켓이 안 건드린 종전 코드)가 더 걸려 여기서는
# 안 기다린다 - 유예가 안 끝까지 갔다는 사실 자체가 수용조건 8의 증거다.
eng6 = ENGINE.format(bg_line=BG_LINE, result_line=RESULT_LINE, body=BODY_NO_GROW)
t0 = time.time()
with Case(eng6, grace=20, maxrun=3) as c:
    assert wait_for(lambda: "NUDGE bg0001 bg" in c.log(), 12), \
        "MAXRUN이 유예 중에도 걸려야 하는데 주입조차 안 났다\n" + c.log()
    elapsed = time.time() - t0
    assert elapsed < 12, "MAXRUN(3s)이 걸려야 하는데 유예(20s)를 거의 다 기다린 것처럼 오래 걸렸다({:.1f}s)".format(elapsed)
print("PASS 6 - 유예 중에도 MAXRUN 상한이 그대로 걸려 유예가 20초를 못 채운다(수용조건 8)")
