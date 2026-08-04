#!/usr/bin/env python3
"""온톨로지 목차 블록 자체검증: <루트>/ontology/**/*.md 의 `## ` 목차가 프롬프트에 붙는가.

임시 큐에서만 판정한다(도그푸딩 큐에서 엔진을 실험하지 않는다). 엔진을 실제로 부르지 않고
`tick.sh dryrun`이 찍는 프롬프트로 본다 -- 붙는 자리와 조건이 전부 프롬프트 조립에 있다.
메모리와 갈리는 자리 셋을 못박는다: 본문이 아니라 목차다 / 하위 디렉터리를 읽는다 /
페르소나 밖이라 `persona:` 없는 티켓에도 붙는다. 실패하면 assert로 죽는다.
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

    # 3) 세 장 -> 목차만, 경로 오름차순으로. 메모리와 갈리는 자리 둘을 여기서 본다:
    #    하위 디렉터리를 읽는다(재귀) / 공백 있는 파일명이 한 항목으로 선다.
    #    (생성 순서를 뒤섞어 둬서 fs 순서가 아니라 이름 순인 것을 본다)
    write(os.path.join(ontdir, "프로토콜", "티켓 상태 전이.md"),
          "# 티켓 상태 전이\n온톨로지-본문-마커-C\n\n## 되돌릴 수 없는 전이\n본문 C1\n")
    write(os.path.join(ontdir, "개념 하나.md"),
          "# 개념 하나\n온톨로지-본문-마커-B\n\n## 절 B1\n본문 B1\n\n## 절 B2\n본문 B2\n")
    write(os.path.join(ontdir, "GUI", "보드.md"), "# 보드\n온톨로지-본문-마커-A\n")  # `## ` 0개
    got = dryrun(w, local)
    block = ("아래는 이 큐의 온톨로지 목차입니다(파일 경로와 각 파일의 '## ' 절 제목).\n"
             "본문은 안 실려 있으니 필요한 개념은 {d} 를 grep해서 여세요.\n"
             "\n"
             "===== 온톨로지 목차 ({d}) =====\n"
             "--- GUI/보드.md\n"
             "\n"
             "--- 개념 하나.md\n"
             "## 절 B1\n"
             "## 절 B2\n"
             "--- 프로토콜/티켓 상태 전이.md\n"
             "## 되돌릴 수 없는 전이\n"
             "===== 온톨로지 끝 =====\n"
             "\n").format(d=ontdir)
    assert block in got, "온톨로지 블록이 프롬프트에 안 붙었다\n" + got
    for marker in ("온톨로지-본문-마커-A", "온톨로지-본문-마커-B", "온톨로지-본문-마커-C",
                   "본문 B1", "본문 C1"):
        assert marker not in got, "본문이 실렸다: {}\n{}".format(marker, got)
    assert got.replace(block, "") == base, \
        "온톨로지 블록 말고 다른 것도 바뀌었다\n--- 기준선\n{}\n--- 지금\n{}".format(base, got)
    assert warns(root) == [], "온톨로지 블록에서 WARN이 났다: {}".format(warns(root))

    # 4) `persona:` 없는 티켓에도 붙는다(페르소나 if 밖에 서는 자리다)
    os.remove(os.path.join(root, "tickets", "5c112001.md"))
    mk(root, "5c112002", fm="kind: work\n")
    nop = dryrun(w, local)
    assert "데브-프로필-마커" not in nop, "persona 없는 티켓에 프로필이 붙었다\n" + nop
    assert block in nop, "persona 없는 티켓에 온톨로지가 안 붙었다\n" + nop

    print("PASS 온톨로지 목차 주입·본문 제외·재귀·공백 파일명·페르소나 무관·없으면 WARN 0줄")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
