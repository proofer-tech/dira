#!/usr/bin/env python3
"""고정 엔진 계열 자체검증 (P560-5가 네 장을 한 장으로 합쳤다. 단언은 원본 그대로이고 실패하면 assert로 죽는다).

  case_codex       - P463-1: refresh_fixed_engine이 codex 패키지 레이아웃을 보존하는가
  case_agy         - P503-1: agy는 굽지 않고 agy.src만 적으며, 라우터가 그 경로를 exec한다
  case_source_time - P508-1: 더 옛 출처 시각의 코드가 고정 경로 엔진 파일과 code-dir을 덮어쓰지 않는가
  case_bundle      - P541-1: tick.sh가 $CODE/<이름>으로 부르는 엔진 파일이 전부 extraResources에 있는가
                     (dist 스크립트가 `test_fixed_engine.py --bundle`로 이 케이스만 부른다)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import testkit  # noqa: F401 - 워커 세션 환경변수가 새지 않게 지운다

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


def case_codex():
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


def case_agy():
    """P503-1 자체검증: agy는 굽지 않고 agy.src만 적으며, 라우터가 그 경로를 exec한다.

임시 HOME과 임시 PATH에서 tick.sh를 dryrun으로 돌린다. 실패하면 assert로 죽는다.
"""
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


    main()



def case_source_time():
    """P508-1 자체검증: 더 옛 출처 시각의 코드가 고정 경로 엔진 파일과 code-dir을 덮어쓰지 않는가.

코드 디렉터리마다 tick.sh 사본과 source-time 파일을 두고 같은 임시 HOME에서 dryrun으로 돌린다.
"""
    HERE = os.path.dirname(os.path.abspath(__file__))
    FILES = "mcp_server.py mcp_tools.py tickets.py graph.py learn.py remote.py ontology_read.py dispatch.py slim.py".split()


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


    main()



def case_bundle():
    """P541-1 자체검증: tick.sh가 $CODE/<이름>으로 부르는 엔진 파일이 전부 extraResources에 있는가.

dist 스크립트가 electron-builder 앞에서 이 파일을 돌린다. 하나라도 빠지면 그 이름을 대며 exit 1.
또 plan_gate.py가 없는 엔진 디렉터리에서는 claude 훅을 안 붙이고 WARN을 남기는지 dryrun으로 확인한다.
"""
    HERE = os.path.dirname(os.path.abspath(__file__))
    TICK = os.path.join(HERE, "tick.sh")
    PKG = os.path.join(HERE, "apps", "desktop", "package.json")


    def referenced(tick_text):
        # ponytail: 정규식 스캔. 변수로 조립한 이름($CODE/$f)은 못 잡으니 그런 파일은 명시 목록으로 옮긴다
        return sorted(set(re.findall(r'\$CODE/([A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:py|sh|example))', tick_text)))


    def bundled(pkg):
        return {os.path.basename(r["from"]) for r in json.load(open(pkg, encoding="utf-8"))["build"]["extraResources"]
                if r["to"].startswith("engine/")}


    def missing(tick_text, pkg):
        have = bundled(pkg)
        return [n for n in referenced(tick_text) if n not in have]


    def main():
        tick_text = open(TICK, encoding="utf-8").read()
        miss = missing(tick_text, PKG)
        if miss:
            print("FAIL extraResources에 없는 엔진 파일: " + ", ".join(miss), file=sys.stderr)
            sys.exit(1)
        print("PASS tick.sh 참조 %d개가 모두 extraResources에 있다" % len(referenced(tick_text)))
        if "--check-only" in sys.argv:
            return

        tmp = os.path.realpath(tempfile.mkdtemp())
        try:
            # 참조 하나를 지운 사본은 그 이름을 대며 실패한다
            cut = json.load(open(PKG, encoding="utf-8"))
            cut["build"]["extraResources"] = [r for r in cut["build"]["extraResources"] if os.path.basename(r["from"]) != "plan_gate.py"]
            cp = os.path.join(tmp, "package.json")
            json.dump(cut, open(cp, "w"))
            r = subprocess.run([sys.executable, __file__, "--check-only"], capture_output=True, text=True,
                               env=dict(os.environ, P541_PKG=cp))
            assert r.returncode == 1 and "plan_gate.py" in r.stderr, (r.returncode, r.stderr)
            print("PASS plan_gate.py를 뺀 사본은 이름을 대며 실패")

            # dryrun: 엔진 디렉터리에 plan_gate.py가 있을 때와 없을 때
            def dry(with_gate):
                code = os.path.join(tmp, "code-%d" % with_gate); os.makedirs(code)
                shutil.copy(TICK, code)
                if with_gate:
                    shutil.copy(os.path.join(HERE, "plan_gate.py"), code)
                for f in ("tickets.py",):
                    shutil.copy(os.path.join(HERE, f), code)
                root = os.path.join(tmp, "q%d" % with_gate); local = os.path.join(tmp, "l%d" % with_gate)
                os.makedirs(os.path.join(root, "tickets")); os.makedirs(os.path.join(root, "workers")); os.makedirs(local)
                with open(os.path.join(root, "tickets", "5c211001.md"), "w", encoding="utf-8") as f:
                    f.write("---\nticket: 5c211001\ntitle: t\nkind: work\n---\n\n## Goal\ng\n")
                w = os.path.join(root, "workers", "w.sh")
                with open(w, "w", encoding="utf-8") as f:
                    f.write('#!/bin/bash\nTICKET_NAME="w"\nTICKET_CWD="%s"\nTICKET_PROMPT_FMT="pick %%s"\n'
                            'TICKET_ENGINE=("%s/claude" "{prompt}")\n. "%s/tick.sh"\n' % (tmp, tmp, code))
                os.chmod(w, 0o755)
                r = subprocess.run([w, "dryrun"], capture_output=True, text=True, timeout=60,
                                   env=dict(os.environ, TICKET_LOCAL=local))
                assert r.returncode == 0, r.stdout + r.stderr
                rl = os.path.join(root, "workers", "runner.log")
                return r.stdout, open(rl, encoding="utf-8").read() if os.path.exists(rl) else ""

            out, log = dry(True)
            assert "--settings" in out and "plan_gate.py 없음" not in log, (out, log)
            out, log = dry(False)
            assert "--settings" not in out and "WARN plan_gate.py 없음 - 계획 훅 생략" in log, (out, log)
            print("PASS plan_gate.py 있으면 --settings 훅, 없으면 생략하고 WARN")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


    if os.environ.get("P541_PKG"):
        PKG = os.environ["P541_PKG"]
    main()



if __name__ == "__main__":
    if "--check-only" in sys.argv or "--bundle" in sys.argv:  # dist 스크립트가 --bundle로 case_bundle만 돌린다
        case_bundle()
        sys.exit(0)
    for case in (case_codex, case_agy, case_source_time, case_bundle):
        case()
