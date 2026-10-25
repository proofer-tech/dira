#!/usr/bin/env python3
"""dispatch.py run (docs/DESIGN.md P489). 가짜 워커 파일 + PATH의 가짜 crontab + 임시 TICKET_LOCAL.
실패하면 assert로 죽는다."""
import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DISPATCH = os.path.join(HERE, "dispatch.py")
TICKET = "---\nticket: {h}\ntitle: t\nkind: work\npersona: developer\n---\n\n## Goal\nx\n"


def setup(hashes, idle=("w1",), cron=("w1", "w2")):
    d = tempfile.mkdtemp()
    root, local, bindir = (os.path.join(d, n) for n in ("root", "local", "bin"))
    for p in (os.path.join(root, "tickets"), os.path.join(root, "workers"), os.path.join(local, "run"), bindir):
        os.makedirs(p)
    for h in hashes:
        with open(os.path.join(root, "tickets", h + ".md"), "w") as f:
            f.write(TICKET.format(h=h))
    for w in ("w1", "w2"):
        path = os.path.join(root, "workers", w + ".sh")
        with open(path, "w") as f:  # 띄워지면 인자를 표식 파일에 적는다
            f.write('#!/bin/bash\necho "$@" > "%s/ran-%s"\n' % (d, w))
    with open(os.path.join(bindir, "crontab"), "w") as f:
        f.write("#!/bin/sh\n" + "".join("echo '* * * * * %s/workers/%s.sh'\n" % (root, w) for w in cron))
    os.chmod(os.path.join(bindir, "crontab"), 0o755)
    with open(os.path.join(local, "dispatch.json"), "w") as f:  # 실제 머신 부하와 무관하게
        json.dump({"load_max": 1e9, "cron_load_max": 1e9}, f)
    return d, root, local, bindir


def lock(root, local, name):
    import hashlib
    h = hashlib.sha1(os.path.join(root, "workers", name).encode()).hexdigest()[:8]
    d = os.path.join(local, "run", "%s-%s.lock" % (name, h))
    os.makedirs(d)
    with open(os.path.join(d, "pid"), "w") as f:  # P522: pid 없는 락은 5초 뒤 걷히므로 산 pid를 적는다
        f.write("%d\n" % os.getpid())


def run(d, root, local, bindir, *args):
    env = dict(os.environ, TICKET_LOCAL=local, PATH=bindir + os.pathsep + os.environ["PATH"])
    r = subprocess.run([sys.executable, DISPATCH, "run", root] + list(args), env=env,
                       capture_output=True, text=True)
    return r.returncode, (json.loads(r.stdout) if r.stdout.strip() else None)


def runlog(root):
    p = os.path.join(root, "workers", "runner.log")
    return open(p).read() if os.path.exists(p) else ""


def ran(d, w, wait=True):
    p = os.path.join(d, "ran-" + w)
    for _ in range(50 if wait else 1):
        if os.path.exists(p):
            return open(p).read().strip()
        time.sleep(0.1)
    return None


def tree(root):
    out = {}
    for base, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(base, f)
            out[p] = open(p).read()
    return out


