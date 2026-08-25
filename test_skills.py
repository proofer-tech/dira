#!/usr/bin/env python3
"""페르소나 스킬 사이드카 자체검증: <personas>/<이름>/skills.md가 프롬프트에 붙는가.

임시 큐에서만 판정한다(도그푸딩 큐에서 엔진을 실험하지 않는다). 엔진을 실제로 부르지 않고
`tick.sh dryrun`이 찍는 프롬프트로 본다 -- 붙는 자리와 조건이 전부 프롬프트 조립에 있다.
실패하면 assert로 죽는다.
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


def write(path, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return path


def dryrun(worker, local):
    r = subprocess.run([worker, "dryrun"], capture_output=True, text=True,
                       env=dict(os.environ, TICKET_LOCAL=local), timeout=60)
    assert r.returncode == 0, "dryrun rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)
    return r.stdout + r.stderr


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    write(os.path.join(root, "personas", "dev", "PROFILE.md"), "# Dev\n데브-프로필-마커\n")
    # 엔진 판정은 argv[0]의 basename만 본다. dryrun은 엔진을 실행하지 않으므로 이름만 있으면 된다.
    wcl = mkworker(root, "wcl", "claude", tmp)
    wcx = mkworker(root, "wcx", "codex", tmp)
    mk(root, "5c111001", fm="kind: work\npersona: dev\n")

    # 1) 사이드카 없음 -> 블록도 없다(그리고 이 출력이 "종전과 같다"의 기준선이다)
    base = dryrun(wcl, local)
    assert "데브-프로필-마커" in base, "PROFILE.md가 안 실렸다\n" + base
    assert "스킬" not in base, "사이드카가 없는데 스킬 블록이 붙었다\n" + base

    # 2) 사이드카 있음 + claude -> PROFILE 블록 바로 뒤에 붙고, 뺀 나머지는 기준선과 한 글자도 다르지 않다
    sk = write(os.path.join(root, "personas", "dev", "skills.md"), "# 스킬\n스킬-마커\n")
    got = dryrun(wcl, local)
    block = "\n===== dev 스킬 ({}) =====\n# 스킬\n스킬-마커\n===== 스킬 끝 =====\n".format(sk)
    assert block in got, "스킬 블록이 프롬프트에 안 붙었다\n" + got
    assert got.index("===== PROFILE 끝 =====") < got.index("===== dev 스킬") \
        < got.index("please pick up 5c111001"), "스킬 블록 자리가 틀렸다\n" + got
    assert got.replace(block, "") == base, \
        "스킬 블록 말고 다른 것도 바뀌었다\n--- 기준선\n{}\n--- 지금\n{}".format(base, got)

    # 3) 같은 파일, 엔진만 codex -> 안 붙는다(codex엔 스킬 개념이 없다)
    other = dryrun(wcx, local)
    assert "스킬-마커" not in other, "codex 엔진에 스킬 블록이 붙었다\n" + other

    # 4) PROFILE.md가 없으면 사이드카가 있어도 안 붙는다(스킬은 페르소나 프롬프트 안에만 있다)
    os.remove(os.path.join(root, "tickets", "5c111001.md"))
    write(os.path.join(root, "personas", "nop", "skills.md"), "# 스킬\n고아-스킬-마커\n")
    mk(root, "5c111002", fm="kind: work\npersona: nop\n")
    orphan = dryrun(wcl, local)
    assert "고아-스킬-마커" not in orphan, "PROFILE 없는 페르소나에 스킬이 붙었다\n" + orphan
    with open(os.path.join(root, "workers", "runner.log"), encoding="utf-8") as f:
        assert "WARN 페르소나 프로필 없음" in f.read(), "프로필 없음 WARN이 사라졌다"

    print("PASS 스킬 사이드카 주입·자리·claude 한정·PROFILE 선행")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
