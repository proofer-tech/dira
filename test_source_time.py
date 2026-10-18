#!/usr/bin/env python3
"""P508-1 자체검증: 더 옛 출처 시각의 코드가 고정 경로 엔진 파일과 code-dir을 덮어쓰지 않는가.

코드 디렉터리마다 tick.sh 사본과 source-time 파일을 두고 같은 임시 HOME에서 dryrun으로 돌린다.
"""
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = "mcp_server.py mcp_tools.py tickets.py graph.py learn.py remote.py ontology_read.py".split()


def mkcode(tmp, name, stamp):
    d = os.path.join(tmp, name)
    os.makedirs(d)
    shutil.copy(os.path.join(HERE, "tick.sh"), d)
    for f in FILES:
        open(os.path.join(d, f), "w").write("# " + name + "\n")
    if stamp is not None:
        open(os.path.join(d, "source-time"), "w").write("%d\n" % stamp)
    return d


def run(tmp, code):
    root = os.path.join(tmp, "q")
    os.makedirs(os.path.join(root, "tickets"), exist_ok=True)
    os.makedirs(os.path.join(root, "workers"), exist_ok=True)
    w = os.path.join(root, "workers", "w.sh")
    open(w, "w").write('#!/bin/bash\nTICKET_NAME="w"\nTICKET_CWD="%s"\n. "%s/tick.sh"\n' % (tmp, code))
    os.chmod(w, 0o755)
    env = dict(os.environ, HOME=tmp, PATH="/usr/bin:/bin")
    subprocess.run(["bash", w, "dryrun"], env=env, cwd=tmp, capture_output=True, timeout=60)


def state(tmp):
    ed = os.path.join(tmp, ".config", "dira", "bin", "engines")
    rd = lambda n: open(os.path.join(ed, n)).read()
    return {f: rd(f) for f in FILES}, rd("code-dir").strip(), rd("source-time").strip()


def main():
    tmp = os.path.realpath(tempfile.mkdtemp())
    try:
        new = mkcode(tmp, "new", 200)
        old = mkcode(tmp, "old", 100)
        none = mkcode(tmp, "none", None)
        run(tmp, new)
        files, cd, st = state(tmp)
        assert st == "200" and cd == new and all(v == "# new\n" for v in files.values()), (files, cd, st)
        run(tmp, old)  # 더 옛 코드는 건너뛴다
        files, cd, st = state(tmp)
        assert st == "200" and cd == new and all(v == "# new\n" for v in files.values()), (files, cd, st)
        run(tmp, none)  # 출처 시각 0도 더 옛 코드다
        assert state(tmp)[2] == "200"
        shutil.rmtree(os.path.join(tmp, ".config"))
        run(tmp, old)
        run(tmp, new)  # 반대 순서: 200 쪽으로 바뀐다
        files, cd, st = state(tmp)
        assert st == "200" and cd == new and all(v == "# new\n" for v in files.values()), (files, cd, st)
        os.remove(os.path.join(tmp, ".config", "dira", "bin", "engines", "source-time"))
        run(tmp, old)  # 기록이 없으면 굽는다
        files, cd, st = state(tmp)
        assert st == "100" and cd == old and all(v == "# old\n" for v in files.values()), (files, cd, st)
        print("OK test_source_time")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
