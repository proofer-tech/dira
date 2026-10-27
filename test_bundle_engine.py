#!/usr/bin/env python3
"""P541-1 자체검증: tick.sh가 $CODE/<이름>으로 부르는 엔진 파일이 전부 extraResources에 있는가.

dist 스크립트가 electron-builder 앞에서 이 파일을 돌린다. 하나라도 빠지면 그 이름을 대며 exit 1.
또 plan_gate.py가 없는 엔진 디렉터리에서는 claude 훅을 안 붙이고 WARN을 남기는지 dryrun으로 확인한다.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

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


if __name__ == "__main__":
    if os.environ.get("P541_PKG"):
        PKG = os.environ["P541_PKG"]
    main()
