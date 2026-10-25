#!/usr/bin/env python3
"""ps가 시간을 넘겨도 REAP_CLEAR 전부 빈 .wip만 회수하는지 검증(P522 결정 6). 실패하면 assert로 죽는다."""
import os
import sys
import stat
import time
import shutil
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp()
try:
    bindir = os.path.join(tmp, "bin")
    os.makedirs(bindir)
    ps = os.path.join(bindir, "ps")
    with open(ps, "w") as f:
        f.write("#!/bin/sh\nsleep 15\n")
    os.chmod(ps, os.stat(ps).st_mode | stat.S_IXUSR)

    td = os.path.join(tmp, "q", "tickets")
    os.makedirs(td)
    paths = {}
    for h, extra in (("aaaa1111", ""), ("bbbb2222", "owner: developer / w1-x\n")):
        p = os.path.join(td, h + ".wip.md")
        with open(p, "w", encoding="utf-8") as f:
            f.write("---\nticket: {}\nkind: work\npersona: developer\npid:\n{}---\n\n## Goal\nx\n".format(h, extra))
        old = time.time() - 181
        os.utime(p, (old, old))
        paths[h] = p

    env = dict(os.environ, PATH=bindir + os.pathsep + os.environ["PATH"])
    r = subprocess.run([sys.executable, os.path.join(HERE, "tickets.py"), "reap", os.path.join(tmp, "q")],
                       capture_output=True, text=True, env=env, timeout=120)
    print(r.stdout, r.stderr)
    assert r.returncode == 0, r.returncode
    assert os.path.exists(os.path.join(td, "aaaa1111.md")), "전부 빈 .wip이 열림으로 안 돌아왔다"
    assert not os.path.exists(paths["aaaa1111"])
    assert os.path.exists(paths["bbbb2222"]), "owner가 찬 .wip은 보류여야 한다"
    print("OK")
finally:
    shutil.rmtree(tmp)
