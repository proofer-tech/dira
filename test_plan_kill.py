#!/usr/bin/env python3
"""참견을 무시한 세션을 끊는다(§결정 기록 §엔진 수정 서른여섯 번째 승인 §판정 2) 자체검증.
수용조건 6~10을 덮는다 - 판정 1·3은 이 회차 밖이다(각자 다른 티켓).

harness는 `test_plan_nudge.py`와 같은 관용구다(진짜 claude를 안 부른다 - 가짜 스트림 엔진,
시각은 폴링으로 잰다, 고정 sleep 금지). 이 파일만의 것은 `TICKET_PLAN_KILL`과 사람 참견
표식(`<inbox>.human`) 조작이다.

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
TICKET_NAME="pk"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_PLAN_NUDGE="{nudge}"
TICKET_PLAN_KILL="{kill}"
TICKET_REUSE=0
TICKET_ENGINE=("{tmp}/fake-stream.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

# SIGTERM의 기본 처분(종료)에 기댄다 - 우리 손으로 trap하지 않는다, tick.sh가 진짜 세션에
# 보내는 신호와 같은 자리에서 같은 처분을 봐야 한다.
ENGINE = """\
#!/bin/bash
printf '{{"type":"system","subtype":"init"}}\\n'
for i in $(seq 1 {window}); do
  if IFS= read -r -t 1 line; then
    printf '%s\\n' "$line" >> "{tmp}/engine-stdin.jsonl"
  fi
done
sleep 60
"""


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
    def __init__(self, body, nudge, kill, window=90, name="plank001"):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        root = os.path.join(self.tmp, "dira")
        local = os.path.join(self.tmp, "local")
        os.makedirs(local)
        os.makedirs(os.path.join(root, "workers"), exist_ok=True)
        w = os.path.join(root, "workers", "pk.sh")
        with open(w, "w", encoding="utf-8") as f:
            f.write(WORKER.format(tmp=self.tmp, tick=TICK, nudge=nudge, kill=kill))
        os.chmod(w, 0o755)
        eng = os.path.join(self.tmp, "fake-stream.sh")
        with open(eng, "w", encoding="utf-8") as f:
            f.write(ENGINE.format(tmp=self.tmp, window=window))
        os.chmod(eng, 0o755)

        self.name = name
        raw = mk(root, name, body)
        self.wip = raw[:-3] + ".wip.md"
        self.open_ = raw  # 되돌리면 이 이름으로 돌아온다
        env = dict(os.environ, TICKET_LOCAL=local)
        self.proc = subprocess.Popen([w, "tick"], stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL, env=env)
        self.stdinf = os.path.join(self.tmp, "engine-stdin.jsonl")
        self.runlog = os.path.join(root, "workers", "runner.log")

        inbox = wait_for(lambda: os.path.exists(self.wip) and fm_get(self.wip, "inbox"), 90)
        assert inbox, "도는 동안 fm에 inbox:가 안 써졌다"
        assert stat.S_ISFIFO(os.stat(inbox).st_mode), "inbox 경로가 FIFO가 아니다"
        self.inbox = inbox
        assert wait_for(lambda: os.path.exists(self.stdinf), 30), \
            "최초 프롬프트가 엔진 stdin에 안 왔다"

    def log(self):
        with open(self.runlog, encoding="utf-8") as f:
            return f.read()

    def touch_human(self):
        """`lib/interject.ts`가 하는 것과 같은 동작 - 표식에 쓴다(mtime을 움직인다)."""
        with open(self.inbox + ".human", "w", encoding="utf-8") as f:
            f.write(str(time.time()))

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


# 수용조건 6 - 참견 뒤에도 티켓 파일이 TICKET_PLAN_KILL초 동안 안 갈리면 끊기고 열린
# 이름으로 돌아온다. attempts가 오른다(수용조건 10 - other로 세었다는 증거, killed면 안 오른다).
with Case("\n## 진행 계획\n- [ ] 아직 안 끝난 항목\n", nudge=2, kill=2, name="plank006") as c:
    assert wait_for(lambda: "NUDGE plank006" in c.log(), 40), "참견이 안 왔다\n" + c.log()
    assert wait_for(lambda: os.path.exists(c.open_) and not os.path.exists(c.wip), 40), \
        "임계값이 지났는데 안 끊겼다(수용조건 6)\n" + c.log()
    assert wait_for(lambda: "KILLED plank006" in c.log(), 10), \
        "끊긴 세션의 종료 줄이 없다\n" + c.log()
    assert fm_get(c.open_, "attempts") == "1", \
        "attempts가 안 올랐다(수용조건 10 - other가 아니라 killed로 샜을 수 있다): {}".format(
            fm_get(c.open_, "attempts"))
print("PASS 수용조건 6·10 - 참견 무시 세션이 끊기고 열린 이름으로 돌아온다, attempts=1")

# 수용조건 7 - 참견 뒤 티켓 파일을 한 글자 갈면(mtime) 그 정체는 안 끊긴다.
with Case("\n## 진행 계획\n- [ ] 아직 안 끝난 항목\n", nudge=2, kill=2, name="plank007") as c:
    assert wait_for(lambda: "NUDGE plank007" in c.log(), 40), "참견이 안 왔다\n" + c.log()
    os.utime(c.wip, None)  # 한 글자 갈렸다고 본다 - mtime만 움직여도 재무장이다
    time.sleep(6)  # kill(2s)의 3배를 넉넉히 기다린다 - 그래도 안 끊겨야 한다
    assert os.path.exists(c.wip) and not os.path.exists(c.open_), \
        "파일을 갈았는데도 끊겼다(수용조건 7)\n" + c.log()
print("PASS 수용조건 7 - 참견 뒤 파일을 한 글자 갈면 안 끊긴다")

# 수용조건 8 - 사람의 참견이 이 정체에 들어오면(표식 mtime 갱신) 티켓 파일이 안 갈려도 안 끊긴다.
with Case("\n## 진행 계획\n- [ ] 아직 안 끝난 항목\n", nudge=2, kill=2, name="plank008") as c:
    assert wait_for(lambda: "NUDGE plank008" in c.log(), 40), "참견이 안 왔다\n" + c.log()
    c.touch_human()
    time.sleep(6)  # kill(2s)의 3배 - 사람 참견 표식이 계속 막아야 한다
    assert os.path.exists(c.wip) and not os.path.exists(c.open_), \
        "사람 참견이 들어왔는데도 끊겼다(수용조건 8)\n" + c.log()
print("PASS 수용조건 8 - 사람 참견이 들어오면 파일이 안 갈려도 안 끊긴다")

# 수용조건 9 - TICKET_PLAN_KILL=0이면 장치가 꺼진다(넉넉히 기다려도 안 끊긴다).
with Case("\n## 진행 계획\n- [ ] 아직 안 끝난 항목\n", nudge=2, kill=0, name="plank009") as c:
    assert wait_for(lambda: "NUDGE plank009" in c.log(), 40), "참견이 안 왔다\n" + c.log()
    time.sleep(8)
    assert os.path.exists(c.wip) and not os.path.exists(c.open_), \
        "TICKET_PLAN_KILL=0인데 끊겼다(수용조건 9)\n" + c.log()
print("PASS 수용조건 9 - TICKET_PLAN_KILL=0이면 장치가 꺼진다")
