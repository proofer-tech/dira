#!/usr/bin/env python3
"""언어 주입 자체검증: $LOCAL/language.json의 locale이 프롬프트 맨 꼬리에 닿는가
(§0-16 §주입 §개정, §개정 5).

로케일이 무엇이든 프롬프트 맨 꼬리에 문장 두 짝이 실린다 -- ko면 한국어 문장, en이면
영어 문장. 파일 없음·JSON 깨짐·객체 아님·모르는 값 넷 다 ko로 흡수한다(GUI의 readLanguage와
같은 판정) -- 즉 이 넷의 출력이 명시적 ko와 바이트 단위로 같다.

§개정 5(요구 d8407b1a)로 문장 ②(산출물 언어)도 로케일을 따른다 -- en이면 산출물이 영어다.
절 이름(`## Goal` 등)은 로케일과 무관한 리터럴로 남고, 한국어 문장 지침 히어독(FLUENTKO)은
`ko`일 때만 실린다(en에서는 적용 대상이 없다).

임시 큐에서만 판정한다(도그푸딩 큐에서 엔진을 실험하지 않는다). 엔진을 실제로 부르지 않고
`tick.sh dryrun`이 찍는 프롬프트로 본다. 실패하면 assert로 죽는다.
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
    langfile = os.path.join(local, "language.json")
    w = mkworker(root, "w", tmp)
    mk(root, "5c112003", fm="kind: work\n")

    # 0) language.json 자체가 없다 -> ko로 흡수, 꼬리에 한국어 문장 두 짝. 이 출력이 기준선이다.
    base = dryrun(w, local)
    assert "언어 안내" in base, "language.json이 없는데 ko 주입이 안 됐다\n" + base
    assert "## 결과" in base and "docs/" in base, "산출물 한국어 고정 짝이 안 실렸다\n" + base
    assert warns(root) == [], "language.json이 없는데 WARN이 났다: {}".format(warns(root))
    assert "===== 한국어 문장 지침" in base and "엠대시" in base, \
        "한국어 문장 지침 블록이 안 실렸다\n" + base

    # 1) 명시적으로 ko -> 기준선과 바이트 단위로 같다
    write(langfile, json.dumps({"locale": "ko"}))
    assert dryrun(w, local) == base, "locale=ko인데 프롬프트가 기준선과 달라졌다"

    # 2) JSON 깨짐 -> ko로 흡수, 기준선과 같다
    write(langfile, "{ 이건 json이 아니다")
    assert dryrun(w, local) == base, "JSON이 깨졌는데 프롬프트가 기준선과 달라졌다"

    # 3) 객체가 아니다(배열) -> ko로 흡수
    write(langfile, json.dumps(["en"]))
    assert dryrun(w, local) == base, "객체가 아닌데 프롬프트가 기준선과 달라졌다"

    # 4) 모르는 값 -> ko로 흡수
    write(langfile, json.dumps({"locale": "fr"}))
    assert dryrun(w, local) == base, "모르는 locale인데 프롬프트가 기준선과 달라졌다"

    # 5) en -> 참조 컨텍스트(티켓 줄) 뒤, 프롬프트 맨 꼬리에 영어 문장 두 짝이 실린다
    write(langfile, json.dumps({"locale": "en"}))
    got = dryrun(w, local)
    assert got != base, "locale=en인데 프롬프트가 ko와 같다"
    ctxend = got.index("Language note")
    assert "언어 안내" not in got, "en인데 ko 문장이 같이 실렸다\n" + got
    tail = got[ctxend:]
    assert "english" in tail.lower(), "사용자에게 하는 말은 영어 짝이 안 실렸다\n" + tail
    # §0-16 §주입 §개정 5: 산출물 언어도 로케일을 따른다 -- en에서는 산출물이 영어다.
    assert "keep every written deliverable in english" in tail.lower(), \
        "산출물 영어 고정 짝이 안 실렸다\n" + tail
    assert "korean" not in tail.lower(), "en인데 산출물이 여전히 한국어로 고정돼 있다\n" + tail
    assert "## 결과" in tail and "docs/" in tail, "산출물 대상(## 결과 · docs/)이 안 실렸다\n" + tail
    # 절 이름은 로케일과 무관한 리터럴이다(tickets.py:782,876,933 - lib/queue.ts:775가 문자열로 찾는다).
    for lit in ("## Goal", "## Done when", "## 진행 계획", "## 결과", "## 블록", "## 질문 n"):
        assert lit in tail, "절 이름 리터럴 {}가 en 문장에 안 실렸다\n{}".format(lit, tail)
    assert warns(root) == [], "en 주입에서 WARN이 났다: {}".format(warns(root))
    # §개정 5: en에서는 지침 블록이 적용 대상 없는 지시가 돼 0바이트로 빠진다(꼬리의 가리키는
    # 줄도 함께 빠진다) -- ko 문서 층에만 남는 히어독이라 이 검사는 got 전체로 본다.
    assert "===== 한국어 문장 지침" not in got, "en인데 한국어 문장 지침이 실렸다\n" + got
    assert "추가 금지 표현" not in got, "en인데 추가 금지 표현이 실렸다\n" + got
    assert "<한국어 문장 지침>" not in got, "en인데 없는 블록을 가리키는 줄이 남았다\n" + got

    # 5c) §개정 2 -- 생각 예외 절이 ko·en 두 짝에 각각 실린다(허가지 금지가 아니다)
    # 줄바꿈이 낱말 사이에 낄 수 있어(예: "internal\nreasoning") 공백으로 정규화한 뒤 본다.
    assert "이 지시의 대상이 아닙니다" in " ".join(base.split()) \
        and "thinking or internal reasoning" in " ".join(tail.lower().split()), \
        "생각 예외 절이 두 짝에 안 실렸다\n" + base + "\n---\n" + tail

    # 5b) 블록 크기는 상수다 -- 두 번 재도 같은 문자열
    again = dryrun(w, local)
    assert again == got, "같은 locale=en인데 블록이 매번 달라졌다(상수여야 한다)"

    # 6) `persona:` 없는 티켓에도 붙는다(페르소나 if 밖에 뜨는 자리다) -- 위 케이스가 이미
    #    persona 없는 티켓(5c112003)으로 돌았으므로 여기서는 그 사실을 명시적으로 밝힌다.
    assert "persona" not in open(os.path.join(root, "tickets", "5c112003.md"),
                                  encoding="utf-8").read()

    print("PASS ko/파일없음/JSON깨짐/객체아님/모르는값 5종 ko 주입(바이트 동일) · "
          "en 주입은 꼬리에 영어 문장 두 짝 · 블록 상수 · persona 무관 · WARN 0줄")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
