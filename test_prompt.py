#!/usr/bin/env python3
"""프롬프트 주입 자체검증 7종(P560-3). 옛 test_core_protocol - test_language - test_autonomy - test_memory -
test_skills - test_ontology - test_cache_control 일곱 장을 한 장으로 합쳤다. 단언은 문장 그대로다.

절마다 함수 하나이고 각자 임시 큐를 만든다. 절 사이에 상태를 공유하지 않으므로 스레드 4개로 병렬로 돈다.
절 설명은 각 함수의 docstring이다. 하나라도 실패하면 rc=1이다.
"""
import concurrent.futures
import sys
import traceback

def section_core_protocol():
    """코어 프로토콜 인라인 자체검증: <엔진 레포>/protocols/CORE.md가 프롬프트 맨 앞에 붙는가.

임시 큐에서만 판정한다(도그푸딩 큐에서 엔진을 실험하지 않는다). **엔진도 임시 디렉터리로
복사한다** — 코어는 큐가 아니라 엔진 레포 옆에 살아서, 이 레포의 진짜 CORE.md를 지우지 않고
"없을 때"를 재는 길이 그것뿐이다. 엔진을 실제로 부르지 않고 `tick.sh dryrun`이 찍는
프롬프트로 본다. 실패하면 assert로 죽는다.
"""
    __import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())  # 마이그레이션 게이트(P505)가 임시 루트를 막지 않게 빈 항목 폴더로
    import os
    import shutil
    import tempfile
    import subprocess

    import testkit

    HERE = os.path.dirname(os.path.abspath(__file__))

    WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/claude" "{{prompt}}")
