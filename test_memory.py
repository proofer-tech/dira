#!/usr/bin/env python3
"""페르소나 메모리 사이드카 자체검증: <personas>/<이름>/memory/*.md가 프롬프트에 붙는가.

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

    # 3) 세 장 -> 스킬 블록 뒤에, 파일명 오름차순으로, 파일마다 `--- <파일명>` + 그 파일의 `## ` 목차만.
    #    본문은 한 줄도 안 실린다. 절이 없는 파일도 `--- <파일명>` 줄은 남는다(목차가 전량 실려야
    #    "있는 줄 몰라서 못 여는" 상태가 없다). 생성 순서를 역순으로 둬서 fs 순서가 아니라 이름 순인 것을 본다.
    write(os.path.join(memdir, "c절없음.md"), "# 절이 없다\n본문-C-마커\n")
    write(os.path.join(memdir, "b개념.md"), "# 나중\n본문-B-마커\n## B절\n본문-B2-마커\n")
    write(os.path.join(memdir, "a개념.md"), "# 먼저\n본문-A-마커\n## A절1\n본문\n## A절2\n### A소절\n")
    got = dryrun(wcl, local)
    guide = ("본문은 안 실렸다 - 아래는 파일별 '## ' 목차다. "
             "필요한 개념은 위 경로를 grep해서 그 파일을 읽는다.")
    block = ("\n===== dev 메모리 ({}) =====\n{}\n"
             "--- a개념.md\n## A절1\n## A절2\n"
             "--- b개념.md\n## B절\n"
             "--- c절없음.md\n"
             "===== 메모리 끝 =====\n").format(memdir, guide)
    assert block in got, "메모리 목차 블록이 프롬프트에 안 붙었다\n" + got
    # 본문은 안 붙는다 -- `## `이 아닌 줄은 제목(`# `)도 소절(`### `)도 문단도 전부 빠진다
    for marker in ("본문-A-마커", "본문-B-마커", "본문-B2-마커", "본문-C-마커",
                   "# 먼저", "# 나중", "### A소절"):
        assert marker not in got, "본문이 실렸다: {}\n{}".format(marker, got)
    assert memdir in got, "메모리 디렉터리 절대경로가 안 실렸다(grep할 자리다)\n" + got
    assert got.index("===== 스킬 끝 =====") < got.index("===== dev 메모리") \
        < got.index("please pick up 5c111001"), "메모리 블록 자리가 틀렸다\n" + got
    assert got.replace(block, "") == base, \
        "메모리 블록 말고 다른 것도 바뀌었다\n--- 기준선\n{}\n--- 지금\n{}".format(base, got)

    # 4) 같은 파일, 엔진만 codex -> 그래도 붙는다(스킬과 갈리는 자리다)
    other = dryrun(wcx, local)
    assert block in other, "codex 엔진에 메모리 블록이 안 붙었다\n" + other
    assert "스킬-마커" not in other, "codex 엔진에 스킬 블록이 붙었다(기존 계약)\n" + other

    # 5) 하위 디렉터리는 안 읽는다(글롭 한 단계). 목차만 실리므로 마커도 `## ` 줄로 둔다 --
    #    본문 마커면 본문이 안 실리는 것만으로 통과해서 글롭 한 단계를 안 재게 된다.
    write(os.path.join(memdir, "하위", "x.md"), "# 하위\n## 하위-절-마커\n")
    deep = dryrun(wcl, local)
    assert "하위-절-마커" not in deep, "memory/<하위>/x.md를 읽었다\n" + deep
    assert "--- x.md" not in deep, "memory/<하위>/x.md가 목차에 실렸다\n" + deep

    # 6) PROFILE.md가 없으면 메모리도 안 붙는다(메모리는 페르소나 프롬프트 안에서만 산다)
    os.remove(os.path.join(root, "tickets", "5c111001.md"))
    write(os.path.join(root, "personas", "nop", "memory", "m.md"), "# 고아\n## 고아-절-마커\n")
    mk(root, "5c111002", fm="kind: work\npersona: nop\n")
    orphan = dryrun(wcl, local)
    assert "고아-절-마커" not in orphan, "PROFILE 없는 페르소나에 메모리가 붙었다\n" + orphan
    assert "--- m.md" not in orphan, "PROFILE 없는 페르소나에 메모리 목차가 붙었다\n" + orphan

    print("PASS 목차 주입·본문 미주입·절대경로·자리·오름차순·절 없는 파일·"
          "엔진 무관·글롭 한 단계·PROFILE 선행·WARN 0줄")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
