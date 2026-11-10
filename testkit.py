#!/usr/bin/env python3
"""엔진 테스트 공용 하네스와 러너 (P560-1). 표준 라이브러리만 쓴다.

import하면 워커 세션의 환경변수가 테스트로 새지 않도록 지운다. 실행하면 러너다:
    python3 testkit.py [-j N] [--timeout 초] [파일...]   (인자가 없으면 test_*.py 전량)
"""
import concurrent.futures
import glob
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
LEAK = ("TICKET_ONTOLOGY", "TICKET_DONE", "TICKET_INPROGRESS", "DIRA_ENGINE")


# CI(CI=true)에서만 건너뛰는 파일: {파일 이름: 사유 한 줄}. 조용히 빠지는 파일이 없도록 끝 표에 이름과 사유가 찍힌다.
# 지금은 비어 있다: CI가 macOS 러너(ci.yml)이고 launchctl - crontab - pty 의존 테스트가 가짜 스텁이나 macOS 도구로 돈다.
# ponytail: 러너가 ubuntu로 바뀌거나 CI에서만 깨지는 파일이 나오면 여기에 이름과 사유를 적는다.
CI_SKIP = {}


def clean_env(env=None):
    e = dict(os.environ if env is None else env)
    for k in LEAK:
        e.pop(k, None)
    return e


for _k in LEAK:
    os.environ.pop(_k, None)

WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/{engine}" "{{prompt}}")
. "{tick}"
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


def mk(root, name, fm=""):
    d = os.path.join(root, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\ntitle: t\n{}---\n\n## Goal\ntest\n".format(name, fm))
    return p


def mkworker(root, name, tmp, engine="claude", tick=TICK):
    return mkfile(os.path.join(root, "workers", name + ".sh"),
                  WORKER.format(name=name, engine=engine, tmp=tmp, tick=tick), 0o755)


def dryrun(worker, local, home=None, ontology=None, stderr=True):
    """`w.sh dryrun` 출력. gate-<UUID>는 회차마다 달라 고정 문자열로 바꾼다."""
    env = clean_env(dict(os.environ, TICKET_LOCAL=local))
    if home is not None:
        env["HOME"] = home  # 엔진 사본 동기화가 진짜 ~/.config 를 두고 다른 tick 과 경합한다
    if ontology is not None:
        env["TICKET_ONTOLOGY"] = ontology
    r = subprocess.run([worker, "dryrun"], capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0, "dryrun rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)
    out = r.stdout + (r.stderr if stderr else "")  # stderr를 빼면 동시 tick의 *.tmp.<pid> 청소 경합 traceback이 안 낀다
    return re.sub(r"gate-[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}", "gate-UUID", out)


def wait_for(pred, timeout, interval=0.2):
    end = time.time() + timeout
    while time.time() < end:
        v = pred()
        if v:
            return v
        time.sleep(interval)
    return pred()


def _run(path, timeout):
    t = time.time()
    try:
        r = subprocess.run([sys.executable, path], cwd=HERE, env=clean_env(),
                           capture_output=True, text=True, timeout=timeout)
        rc, out = r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired as e:
        rc, out = 124, "timeout {}s\n{}".format(timeout, (e.stdout or b"") if isinstance(e.stdout, str) else "")
    return path, rc, time.time() - t, out


def main(argv):
    jobs, timeout, files = 4, 600, []
    it = iter(argv)
    for a in it:
        if a == "-j":
            jobs = int(next(it))
        elif a == "--timeout":
            timeout = float(next(it))
        else:
            files.append(a)
    if not files:
        files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(HERE, "test_*.py")))
    skipped = {}
    if os.environ.get("CI") == "true":
        skipped = {f: why for f, why in CI_SKIP.items() if f in {os.path.basename(x) for x in files}}
        files = [f for f in files if os.path.basename(f) not in skipped]
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, jobs)) as ex:
        res = list(ex.map(lambda f: _run(f if os.path.isabs(f) else os.path.join(HERE, f), timeout), files))
    bad = 0
    for path, rc, sec, out in res:
        if rc != 0:
            bad += 1
            print("--- {} rc={} ---\n{}".format(os.path.basename(path), rc, out[-3000:]))
    print("{:>4} {:>7}  {}".format("rc", "초", "파일"))
    for path, rc, sec, _ in res:
        print("{:>4} {:>7.1f}  {}".format(rc, sec, os.path.basename(path)))
    for f, why in sorted(skipped.items()):
        print("건너뜀(CI) {}: {}".format(f, why))
    print("실패 {} / {}".format(bad, len(res)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
