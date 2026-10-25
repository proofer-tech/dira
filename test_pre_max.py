#!/usr/bin/env python3
"""P522-2 tick.sh 세션 전 상한(결정 4)과 세션 표지(결정 5). 실패하면 assert로 죽는다.

가짜 엔진으로 진짜 tick.sh를 돈다. 세션 전 단계를 느리게 만들려고 임시 code 폴더에 엔진을 복사하고
tickets.py의 assign만 10초 자게 감싼다.
"""
__import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())
import glob
import hashlib
import os
import shutil
import signal
import subprocess
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))

WORKER = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/fake-engine.sh" "{{sid}}" "--input-format" "stream-json")
. "{code}/tick.sh"
"""

# fm pid가 찍힐 때까지 기다린 뒤 워커 락의 session 파일과 fm pid를 기록하고 result로 끝낸다
ENGINE = """\
#!/bin/bash
IFS= read -r _first
printf '{{"type":"system","subtype":"init"}}\\n'
wip=$(ls -t "{tmp}/dira/tickets"/*.wip.md 2>/dev/null | head -1)
i=0
while [ "$i" -lt 25 ] && ! grep -qE '^pid: [0-9]' "$wip" 2>/dev/null; do sleep 0.2; i=$((i+1)); done
sleep 1
cat "{local}"/run/w1-*.lock/session > "{tmp}/session-seen" 2>/dev/null
sed -n 's/^pid:[[:space:]]*//p' "$wip" > "{tmp}/fm-pid"
printf '{{"is_error":true,"session_id":"%s","type":"result","subtype":"error_during_execution","terminal_reason":"aborted_streaming"}}\\n' "$1"
exec sleep 60
"""

SLOW = """\
import runpy, sys, time
try:
    runpy.run_path(__file__.replace("tickets.py", "tickets_real.py"), run_name="__main__")
finally:
    if len(sys.argv) > 1 and sys.argv[1] == "assign":
        time.sleep(10)
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


tmp = os.path.realpath(tempfile.mkdtemp())
procs = []
try:
    root, local, code = (os.path.join(tmp, n) for n in ("dira", "local", "code"))
    os.makedirs(os.path.join(local, "run"))
    tickets = os.path.join(root, "tickets")
    runlog = os.path.join(root, "workers", "runner.log")
    os.makedirs(code)
    for n in os.listdir(HERE):  # .dira 심링크가 큐 전체를 끌어오므로 엔진 파일만 복사한다
        if n == "tick.sh" or (n.endswith(".py") and not n.startswith("test_")):
            shutil.copy(os.path.join(HERE, n), code)
    os.rename(os.path.join(code, "tickets.py"), os.path.join(code, "tickets_real.py"))
    mkfile(os.path.join(code, "tickets.py"), SLOW)
    mkfile(os.path.join(tmp, "fake-engine.sh"), ENGINE.format(tmp=tmp, local=local), 0o755)
    w1 = mkfile(os.path.join(root, "workers", "w1.sh"), WORKER.format(tmp=tmp, code=code), 0o755)
    h = hashlib.sha1(w1[:-3].encode()).hexdigest()[:8]
    lock = os.path.join(local, "run", "w1-%s.lock" % h)
    entry = os.path.join(local, "run", "w1-%s.entry" % h)

    def log():
        return open(runlog, encoding="utf-8").read() if os.path.exists(runlog) else ""

    def tick(**over):
        t = time.time()
        r = subprocess.run([w1], capture_output=True, text=True,
                           env=dict(os.environ, TICKET_LOCAL=local, **over), timeout=180)
        return r, time.time() - t

    def new_ticket(n):
        mkfile(os.path.join(tickets, n + ".md"),
               "---\nticket: {}\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n".format(n))

    # 1. 세션 전 상한: PRE_MAX=5, assign 뒤 10초 잔다 -> 10초 안에 끝, 열림 복귀, attempts 그대로, 잠금 없음
    new_ticket("aaaa0001")
    r, el = tick(TICKET_PRE_MAX="5")
    assert el < 10, (el, r)
    assert "WARN tick 세션 전 상한 5초 초과 - 끝낸다" in log(), log()
    assert os.path.exists(os.path.join(tickets, "aaaa0001.md")), os.listdir(tickets)
    body = open(os.path.join(tickets, "aaaa0001.md"), encoding="utf-8").read()
    assert "attempts: 1" not in body and "attempts: 2" not in body, body
    assert not os.path.exists(lock) and not os.path.exists(entry), os.listdir(os.path.join(local, "run"))
    os.remove(os.path.join(tickets, "aaaa0001.md"))
    print("1 ok", round(el, 1), "s")

    # 2. 정상 tick: 세션을 띄우면 워커 락 안 session 파일이 fm pid와 같다
    shutil.copy(os.path.join(code, "tickets_real.py"), os.path.join(code, "tickets.py"))
    new_ticket("bbbb0002")
    tick()
    seen = open(os.path.join(tmp, "session-seen")).read().strip()
    fm = open(os.path.join(tmp, "fm-pid")).read().strip()
    assert seen.isdigit() and seen == fm, (seen, fm)
    print("2 ok pid", seen)
    for f in glob.glob(os.path.join(tickets, "bbbb0002*")):
        os.remove(f)

    # 3. 갇힌 tick 회수: 락 pid가 산 프로세스, session 없음, pid 파일 PRE_MAX+61초 전
    def make_lock(session):
        shutil.rmtree(lock, ignore_errors=True)
        os.makedirs(lock)
        p = subprocess.Popen(["sleep", "600"], start_new_session=True)
        procs.append(p)
        mkfile(os.path.join(lock, "pid"), str(p.pid))
        if session:
            mkfile(os.path.join(lock, "session"), str(p.pid))
        old = time.time() - 661
        os.utime(os.path.join(lock, "pid"), (old, old))
        return p

    p = make_lock(False)
    tick()
    assert p.poll() is not None, "갇힌 tick을 안 끝냈다"
    assert "WARN 세션 없는 tick 회수 pid=%d" % p.pid in log(), log()
    assert not os.path.exists(lock), "회수한 락이 남았다"
    print("3 ok")

    # 4. 같은 상태에서 session 파일이 있으면 SKIP이고 프로세스는 산다
    p = make_lock(True)
    tick()
    assert p.poll() is None, "session 표지가 있는데 죽였다"
    assert "SKIP 이 워커가 아직 티켓을 물고 있다 pid=%d" % p.pid in log(), log()
    assert os.path.isdir(lock)
    print("4 ok")
finally:
    for p in procs:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
    shutil.rmtree(tmp, ignore_errors=True)
print("PASS")
