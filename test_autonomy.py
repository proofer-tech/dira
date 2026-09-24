#!/usr/bin/env python3
"""주도성 주입 자체검증: $LOCAL/autonomy.json의 level이 프롬프트에서 언어 안내 바로 뒤에
닿는가 (docs/DESIGN.md §주도성 결정 1-3, 요구 862c7d6e, 답 e68990f2).

level이 무엇이든 언어 안내 바로 뒤(꼬리, TAIL)에 `주도성 안내: <n>/5` (locale=en이면
`Autonomy note: <n>/5`) 문장이 한 번 실린다. 파일 없음·JSON 깨짐·객체 아님·정수 아님·1~5
밖 다섯 경우 전부 4로 흡수한다(GUI readAutonomy와 같은 판정, 언어의 readLanguage와 같은 틀).

임시 큐에서만 판정한다. 엔진을 실제로 부르지 않고 `tick.sh dryrun`이 찍는 프롬프트로 본다.
실패하면 assert로 죽는다.
"""
import json
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


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    autof = os.path.join(local, "autonomy.json")
    w = mkworker(root, "w", tmp)
    mk(root, "5c112003", fm="kind: work\n")

    # 0) autonomy.json이 없다 -> 기본값 4, `주도성 안내: 4/5`가 한 번 나온다(수용조건 1).
    base = dryrun(w, local)
    assert base.count("주도성 안내: 4/5") == 1, "기본값 4 안내가 한 번 안 나왔다\n" + base
    li = base.index("언어 안내")
    ai = base.index("주도성 안내")
    assert ai > li, "주도성 안내가 언어 안내보다 앞에 있다"

    # 1) level 1~5 각각 그 수준 문장이 실린다(수용조건 2).
    for lvl in (1, 2, 3, 4, 5):
        write(autof, json.dumps({"level": lvl}))
        got = dryrun(w, local)
        assert got.count("주도성 안내: {}/5".format(lvl)) == 1, \
            "level={}인데 그 수치가 안 실렸다\n{}".format(lvl, got)

    # 1b) 그 수준 행 문장이 실제로 갈린다 -- 1과 5는 서로 다른 문장이어야 한다.
    write(autof, json.dumps({"level": 1}))
    got1 = dryrun(w, local)
    write(autof, json.dumps({"level": 5}))
    got5 = dryrun(w, local)
    assert got1 != got5, "level 1과 5의 안내 문장이 같다"
    assert "선택지가 하나뿐인 일만" in got1, "level 1 문장이 결정 2의 1행과 안 맞다\n" + got1
    assert "주도성 5 판단:" in got5, "level 5 문장에 기록 규칙이 없다\n" + got5

    # 2) level 0 / "3"(문자열) / [] / 깨진 JSON 넷 다 4로 읽는다(수용조건 3) -- base와 동일.
    for body in (json.dumps({"level": 0}), json.dumps({"level": "3"}),
                 json.dumps([]), "{ 이건 json이 아니다"):
        write(autof, body)
        assert dryrun(w, local) == base, \
            "흡수 판정이 4가 아니다(body={})".format(body)
    os.remove(autof)
    assert dryrun(w, local) == base, "파일 삭제 후에도 4로 안 돌아왔다"

    # 3) language.json이 en이면 `Autonomy note: <n>/5`만 나오고 한국어 주도성 안내는 0회다
    #    (수용조건 4).
    langfile = os.path.join(local, "language.json")
    write(langfile, json.dumps({"locale": "en"}))
    write(autof, json.dumps({"level": 2}))
    goten = dryrun(w, local)
    assert "Autonomy note: 2/5" in goten, "en 로케일인데 영어 주도성 안내가 안 나왔다\n" + goten
    assert "주도성 안내" not in goten, "en인데 한국어 주도성 안내가 같이 나왔다\n" + goten
    ali = goten.index("Autonomy note")
    lli = goten.index("Language note")
    assert ali > lli, "en에서도 주도성 안내가 언어 안내보다 앞에 있다"

    # 4) 안내가 언어 안내 뒤 · 꼬리(TAIL)에 있고 persona: 없는 티켓(5c112003)에도 붙는다
    #    (수용조건 5) -- 위 케이스가 전부 그 티켓으로 돌았다. 명시적으로 재확인한다.
    assert "persona" not in open(os.path.join(root, "tickets", "5c112003.md"),
                                  encoding="utf-8").read()
    os.remove(langfile)
    write(autof, json.dumps({"level": 3}))
    got3 = dryrun(w, local)
    assert got3.index("주도성 안내") > got3.index("언어 안내")

    # 5) 블록은 상수다 -- 같은 level을 두 번 재도 같은 문자열.
    again = dryrun(w, local)
    assert again == got3, "같은 level=3인데 블록이 매번 달라졌다(상수여야 한다)"

    print("PASS 기본값4 · level 1-5 개별 · 0/문자열/배열/깨진JSON 4종 4로 흡수 · "
          "en에서는 영어 안내만 · 언어 안내 뒤 꼬리 · persona 무관 · 블록 상수")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