def main():
    # request: 후보 하나 + idle -> go (dryrun은 큐와 로그를 안 바꾼다)
    S = setup(["aaaaaaaa"])
    before = tree(S[1])
    rc, j = run(*S, "--reason", "request", "--hash", "aaaaaaaa", "--dryrun")
    assert rc == 0 and j["go"] and j["worker"] == "w1", (rc, j)
    assert tree(S[1]) == before and ran(S[0], "w1", False) is None
    # 실제: 띄우고 KICK 한 줄
    rc, j = run(*S, "--reason", "request", "--hash", "aaaaaaaa")
    assert rc == 0 and ran(S[0], "w1") == "tick aaaaaaaa"
    assert "[dispatch] KICK request aaaaaaaa w1" in runlog(S[1])

    # request: 다른 후보가 있어도 go, judge는 no-go + KICK-SKIP 한 줄, 워커 안 뜸
    S = setup(["aaaaaaaa", "bbbbbbbb"])
    rc, j = run(*S, "--reason", "request", "--hash", "aaaaaaaa", "--dryrun")
    assert rc == 0 and j["go"] and j["worker"] == "w1", (rc, j)
    rc, j = run(*S, "--reason", "judge", "--hash", "aaaaaaaa")
    assert rc == 1 and not j["go"] and j["worker"] is None
    assert runlog(S[1]).count("KICK-SKIP judge aaaaaaaa") == 1 and ran(S[0], "w1", False) is None
    # request: idle 워커 0개면 no-go + KICK-SKIP 한 줄
    S = setup(["aaaaaaaa"])
    lock(S[1], S[2], "w1")
    lock(S[1], S[2], "w2")
    rc, j = run(*S, "--reason", "request", "--hash", "aaaaaaaa")
    assert rc == 1 and not j["go"]
    assert "KICK-SKIP request aaaaaaaa idle 워커가 없다" in runlog(S[1])
    # 후보 아닌 해시
    rc, j = run(*S, "--reason", "judge", "--hash", "cccccccc")
    assert rc == 1 and not j["go"]
    # judge는 request와 같은 조건: 후보 하나면 go
    S = setup(["aaaaaaaa"])
    rc, j = run(*S, "--reason", "judge", "--hash", "aaaaaaaa", "--dryrun")
    assert rc == 0 and j["go"]

    # load_max 0: judge만 no-go(부하), request와 direct는 go
    S = setup(["aaaaaaaa", "bbbbbbbb"])
    with open(os.path.join(S[2], "dispatch.json"), "w") as f:
        json.dump({"load_max": 0, "cron_load_max": 1e9}, f)
    rc, j = run(*S, "--reason", "judge", "--hash", "aaaaaaaa", "--dryrun")
    assert rc == 1 and not j["go"] and "부하" in j["why"], j
    for r in ("request", "direct"):
        rc, j = run(*S, "--reason", r, "--hash", "aaaaaaaa", "--dryrun")
        assert rc == 0 and j["go"], (r, j)

    # direct: 해시 없으면 idle만 본다, 다른 후보 무시. 해시가 후보 아니면 no-go
    S = setup(["aaaaaaaa", "bbbbbbbb"])
    rc, j = run(*S, "--reason", "direct", "--hash", "aaaaaaaa", "--dryrun")
    assert rc == 0 and j["go"]
    rc, j = run(*S, "--reason", "direct", "--dryrun")
    assert rc == 0 and j["go"] and j["hash"] is None
    rc, j = run(*S, "--reason", "direct", "--hash", "zzzzzzzz", "--dryrun")
    assert rc == 1 and not j["go"]
    rc, j = run(*S, "--reason", "direct")
    assert rc == 0 and ran(S[0], "w1") == ""  # 해시 없으면 인자 없이

    # cron: --worker의 idle만 본다. 다른 후보 있어도 go, 부하 무관, runner.log 무변
    S = setup(["aaaaaaaa", "bbbbbbbb"])
    with open(os.path.join(S[2], "dispatch.json"), "w") as f:
        json.dump({"load_max": 0, "cron_load_max": 1e9}, f)
    rc, j = run(*S, "--reason", "cron", "--worker", os.path.join(S[1], "workers", "w2.sh"))
    assert rc == 0 and j["worker"] == "w2" and ran(S[0], "w2") == ""
    assert runlog(S[1]) == ""
    lock(S[1], S[2], "w1")
    rc, j = run(*S, "--reason", "cron", "--worker", "w1")
    assert rc == 1 and not j["go"] and runlog(S[1]) == ""

    # 락이 전부 잡히면 네 사유 모두 no-go. crontab에 없는 워커도 idle이 아니다
    S = setup(["aaaaaaaa"])
    lock(S[1], S[2], "w1")
    lock(S[1], S[2], "w2")
    for r, extra in (("request", ["--hash", "aaaaaaaa"]), ("judge", ["--hash", "aaaaaaaa"]),
                     ("direct", []), ("cron", ["--worker", "w1"])):
        rc, j = run(*S, "--reason", r, "--dryrun", *extra)
        assert rc == 1 and not j["go"], (r, j)
    S = setup(["aaaaaaaa"], cron=("w2",))
    rc, j = run(*S, "--reason", "direct", "--worker", "w1", "--dryrun")
    assert rc == 1, j

    # rc 2: 사유 오류, request/judge에 --hash 없음, cron에 --worker 없음
    S = setup(["aaaaaaaa"])
    for args in (["--reason", "bogus"], ["--reason", "request"], ["--reason", "judge"], ["--reason", "cron"]):
        rc, j = run(*S, *args)
        assert rc == 2 and j is None, (args, rc)
    print("ok")


main()
