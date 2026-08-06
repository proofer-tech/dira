#!/usr/bin/env python3
"""페르소나 메모리 사이드카 자체검증: <personas>/<이름>/memory/*.md가 프롬프트에 붙는가.

9d7ba932 이후 블록은 나열(파일명+`## ` 절)이 아니라 **위치 + 검색 방법 상수**다 -- 그래서
여기서 재는 것은 "목차가 실리는가"가 아니라 "블록이 붙는가 · 절대경로가 실리는가 · 검색 안내가
실리는가 · `## ` 절 제목과 본문이 안 실리는가 · 파일을 늘려도 블록이 안 자라는가"다.

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


def warns(root):
    p = os.path.join(root, "workers", "runner.log")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        return [ln for ln in f if "WARN" in ln]


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    memdir = os.path.join(root, "personas", "dev", "memory")
    write(os.path.join(root, "personas", "dev", "PROFILE.md"), "# Dev\n데브-프로필-마커\n")
    write(os.path.join(root, "personas", "dev", "skills.md"), "# 스킬\n스킬-마커\n")
    # 엔진 판정은 argv[0]의 basename만 본다. dryrun은 엔진을 실행하지 않으므로 이름만 있으면 된다.
    wcl = mkworker(root, "wcl", "claude", tmp)
    wcx = mkworker(root, "wcx", "codex", tmp)
    mk(root, "5c111001", fm="kind: work\npersona: dev\n")

    # 1) memory/ 없음 -> 블록도 없다(그리고 이 출력이 "종전과 같다"의 기준선이다)
    base = dryrun(wcl, local)
    assert "데브-프로필-마커" in base, "PROFILE.md가 안 실렸다\n" + base
    assert "메모리" not in base, "memory/가 없는데 메모리 블록이 붙었다\n" + base

    # 2) 빈 memory/ -> 여전히 안 붙고 WARN도 0줄이다(없는 것이 정상 상태다)
    os.makedirs(memdir)
    assert dryrun(wcl, local) == base, "빈 memory/가 프롬프트를 바꿨다"
    assert warns(root) == [], "memory/가 비었는데 WARN이 났다: {}".format(warns(root))

    # 3) 세 장 -> 블록은 상수다(위치 + 검색 방법). 목차·본문은 한 줄도 안 실린다.
    write(os.path.join(memdir, "c절없음.md"), "# 절이 없다\n본문-C-마커\n")
    write(os.path.join(memdir, "b개념.md"), "# 나중\n본문-B-마커\n## B절\n본문-B2-마커\n")
    write(os.path.join(memdir, "a개념.md"), "# 먼저\n본문-A-마커\n## A절1\n본문\n## A절2\n### A소절\n")
    got = dryrun(wcl, local)
    block_start = "\n===== dev 메모리 ({}) =====\n".format(memdir)
    block_end = "\n===== 메모리 끝 =====\n"
    assert block_start in got, "메모리 블록이 프롬프트에 안 붙었다\n" + got
    assert block_end in got, "메모리 블록이 안 닫혔다\n" + got
    block = got[got.index(block_start):got.index(block_end) + len(block_end)]
    assert memdir in block, "메모리 디렉터리 절대경로가 블록 안에 안 실렸다(grep할 자리다)\n" + got
    assert "grep" in block, "검색 방법(grep) 안내가 안 실렸다\n" + got
    # 목차(`## ` 절 제목)·파일명·본문 전부 안 붙는다 -- 나열이 아니라 위치+검색 방법 상수다
    for marker in ("--- a개념.md", "--- b개념.md", "--- c절없음.md", "## A절1", "## A절2", "## B절",
                   "본문-A-마커", "본문-B-마커", "본문-B2-마커", "본문-C-마커",
                   "# 먼저", "# 나중", "### A소절"):
        assert marker not in got, "나열/본문이 실렸다: {}\n{}".format(marker, got)
    assert got.index("===== 스킬 끝 =====") < got.index(block_start) \
        < got.index("please pick up 5c111001"), "메모리 블록 자리가 틀렸다\n" + got
    assert got.replace(block, "") == base, \
        "메모리 블록 말고 다른 것도 바뀌었다\n--- 기준선\n{}\n--- 지금\n{}".format(base, got)

    # 3b) 파일을 더 늘려도 블록은 안 자란다(상수라 파일 수와 무관하다)
    write(os.path.join(memdir, "d개념.md"), "# 넷째\n## D절1\n## D절2\n## D절3\n")
    grown = dryrun(wcl, local)
    grown_block = grown[grown.index(block_start):grown.index(block_end) + len(block_end)]
    assert grown_block == block, \
        "파일을 늘렸는데 메모리 블록이 자랐다\n--- 전\n{}\n--- 후\n{}".format(block, grown_block)
    os.remove(os.path.join(memdir, "d개념.md"))

    # 4) 같은 파일, 엔진만 codex -> 그래도 붙는다(스킬과 갈리는 자리다)
    other = dryrun(wcx, local)
    assert block in other, "codex 엔진에 메모리 블록이 안 붙었다\n" + other
    assert "스킬-마커" not in other, "codex 엔진에 스킬 블록이 붙었다(기존 계약)\n" + other

    # 5) 하위 디렉터리는 안 읽는다(글롭 한 단계) -- 블록은 상수라 내용도 안 바뀐다.
    write(os.path.join(memdir, "하위", "x.md"), "# 하위\n## 하위-절-마커\n")
    deep = dryrun(wcl, local)
    assert "하위-절-마커" not in deep, "memory/<하위>/x.md를 읽었다\n" + deep
    deep_block = deep[deep.index(block_start):deep.index(block_end) + len(block_end)]
    assert deep_block == block, "memory/<하위>/x.md가 블록을 바꿨다\n" + deep

    # 6) PROFILE.md가 없으면 메모리도 안 붙는다(메모리는 페르소나 프롬프트 안에서만 산다)
    os.remove(os.path.join(root, "tickets", "5c111001.md"))
    write(os.path.join(root, "personas", "nop", "memory", "m.md"), "# 고아\n## 고아-절-마커\n")
    mk(root, "5c111002", fm="kind: work\npersona: nop\n")
    orphan = dryrun(wcl, local)
    assert "고아-절-마커" not in orphan, "PROFILE 없는 페르소나에 메모리가 붙었다\n" + orphan
    assert "메모리" not in orphan, "PROFILE 없는 페르소나에 메모리 블록이 붙었다\n" + orphan

    print("PASS 위치+검색 방법 상수 블록·본문/목차 미주입·절대경로·자리·파일 늘어도 불변·"
          "엔진 무관·글롭 한 단계·PROFILE 선행·WARN 0줄")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
