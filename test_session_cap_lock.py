"""머신 전체 세션 상한 검사의 직렬화 락 검증 (요구 ae6ccb48).

산 세션이 상한-1인 큐에서 워커 넷의 tick을 동시에 띄워도 디스패치(게이트 통과)가 한 건뿐인지,
락이 스테일일 때 회수되는지, 그리고 큐 사본(.dira/session-cap.sh)이 git 템플릿
(templates/hooks/session-cap.sh)과 같은지 본다. mktemp 합성 큐에서만 돈다.

사용법: python3 test_session_cap_lock.py
"""
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SC = os.path.join(HERE, "templates", "hooks", "session-cap.sh")


def rig(d, live_pids, limit):
    root = os.path.join(d, "q")
    local = os.path.join(d, "local")
    os.makedirs(os.path.join(root, "workers"))
    os.makedirs(os.path.join(root, "tickets"))
    os.makedirs(local)
    with open(os.path.join(local, "session-limit"), "w") as f:
        f.write("%d\n" % limit)
    with open(os.path.join(local, "gui-projects.json"), "w") as f:
        f.write('{"projects":[{"root":"%s"}]}' % root)
    for i, pid in enumerate(live_pids):
        wip(root, "live%04d" % i, pid)
    # 합성 워커 - 게이트를 지나면 디스패치(.wip에 산 pid 기록)를 흉내 내고 잠시 산다.
    for name in ("w1", "w2", "w3", "w4"):
        with open(os.path.join(root, "workers", name + ".sh"), "w") as f:
            f.write(
                '#!/bin/bash\nTICKET_LOCAL="%s"\n. "%s"\n'
                'sleep 0.3\nsleep 30 & P=$!\n'
                'printf -- "---\\npid: %%s\\n---\\n" "$P" > "%s/tickets/new-$$.wip.md"\n'
                'echo GATE_PASSED\nsleep 3\nkill $P\n' % (local, SC, root)
            )
    return root, local


def wip(root, h, pid):
    with open(os.path.join(root, "tickets", h + ".wip.md"), "w") as f:
        f.write("---\nticket: %s\npid: %d\n---\n" % (h, pid))


def run_four(root, extra_env=None):
    env = dict(os.environ, **(extra_env or {}))
    procs = [
        subprocess.Popen(["bash", os.path.join(root, "workers", n + ".sh")],
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env)
        for n in ("w1", "w2", "w3", "w4")
    ]
    return sum(p.communicate()[0].count("GATE_PASSED") for p in procs)


def main():
    fail = 0
    sleeper = subprocess.Popen(["sleep", "60"])
    try:
        with tempfile.TemporaryDirectory() as d:
            root, local = rig(d, [sleeper.pid, sleeper.pid], 3)
            n = run_four(root)
            ok = n == 1
            print("%s 산 2/상한 3에서 동시 tick 넷 -> 디스패치 %d건 (기대 1)" % ("PASS" if ok else "FAIL", n))
            fail |= not ok
            time.sleep(2)  # 감시 서브셸이 락을 뗀다
            ok = not os.path.exists(os.path.join(local, "run", "session-cap.lock"))
            print("%s 디스패치 뒤 락이 풀린다" % ("PASS" if ok else "FAIL"))
            fail |= not ok

        with tempfile.TemporaryDirectory() as d:
            root, local = rig(d, [sleeper.pid, sleeper.pid], 3)
            lock = os.path.join(local, "run", "session-cap.lock")
            os.makedirs(lock)
            dead = subprocess.Popen(["true"]); dead.wait()
            with open(os.path.join(lock, "pid"), "w") as f:
                f.write("%d\n" % dead.pid)
            n = run_four(root)
            ok = n == 1
            print("%s 죽은 pid가 쥔 락은 회수된다 -> 디스패치 %d건" % ("PASS" if ok else "FAIL", n))
            fail |= not ok

        with tempfile.TemporaryDirectory() as d:
            root, local = rig(d, [sleeper.pid, sleeper.pid], 3)
            lock = os.path.join(local, "run", "session-cap.lock")
            os.makedirs(lock)
            with open(os.path.join(lock, "pid"), "w") as f:
                f.write("%d\n" % sleeper.pid)  # 산 pid가 쥐고 있다
            n = run_four(root)
            ok = n == 0
            print("%s 산 pid가 쥔 새 락 앞에서는 전부 건너뛴다 -> 디스패치 %d건" % ("PASS" if ok else "FAIL", n))
            fail |= not ok
            old = time.time() - 500
            os.utime(lock, (old, old))
            n = run_four(root)
            ok = n == 1
            print("%s 상한 시간을 넘긴 락은 산 pid여도 회수된다 -> 디스패치 %d건" % ("PASS" if ok else "FAIL", n))
            fail |= not ok

        queue_copy = os.path.join(HERE, ".dira", "session-cap.sh")
        if os.path.exists(queue_copy):
            ok = open(queue_copy, "rb").read() == open(SC, "rb").read()
            print("%s 큐 사본과 git 템플릿이 같다" % ("PASS" if ok else "FAIL"))
            fail |= not ok
    finally:
        sleeper.kill()
    print("전부 PASS" if not fail else "FAIL 있음")
    return fail


sys.exit(main())
