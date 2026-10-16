#!/usr/bin/env python3
"""P503-1 자체검증: agy는 굽지 않고 agy.src만 적으며, 라우터가 그 경로를 exec한다.

임시 HOME과 임시 PATH에서 tick.sh를 dryrun으로 돌린다. 실패하면 assert로 죽는다.
"""
import os
import shutil
import subprocess
import tempfile

from test_fixed_engine_codex import exe, tick


def run(args, tmp, path):
    env = dict(os.environ, HOME=tmp, PATH=path)
    return subprocess.run(args, env=env, capture_output=True, text=True, timeout=30).stdout.strip()


def main():
    tmp = os.path.realpath(tempfile.mkdtemp())
    try:
        bd = os.path.join(tmp, ".config", "dira", "bin")
        eng = os.path.join(bd, "engines")
        orig = os.path.join(tmp, ".local", "bin", "agy")
        exe(orig, "#!/bin/sh\necho orig $*\n")
        # 갈라진 옛 사본과 stamp가 남아 있다
        exe(os.path.join(eng, "agy"), "#!/bin/sh\necho stale\n")
        open(os.path.join(eng, "agy.stamp"), "w").write("1 2")
        tick_path = os.path.dirname(orig) + ":/usr/bin:/bin"
        tick(tmp)  # 큐 뼈대 생성(PATH에 agy 없음)
        root = os.path.join(tmp, "q")
        w = os.path.join(root, "workers", "w.sh")
        subprocess.run(["bash", w, "dryrun"], env=dict(os.environ, HOME=tmp, PATH=tick_path),
                       cwd=tmp, capture_output=True, timeout=60)
        assert not os.path.lexists(os.path.join(eng, "agy")), "사본이 남았다"
        assert not os.path.exists(os.path.join(eng, "agy.stamp"))
        assert open(os.path.join(eng, "agy.src")).read() == orig
        router = os.path.join(bd, "dira")
        # 갈래 1: agy.src 실행 가능 -> 그 경로
        assert run([router, "agy", "--v"], tmp, "/usr/bin:/bin") == "orig --v"
        # 갈래 2: agy.src가 실행 불가 -> PATH의 agy
        other = os.path.join(tmp, "pathbin", "agy")
        exe(other, "#!/bin/sh\necho path $*\n")
        os.remove(orig)
        assert run([router, "agy", "--v"], tmp, os.path.dirname(other) + ":/usr/bin:/bin") == "path --v"
        print("ok")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
