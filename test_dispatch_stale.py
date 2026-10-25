#!/usr/bin/env python3
"""dispatch.py P522 결정 1-2-3-5: 죽은 락 회수, cron 띄움 잠금, 부하 건너뛰기, 세션 없는 tick 회수.
test_dispatch.py의 가짜 워커-crontab 틀을 재사용한다. 실패하면 assert로 죽는다."""
import hashlib
import json
import os
import subprocess
import sys
import threading
import time

sys.argv, _argv = sys.argv[:1], sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "test_dispatch.py")).read().split("\ndef main():")[0]
exec(compile(src, "test_dispatch.py", "exec"))


def lockdir(root, local, name, suffix="lock"):
    h = hashlib.sha1(os.path.join(root, "workers", name).encode()).hexdigest()[:8]
    return os.path.join(local, "run", "%s-%s.%s" % (name, h, suffix))


def sleeper():
    p = subprocess.Popen(["sleep", "600"], start_new_session=True)
    threading.Thread(target=p.wait, daemon=True).start()  # 좀비로 남으면 kill -0이 성공한다
    return p


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def put(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def cron(S, w="w1", *extra):
    return run(*S, "--reason", "cron", "--worker", w + ".sh", *extra)


def main():
    # 결정 1: 죽은 pid 락은 걷고 go, 산 pid 락은 go false
    S = setup([])
    d = lockdir(S[1], S[2], "w1")
    put(os.path.join(d, "pid"), "999999\n")
    rc, j = cron(S, "w1", "--dryrun")
    assert rc == 0 and j["go"], j
    assert not os.path.exists(d)
    assert runlog(S[1]).count("WARN 죽은 워커 락 회수 w1 pid=999999") == 1, runlog(S[1])
    live = sleeper()
    put(os.path.join(d, "pid"), "%d\n" % live.pid)
    rc, j = cron(S, "w1", "--dryrun")
    assert rc == 1 and not j["go"] and os.path.isdir(d), j
    live.kill()
    # pid 파일 없는 락: 5초 안은 busy, 지나면 회수
    os.remove(os.path.join(d, "pid"))
    fut = time.time() + 120  # 부하가 높아도 5초 안으로 보이게 미래 시각으로 둔다
    os.utime(d, (fut, fut))
    rc, j = cron(S, "w1", "--dryrun")
    assert rc == 1, j
    old = time.time() - 10
    os.utime(d, (old, old))
    rc, j = cron(S, "w1", "--dryrun")
    assert rc == 0 and not os.path.exists(d), j
    # 죽은 진입 잠금은 로그 없이 걷는다
    S = setup([])
    e = lockdir(S[1], S[2], "w1", "entry")
    put(os.path.join(e, "pid"), "999999\n")
    rc, j = cron(S, "w1", "--dryrun")
    assert rc == 0 and not os.path.exists(e) and runlog(S[1]) == "", j

    # 결정 2: 60초 자는 워커를 10번 불러도 하나만 뜬다. 죽이면 다시 뜬다
    S = setup([])
    sh = os.path.join(S[1], "workers", "w1.sh")
    put(sh, "#!/bin/bash\nsleep 60\n")
    whys = [cron(S)[1]["why"] for _ in range(10)]
    assert whys[0] == "idle 워커" and all(w == "앞 tick이 아직 돈다" for w in whys[1:]), whys
    pidf = os.path.join(lockdir(S[1], S[2], "w1", "launch"), "pid")
    pid = int(open(pidf).read())
    assert runlog(S[1]) == ""
    # 다른 길은 이 잠금을 보지 않는다
    rc, j = run(*S, "--reason", "direct", "--worker", "w1", "--dryrun")
    assert rc == 0 and j["go"], j
    os.killpg(pid, 9)
    for _ in range(50):
        if not alive(pid):
            break
        time.sleep(0.1)
    rc, j = cron(S, "w1", "--dryrun")
    assert rc == 0 and j["why"] == "idle 워커", j
    assert not os.path.exists(os.path.dirname(pidf))

    # 결정 3: cron_load_max 0.01이면 셋 다 false, SKIP-LOAD 한 줄, direct는 통과
    S = setup(["aaaaaaaa"])
    put(os.path.join(S[2], "dispatch.json"), json.dumps({"cron_load_max": 0.01, "load_max": 1e9}))
    for _ in range(3):
        rc, j = cron(S)
        assert rc == 1 and not j["go"], j
    assert ran(S[0], "w1", False) is None
    assert runlog(S[1]).count("SKIP-LOAD") == 1, runlog(S[1])
    rc, j = run(*S, "--reason", "direct", "--hash", "aaaaaaaa", "--dryrun")
    assert rc == 0 and j["go"], j

    # 결정 5: 세션 없이 오래된 산 pid 락은 끝내고 go, session에 산 pid가 있으면 busy
    S = setup([])
    d = lockdir(S[1], S[2], "w1")
    live = sleeper()
    put(os.path.join(d, "pid"), "%d\n" % live.pid)
    old = time.time() - (600 + 61)
    os.utime(os.path.join(d, "pid"), (old, old))
    other = sleeper()
    put(os.path.join(d, "session"), "%d\n" % other.pid)
    rc, j = cron(S, "w1", "--dryrun")
    assert rc == 1 and alive(live.pid) and os.path.isdir(d), j
    os.remove(os.path.join(d, "session"))
    other.kill()
    rc, j = cron(S, "w1", "--dryrun")
    assert rc == 0 and j["go"] and not os.path.exists(d), j
    for _ in range(50):
        if live.poll() is not None:
            break
        time.sleep(0.1)
    assert live.poll() is not None
    assert runlog(S[1]).count("WARN 세션 없는 tick 회수 pid=%d" % live.pid) == 1, runlog(S[1])
    print("ok")


main()
