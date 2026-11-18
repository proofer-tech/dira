#!/usr/bin/env python3
"""dispatch.py sweep (P565). 가짜 워커 + PATH의 가짜 crontab + 임시 TICKET_LOCAL.
빈 큐에서는 tick을 띄우지 않고 큐 아래 파일을 하나도 바꾸지 않는다. 일이 있을 때만 띄운다.
실패하면 assert로 죽는다."""
import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DISPATCH = os.path.join(HERE, "dispatch.py")
sys.path.insert(0, HERE)
import dispatch  # noqa: E402

TICKET = "---\nticket: {h}\ntitle: t\nkind: work\npersona: developer\n{extra}---\n\n## Goal\nx\n"


def setup(marker=True):
    d = tempfile.mkdtemp()
    root, local, bindir = (os.path.join(d, n) for n in ("root", "local", "bin"))
    for p in (os.path.join(root, "tickets"), os.path.join(root, "workers"), os.path.join(local, "run"), bindir):
        os.makedirs(p)
    for w in ("w1", "w2"):
        with open(os.path.join(root, "workers", w + ".sh"), "w") as f:  # 띄워지면 DIRA_SWEEP을 표식에 적는다
            f.write('#!/bin/bash\necho "sweep=$DIRA_SWEEP $*" > "%s/ran-%s"\n' % (d, w))
    lines = []
    for w in ("w1", "w2"):
        p = os.path.join(root, "workers", w + ".sh")
        lines.append(('# dira-worker "%s"' % p) if marker else
                     ('* * * * * python3 "%s" run "%s" --reason cron --worker "%s"' % (DISPATCH, root, p)))
    with open(os.path.join(bindir, "crontab"), "w") as f:
        f.write("#!/bin/sh\ncat <<'EOF'\n%s\nEOF\n" % "\n".join(lines))
    os.chmod(os.path.join(bindir, "crontab"), 0o755)
    with open(os.path.join(local, "dispatch.json"), "w") as f:
        json.dump({"load_max": 1e9, "cron_load_max": 1e9}, f)
    return d, root, local, bindir


def add(root, h, extra=""):
    with open(os.path.join(root, "tickets", h + ".md"), "w") as f:
        f.write(TICKET.format(h=h, extra=extra))