. "{tick}"
"""


    def write(path, body):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        return path


    def dryrun(worker, local):
        out = testkit.dryrun(worker, local)
        assert out, "dryrun 출력이 비었다"
        return out


    def warns(root):
        p = os.path.join(root, "workers", "runner.log")
        if not os.path.exists(p):
            return []
        with open(p, encoding="utf-8") as f:
            return [ln for ln in f if "WARN" in ln]


    tmp = os.path.realpath(tempfile.mkdtemp())
    try:
        # 엔진 사본. tick.sh는 자기 위치에서 tickets.py와 protocols/를 유도한다(tick.sh:19).
        code = os.path.join(tmp, "engine")
        os.makedirs(code)
        for f in ("tick.sh", "tickets.py", "migrate.py", "plan_gate.py"):
            shutil.copy2(os.path.join(HERE, f), os.path.join(code, f))
        shutil.copy2(os.path.join(HERE, "dira_apm.py"), os.path.join(code, "dira_apm.py"))
        shutil.copy2(os.path.join(HERE, "apm-version"), os.path.join(code, "apm-version"))
        tick = os.path.join(code, "tick.sh")
        core = os.path.join(tmp, "dira-team", "protocols", "CORE.md")  # resolve protocols가 주는 로컬 패키지

        root = os.path.join(tmp, "dira")
        local = os.path.join(tmp, "local")
        os.makedirs(local)
        write(os.path.join(root, "protocols", "AGENTS.md"), "# 협업 프로토콜\n프로젝트-AGENTS-마커\n")
        write(os.path.join(root, "personas", "dev", "PROFILE.md"), "# Dev\n데브-프로필-마커\n")
        write(os.path.join(root, "tickets", "c0e00001.md"),
              "---\nticket: c0e00001\ntitle: t\nkind: work\npersona: dev\n---\n\n## Goal\ntest\n")
        worker = write(os.path.join(root, "workers", "w.sh"),
                       WORKER.format(name="w", tmp=tmp, tick=tick))
        os.chmod(worker, 0o755)

        # 1) 코어 파일이 없어도 디스패치가 성립한다 — rc=0, 프롬프트는 종전 그대로, WARN 한 줄.
        assert not os.path.exists(core), "사본 엔진에 CORE.md가 딸려 왔다"
        base = dryrun(worker, local)
        assert "프로젝트-AGENTS-마커" in base, "큐 AGENTS.md가 안 실렸다\n" + base
        assert "please pick up c0e00001" in base, "티켓 프롬프트가 안 실렸다\n" + base
        assert "CORE.md" not in base, "없는 코어가 프롬프트에 붙었다\n" + base
        w = warns(root)
        assert len(w) == 1 and "코어 프로토콜 없음" in w[0], "코어 없음 WARN이 한 줄이 아니다: {}".format(w)

        # 2) 코어가 있으면 통째로 실린다 — 큐 AGENTS.md 앞에, 그리고 프롬프트 맨 앞에.
        write(os.path.join(tmp, "dira-team", "apm.yml"), "name: t-team\nversion: 1.0.0\n")
        write(core, "# 코어\n코어-본문-마커\n")
        got = dryrun(worker, local)
        block = "===== CORE.md ({}) =====\n# 코어\n코어-본문-마커\n===== 코어 프로토콜 끝 =====\n\n".format(core)
        # dryrun은 프롬프트를 `프롬프트: ` 뒤에 그대로 찍는다 — 그 자리가 곧 프롬프트의 첫 글자다.
        assert "프롬프트: " + block in got, "코어 블록이 프롬프트 맨 앞이 아니다\n" + got
        assert got.index("코어-본문-마커") < got.index("프로젝트-AGENTS-마커") \
            < got.index("please pick up c0e00001"), "코어가 큐 AGENTS.md 앞이 아니다\n" + got
        assert got.index("코어-본문-마커") < got.index("데브-프로필-마커"), \
            "코어가 페르소나 프로필 앞이 아니다(결정 3)\n" + got
        assert got.replace(block, "") == base, \
            "코어 블록 말고 다른 것도 바뀌었다\n--- 기준선\n{}\n--- 지금\n{}".format(base, got)
        assert warns(root) == w, "코어가 있는데 WARN이 늘었다: {}".format(warns(root))

        # 3) 이 레포의 진짜 코어에는 프로젝트 층 자리표시자가 없다(§프롬프트 층 결정 2·3).
        with open(os.path.join(HERE, "packages", "dira-protocols", "CORE.md"), encoding="utf-8") as f:
            real = f.read()
        for ph in ("<프로젝트>", "<통합 브랜치>"):
            assert ph not in real, "코어에 프로젝트 층 자리표시자가 남아 있다: {}".format(ph)

        # 4) 큐 vendored 사본(§프롬프트 층 결정 8-b) - 있으면 그것이 우선이고 머리가 큐 절대경로를
        #    찍는다. 엔진 사본(2번의 마커)은 실리지 않는다. WARN도 안 늘어난다.
        vendored = write(os.path.join(root, "protocols", "CORE.md"), "# 큐 코어\n큐-코어-마커\n")
        got2 = dryrun(worker, local)
        block2 = "===== CORE.md ({}) =====\n# 큐 코어\n큐-코어-마커\n===== 코어 프로토콜 끝 =====\n\n".format(vendored)
        assert "프롬프트: " + block2 in got2, "큐 vendored 코어가 프롬프트 맨 앞이 아니다\n" + got2
        assert "코어-본문-마커" not in got2, "엔진 사본이 큐 사본보다 우선했다\n" + got2
        assert warns(root) == w, "큐 vendored 코어가 있는데 WARN이 늘었다: {}".format(warns(root))

        # 5) 큐 사본을 치우면 엔진 사본으로 폴백한다(이상 상태가 아니다 - 결정 8-b).
        os.remove(vendored)
        back = dryrun(worker, local)
        assert back == got, "큐 사본 제거 후 엔진 폴백이 2번과 달라졌다\n" + back

        print("PASS 코어 인라인·큐 AGENTS.md 앞·부재시 디스패치 성립(WARN 1줄)·자리표시자 0건"
              "·큐 vendored 우선·엔진 폴백")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def section_language():
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
    __import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())  # 마이그레이션 게이트(P505)가 임시 루트를 막지 않게 빈 항목 폴더로
    import json
    import os
    import shutil
    import tempfile
    import subprocess

    import testkit

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
        out = testkit.dryrun(worker, local, home=tmp)
        assert out, "dryrun 출력이 비었다"
        return out


    def warns(root):
        p = os.path.join(root, "workers", "runner.log")
        if not os.path.exists(p):
            return []
        with open(p, encoding="utf-8") as f:
            return [ln for ln in f if "WARN" in ln and "코어 프로토콜 없음" not in ln]  # P506-4: 엔진 사본이 없어 임시 큐는 코어 없이 돈다


    tmp = os.path.realpath(tempfile.mkdtemp())
    try:
        root = os.path.join(tmp, "dira")
        __import__("os").makedirs(os.path.join(root, "protocols"), exist_ok=True)  # P506-4가 엔진 사본을 지웠다 - 큐 사본이 없으면 WARN
        __import__("shutil").copy2(os.path.join(HERE, "packages", "dira-protocols", "CORE.md"), os.path.join(root, "protocols", "CORE.md"))
        local = os.path.join(tmp, "local")
        os.makedirs(local)
        langfile = os.path.join(local, "language.json")
        w = mkworker(root, "w", tmp)
        write(os.path.join(root, "protocols", "CORE.md"), "# core\n")  # P506-4: 큐 사본이 코어라 있어야 WARN 시각이 안 섞인다
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


def section_autonomy():
    """주도성 주입 자체검증: $LOCAL/autonomy.json의 level이 프롬프트에서 언어 안내 바로 뒤에
닿는가 (docs/DESIGN.md §주도성 결정 1-3, 요구 862c7d6e, 답 e68990f2).

level이 무엇이든 언어 안내 바로 뒤(꼬리, TAIL)에 `주도성 안내: <n>/5` (locale=en이면
`Autonomy note: <n>/5`) 문장이 한 번 실린다. 파일 없음·JSON 깨짐·객체 아님·정수 아님·1~5
밖 다섯 경우 전부 4로 흡수한다(GUI readAutonomy와 같은 판정, 언어의 readLanguage와 같은 틀).

