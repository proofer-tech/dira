#!/usr/bin/env python3
"""P514-2 tick 진입 잠금. 실패하면 assert로 죽는다. 임시 TICKET_LOCAL + 가짜 python3(reap만 느리게)."""
import hashlib
import json
import shutil
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DISPATCH = os.path.join(HERE, "dispatch.py")


def make():
    d = os.path.realpath(tempfile.mkdtemp())  # tick.sh가 pwd -P로 해석하므로 처음부터 실경로
    root, local, bindir = (os.path.join(d, n) for n in ("root", "local", "bin"))
    for p in ("tickets", "workers"):
        os.makedirs(os.path.join(root, p))
    os.makedirs(os.path.join(local, "run"))
    os.makedirs(bindir)
    with open(os.path.join(bindir, "crontab"), "w") as f:
        f.write("#!/bin/sh\necho '* * * * * %s/workers/w1.sh'\n" % root)
    os.chmod(os.path.join(bindir, "crontab"), 0o755)
    with open(os.path.join(local, "dispatch.json"), "w") as f:  # 머신 부하와 무관하게
        json.dump({"load_max": 1e9}, f)
    w = os.path.join(root, "workers", "w1.sh")
    with open(w, "w") as f:
        f.write('. "%s/tick.sh"\n' % os.path.join(d, "code"))
    code = os.path.join(d, "code")  # tick.sh는 PATH를 초기화하므로 tickets.py 스텁으로 reap을 느리게 한다
    os.makedirs(code)
    shutil.copy(os.path.join(HERE, "tick.sh"), code)
    with open(os.path.join(code, "tickets.py"), "w") as f:
        f.write('import sys, time\nif sys.argv[1] == "reap":\n'
                '    open("%s/reap-count", "a").write("x")\n    time.sleep(10)\n' % d)
    env = dict(os.environ, TICKET_LOCAL=local, PATH=bindir + os.pathsep + os.environ["PATH"])
    h = hashlib.sha1(os.path.realpath(w)[:-3].encode()).hexdigest()[:8]
    return d, root, local, w, env, os.path.join(local, "run", "w1-%s.entry" % h)


def dispatch(d, root, local):
    env = dict(os.environ, TICKET_LOCAL=local, PATH=os.path.join(d, "bin") + os.pathsep + os.environ["PATH"])
    r = subprocess.run([sys.executable, DISPATCH, "run", os.path.realpath(root), "--reason", "cron", "--worker", "w1.sh", "--dryrun"],
                       env=env, capture_output=True, text=True)
    return r.returncode, json.loads(r.stdout)


def runlog(root):
    p = os.path.join(root, "workers", "runner.log")
    return open(p).read() if os.path.exists(p) else ""


