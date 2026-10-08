#!/usr/bin/env python3
"""P463-1 자체검증: refresh_fixed_engine이 codex 패키지 레이아웃을 보존하는가.

임시 HOME과 임시 PATH에서 tick.sh를 dryrun으로 돌린다. 실패하면 assert로 죽는다.
"""
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")


def exe(path, body="#!/bin/sh\necho hi\n"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(body)
    os.chmod(path, 0o755)


def mkpkg(tmp, ver):
    root = os.path.join(tmp, "rel", ver)
    exe(os.path.join(root, "bin", "codex"), "#!/bin/sh\necho " + ver + "\n")
    exe(os.path.join(root, "bin", "codex-code-mode-host"))
    for d in ("codex-resources", "codex-path"):
        os.makedirs(os.path.join(root, d))
    open(os.path.join(root, "codex-package.json"), "w").write("{}")
    return root


def tick(tmp):
    root = os.path.join(tmp, "q")
    os.makedirs(os.path.join(root, "tickets"), exist_ok=True)
    os.makedirs(os.path.join(root, "workers"), exist_ok=True)
    w = os.path.join(root, "workers", "w.sh")
    open(w, "w").write('#!/bin/bash\nTICKET_NAME="w"\nTICKET_CWD="%s"\n. "%s"\n' % (tmp, TICK))
    os.chmod(w, 0o755)
    env = dict(os.environ, HOME=tmp, PATH="/usr/bin:/bin")
    subprocess.run(["bash", w, "dryrun"], env=env, cwd=tmp, capture_output=True, timeout=60)


def link(tmp, root):
    p = os.path.join(tmp, ".local", "bin", "codex")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if os.path.lexists(p):
        os.remove(p)
    os.symlink(os.path.join(root, "bin", "codex"), p)


def main():
    tmp = os.path.realpath(tempfile.mkdtemp())
    try:
        bd = os.path.join(tmp, ".config", "dira", "bin")
        fixed = os.path.join(bd, "engines", "codex")
        # 1) 패키지: 실경로 옆에 host, 부모에 표식 셋
        r1 = mkpkg(tmp, "1.0")
        link(tmp, r1)
        tick(tmp)
        real = os.path.realpath(fixed)
        assert real.startswith(bd + os.sep), real
        assert os.path.exists(os.path.join(os.path.dirname(real), "codex-code-mode-host"))
        par = os.path.dirname(os.path.dirname(real))
        for n in ("codex-package.json", "codex-resources", "codex-path"):
            assert os.path.exists(os.path.join(par, n)), n
        # 2) 같은 버전은 다시 안 굽는다
        tick(tmp)
        assert os.path.realpath(fixed) == real
        # 2b) 옛 굽기(단일 파일 복사본, .src/.stamp는 신선)가 남아 있어도 패키지로 다시 굽는다
        os.remove(fixed)
        shutil.copy(real, fixed)
        tick(tmp)
        assert os.path.islink(fixed)
        real = os.path.realpath(fixed)
        # 3) 버전이 바뀌면 다시 굽고 옛 복제본이 안 남는다
        r2 = mkpkg(tmp, "2.0")
        link(tmp, r2)
        tick(tmp)
        real2 = os.path.realpath(fixed)
        assert real2 != real and real2.startswith(bd + os.sep)
        assert not os.path.exists(real) and not os.path.exists(par)
        ed = os.path.join(bd, "engines")
        pk = [n for n in os.listdir(ed) if ".pkg." in n]
        assert len(pk) == 1, pk
        assert subprocess.run([fixed], capture_output=True, text=True).stdout.strip() == "2.0"
        # 4) 단일 파일 codex는 종전처럼 일반 파일, 패키지 복제본은 사라진다
        single = os.path.join(tmp, "single", "x", "bin", "codex")
        exe(single)
        p = os.path.join(tmp, ".local", "bin", "codex")
        os.remove(p)
        os.symlink(single, p)
        tick(tmp)
        assert os.path.isfile(fixed) and not os.path.islink(fixed)
        assert not [n for n in os.listdir(ed) if ".pkg." in n], os.listdir(ed)
        # 5) P468-1 라우터: bin에는 dira와 engines만, 옛 dira-*와 부속은 지워진다
        for n in ("dira-codex", "dira-agy.1.old", "dira-codex.pkg.9", "dira.src", "dira.stamp"):
            exe(os.path.join(bd, n))
        # 옛 굽기가 남긴 claude 복사본 dira도 라우터로 바뀌어야 한다
        exe(os.path.join(tmp, ".local", "bin", "claude"), "#!/bin/sh\necho claude-$*\n")
        tick(tmp)
        assert sorted(os.listdir(bd)) == ["dira", "engines"], os.listdir(bd)
        router = os.path.join(bd, "dira")
        env = dict(os.environ, PATH="/usr/bin:/bin")
        def run(*a):
            return subprocess.run([router, *a], capture_output=True, text=True, env=env).stdout.strip()
        assert run("--version") == "claude---version", run("--version")
        assert run("codex") == "hi", run("codex")  # 단일 파일 codex 사본, 인자 codex는 빠진다
        # 사본이 없으면 PATH의 같은 이름으로 간다
        os.remove(os.path.join(bd, "engines", "claude"))
        env["PATH"] = os.path.join(tmp, ".local", "bin") + ":/usr/bin:/bin"
        assert run("-p", "x") == "claude--p x", run("-p", "x")
        # 6) 워커 첫 칸 bin/dira + codex, 옛 bin/dira-codex 모두 쿨다운 이름이 codex다
        for eng in ('"%s/dira" codex' % bd, '"%s/dira-codex"' % bd):
            root = os.path.join(tmp, "q")
            shutil.rmtree(os.path.join(tmp, "q"), ignore_errors=True)
            os.makedirs(os.path.join(root, "tickets"))
            os.makedirs(os.path.join(root, "workers"))
            open(os.path.join(root, "tickets", "cafe0002.md"), "w").write(
                "---\nticket: cafe0002\ntitle: t\nkind: work\n---\n\n## Goal\nx\n")
            w = os.path.join(root, "workers", "w.sh")
            open(w, "w").write('#!/bin/bash\nTICKET_NAME="w"\nTICKET_CWD="%s"\n'
                               'TICKET_ENGINE=(%s "{sid}")\n. "%s"\n' % (tmp, eng, TICK))
            os.chmod(w, 0o755)
            e2 = dict(os.environ, HOME=tmp, PATH="/usr/bin:/bin", TICKET_LOCAL=os.path.join(tmp, "loc"))
            r = subprocess.run(["bash", w, "dryrun"], env=e2, cwd=tmp, capture_output=True, text=True, timeout=60)
            log = open(os.path.join(root, "workers", "runner.log"), encoding="utf-8").read()
            assert "엔진: %s/dira codex" % bd in log, (eng, log, r.stderr)
        print("ok")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()


def test_fixed_engine_codex():
    main()
