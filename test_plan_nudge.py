#!/usr/bin/env python3
"""계획 상자 참견(§결정 기록 §엔진 수정 서른네 번째 승인 §판정 1, 서른일곱 번째 승인 §판정 1이
조건 1을 가른 뒤의 모습) 자체검증. 수용조건 1~7을 덮는다 - 8~12(판정 2 - 공통)는 이 회차 밖이다.
조건 5는 서른일곱 번째 승인이 뒤집었다 - 절이 없으면 0개가 아니라 다른 문장으로 참견한다.

진짜 claude를 부르지 않는다 - stdin JSONL을 받아 적고 스스로는 오래 안 끝나는 가짜 스트림
엔진으로 판정한다(§제약 1, test_inbox.py와 같은 관용구). 임계값을 짧게(2초) 걸어 재는 시간을
줄인다. **시각은 고정 sleep이 아니라 폴링으로 잰다** - 디스패치 자체(claim·assign·mkfifo·
init 핸드셰이크)의 지연이 샌드박스마다 달라서, 고정 오프셋은 임계값보다 늦게 시작되면
거짓 실패가 난다.

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
TICKET_NAME="pn"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_PLAN_NUDGE="{nudge}"
TICKET_REUSE=0
TICKET_ENGINE=("{tmp}/fake-stream.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

# 가짜 스트림 엔진: init을 뱉고 -> stdin으로 오는 줄을 최대 window초(1초 해상도 - POLL=1과
# 같은 자리) 동안 받아 적고 -> 스스로는 안 끝난다(result도 없이 sleep - 파이썬 쪽이 죽인다).
# 고정 window로 result를 내지 않는 이유: 디스패치 지연이 들쭉날쭉한 샌드박스에서 폴링이
# 끝나기 전에 엔진이 먼저 읽기를 멈추면 뒤이은 참견이 전달 자체가 안 된다 - 넉넉히 오래 듣는다.
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

NUDGE_TEXT = "## 진행 계획 상자 중 이미 끝난 항목이 있으면 지금 켜 주세요."


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


def stdin_lines(stdinf):
    if not os.path.exists(stdinf):
        return []
    with open(stdinf, encoding="utf-8") as f:
        return [l for l in f.read().split("\n") if l.strip()]


def wait_for(pred, timeout, interval=0.2):
    end = time.time() + timeout
    while time.time() < end:
        v = pred()
        if v:
            return v
        time.sleep(interval)
    return pred()


class Case:
    """티켓 본문으로 워커 하나를 띄운 채 지켜본다. 함수 하나가 아니라 with 블록인 이유는
    양성 시나리오(1·2·3·7)가 같은 세션 하나 안에서 poll -> touch -> poll을 연쇄해야 해서다."""

    def __init__(self, body, nudge, window=90):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        self.window = window
        root = os.path.join(self.tmp, "dira")
        local = os.path.join(self.tmp, "local")
        os.makedirs(local)
        os.makedirs(os.path.join(root, "workers"), exist_ok=True)
        w = os.path.join(root, "workers", "pn.sh")
        with open(w, "w", encoding="utf-8") as f:
            f.write(WORKER.format(tmp=self.tmp, tick=TICK, nudge=nudge))
        os.chmod(w, 0o755)
        eng = os.path.join(self.tmp, "fake-stream.sh")
        with open(eng, "w", encoding="utf-8") as f:
            f.write(ENGINE.format(tmp=self.tmp, window=window))
        os.chmod(eng, 0o755)

        raw = mk(root, "plan0001", body)
        self.wip = raw[:-3] + ".wip.md"
        env = dict(os.environ, TICKET_LOCAL=local)
        self.proc = subprocess.Popen([w, "tick"], stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL, env=env)
        self.stdinf = os.path.join(self.tmp, "engine-stdin.jsonl")
        self.runlog = os.path.join(root, "workers", "runner.log")

        # 디스패치 자체(엔진 후보 셋 심링크 확인 등)가 샌드박스에서 30초 가까이 걸리기도
        # 한다(test_inbox.py 실측과 같은 자리) - 넉넉히 잡는다. 참견 시계는 이 뒤부터다.
        inbox = wait_for(lambda: os.path.exists(self.wip) and fm_get(self.wip, "inbox"), 90)
        assert inbox, "도는 동안 fm에 inbox:가 안 써졌다"
        assert stat.S_ISFIFO(os.stat(inbox).st_mode), "inbox 경로가 FIFO가 아니다"
        # 프롬프트가 엔진 stdin에 실제로 닿을 때까지 - 그 뒤부터 참견 시계가 의미를 가진다.
        assert wait_for(lambda: len(stdin_lines(self.stdinf)) >= 1, 30), \
            "최초 프롬프트가 엔진 stdin에 안 왔다"
        with open(self.wip, encoding="utf-8") as f:
            self.original = f.read()

    def lines(self):
        return stdin_lines(self.stdinf)[1:]  # 프롬프트 한 줄을 뺀 나머지가 참견이다

    def log(self):
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


# 1·2·3·7 - 임계값 넘으면 정확히 한 줄, 그 뒤 갈지 않으면 둘째 줄이 안 오고, 파일을 갈면
# 다시 무장해서 임계값 뒤에 또 한 줄 온다. 참견은 티켓 파일에 안 쓴다.
with Case("\n## 진행 계획\n- [ ] 아직 안 끝난 항목\n", nudge=2) as c:
    assert wait_for(lambda: len(c.lines()) >= 1, 40), \
        "임계값이 지났는데 참견이 안 왔다(수용조건 1): {}".format(c.lines())
    assert len(c.lines()) == 1 and NUDGE_TEXT in c.lines()[0], \
        "참견 문장이 다르다: {}".format(c.lines())
    # FIFO에 줄이 닿는 시점과 log()가 그 줄을 적는 시점 사이에 실측 지연이 있다(python3
    # 서브프로세스 종료 대기) - lines()처럼 폴링으로 잰다, 즉시 비교하면 거짓 실패가 난다.
    assert wait_for(lambda: "NUDGE plan0001" in c.log(), 10), \
        "runner.log에 NUDGE 로그가 없다\n" + c.log()

    # 조건 2 - 파일을 안 갈면 임계값을 몇 번 더 지나도 둘째 줄이 안 온다.
    time.sleep(6)  # nudge(2s)의 3배 - 재무장 없이 또 넘는지를 본다
    assert len(c.lines()) == 1, "파일을 안 갈았는데 참견이 또 왔다(수용조건 2): {}".format(c.lines())

    # 수용조건 7 - 그동안 티켓 파일에 참견이 한 글자도 안 썼다.
    with open(c.wip, encoding="utf-8") as f:
        assert f.read() == c.original, "참견이 티켓 파일에 뭔가 썼다(엔진은 티켓에 안 쓴다)"

    # 조건 3 - 파일을 한 글자(mtime) 갈면 다시 무장해서 임계값 뒤에 또 한 줄 온다.
    os.utime(c.wip, None)
    assert wait_for(lambda: len(c.lines()) >= 2, 40), \
        "재무장 뒤 임계값이 지났는데 둘째 참견이 안 왔다(수용조건 3): {}".format(c.lines())
    assert all(NUDGE_TEXT in n for n in c.lines()), "참견 문장이 다르다: {}".format(c.lines())
print("PASS 조건 1·2·3·7 - 임계값 참견 - 무변 무참견 - 재무장 재참견, 파일 무수정")

# 4 - 계획 항목이 전부 [x]면 넉넉히 기다려도 줄이 0개다.
with Case(
    "\n## 진행 계획\n- [x] 끝난 항목 (2026-09-07T00:00:00+09:00 -> 2026-09-07T00:01:00+09:00)\n",
    nudge=2,
) as c:
    time.sleep(10)
    assert c.lines() == [], "완료된 계획인데 참견이 왔다: {}".format(c.lines())
print("PASS 조건 4 - 계획이 전부 완료면 참견 0개(수용조건 4)")

# 취소(~~)만 있어도 0개 - 4의 확장(§2-11 취소 상태).
with Case(
    "\n## 진행 계획\n- [ ] ~~취소된 항목~~ (2026-09-07T00:00:00+09:00 -> 2026-09-07T00:01:00+09:00)\n",
    nudge=2,
) as c:
    time.sleep(10)
    assert c.lines() == [], "취소된 계획인데 참견이 왔다: {}".format(c.lines())
print("PASS 조건 4확장 - 취소된 항목만 있으면 참견 0개")

# 5 - `## 진행 계획` 절이 아예 없어도(엔진 수정 서른일곱 번째 승인 §판정 1이 서른네 번째
# 승인 수용조건 5를 가른다) 같은 시계로 참견 한 줄이 오되, 문장은 "계획을 세워라"로 다르다.
NUDGE_TEXT_SECTION = "## 진행 계획을 지금 세워 주세요."
with Case("", nudge=2) as c:
    assert wait_for(lambda: len(c.lines()) >= 1, 40), \
        "계획 절이 없는데 임계값이 지나도 참견이 안 왔다: {}".format(c.lines())
    assert len(c.lines()) == 1 and NUDGE_TEXT_SECTION in c.lines()[0], \
        "절 없음 갈래의 참견 문장이 다르다: {}".format(c.lines())
    assert wait_for(lambda: "NUDGE plan0001" in c.log(), 10), \
        "runner.log에 NUDGE 로그가 없다\n" + c.log()
print("PASS 조건 5 - 계획 절이 없어도 '계획을 세워라' 참견이 온다(엔진 수정 서른일곱 번째 승인 판정 1)")

# 6 - TICKET_PLAN_NUDGE=0이면 장치가 꺼진다(참견이 오래 걸려도 안 온다).
with Case("\n## 진행 계획\n- [ ] 아직 안 끝난 항목\n", nudge=0) as c:
    time.sleep(10)
    assert c.lines() == [], "TICKET_PLAN_NUDGE=0인데 참견이 왔다: {}".format(c.lines())
    assert "NUDGE plan0001" not in c.log(), "장치를 껐는데 NUDGE 로그가 났다\n" + c.log()
print("PASS 조건 6 - TICKET_PLAN_NUDGE=0이면 장치가 꺼진다(수용조건 6)")