def main():
    d, root, local, w, env, entry = make()
    # 1. 산 pid가 쥔 잠금: 1초 안에 끝나고 runner.log에 새 줄이 없다
    os.makedirs(entry)
    with open(os.path.join(entry, "pid"), "w") as f:
        f.write(str(os.getpid()))
    t = time.time()
    r = subprocess.run(["bash", w], env=env, capture_output=True, text=True, timeout=5)
    el = time.time() - t  # 부하가 큰 머신에서 1초는 흔들려 3초로 둔다. reap 미진입이 본 판정
    assert r.returncode == 0 and el < 3 and  runlog(root) == "", (r, el, runlog(root))
    assert not os.path.exists(os.path.join(d, "reap-count"))
    # 2. dispatch.py가 그 워커를 idle에서 뺀다
    rc, j = dispatch(d, root, local)
    assert rc == 1 and not j["go"], (rc, j)
    # 3. 인자 있는 호출은 막지 않는다
    for a in ("list", "dryrun"):
        subprocess.run(["bash", w, a], env=env, capture_output=True, text=True, timeout=20)
    assert os.path.isdir(entry)  # 남의 잠금은 안 건드린다
    # 4. 죽은 pid의 잠금은 걷고 다시 잡는다: 10개 동시 tick 중 reap에 들어간 것은 하나, 끝나면 잠금이 풀린다
    with open(os.path.join(entry, "pid"), "w") as f:
        f.write("999999")
    rc, j = dispatch(d, root, local)
    assert rc == 0 and j["go"], (rc, j, os.listdir(os.path.join(local, "run")))
    # 4b. 깨진 pid 값(-1 0 abc 빈 문자열)은 죽은 것이다: dispatch는 idle로 보고 tick은 잠금을 걷고 reap에 든다
    for bad in ("-1", "0", "abc", ""):
        with open(os.path.join(entry, "pid"), "w") as f:
            f.write(bad)
        rc, j = dispatch(d, root, local)
        assert rc == 0 and j["go"], (bad, rc, j)
        p = subprocess.Popen(["bash", w], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(80):
            if os.path.exists(os.path.join(d, "reap-count")):
                break
            time.sleep(0.1)
        assert os.path.exists(os.path.join(d, "reap-count")), bad
        os.remove(os.path.join(d, "reap-count"))
        p.kill()
        p.wait()
        shutil.rmtree(entry, ignore_errors=True)
        os.makedirs(entry)
    time.sleep(0.5)  # 죽인 tick의 스텁이 남기는 기록까지 기다린 뒤 비운다
    if os.path.exists(os.path.join(d, "reap-count")):
        os.remove(os.path.join(d, "reap-count"))
    with open(os.path.join(entry, "pid"), "w") as f:
        f.write("999999")
    # 4c. pid 없는 빈 잠금: 방금 만들었으면 산 것(조용히 exit 0, reap 없음, stderr 없음), 오래됐으면 걷는다
    shutil.rmtree(entry, ignore_errors=True)
    os.makedirs(entry)
    r = subprocess.run(["bash", w], env=env, capture_output=True, text=True, timeout=20)
    assert r.returncode == 0 and r.stderr == "" and not os.path.exists(os.path.join(d, "reap-count")), r
    assert os.path.isdir(entry)
    old = time.time() - 60
    os.utime(entry, (old, old))
    rc, j = dispatch(d, root, local)
    p = subprocess.Popen(["bash", w], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(80):
        if os.path.exists(os.path.join(d, "reap-count")):
            break
        time.sleep(0.1)
    assert os.path.exists(os.path.join(d, "reap-count"))
    p.kill()
    p.wait()
    shutil.rmtree(entry, ignore_errors=True)
    os.makedirs(entry)
    time.sleep(0.5)
    if os.path.exists(os.path.join(d, "reap-count")):
        os.remove(os.path.join(d, "reap-count"))
    with open(os.path.join(entry, "pid"), "w") as f:
        f.write("999999")
    # 4d. reap 루트 잠금: 방금 만든 빈 디렉터리면 SKIP
    sys.path.insert(0, HERE)
    import tickets as T
    ld = os.path.join(d, "reaplocal")
    lock = os.path.join(ld, "run", "reap-%s.lock" % hashlib.sha1(os.path.realpath(root).encode()).hexdigest()[:8])
    os.makedirs(lock)
    assert T.reap(root, ld) == ["SKIP 다른 reap이 도는 중"]
    os.utime(lock, (old, old))
    assert T.reap(root, ld) != ["SKIP 다른 reap이 도는 중"]
    ps = [subprocess.Popen(["bash", w], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) for _ in range(10)]
    rc_file = os.path.join(d, "reap-count")
    for _ in range(80):  # 부하가 큰 머신에서는 reap에 닿기까지 오래 걸린다
        if os.path.exists(rc_file) and sum(p.poll() is None for p in ps) == 1:
            break
        time.sleep(0.1)
    n = open(os.path.join(d, "reap-count")).read().count("x")
    assert n == 1, n
    assert sum(p.poll() is None for p in ps) == 1
    for p in ps:
        p.kill()
        p.wait()
    print("ok")


if __name__ == "__main__":
    main()
