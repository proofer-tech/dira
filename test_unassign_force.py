#!/usr/bin/env python3
"""강제 할당 해제(`unassign <해시> --force`)와 정직한 종료 로그(KILLED).

계약은 docs/DESIGN.md §2-5다. 여기서 못박는 것 넷:
  1. 산 세션은 플래그 없이는 종전대로 거부하되 **종료 코드가 3**이다(화면이 이 코드로 확인을 띄운다).
  2. `--force`는 그 pid를 죽이고 티켓을 열림으로 되돌린다. 죽은 세션에는 아무 일도 안 한다.
  3. `pid:`가 없는 산 세션(`session=` 갈래)은 강제도 거부한다 - 죽일 대상이 없다. 종전 문구를 안 쓴다.
  4. 상한 미만에 죽은 세션은 `TIMEOUT`이 아니라 `KILLED <해시> <경과>s`로 남는다.

도그푸딩 큐를 건드리지 않는다 - 전부 임시 큐 + 가짜 스트리밍 엔진이다.
실패하면 assert로 죽는다.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

# init 한 줄을 뱉고 stdin을 빨면서 사는 엔진. 안 빨면 프롬프트 주입이 안 끝나 STALL로 죽는다.
# `exec`는 test_feed_stall.py와 같은 이유다 - 프로세스를 하나로 만들어 kill이 진짜 엔진에 닿게 한다.
FAKE_ENGINE = """\
#!/bin/bash
printf '{"type":"system","subtype":"init"}\\n'
exec cat > /dev/null
"""

WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_INPROGRESS=".wip"
TICKET_DONE=".done"
TICKET_FEED_TIMEOUT=30
TICKET_MAXRUN={maxrun}
TICKET_ENGINE=("{tmp}/fake-engine.sh" --input-format stream-json)
. "{tick}"
"""

TICKET = "---\nticket: {h}\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n"
WIP = ("---\nticket: {h}\ntitle: t\nsession_id: {sid}\n{pid}---\n\n## Goal\ntest\n")


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


def run(*argv, **kw):
    return subprocess.run(argv, capture_output=True, text=True, timeout=60, **kw)


def wait_for(cond, limit=40, step=0.5):
    for _ in range(int(limit / step)):
        if cond():
            return True
        time.sleep(step)
    return False