임시 큐에서만 판정한다. 엔진을 실제로 부르지 않고 `tick.sh dryrun`이 찍는 프롬프트로 본다.
실패하면 assert로 죽는다.
"""
    __import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())  # 마이그레이션 게이트(P505)가 임시 루트를 막지 않게 빈 항목 폴더로
    import json
    import os
    import shutil
    import tempfile
    import subprocess

    import testkit

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
        out = testkit.dryrun(worker, local, home=os.path.dirname(local), stderr=False)
        assert out, "dryrun 출력이 비었다"
        return out


    tmp = os.path.realpath(tempfile.mkdtemp())
    try:
        root = os.path.join(tmp, "dira")
        __import__("os").makedirs(os.path.join(root, "protocols"), exist_ok=True)  # P506-4가 엔진 사본을 지웠다 - 큐 사본이 없으면 WARN
        __import__("shutil").copy2(os.path.join(HERE, "packages", "dira-protocols", "CORE.md"), os.path.join(root, "protocols", "CORE.md"))
        local = os.path.join(tmp, "local")
        os.makedirs(local)
        autof = os.path.join(local, "autonomy.json")
        w = mkworker(root, "w", tmp)
        write(os.path.join(root, "protocols", "CORE.md"), "# 코어\n")  # P506-4: 코어가 없으면 WARN 줄에 시각이 섞여 비결정적이다
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
        assert "autonomy" in got5, "level 5 문장에 펜스 정보 문자열 안내가 없다(P444-1)\n" + got5

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

        # 6) 오토파일럿(P517-1): 유효 = level 5 + JSON true. 나머지 셋은 줄 0회, 지금 안내 그대로.
        for body, on in (({"level": 5, "autopilot": True}, True), ({"level": 4, "autopilot": True}, False),
                         ({"level": 5, "autopilot": "true"}, False), ({"level": 5}, False)):
            write(autof, json.dumps(body))
            got = dryrun(w, local)
            assert got.count("주도성 안내: 5/5 (오토파일럿).") == (1 if on else 0), "오토파일럿 줄 횟수가 다르다 {}".format(body)
            assert ("오토파일럿이 켜져 있습니다. 답변 대기를 만들지 않습니다" in got) == on, body
            assert got.count("이미 로그인된 CLI") == (1 if on else 0), "권한 범위 문장 횟수가 다르다 {}".format(body)
            assert got.count("외부-계정.md") == (1 if on else 0), "외부-계정.md 횟수가 다르다 {}".format(body)
            if not on:
                write(autof, json.dumps({"level": body["level"]}))
                assert got == dryrun(w, local), "꺼진 판정인데 안내가 달라졌다 {}".format(body)
        write(langfile, json.dumps({"locale": "en"}))
        write(autof, json.dumps({"level": 5, "autopilot": True}))
        assert dryrun(w, local).count("Autonomy note: 5/5 (autopilot).") == 1, "영어 오토파일럿 안내 없음"
        os.remove(langfile)

        # 7) ask_human 표식과 8) 이어받기 상한 생략
        import sys
        sys.path.insert(0, HERE)
        import tickets as T
        os.environ["TICKET_LOCAL"] = local

        def mkq(h, fm):
            d = os.path.join(tmp, "q", "tickets")
            os.makedirs(d, exist_ok=True)
            q = os.path.join(d, h + ".md")
            write(q, "---\nticket: {}\nkind: work\n{}---\n\n## Goal\nx\n".format(h, fm))
            return q

        def mark(q):
            return (T.read_fm(q)[0].get("autopilot_failed") or "").strip()

        write(autof, json.dumps({"level": 5, "autopilot": True}))
        q = mkq("aaaa0001", "")
        T.ask_human(q, "aaaa0001", 0, "x", blocked=True)
        assert mark(q), "오토파일럿인데 autopilot_failed가 없다"
        q = mkq("aaaa0002", "")
        T.ask_human(q, "aaaa0002", 0, "x", killed=True)
        assert not mark(q), "killed인데 표식이 생겼다"
        write(autof, json.dumps({"level": 5}))
        q = mkq("aaaa0003", "")
        T.ask_human(q, "aaaa0003", 0, "x", blocked=True)
        assert not mark(q), "꺼져 있는데 표식이 생겼다"

        q = mkq("aaaa0004", "handoffs: 4\n")
        try:
            T.claim(q)
            assert False, "꺼져 있으면 handoffs 4는 잠겨야 한다"
        except SystemExit:
            pass
        write(autof, json.dumps({"level": 5, "autopilot": True}))
        q = mkq("aaaa0005", "handoffs: 4\n")
        T.claim(q)
        assert os.path.exists(os.path.join(tmp, "q", "tickets", "aaaa0005" + T.IN_PROGRESS + ".md")), "오토파일럿인데 .wip이 안 됐다"

        print("PASS 기본값4 · level 1-5 개별 · 0/문자열/배열/깨진JSON 4종 4로 흡수 · "
              "en에서는 영어 안내만 · 언어 안내 뒤 꼬리 · persona 무관 · 블록 상수")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def section_memory():
    """페르소나 메모리 사이드카 자체검증: <personas>/<이름>/memory/*.md가 프롬프트에 붙는가.

9d7ba932 이후 블록은 나열(파일명+`## ` 절)이 아니라 **위치 + 검색 방법 상수**다 -- 그래서
여기서 재는 것은 "목차가 실리는가"가 아니라 "블록이 붙는가 · 절대경로가 실리는가 · 검색 안내가
실리는가 · `## ` 절 제목과 본문이 안 실리는가 · 파일을 늘려도 블록이 안 자라는가"다.

임시 큐에서만 판정한다(도그푸딩 큐에서 엔진을 실험하지 않는다). 엔진을 실제로 부르지 않고
`tick.sh dryrun`이 찍는 프롬프트로 본다 -- 붙는 자리와 조건이 전부 프롬프트 조립에 있다.
실패하면 assert로 죽는다.
"""
    __import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())  # 마이그레이션 게이트(P505)가 임시 루트를 막지 않게 빈 항목 폴더로
    import os
    import shutil
    import tempfile
    import subprocess

    import testkit

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
        out = testkit.dryrun(worker, local, home=tmp)
        assert out, "dryrun 출력이 비었다"
        return out


    def warns(root):
        p = os.path.join(root, "workers", "runner.log")
        if not os.path.exists(p):
            return []
        with open(p, encoding="utf-8") as f:
            return [ln for ln in f if "WARN" in ln and "코어 프로토콜 없음" not in ln]  # P506-4: 엔진 사본이 없어 임시 큐는 코어 없이 돈다


    tmp = os.path.realpath(tempfile.mkdtemp())
    try:
        root = os.path.join(tmp, "dira")
        __import__("os").makedirs(os.path.join(root, "protocols"), exist_ok=True)  # P506-4가 엔진 사본을 지웠다 - 큐 사본이 없으면 WARN
        __import__("shutil").copy2(os.path.join(HERE, "packages", "dira-protocols", "CORE.md"), os.path.join(root, "protocols", "CORE.md"))
        local = os.path.join(tmp, "local")
        os.makedirs(local)
        memdir = os.path.join(root, "personas", "dev", "memory")
        write(os.path.join(root, "protocols", "CORE.md"), "# core\n")  # P506-4: 큐 사본이 코어라 있어야 WARN 시각이 안 섞인다
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

        # 6) PROFILE.md가 없으면 메모리도 안 붙는다(메모리는 페르소나 프롬프트 안에만 있다)
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


def section_skills():
    """페르소나 스킬 사이드카 자체검증: <personas>/<이름>/skills.md가 프롬프트에 붙는가.

임시 큐에서만 판정한다(도그푸딩 큐에서 엔진을 실험하지 않는다). 엔진을 실제로 부르지 않고
`tick.sh dryrun`이 찍는 프롬프트로 본다 -- 붙는 자리와 조건이 전부 프롬프트 조립에 있다.
실패하면 assert로 죽는다.
"""
    __import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())  # 마이그레이션 게이트(P505)가 임시 루트를 막지 않게 빈 항목 폴더로
    import os
    import shutil
    import tempfile
    import subprocess

    import testkit

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
        out = testkit.dryrun(worker, local, home=tmp)
        assert out, "dryrun 출력이 비었다"
        return out


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


def section_ontology():
    """온톨로지 블록 자체검증: <루트>/ontology/**/*.md가 있으면 위치+검색 방법 블록이 붙는가.

