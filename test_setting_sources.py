#!/usr/bin/env python3
"""P461-1 자체검증: claude 엔진 세션이 사람의 ~/.claude 설정을 안 물려받는가.

임시 큐에서만 판정한다. 엔진을 실제로 부르지 않고 `tick.sh dryrun`이 찍는
"엔진: ..." 줄로 argv 조립 결과를 본다. 실패하면 assert로 죽는다.
"""
import os
import shutil
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/{engine}" "{{prompt}}")
. "{tick}"
"""


def mk(root, name, fm=""):
    d = os.path.join(root, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\ntitle: t\n{}---\n\n## Goal\ntest\n".format(name, fm))
    return p


def mkworker(root, name, engine, tmp):
    d = os.path.join(root, "workers")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".sh")
    with open(p, "w", encoding="utf-8") as f:
        f.write(WORKER.format(name=name, engine=engine, tmp=tmp, tick=TICK))
    os.chmod(p, 0o755)
    return p


def dryrun(worker, local, extra_env=None):
    env = dict(os.environ, TICKET_LOCAL=local)
    if extra_env:
        env.update(extra_env)
    r = subprocess.run([worker, "dryrun"], capture_output=True, text=True,
                       env=env, timeout=60)
    assert r.returncode == 0, "dryrun rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)
    return r.stdout + r.stderr


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    # 엔진 판정은 argv[0]의 basename만 본다. dryrun은 엔진을 실행하지 않으므로 이름만 있으면 된다.
    wcl = mkworker(root, "wcl", "claude", tmp)
    wcx = mkworker(root, "wcx", "codex", tmp)
    mk(root, "5c211001", fm="kind: work\n")

    # 1) claude 엔진 + 기본 환경 -> 두 플래그가 붙는다
    got = dryrun(wcl, local)
    assert "--setting-sources project,local" in got, "--setting-sources가 안 붙었다\n" + got
    assert "--strict-mcp-config" in got, "--strict-mcp-config가 안 붙었다\n" + got

    # 2) DIRA_INHERIT_USER_CONFIG=1 -> claude여도 둘 다 안 붙는다
    inherited = dryrun(wcl, local, {"DIRA_INHERIT_USER_CONFIG": "1"})
    assert "--setting-sources" not in inherited, \
        "DIRA_INHERIT_USER_CONFIG=1인데 --setting-sources가 붙었다\n" + inherited
    assert "--strict-mcp-config" not in inherited, \
        "DIRA_INHERIT_USER_CONFIG=1인데 --strict-mcp-config가 붙었다\n" + inherited

    # 3) 같은 티켓, 엔진만 codex -> 둘 다 안 붙는다(claude 전용)
    other = dryrun(wcx, local)
    assert "--setting-sources" not in other, "codex 엔진에 --setting-sources가 붙었다\n" + other
    assert "--strict-mcp-config" not in other, "codex 엔진에 --strict-mcp-config가 붙었다\n" + other

    print("PASS claude 전용 --setting-sources/--strict-mcp-config 주입, DIRA_INHERIT_USER_CONFIG 탈출구")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