tmp = os.path.realpath(tempfile.mkdtemp())
alive = []
try:
    root = os.path.join(tmp, "dira")
    tickets = os.path.join(root, "tickets")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    env = dict(os.environ, TICKET_LOCAL=local)
    mkfile(os.path.join(tmp, "fake-engine.sh"), FAKE_ENGINE, 0o755)
    w1 = mkfile(os.path.join(root, "workers", "w1.sh"),
                WORKER.format(name="w1", tmp=tmp, tick=TICK, maxrun=120), 0o755)
    runlog = os.path.join(root, "workers", "runner.log")

    def readlog():
        try:
            with open(runlog, encoding="utf-8") as f:
                return f.read()
        except OSError as e:
            return "(runner.log 없음: {})".format(e)

    # --- 1) 인자: 해시 없음 · 모르는 플래그는 사용법(exit 2) ---
    r = run(w1, "unassign")
    assert r.returncode == 2, "해시 없이 부른 unassign이 2가 아니다: " + str(r.returncode)
    mkfile(os.path.join(tickets, "aaaa0001.md"), TICKET.format(h="aaaa0001"))
    r = run(w1, "unassign", "aaaa0001", "--forse", env=env)
    assert r.returncode == 2, "모르는 플래그가 2가 아니다: {}\n{}".format(r.returncode, r.stderr)
    assert "사용법" in r.stdout + r.stderr, r.stdout + r.stderr

    # --- 2) 산 세션 + 플래그 없음: 종전 문구 그대로, 종료 코드 3 ---
    live = subprocess.Popen(["sleep", "60"])
    alive.append(live)
    mkfile(os.path.join(tickets, "bbbb0002.wip.md"),
           WIP.format(h="bbbb0002", sid="dead-sid", pid="pid: {}\n".format(live.pid)))
    r = run(w1, "unassign", "bbbb0002", env=env)
    assert r.returncode == 3, "산 세션 거부가 3이 아니다: {}\n{}".format(r.returncode, r.stderr)
    assert "먼저 끝내거나 죽인 뒤 다시 시도하세요" in r.stderr, r.stderr
    assert os.path.exists(os.path.join(tickets, "bbbb0002.wip.md")), "거부했는데 티켓이 풀렸다"

    # --- 3) --force: pid를 죽이고 티켓이 열림으로 돌아온다 ---
    #    이 티켓엔 풀어 줄 부모 tick.sh가 없다(손 클레임과 같은 모양) - ④가 자기가 푼다.
    r = run(w1, "unassign", "bbbb0002", "--force", env=env)
    assert r.returncode == 0, "강제 해제가 실패했다: {}\n{}{}".format(r.returncode, r.stdout, r.stderr)
    assert os.path.exists(os.path.join(tickets, "bbbb0002.md")), \
        "강제 뒤 백로그로 안 돌아왔다: " + str(os.listdir(tickets))
    assert live.poll() is not None or not wait_for(lambda: live.poll() is not None, 5), \
        "pid가 안 죽었다"
    body = open(os.path.join(tickets, "bbbb0002.md"), encoding="utf-8").read()
    assert not re.search(r"^(session_id|pid|inbox):[ \t]*\S", body, re.M), \
        "할당 값이 안 비었다\n" + body
    assert "UNASSIGN bbbb0002 강제" in readlog(), readlog()

    # --- 4) 죽은 세션 + --force: 종전 경로 그대로다(회귀) ---
    dead = subprocess.Popen(["sleep", "0"])
    dead.wait()
    mkfile(os.path.join(tickets, "cccc0003.wip.md"),
           WIP.format(h="cccc0003", sid="dead-sid", pid="pid: {}\n".format(dead.pid)))
    r = run(w1, "unassign", "cccc0003", "--force", env=env)
    assert r.returncode == 0, "죽은 세션인데 강제가 막혔다: {}\n{}".format(r.returncode, r.stderr)
    assert os.path.exists(os.path.join(tickets, "cccc0003.md")), "죽은 세션이 안 풀렸다"

    # --- 5) pid 없는 산 세션(session= 갈래): --force도 거부하고 문구가 다르다 ---
    sid = "dddd0004-sid"
    ghost = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(60)",
                              "--session-id", sid])
    alive.append(ghost)
    assert wait_for(lambda: sid in subprocess.run(
        ["ps", "-eo", "command="], capture_output=True, text=True).stdout, 10)
    mkfile(os.path.join(tickets, "dddd0004.wip.md"),
           WIP.format(h="dddd0004", sid=sid, pid=""))
    r = run(w1, "unassign", "dddd0004", "--force", env=env)
    assert r.returncode == 1, "pid 없는 산 세션이 1이 아니다: {}\n{}".format(r.returncode, r.stderr)
    assert "먼저 끝내거나 죽인 뒤 다시 시도하세요" not in r.stderr, \
        "종전 문구를 재사용했다(이미 강제를 시도한 사람에게 할 말이 아니다)\n" + r.stderr
    assert "pid" in r.stderr, r.stderr
    assert os.path.exists(os.path.join(tickets, "dddd0004.wip.md")), "거부했는데 티켓이 풀렸다"
    ghost.kill(); ghost.wait()

    # --- 6) 진짜 디스패치 한 바퀴: 강제로 끊으면 부모가 풀고 로그는 KILLED다 ---
    # 앞 케이스가 남긴 열린 티켓을 치운다 - 선정은 최고참 1건이라 그게 먼저 뽑힌다.
    for f in os.listdir(tickets):
        os.remove(os.path.join(tickets, f))
    mkfile(os.path.join(tickets, "eeee0005.md"), TICKET.format(h="eeee0005"))
    tick = subprocess.Popen([w1, "tick"], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    alive.append(tick)
    wip = os.path.join(tickets, "eeee0005.wip.md")
    assert wait_for(lambda: "DISPATCH eeee0005" in readlog() and os.path.exists(wip)), \
        "디스패치가 안 섰다\n" + readlog()
    # 세션이 정말 살아서 stdin을 빨고 있어야(=inbox가 광고돼야) 강제가 재현이다
    assert wait_for(lambda: "inbox:" in open(wip, encoding="utf-8").read()
                    and open(wip, encoding="utf-8").read().split("inbox:")[1][:2].strip()), \
        "엔진이 기동 못 했다(주입+init)\n" + readlog()
    time.sleep(2)                                   # 경과가 0s로 안 찍히게 - 수를 눈으로 본다

    r = run(w1, "unassign", "eeee0005", env=env)
    assert r.returncode == 3, "디스패치된 산 세션이 3이 아니다: {}\n{}".format(r.returncode, r.stderr)
    r = run(w1, "unassign", "eeee0005", "--force", env=env)
    assert r.returncode == 0, "강제가 실패했다: {}\n{}{}".format(r.returncode, r.stdout, r.stderr)
    tick.wait(timeout=60)
    assert os.path.exists(os.path.join(tickets, "eeee0005.md")), \
        "강제 뒤 백로그로 안 돌아왔다: " + str(os.listdir(tickets))

    log = readlog()
    assert "TIMEOUT eeee0005" not in log, "상한 미만에 죽었는데 TIMEOUT으로 적었다\n" + log
    m = re.search(r"KILLED eeee0005 (\d+)s ", log)
    assert m, "KILLED 줄이 없다\n" + log
    assert 0 < int(m.group(1)) < 120, "경과 초가 이상하다: " + m.group(0)

    # --- 7) 상한을 진짜 넘긴 세션은 여전히 TIMEOUT이다 ---
    w2 = mkfile(os.path.join(root, "workers", "w2.sh"),
                WORKER.format(name="w2", tmp=tmp, tick=TICK, maxrun=1), 0o755)
    for f in os.listdir(tickets):
        os.remove(os.path.join(tickets, f))
    mkfile(os.path.join(tickets, "ffff0006.md"), TICKET.format(h="ffff0006"))
    r = subprocess.run([w2, "tick"], capture_output=True, text=True, env=env, timeout=120)
    log = readlog()
    assert "TIMEOUT ffff0006" in log, "상한 초과가 TIMEOUT이 아니다\n" + log
    assert "KILLED ffff0006" not in log, "상한을 넘겼는데 KILLED로 적었다\n" + log

    print("OK - unassign --force + KILLED 로그")
finally:
    for p in alive:
        try:
            p.kill(); p.wait(timeout=5)
        except Exception:
            pass
    shutil.rmtree(tmp, ignore_errors=True)