9d7ba932 이후 블록은 나열(파일 경로+`## ` 절)이 아니라 **위치 + 검색 방법 상수**다 -- 그래서
여기서 재는 것은 "목차가 실리는가"가 아니라 "블록이 붙는가 · 절대경로가 실리는가 · SCHEMA.md가
지도라는 안내가 실리는가 · 검색 안내가 실리는가 · 파일을 늘려도 블록이 안 자라는가".
메모리와 갈리는 자리 둘은 그대로 고정한다: 하위 디렉터리도 존재 판정에 들어간다(재귀) /
페르소나 밖이라 `persona:` 없는 티켓에도 붙는다.

임시 큐에서만 판정한다(도그푸딩 큐에서 엔진을 실험하지 않는다). 엔진을 실제로 부르지 않고
`tick.sh dryrun`이 찍는 프롬프트로 본다 -- 붙는 자리와 조건이 전부 프롬프트 조립에 있다.
실패하면 assert로 죽는다.
"""
    __import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())  # 마이그레이션 게이트(P505)가 임시 루트를 막지 않게 빈 항목 폴더로
    import os
    import shutil
    import tempfile
    import subprocess

    import testkit

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
        out = testkit.dryrun(worker, local, home=tmp, ontology=ontology)
        assert out, "dryrun 출력이 비었다"
        return out


    def warns(root):
        p = os.path.join(root, "workers", "runner.log")
        if not os.path.exists(p):
            return []
        with open(p, encoding="utf-8") as f:
            return [ln for ln in f if "WARN" in ln and "코어 프로토콜 없음" not in ln]  # P506-4: 엔진 사본이 없어 임시 큐는 코어 없이 돈다


    tmp = os.path.realpath(tempfile.mkdtemp())
    try:
        root = os.path.join(tmp, "dira")
        __import__("os").makedirs(os.path.join(root, "protocols"), exist_ok=True)  # P506-4가 엔진 사본을 지웠다 - 큐 사본이 없으면 WARN
        __import__("shutil").copy2(os.path.join(HERE, "packages", "dira-protocols", "CORE.md"), os.path.join(root, "protocols", "CORE.md"))
        local = os.path.join(tmp, "local")
        os.makedirs(local)
        ontdir = os.path.join(root, "ontology")
        write(os.path.join(root, "protocols", "CORE.md"), "# core\n")  # P506-4: 큐 사본이 코어라 있어야 WARN 시각이 안 섞인다
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

        # 4) `persona:` 없는 티켓에도 붙는다(페르소나 if 밖에 뜨는 자리다)
        os.remove(os.path.join(root, "tickets", "5c112001.md"))
        mk(root, "5c112002", fm="kind: work\n")
        nop = dryrun(w, local)
        assert "데브-프로필-마커" not in nop, "persona 없는 티켓에 프로필이 붙었다\n" + nop
        assert block in nop, "persona 없는 티켓에 온톨로지가 안 붙었다\n" + nop

        # 5) TICKET_ONTOLOGY 재정의 - 큐 밖 임시 디렉터리를 가리키면 그 자리가 블록에 뜬다.
        #    기본값 케이스(위 1~4)는 이 변수를 안 건드려 무수정으로 통과했다(85114387).
        extdir = os.path.join(tmp, "밖온톨로지")
        write(os.path.join(extdir, "외부개념.md"), "# 외부개념\n외부-온톨로지-마커\n")
        ext = dryrun(w, local, ontology=extdir)
        ext_start = "===== 온톨로지 (" + extdir + ") =====\n"
        assert ext_start in ext, "TICKET_ONTOLOGY 자리가 블록에 안 떴다\n" + ext
        assert "===== 온톨로지 (" + ontdir + ") =====" not in ext, \
            "재정의했는데 기본 자리(<큐>/ontology)가 블록에 남았다\n" + ext

        # 6) 재정의 자리에 md 500장을 두 층(층a/층b)에 걸쳐 두면 - `find | grep -q .`가
        #    파이프 버퍼(수십 KB)를 넘겨 find가 SIGPIPE로 죽고, `set -o pipefail`이 그 141을
        #    올려 판정을 "없다"로 뒤집던 자리다(P313-9). 파일명에 150자를 채워 총량을 파이프
        #    버퍼 위로 올린다 - 짧은 파일명이면 버퍼 안에 다 들어가 race가 안 걸린다.
        bigdir = os.path.join(tmp, "큰온톨로지")
        pad = "x" * 150
        for i in range(500):
            sub = "층a" if i % 2 == 0 else "층b"
            write(os.path.join(bigdir, sub, "개념{:03d}{}.md".format(i, pad)),
                  "# 개념{}\n본문\n".format(i))
        big = dryrun(w, local, ontology=bigdir)
        assert ("===== 온톨로지 (" + bigdir + ") =====") in big, \
            "md 500장 · 두 층 재정의 자리에서 온톨로지 블록이 안 붙었다(141 회귀)\n" + big

        # 7) TICKET_ONTOLOGY에 없는 절대경로를 주면 - find는 빈손이지만(종전이면 안 붙었을 자리)
        #    재정의한 자리는 존재를 재지 않고 그대로 블록을 붙인다(51c730de). WARN도 없다 -
        #    존재 판정은 쓰는 쪽(GUI)의 몫이지 엔진의 몫이 아니다.
        missingdir = os.path.join(tmp, "없는-온톨로지")
        assert not os.path.exists(missingdir)
        missing = dryrun(w, local, ontology=missingdir)
        assert ("===== 온톨로지 (" + missingdir + ") =====") in missing, \
            "TICKET_ONTOLOGY가 없는 자리를 가리켜도 블록이 붙어야 한다\n" + missing
        assert warns(root) == [], \
            "TICKET_ONTOLOGY가 없는 자리인데 WARN이 났다: {}".format(warns(root))

        # 8) TICKET_ONTOLOGY 미설정 - 종전 그대로다(위 1~4의 기준선과 동일, 이번 개정의 대상이 아니다).
        #    없거나 빈 <큐 루트>/ontology에서는 여전히 안 붙고 WARN도 0줄이다.
        shutil.rmtree(ontdir)
        unset_missing = dryrun(w, local)
        assert "온톨로지" not in unset_missing, \
            "TICKET_ONTOLOGY 미설정 + ontology/ 없음인데 블록이 붙었다\n" + unset_missing
        assert warns(root) == [], "미설정 + 없음인데 WARN이 났다: {}".format(warns(root))
        os.makedirs(ontdir)
        unset_empty = dryrun(w, local)
        assert "온톨로지" not in unset_empty, \
            "TICKET_ONTOLOGY 미설정 + 빈 ontology/인데 블록이 붙었다\n" + unset_empty
        assert warns(root) == [], "미설정 + 빈 폴더인데 WARN이 났다: {}".format(warns(root))

        print("PASS 위치+검색 방법 상수 블록·본문/목차 미주입·재귀·공백 파일명·"
              "파일 늘어도 불변·페르소나 무관·없으면 WARN 0줄·TICKET_ONTOLOGY 재정의·"
              "md 500장 두 층에서도 붙음(P313-9)·재정의 자리가 없어도 안 재고 붙음(51c730de)·"
              "미설정은 종전 그대로")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def section_cache_control():
    """캐시 갈래(P295-10) 자체검증: 안 변하는 문서 층이 캐시되는 자리로 가는가.

