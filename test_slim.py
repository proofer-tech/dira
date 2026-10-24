#!/usr/bin/env python3
"""P519-1 자체검증: slim.py(status empty fill auto)와 tick.sh의 채우기 호출. 실패하면 assert로 죽는다."""
__import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())
import json
import os
import re
import shutil
import subprocess
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SLIM = os.path.join(HERE, "slim.py")
TICK = os.path.join(HERE, "tick.sh")


def sh(*argv, cwd=None, ok=True, **kw):
    r = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=60, **kw)
    assert not ok or r.returncode == 0, "{}: {} {}".format(argv, r.returncode, r.stderr)
    return r


def put(path, body="x\n"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(body)


def slim(proj, cmd):
    r = sh("python3", SLIM, cmd, os.path.join(proj, ".dira"), ok=False)
    return r.returncode, json.loads(r.stdout)


def mkproj(tmp, name):
    """통합 브랜치 master, 추적 파일 셋, 무시 파일 node_modules/x와 .env.local, linked worktree 하나."""
    proj = os.path.join(tmp, name)
    os.makedirs(proj)
    g = lambda *a, **kw: sh("git", "-C", proj, *a, **kw)
    g("init", "-q", "-b", "master")
    g("config", "user.email", "t@t.t")
    g("config", "user.name", "t")
    g("config", "receive.denyCurrentBranch", "updateInstead")
    put(os.path.join(proj, ".gitignore"), ".dira\nnode_modules\n.env.local\n")
    for n in ("a.txt", "src/b.txt", "src/deep/c.txt"):
        put(os.path.join(proj, n))
    g("add", "-A")
    g("commit", "-q", "-m", "init")
    put(os.path.join(proj, "node_modules", "x"))
    put(os.path.join(proj, ".env.local"), "SECRET=1\n")
    os.makedirs(os.path.join(proj, ".dira", "tickets"))
    put(os.path.join(proj, ".dira", "integration-branch"), "master\n")
    put(os.path.join(proj, ".dira", "slim-checkout"), "on\n")
    wt = os.path.join(proj, ".dira", "worktrees", "w1")
    g("worktree", "add", "-q", "-b", "wt/w1", wt)
    sh("git", "-C", wt, "config", "user.email", "t@t.t")
    sh("git", "-C", wt, "config", "user.name", "t")
    return proj, wt


def main():
    tmp = os.path.realpath(tempfile.mkdtemp())
    try:
        proj, wt = mkproj(tmp, "p1")
        assert slim(proj, "status")[1]["state"] == "full"
        rc, out = slim(proj, "empty")
        assert rc == 0 and out["state"] == "empty", out
        left = set(os.listdir(proj))
        assert left == {".dira", ".git", ".env.local"}, left
        assert not os.path.exists(os.path.join(proj, "node_modules"))
        assert os.path.isdir(wt)
        assert sh("git", "-C", proj, "status", "--porcelain").stdout == ""
        assert slim(proj, "status")[1]["state"] == "empty"
        assert not [l for l in sh("git", "-C", wt, "ls-files", "-t").stdout.splitlines() if l.startswith("S ")]
        assert slim(proj, "empty")[0] == 0  # 이미 비어 있으면 그대로

        # 비운 상태에서 linked worktree의 updateInstead push가 성공한다
        put(os.path.join(wt, "new.txt"), "n\n")
        sh("git", "-C", wt, "add", "-A")
        sh("git", "-C", wt, "commit", "-q", "-m", "add new")
        sh("git", "-C", wt, "push", "-q", proj, "HEAD:master")
        assert sh("git", "-C", proj, "status", "--porcelain").stdout == ""
        rc, out = slim(proj, "fill")
        assert rc == 0 and out["state"] == "full", out
        assert open(os.path.join(proj, "new.txt")).read() == "n\n"
        assert os.path.exists(os.path.join(proj, "src/deep/c.txt"))
        assert slim(proj, "fill")[0] == 0  # 이미 채워져 있으면 그대로

        # 거절: 추적 파일 수정, 미추적 파일, 다른 브랜치
        for tag, setup in (("tracked", lambda p: put(os.path.join(p, "a.txt"), "edit\n")),
                           ("untracked", lambda p: put(os.path.join(p, "u.txt"))),
                           ("branch", lambda p: sh("git", "-C", p, "checkout", "-q", "-b", "other"))):
            p, _ = mkproj(tmp, "r-" + tag)
            setup(p)
            before = sorted(os.path.join(d, f) for d, _, fs in os.walk(p) if ".git" not in d.split(os.sep) for f in fs)
            rc, out = slim(p, "empty")
            assert rc == 2 and out["reason"] and out["state"] == "full", (tag, rc, out)
            after = sorted(os.path.join(d, f) for d, _, fs in os.walk(p) if ".git" not in d.split(os.sep) for f in fs)
            assert before == after, tag

        # auto: .wip이 있거나 71시간이면 안 비우고, .wip 0장 73시간이면 비운다. 옵션 파일이 없으면 아무것도 안 한다
        p, _ = mkproj(tmp, "auto")
        q = os.path.join(p, ".dira")
        act = os.path.join(q, "slim-checkout.active")
        put(act)
        age = lambda h: os.utime(act, (time.time() - h * 3600,) * 2)
        age(71)
        assert slim(p, "auto")[1]["state"] == "full"
        age(73)
        put(os.path.join(q, "tickets", "aaaaaaaa.wip.md"))
        assert slim(p, "auto")[1]["state"] == "full"
        os.unlink(os.path.join(q, "tickets", "aaaaaaaa.wip.md"))
        rc, out = slim(p, "auto")
        assert rc == 0 and out["state"] == "empty", out
        p2, _ = mkproj(tmp, "auto-off")
        os.unlink(os.path.join(p2, ".dira", "slim-checkout"))
        put(os.path.join(p2, ".dira", "slim-checkout.active"))
        os.utime(os.path.join(p2, ".dira", "slim-checkout.active"), (1, 1))
        assert slim(p2, "auto")[1]["state"] == "full"

        # tick.sh: 옵션이 켜져 있으면 세션 시작 전에 루트가 full이 되고 active가 갱신된다
        p3, _ = mkproj(tmp, "tick")
        q3 = os.path.join(p3, ".dira")
        assert slim(p3, "empty")[0] == 0
        act3 = os.path.join(q3, "slim-checkout.active")
        put(act3)
        os.utime(act3, (1000, 1000))
        seen = os.path.join(tmp, "seen")
        eng = os.path.join(tmp, "eng.sh")
        put(eng, '#!/bin/bash\nwip=$(ls "%s"/tickets/*.wip.md | head -1)\n'
                 '[ -f "%s/a.txt" ] && echo full > "%s" || echo empty > "%s"\n'
                 'mv "$wip" "${wip%%.wip.md}.done.md"\n'
                 'echo \'{"is_error":false,"type":"result","session_id":"s","subtype":"success"}\'\n' % (q3, p3, seen, seen))
        os.chmod(eng, 0o755)
        w = os.path.join(q3, "workers", "w1.sh")
        put(w, '#!/bin/bash\nTICKET_NAME="w1"\nTICKET_CWD="%s"\nTICKET_ENGINE=("%s" "{prompt}")\n. "%s"\n' % (tmp, eng, TICK))
        os.chmod(w, 0o755)
        put(os.path.join(q3, "tickets", "bbbbbbbb.md"), "---\nticket: bbbbbbbb\ntitle: t\nkind: work\n---\n\n## Goal\ng\n")
        local = os.path.join(tmp, "local")
        os.makedirs(local)
        sh("bash", w, env=dict(os.environ, TICKET_LOCAL=local, HOME=tmp))
        assert open(seen).read().strip() == "full", "세션 시작 전에 채워지지 않았다"
        assert os.stat(act3).st_mtime > 1e9 + 1000
        assert slim(p3, "status")[1]["state"] == "full"

        # tick.sh의 slim.py 호출(굽기 목록 제외)은 전부 옵션 판정(slim_on) 안쪽이다
        src = open(TICK).read().splitlines()
        for i, l in enumerate(src):
            if "slim.py" in l and "for f in" not in l and "slim_on()" not in l and not l.lstrip().startswith("#"):
                assert any("slim_on" in x for x in src[max(0, i - 3):i]), (i + 1, l)
        print("OK")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


main()
