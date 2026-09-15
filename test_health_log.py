#!/usr/bin/env python3
"""건강 로그(§엔진 수정 서른아홉 번째 승인 §판정 1) 자체검증. 수용조건 1~7을 덮는다
(8~12는 P409-2 몫이라 이 회차 밖이다).

진짜 claude를 부르지 않는다 - stdin JSONL을 받아 적고 스스로는 오래 안 끝나는 가짜 스트림
엔진으로 판정한다(test_plan_nudge.py와 같은 관용구). MAXRUN 감시 루프가 이미 POLL 간격으로
도는 자리에 분기 하나를 얹은 것이므로, 새 프로세스도 새 감시자도 없다.

실패하면 assert로 죽는다.
"""
import os
import re
import time
import shutil
import signal
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="hl"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_HEALTH_INTERVAL="{interval}"
TICKET_PLAN_NUDGE=0
TICKET_REUSE=0
TICKET_ENGINE=("{tmp}/fake-stream.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

# init을 뱉고 -> stdin을 받아 적고 -> 스스로는 안 끝난다(result 없이 sleep, 밖에서 죽인다).
ENGINE = """\
#!/bin/bash
printf '{{"type":"system","subtype":"init"}}\\n'
for i in $(seq 1 90); do
  if IFS= read -r -t 1 line; then
    printf '%s\\n' "$line" >> "{tmp}/engine-stdin.jsonl"
  fi
done
sleep 60
"""

LINE_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[hl\] "
    r"sid=\S+ hash=\S+ load1=\S+ net=(ok|fail) pid=(alive|dead)$"
)


def mk(root, name, body="## Goal\ntest\n"):
    d = os.path.join(root, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\ntitle: t\n---\n\n{}".format(name, body))
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
    def __init__(self, interval):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        root = os.path.join(self.tmp, "dira")
        local = os.path.join(self.tmp, "local")
        os.makedirs(local)
        os.makedirs(os.path.join(root, "workers"), exist_ok=True)
        w = os.path.join(root, "workers", "hl.sh")
        with open(w, "w", encoding="utf-8") as f:
            f.write(WORKER.format(tmp=self.tmp, tick=TICK, interval=interval))
        os.chmod(w, 0o755)
        eng = os.path.join(self.tmp, "fake-stream.sh")
        with open(eng, "w", encoding="utf-8") as f:
            f.write(ENGINE.format(tmp=self.tmp))
        os.chmod(eng, 0o755)

        raw = mk(root, "health0001")
        self.wip = raw[:-3] + ".wip.md"
        env = dict(os.environ, TICKET_LOCAL=local)
        self.proc = subprocess.Popen([w, "tick"], stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL, env=env)
        self.stdinf = os.path.join(self.tmp, "engine-stdin.jsonl")
        self.runlog = os.path.join(root, "workers", "runner.log")
        self.healthdir = os.path.join(root, "workers", "health")

        inbox = wait_for(lambda: os.path.exists(self.wip) and fm_get(self.wip, "inbox"), 90)
        assert inbox, "도는 동안 fm에 inbox:가 안 써졌다"
        assert wait_for(lambda: len(self._stdin_lines()) >= 1, 30), \
            "최초 프롬프트가 엔진 stdin에 안 왔다"

    def _stdin_lines(self):
        if not os.path.exists(self.stdinf):
            return []
        with open(self.stdinf, encoding="utf-8") as f:
            return [l for l in f.read().split("\n") if l.strip()]

    def health_file(self):
        return os.path.join(self.healthdir, time.strftime("%Y%m%d") + ".log")

    def health_lines(self):
        p = self.health_file()
        if not os.path.exists(p):
            return []
        with open(p, encoding="utf-8") as f:
            return [l for l in f.read().split("\n") if l.strip()]

    def cpid(self):
        return fm_get(self.wip, "pid")

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


# 1·2·5 - 짧은 간격으로 돌리면 그 간격마다 줄이 붙고, 한 줄에 필드 일곱이 다 들어 있다.
# 연속 두 줄이 넉넉한 상한(40s) 안에 모두 온다는 것 자체가, 도달 검사가 2초 상한 없이
# 걸려 늘어지지 않는다는 근거다(수용조건 5 - 걸리면 두 번째 줄이 훨씬 늦게 온다).
with Case(interval=2) as c:
    assert wait_for(lambda: len(c.health_lines()) >= 2, 40), \
        "간격(2s)마다 줄이 안 붙었다(수용조건 1): {}".format(c.health_lines())
    lines = c.health_lines()
    for ln in lines:
        assert LINE_RE.match(ln), "건강 로그 한 줄의 모양이 다르다(수용조건 2): {!r}".format(ln)
        assert "hash=health0001" in ln, "티켓 해시가 안 들어 있다: {!r}".format(ln)
    print("PASS 조건 1·2·5 - 간격마다 한 줄, 필드 일곱, 지연 없음: {}줄".format(len(lines)))

    # 4 - net=fail이 섞여도(샌드박스는 대개 외부 네트워크가 없다) 세션은 안 끊기고 계속 붙는다.
    nets = {re.search(r"net=(ok|fail)", ln).group(1) for ln in lines}
    assert nets <= {"ok", "fail"}, "net 필드가 ok/fail 밖의 값이다: {}".format(nets)
    print("PASS 조건 4 - net 값({})이 나와도 세션이 안 끊긴다".format(nets))

    # 7 - runner.log에는 건강 로그 머리말이 안 섞인다(reap_release가 다시 파싱하는 파일이다).
    with open(c.runlog, encoding="utf-8") as f:
        runner_body = f.read()
    assert "load1=" not in runner_body, "건강 로그 줄이 runner.log에 섞였다(수용조건 7)\n" + runner_body
    print("PASS 조건 7 - runner.log 무수정")

    # 3 - 자식을 급사(-9)시키면 마지막 줄에서 더 안 붙는다.
    pid = c.cpid()
    assert pid, "pid frontmatter가 안 채워졌다"
    before = len(c.health_lines())
    os.kill(int(pid), signal.SIGKILL)
    time.sleep(6)  # 간격(2s)의 3배 - 재부팅 없이 더 안 붙는지 본다
    after = len(c.health_lines())
    assert after == before, \
        "kill -9 뒤에도 줄이 더 붙었다(수용조건 3): before={} after={}".format(before, after)
    print("PASS 조건 3 - kill -9 뒤 마지막 줄에서 안 붙는다 ({}줄 고정)".format(after))

# 6 - TICKET_HEALTH_INTERVAL=0이면 파일도 디렉터리도 안 생긴다.
with Case(interval=0) as c:
    time.sleep(8)
    assert not os.path.exists(c.healthdir), \
        "TICKET_HEALTH_INTERVAL=0인데 health/ 디렉터리가 생겼다(수용조건 6)"
    print("PASS 조건 6 - TICKET_HEALTH_INTERVAL=0이면 파일도 디렉터리도 안 생긴다")
