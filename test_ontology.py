#!/usr/bin/env python3
"""온톨로지 블록 자체검증: <루트>/ontology/**/*.md가 있으면 위치+검색 방법 블록이 붙는가.

9d7ba932 이후 블록은 나열(파일 경로+`## ` 절)이 아니라 **위치 + 검색 방법 상수**다 -- 그래서
여기서 재는 것은 "목차가 실리는가"가 아니라 "블록이 붙는가 · 절대경로가 실리는가 · SCHEMA.md가
지도라는 안내가 실리는가 · 검색 안내가 실리는가 · 파일을 늘려도 블록이 안 자라는가".
메모리와 갈리는 자리 둘은 그대로 못박는다: 하위 디렉터리도 존재 판정에 들어간다(재귀) /
페르소나 밖이라 `persona:` 없는 티켓에도 붙는다.

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
TICKET_ENGINE=("{tmp}/claude" "{{prompt}}")
. "{tick}"
"""


def mk(root, name, fm=""):
    d = os.path.join(root, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\ntitle: t\n{}---\n\n## Goal\ntest\n".format(name, fm))
    return p


def mkworker(root, name, tmp):
    d = os.path.join(root, "workers")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".sh")
    with open(p, "w", encoding="utf-8") as f:
        f.write(WORKER.format(name=name, tmp=tmp, tick=TICK))
    os.chmod(p, 0o755)
    return p


def write(path, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return path


def dryrun(worker, local, ontology=None):
    env = dict(os.environ, TICKET_LOCAL=local)
    if ontology is not None:
        env["TICKET_ONTOLOGY"] = ontology
    r = subprocess.run([worker, "dryrun"], capture_output=True, text=True, env=env, timeout=60)
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
    ontdir = os.path.join(root, "ontology")
    write(os.path.join(root, "personas", "dev", "PROFILE.md"), "# Dev\n데브-프로필-마커\n")
    w = mkworker(root, "w", tmp)
    mk(root, "5c112001", fm="kind: work\npersona: dev\n")

    # 1) ontology/ 없음 -> 블록도 없다(이 출력이 "종전과 같다"의 기준선이다)
    base = dryrun(w, local)
    assert "데브-프로필-마커" in base, "PROFILE.md가 안 실렸다\n" + base
    assert "온톨로지" not in base, "ontology/가 없는데 블록이 붙었다\n" + base
    assert warns(root) == [], "ontology/가 없는데 WARN이 났다: {}".format(warns(root))

    # 2) 빈 ontology/ -> 여전히 안 붙고 WARN도 0줄이다(없는 것이 정상 상태다)
    os.makedirs(ontdir)
    assert dryrun(w, local) == base, "빈 ontology/가 프롬프트를 바꿨다"
    assert warns(root) == [], "ontology/가 비었는데 WARN이 났다: {}".format(warns(root))

    # 3) 세 장(하위 디렉터리·공백 파일명 포함) -> 블록은 위치+검색 방법 상수다. 목차·본문은 안 실린다.
    #    하위 디렉터리에 있어도 존재 판정에 들어간다(메모리와 갈리는 자리 -- 온톨로지는 재귀).
    write(os.path.join(ontdir, "프로토콜", "티켓 상태 전이.md"),
          "# 티켓 상태 전이\n온톨로지-본문-마커-C\n\n## 되돌릴 수 없는 전이\n본문 C1\n")
    write(os.path.join(ontdir, "개념 하나.md"),
          "# 개념 하나\n온톨로지-본문-마커-B\n\n## 절 B1\n본문 B1\n\n## 절 B2\n본문 B2\n")
    write(os.path.join(ontdir, "GUI", "보드.md"), "# 보드\n온톨로지-본문-마커-A\n")  # `## ` 0개
    got = dryrun(w, local)
    block_start = "아래는 이 큐의 온톨로지가 있는 곳입니다.\n\n===== 온톨로지 (" + ontdir + ") =====\n"
    block_end = "\n===== 온톨로지 끝 =====\n\n"
    assert block_start in got, "온톨로지 블록이 프롬프트에 안 붙었다\n" + got
    assert block_end in got, "온톨로지 블록이 안 닫혔다\n" + got
    block = got[got.index(block_start):got.index(block_end) + len(block_end)]
    assert ontdir in block, "온톨로지 디렉터리 절대경로가 블록 안에 안 실렸다(grep할 자리다)\n" + got
    assert "_ontology/SCHEMA.md" in block, "SCHEMA.md가 지도라는 안내가 안 실렸다\n" + got
    assert "grep" in block, "검색 방법(grep) 안내가 안 실렸다\n" + got
    for marker in ("온톨로지-본문-마커-A", "온톨로지-본문-마커-B", "온톨로지-본문-마커-C",
                   "본문 B1", "본문 C1", "GUI/보드.md", "개념 하나.md", "티켓 상태 전이.md",
                   "## 절 B1", "## 절 B2", "## 되돌릴 수 없는 전이"):
        assert marker not in block, "목차/본문이 블록 안에 실렸다: {}\n{}".format(marker, got)
    assert got.replace(block, "") == base, \
        "온톨로지 블록 말고 다른 것도 바뀌었다\n--- 기준선\n{}\n--- 지금\n{}".format(base, got)
    assert warns(root) == [], "온톨로지 블록에서 WARN이 났다: {}".format(warns(root))

    # 3b) 파일을 더 늘려도 블록은 안 자란다(상수라 파일 수·절 수와 무관하다)
    write(os.path.join(ontdir, "넷째.md"), "# 넷째\n## E절1\n## E절2\n## E절3\n")
    grown = dryrun(w, local)
    grown_block = grown[grown.index(block_start):grown.index(block_end) + len(block_end)]
    assert grown_block == block, \
        "파일을 늘렸는데 온톨로지 블록이 자랐다\n--- 전\n{}\n--- 후\n{}".format(block, grown_block)
    os.remove(os.path.join(ontdir, "넷째.md"))

    # 4) `persona:` 없는 티켓에도 붙는다(페르소나 if 밖에 서는 자리다)
    os.remove(os.path.join(root, "tickets", "5c112001.md"))
    mk(root, "5c112002", fm="kind: work\n")
    nop = dryrun(w, local)
    assert "데브-프로필-마커" not in nop, "persona 없는 티켓에 프로필이 붙었다\n" + nop
    assert block in nop, "persona 없는 티켓에 온톨로지가 안 붙었다\n" + nop

    # 5) TICKET_ONTOLOGY 재정의 - 큐 밖 임시 디렉터리를 가리키면 그 자리가 블록에 선다.
    #    기본값 케이스(위 1~4)는 이 변수를 안 건드려 무수정으로 통과했다(85114387).
    extdir = os.path.join(tmp, "밖온톨로지")
    write(os.path.join(extdir, "외부개념.md"), "# 외부개념\n외부-온톨로지-마커\n")
    ext = dryrun(w, local, ontology=extdir)
    ext_start = "===== 온톨로지 (" + extdir + ") =====\n"
    assert ext_start in ext, "TICKET_ONTOLOGY 자리가 블록에 안 섰다\n" + ext
    assert "===== 온톨로지 (" + ontdir + ") =====" not in ext, \
        "재정의했는데 기본 자리(<큐>/ontology)가 블록에 남았다\n" + ext

    print("PASS 위치+검색 방법 상수 블록·본문/목차 미주입·재귀·공백 파일명·"
          "파일 늘어도 불변·페르소나 무관·없으면 WARN 0줄·TICKET_ONTOLOGY 재정의")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