def sweep_once(d, root, local, bindir):
    env = dict(os.environ, TICKET_LOCAL=local, PATH=bindir + os.pathsep + os.environ["PATH"])
    env.pop("DIRA_SWEEP_TRACE", None)
    r = subprocess.run([sys.executable, DISPATCH, "sweep", "--once"], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def tree(root):
    out = {}
    for base, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(base, f)
            if f == ".metadata_never_index":
                continue
            out[p] = (os.stat(p).st_mtime_ns, open(p, "rb").read())
    return out


def ran(d, w, wait=True):
    p = os.path.join(d, "ran-" + w)
    for _ in range(50 if wait else 1):
        if os.path.exists(p):
            return open(p).read().strip()
        time.sleep(0.1)
    return None


def main():
    # 표지 줄 해석: 표지 - 옛 dispatch 줄 - 옛 직접 실행 줄은 등록, 다른 주석과 keepalive는 아니다
    txt = "\n".join([
        '# dira-worker "/a/.dira/workers/w1.sh"',
        '* * * * * python3 "/e/dispatch.py" run "/b/.dira" --reason cron --worker "/b/.dira/workers/w2.sh" >> "/b/.dira/workers/cron.log" 2>&1',
        '* * * * * "/c/.dira/workers/w3.sh" >> "/c/.dira/workers/cron.log" 2>&1',
        '# * * * * * "/d/.dira/workers/w4.sh"',
        '* * * * * "/h/.config/dira/mcp/keepalive.sh" "/e/tick.sh" >> "/h/mcp.log" 2>&1',
    ])
    assert dispatch.registered(txt) == ["/a/.dira/workers/w1.sh", "/b/.dira/workers/w2.sh",
                                        "/c/.dira/workers/w3.sh"], dispatch.registered(txt)

    # crontab 정리: 워커 실행 줄(짝줄 포함)은 표지 한 줄이 되고 기동 줄이 하나 생긴다. 남의 줄은 그대로
    L = '* * * * * python3 "/e/dispatch.py" sweep >> "/h/sweep.log" 2>&1'
    tab = "\n".join([
        "PATH=/usr/bin:/bin",
        "# 사람 주석",
        '* * * * * python3 "/e/dispatch.py" run "/b/.dira" --reason cron --worker "/b/.dira/workers/w1.sh" >> "/b/.dira/workers/cron.log" 2>&1',
        '* * * * * sleep 30; python3 "/e/dispatch.py" run "/b/.dira" --reason cron --worker "/b/.dira/workers/w1.sh" >> "/b/.dira/workers/cron.log" 2>&1',
        '* * * * * "/c/.dira/workers/w2.sh" >> "/c/.dira/workers/cron.log" 2>&1',
        '* * * * * sleep 30; "/c/.dira/workers/w2.sh" >> "/c/.dira/workers/cron.log" 2>&1',
        '* * * * * python3 "/r/remote.py" sync-all >> "/h/sync.log" 2>&1',
        '* * * * * "/h/.config/dira/mcp/keepalive.sh" "/e/tick.sh" >> "/h/mcp.log" 2>&1',
        "0 3 * * * /x/backup.sh",
        "",
    ])
    want = "\n".join([
        "PATH=/usr/bin:/bin",
        "# 사람 주석",
        '# dira-worker "/b/.dira/workers/w1.sh"',
        '# dira-worker "/c/.dira/workers/w2.sh"',
        '* * * * * python3 "/r/remote.py" sync-all >> "/h/sync.log" 2>&1',
        '* * * * * "/h/.config/dira/mcp/keepalive.sh" "/e/tick.sh" >> "/h/mcp.log" 2>&1',
        "0 3 * * * /x/backup.sh",
        L,
        "",
    ])
    got = dispatch.normalize_crontab(tab, L)
    assert got == want, got
    assert dispatch.normalize_crontab(got, L) == got   # 두 번째는 그대로
    assert dispatch.registered(got) == ["/b/.dira/workers/w1.sh", "/c/.dira/workers/w2.sh"]
    # GUI가 옛 2줄로 다시 등록해도 표지가 겹치지 않는다
    again = got + '* * * * * python3 "/e/dispatch.py" run "/b/.dira" --reason cron --worker "/b/.dira/workers/w1.sh" >> "/b/.dira/workers/cron.log" 2>&1\n'
    assert dispatch.normalize_crontab(again, L) == got
    # 남의 잡이 workers/*.sh를 불러도 dira 모양(같은 디렉터리 cron.log)이 아니면 건드리지 않는다
    other = '* * * * * "/x/workers/job.sh" >> "/tmp/job.log" 2>&1\n'
    assert dispatch.normalize_crontab(other, L) == other
    # 다른 엔진 자리를 가리키는 sweep 줄은 기동 줄로 치지 않는다
    stale = got.replace(L, '* * * * * python3 "/old/dispatch.py" sweep >> "/h/sweep.log" 2>&1')
    assert L in dispatch.normalize_crontab(stale, L)
    # 남의 잡이 workers/*.sh를 불러도 dira 모양(같은 디렉터리 cron.log)이 아니면 건드리지 않는다
    other = '* * * * * "/x/workers/job.sh" >> "/tmp/job.log" 2>&1\n'
    assert dispatch.normalize_crontab(other, L) == other
    # 다른 엔진 자리를 가리키는 sweep 줄은 기동 줄로 치지 않는다
    stale = got.replace(L, '* * * * * python3 "/old/dispatch.py" sweep >> "/h/sweep.log" 2>&1')
    assert L in dispatch.normalize_crontab(stale, L)
    # dira 줄이 없는 crontab은 건드리지 않는다
    assert dispatch.normalize_crontab("0 3 * * * /x/backup.sh\n", L) == "0 3 * * * /x/backup.sh\n"

    # 빈 큐: 띄우지 않고 큐 아래 파일을 하나도 안 바꾼다
    S = setup()
    before = tree(S[1])
    sweep_once(*S)
    assert ran(S[0], "w1", False) is None and ran(S[0], "w2", False) is None
    assert tree(S[1]) == before, "빈 큐 sweep이 큐 아래 파일을 바꿨다"

    # 완료 티켓만 있어도 빈 큐다
    with open(os.path.join(S[1], "tickets", "aaaaaaaa.done.md"), "w") as f:
        f.write(TICKET.format(h="aaaaaaaa", extra=""))
    sweep_once(*S)
    assert ran(S[0], "w1", False) is None

    # 티켓 하나: 워커 하나만, DIRA_SWEEP=1로 인자 없이 띄운다
    S = setup()
    add(S[1], "bbbbbbbb")
    sweep_once(*S)
    assert ran(S[0], "w1") == "sweep=1", ran(S[0], "w1", False)
    assert ran(S[0], "w2", False) is None

    # 티켓 둘: 놀고 있는 워커 둘 다
    S = setup()
    add(S[1], "cccccccc")
    add(S[1], "dddddddd")
    sweep_once(*S)
    assert ran(S[0], "w1") and ran(S[0], "w2")

    # 이미 할당된 티켓, deps 미충족 티켓은 일이 아니다
    S = setup()
    add(S[1], "eeeeeeee", "session_id: 1234\n")
    add(S[1], "ffffffff", "deps: [zzzzzzzz]\n")
    sweep_once(*S)
    assert ran(S[0], "w1", False) is None and ran(S[0], "w2", False) is None

    # 비상정지 중이면 띄우지 않는다
    S = setup()
    add(S[1], "gggggggg")
    with open(os.path.join(S[2], "emergency-stop.json"), "w") as f:
        json.dump({"on": True, "at": "", "workers": []}, f)
    sweep_once(*S)
    assert ran(S[0], "w1", False) is None

    # 부하 상한을 넘으면 띄우지 않고 runner.log에 한 줄
    S = setup()
    add(S[1], "hhhhhhhh")
    with open(os.path.join(S[2], "dispatch.json"), "w") as f:
        json.dump({"cron_load_max": -1}, f)
    sweep_once(*S)
    assert ran(S[0], "w1", False) is None
    assert "SKIP-LOAD" in open(os.path.join(S[1], "workers", "runner.log")).read()

    # 등록 안 된 워커는 띄우지 않는다(crontab에 없는 w3)
    S = setup()
    with open(os.path.join(S[1], "workers", "w3.sh"), "w") as f:
        f.write('#!/bin/bash\necho x > "%s/ran-w3"\n' % S[0])
    add(S[1], "iiiiiiii")
    add(S[1], "jjjjjjjj")
    add(S[1], "kkkkkkkk")
    sweep_once(*S)
    assert ran(S[0], "w1") and ran(S[0], "w2") and ran(S[0], "w3", False) is None

    # 옛 cron 줄(run --reason cron): 빈 큐면 띄우지 않는다
    S = setup(marker=False)
    env = dict(os.environ, TICKET_LOCAL=S[2], PATH=S[3] + os.pathsep + os.environ["PATH"])
    r = subprocess.run([sys.executable, DISPATCH, "run", S[1], "--reason", "cron", "--worker", "w1"],
                       env=env, capture_output=True, text=True)
    j = json.loads(r.stdout)
    assert r.returncode == 1 and not j["go"] and j["why"] == "빈 큐", j
    assert ran(S[0], "w1", False) is None
    add(S[1], "llllllll")
    r = subprocess.run([sys.executable, DISPATCH, "run", S[1], "--reason", "cron", "--worker", "w1"],
                       env=env, capture_output=True, text=True)
    assert r.returncode == 0 and ran(S[0], "w1") is not None, r.stdout
    print("ok")


main()