2026-08-28 개정 - 단언이 뒤집힌 자리와 그 이유:
    옛 계약은 "프라임 JSON의 content가 블록 둘로 갈리고 앞 블록에만 cache_control ttl 1h가
    있다"였다. 지금 계약은 "프라임은 꼬리 한 블록이고 cache_control이 하나도 없다. 문서 층은
    `--append-system-prompt`로 간다"다.
    이 파일이 우리 블록 1개만 재고 CLI 몫과의 합은 안 재는 것이 사각지대였다 - 그 합이 API
    상한 4를 넘어도 여기서는 초록이었다.
    실측(로컬 기록 API로 요청 본문을 떠서 셈): CLI가 자기 몫으로 최대 4개를 쓴다 - system 둘
    (에이전트 프롬프트 - 하네스 프롬프트) + 대화 롤링 둘. 롤링 창은 도구 결과가 붙는 **둘째**
    요청부터 2개가 된다. 그래서 우리가 한 개라도 달면 첫 턴은 4로 통과하고 둘째 턴에서 5가 되어
    세션이 통째로 400을 받는다("A maximum of 4 blocks with cache_control may be provided.
    Found 5."). 그 400이 api_error로 읽혀 쿨다운을 걸고, 만료 직전 나간 워커가 또 400을 받아
    창을 되감아 2026-08-28 04:50~11:07 큐가 멎었다(실패 세션 14건).
    우리 몫을 0으로 내려야 합이 4 이하다 - 우리가 줄일 수 있는 유일한 몫이 우리 것뿐이다.
    그러면서 P295 이득은 지킨다: `--append-system-prompt`로 넘긴 텍스트를 CLI가 자기 시스템
    블록 **끝에** 이어 붙이는데 그 블록에는 CLI 자기 cache_control ttl 1h가 이미 달려 있다.
    우리 블록을 하나도 안 쓰고 문서 층이 캐시 프리픽스 안에 들어간다(붙인 뒤에도 총 개수는
    턴1 3 - 턴2 4). 옛 자리보다 오래 사는 캐시다 - 옛 자리는 매 커밋마다 갈리는 gitStatus
    리마인더 뒤였는데 시스템 블록은 그 앞이다.

이어 붙인 것이 프롬프트 전부라는 계약은 그대로다: argv의 문서 층 + 프라임 꼬리가 `dryrun`이
찍는 프롬프트와 바이트 단위로 같아야 한다(§프롬프트 층 결정 10 §엔진 수정 스물다섯 번째 승인 개정).

임시 큐에서만 판정한다(도그푸딩 큐에서 엔진을 실험하지 않는다). 진짜 claude를 부르지 않고,
stdin 첫 줄(프라임 JSON)을 파일로 받아 적는 가짜 스트림 엔진으로 본다(test_inbox.py 선례).
실패하면 assert로 죽는다.
"""
    __import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())  # 마이그레이션 게이트(P505)가 임시 루트를 막지 않게 빈 항목 폴더로
    import os
    import json
    import shutil
    import tempfile
    import subprocess

    HERE = os.path.dirname(os.path.abspath(__file__))

    WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/fake-stream.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

    # 첫 줄(프라임 JSON)을 파일로 떠 두고 init -> result를 뱉는다 - 진짜 엔진의 stdin을 훔쳐보는
    # 대신 엔진 스스로 받아 적게 한다(PRIMEF는 워커 종료 trap에서 지워지므로 디스크에서 훔쳐 읽으면
    # 경합이 생긴다 - test_inbox.py와 같은 이유).
    ENGINE = """\
#!/bin/bash
IFS= read -r first
printf '%s\\n' "$first" > "{tmp}/captured-prime.jsonl"
printf '%s\\0' "$@" > "{tmp}/captured-argv"
printf '{{"type":"system","subtype":"init"}}\\n'
printf '{{"is_error":false,"num_turns":1,"session_id":"%s","type":"result","subtype":"success"}}\\n' "$1"
sleep 60
"""


    def write(path, body):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        return path


    def dryrun(worker, local):
        r = subprocess.run([worker, "dryrun"], capture_output=True, text=True,
                           env=dict(os.environ, TICKET_LOCAL=local), timeout=60)
        assert r.returncode == 0, "dryrun rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)
        return r.stdout


    def prompt_of(dryrun_stdout):
        # dryrun의 마지막 echo가 "프롬프트: $PROMPT"다 - 그 뒤 전부가 프롬프트고, echo 자신이
        # 붙인 마지막 개행 한 글자만 걷어낸다(PROMPT 자체는 개행으로 안 끝난다).
        marker = "프롬프트: "
        assert marker in dryrun_stdout, "dryrun 출력에 프롬프트 표시가 없다\n" + dryrun_stdout
        tail = dryrun_stdout.split(marker, 1)[1]
        assert tail.endswith("\n"), "dryrun 프롬프트 뒤에 echo 개행이 없다"
        return tail[:-1]


    tmp = os.path.realpath(tempfile.mkdtemp())
    try:
        # 엔진 사본 - tick.sh는 자기 위치에서 tickets.py와 protocols/를 유도한다(tick.sh:19).
        code = os.path.join(tmp, "engine")
        os.makedirs(code)
        for f in ("tick.sh", "tickets.py", "migrate.py"):
            shutil.copy2(os.path.join(HERE, f), os.path.join(code, f))
        tick = os.path.join(code, "tick.sh")

        root = os.path.join(tmp, "dira")
        local = os.path.join(tmp, "local")
        os.makedirs(local)
        write(os.path.join(root, "protocols", "CORE.md"), "# 코어\n코어-마커\n")
        write(os.path.join(root, "protocols", "AGENTS.md"), "# 협업\nAGENTS-마커\n")
        write(os.path.join(root, "personas", "dev", "PROFILE.md"), "# Dev\n페르소나-마커\n")
        write(os.path.join(root, "ontology", "_ontology", "SCHEMA.md"), "# 지도\n온톨로지-마커\n")
        write(os.path.join(root, "tickets", "c0c00001.md"),
              "---\nticket: c0c00001\ntitle: t\nkind: work\npersona: dev\n---\n\n## Goal\ntest\n")
        write(os.path.join(tmp, "fake-stream.sh"), ENGINE.format(tmp=tmp))
        os.chmod(os.path.join(tmp, "fake-stream.sh"), 0o755)
        worker = write(os.path.join(root, "workers", "w.sh"),
                       WORKER.format(name="w", tmp=tmp, tick=tick))
        os.chmod(worker, 0o755)

        full_prompt = prompt_of(dryrun(worker, local))
        for marker in ("코어-마커", "페르소나-마커", "===== 온톨로지 (", "AGENTS-마커",
                       "please pick up c0c00001"):
            assert marker in full_prompt, "dryrun 프롬프트에 " + marker + "가 없다\n" + full_prompt

        # 티켓을 다시 백로그로 되돌려 실행용으로 재사용한다(dryrun은 claim을 안 남기지만 방어적으로).
        assert not os.path.exists(os.path.join(root, "tickets", "c0c00001.wip.md"))

        r = subprocess.run([worker, "tick"], capture_output=True, text=True,
                           env=dict(os.environ, TICKET_LOCAL=local), timeout=90)
        assert r.returncode == 0, "tick rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)

        captured_path = os.path.join(tmp, "captured-prime.jsonl")
        assert os.path.exists(captured_path), "가짜 엔진이 프라임 줄을 못 받았다"
        with open(captured_path, encoding="utf-8") as f:
            line = f.read().strip()
        prime = json.loads(line)

        assert prime.get("type") == "user", prime
        content = prime.get("message", {}).get("content")
        assert isinstance(content, list) and len(content) == 1, \
            "content가 꼬리 한 블록인 배열이 아니다: {}".format(content)
        tail_block = content[0]
        assert tail_block.get("type") == "text", tail_block
        # 우리 몫은 0이다. 한 블록이라도 달면 CLI 몫 4와 합쳐 5가 되어 둘째 요청이 400으로 죽는다.
        assert "cache_control" not in tail_block, \
            "프라임 블록에 cache_control이 있으면 안 된다(CLI 몫 4와 합쳐 API 상한 4를 넘는다): {}".format(
                tail_block)

        # 문서 층은 argv로 간다 - `--append-system-prompt <HEAD>`가 인자 **둘**로 인접해 있어야 한다.
        with open(os.path.join(tmp, "captured-argv"), encoding="utf-8") as f:
            argv = f.read().split("\0")[:-1]
        assert "--append-system-prompt" in argv, \
            "엔진 argv에 --append-system-prompt가 없다: {}".format(argv[:6])
        i = argv.index("--append-system-prompt")
        assert i + 1 < len(argv), "--append-system-prompt 뒤에 값이 없다: {}".format(argv)
        head = argv[i + 1]
        assert argv.count("--append-system-prompt") == 1, \
            "--append-system-prompt가 두 번 붙었다(문서 층이 두 벌 간다): {}".format(argv)

        tail = tail_block["text"]
        assert head.startswith("===== CORE.md"), "문서 층이 CORE.md로 안 시작한다\n" + head[:200]
        assert head.rstrip().endswith("===== 프로토콜 끝 ====="), \
            "문서 층이 큐 AGENTS.md 프로토콜 끝으로 안 끝난다\n" + head[-200:]
        assert tail.startswith("please pick up c0c00001"), \
            "프라임 블록이 티켓 해시 문장으로 안 시작한다\n" + tail[:200]
        # P433-1/P433-3(8ae93e57, 0162d6da)부터 언어 안내 뒤에 주도성 안내 꼬리가 더 실린다 -
        # autonomy.json을 안 둔 이 픽스처는 기본값 4/5(§주도성 결정 1-3)를 받고, 그 행은
        # "...남기세요."로 끝난다(레벨 1-3은 다른 동사로 끝난다).
        assert "주도성 안내: 4/5." in tail, \
            "프라임 블록에 기본 주도성 안내(4/5)가 안 실렸다\n" + tail[-300:]
        assert tail.rstrip().endswith("남기세요."), \
            "프라임 블록이 주도성 안내 꼬리로 안 끝난다\n" + tail[-200:]
        # 한국어 문장 지침은 안 변하는 6KB 상수라 문서 층(캐시되는 쪽)에 있다 - 꼬리로 새면
        # 회차마다 캐시 밖에서 다시 쓰인다(이 절이 막는 회귀가 정확히 그것이다).
        assert "===== 한국어 문장 지침" in head and "===== 한국어 문장 지침" not in tail, \
            "한국어 문장 지침 블록이 문서 층에 없다(또는 꼬리로 샜다)"
        # 문서 층이 프라임으로도 새면 같은 것이 두 벌 간다(토큰 두 배 + 캐시 무의미).
        assert "===== CORE.md" not in tail, "문서 층이 프라임 블록으로 샜다\n" + tail[:200]

        assert head + tail == full_prompt, \
            "argv 문서 층 + 프라임 꼬리가 dryrun 프롬프트와 다르다\n--- head+tail\n{}\n--- dryrun\n{}".format(
                head + tail, full_prompt)

        # --- en 경로(§0-16 §주입 §개정 5) - 지침 블록이 0바이트라 위 두 단언(head-tail 분리 -
        # 블록이 앞 블록에 있다)의 대상 자체가 없다. 부재가 이 판정을 깨지 않는지를 본다.
        langfile = os.path.join(local, "language.json")
        write(langfile, json.dumps({"locale": "en"}))
        write(os.path.join(root, "tickets", "c0c00002.md"),
              "---\nticket: c0c00002\ntitle: t\nkind: work\npersona: dev\n---\n\n## Goal\ntest\n")

        full_prompt_en = prompt_of(dryrun(worker, local))
        assert "===== 한국어 문장 지침" not in full_prompt_en, \
            "en인데 지침 블록이 여전히 실렸다\n" + full_prompt_en

        r = subprocess.run([worker, "tick"], capture_output=True, text=True,
                           env=dict(os.environ, TICKET_LOCAL=local), timeout=90)
        assert r.returncode == 0, "en tick rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)

        with open(captured_path, encoding="utf-8") as f:
            prime_en = json.loads(f.read().strip())
        content_en = prime_en.get("message", {}).get("content")
        assert isinstance(content_en, list) and len(content_en) == 1, \
            "en content가 꼬리 한 블록인 배열이 아니다: {}".format(content_en)
        tail_block_en = content_en[0]
        assert "cache_control" not in tail_block_en, \
            "en 프라임 블록에 cache_control이 있으면 안 된다: {}".format(tail_block_en)

        with open(os.path.join(tmp, "captured-argv"), encoding="utf-8") as f:
            argv_en = f.read().split("\0")[:-1]
        assert argv_en.count("--append-system-prompt") == 1, \
            "en에서 --append-system-prompt가 중복되거나 없다: {}".format(argv_en)
        head_en = argv_en[argv_en.index("--append-system-prompt") + 1]
        tail_en = tail_block_en["text"]

        assert "===== 한국어 문장 지침" not in head_en and "===== 한국어 문장 지침" not in tail_en, \
            "en인데 지침 블록이 문서 층 또는 꼬리에 실렸다(부재여야 한다)"
        assert head_en + tail_en == full_prompt_en, \
            "en argv 문서 층 + 프라임 꼬리가 dryrun 프롬프트와 다르다"
        assert "keep every written deliverable in english" in tail_en.lower(), \
            "en 산출물 영어 고정 짝이 프라임 꼬리에 안 실렸다\n" + tail_en

        print("PASS 문서 층은 --append-system-prompt로 · 프라임은 꼬리 한 블록 · cache_control 0개(우리 몫) "
              "· head+tail == dryrun 프롬프트 · en 경로는 지침 블록 부재로도 판정이 안 깨진다")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


SECTIONS = [(k[8:], v) for k, v in sorted(globals().items()) if k.startswith("section_")]


def main():
    bad = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futs = [(n, ex.submit(f)) for n, f in SECTIONS]
        for n, fu in futs:
            try:
                fu.result()
                print("ok   ", n)
            except BaseException:
                bad += 1
                print("FAIL ", n)
                traceback.print_exc()
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
