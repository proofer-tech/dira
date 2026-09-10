#!/usr/bin/env python3
"""엔진 수정 서른일곱 번째 승인 §판정 2 자체검증 - 수용조건 6~11. `.done`으로 닫혔는데
`## 진행 계획`에 완료(`- [x]`)도 취소(`~~`)도 아닌 항목이 남았으면 `FAIL`이고 티켓이 열린
이름으로 돌아온다. 진짜 claude를 부르지 않는다 - test_wip_after_ok.py와 같은 가짜 엔진으로
tick.sh의 종료 로그 분기만 본다. 실패하면 assert로 죽는다."""
import os
import sys
import shutil
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER_TMPL = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{cwd}"
TICKET_PROMPT_FMT="pick up %s"
TICKET_ENGINE=("{engine}" "{{prompt}}")
. "{tick}"
"""

# 비스트리밍 가짜 엔진 - 세션이 죽기 전에 `.wip`을 `.done`으로 닫아 두고 ok를 낸다
# (test_wip_after_ok.py ENGINE과 같은 관용구).
ENGINE = """\
#!/bin/bash
wip=$(ls "{tickets}"/*.wip.md 2>/dev/null | head -1)
mv "$wip" "${{wip%.wip.md}}.done.md"
echo '{{"is_error":false,"type":"result","session_id":"sess-x","subtype":"success"}}'
exit 0
"""

BODY_FMT = """\
---
ticket: {h}
title: t
kind: work
{extra}---

## Goal
test

## 진행 계획

{plan}
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


class Env:
    def __init__(self, tag, h, plan, extra=""):
        self.tmp = tempfile.mkdtemp(prefix="planrevert-" + tag + "-")
        self.root = os.path.join(self.tmp, "dira")
        self.local = os.path.join(self.tmp, "local")
        self.tickets = os.path.join(self.root, "tickets")
        os.makedirs(self.local)
        self.h = h
        mkfile(os.path.join(self.tickets, h + ".md"),
               BODY_FMT.format(h=h, plan=plan, extra=extra))
        engine = mkfile(os.path.join(self.tmp, "fake-engine.sh"),
                         ENGINE.format(tickets=self.tickets), 0o755)
        self.w1 = mkfile(os.path.join(self.root, "workers", "w1.sh"),
                          WORKER_TMPL.format(cwd=self.tmp, engine=engine, tick=TICK), 0o755)
        self.env = dict(os.environ, TICKET_LOCAL=self.local)

    def tick(self):
        return subprocess.run([self.w1, "tick"], capture_output=True, text=True,
                               env=self.env, timeout=180)

    def runner_log(self):
        try:
            with open(os.path.join(self.root, "workers", "runner.log"), encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def ls(self):
        return sorted(os.listdir(self.tickets))

    def read(self, name):
        with open(os.path.join(self.tickets, name), encoding="utf-8") as f:
            return f.read()

    def cleanup(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


envs = []


def newenv(tag, h, plan, extra=""):
    e = Env(tag, h, plan, extra)
    envs.append(e)
    return e


passed = 0
try:
    # ---- 6. 안 켠 상자를 남긴 `.done`은 FAIL이고 열린 이름으로 돌아온다 --------------------
    e6 = newenv("unchecked", "aaaa2006", "- [x] 첫 단계\n- [ ] 둘째 단계\n")
    r = e6.tick()
    assert r.returncode == 0, "6: tick 실패\n" + r.stderr
    log6 = e6.runner_log()
    assert "FAIL aaaa2006" in log6, "6: FAIL이 안 찍혔다\n" + log6
    assert "DONE aaaa2006" not in log6, "6: 안 켠 상자인데 DONE도 찍혔다\n" + log6
    assert e6.ls() == ["aaaa2006.md"], "6: 열린 이름으로 안 돌아왔다: " + str(e6.ls())
    assert "attempts: 1" in e6.read("aaaa2006.md"), "6: attempts가 안 올랐다"
    passed += 1

    # ---- 7. 같은 자리에서 취소선을 그으면 DONE이다 ----------------------------------------
    e7 = newenv("struck", "bbbb2007", "- [x] 첫 단계\n- [ ] ~~안 한 단계~~\n")
    r = e7.tick()
    assert r.returncode == 0, "7: tick 실패\n" + r.stderr
    log7 = e7.runner_log()
    assert "DONE bbbb2007" in log7, "7: 취소선인데 DONE이 안 찍혔다\n" + log7
    assert "FAIL bbbb2007" not in log7, "7: 취소선인데 FAIL이 찍혔다\n" + log7
    assert e7.ls() == ["bbbb2007.done.md"], "7: .done에서 되돌아갔다: " + str(e7.ls())
    passed += 1

    # ---- 8. 상자를 전부 켠 `.done`은 종전대로 DONE이고 되돌아오지 않는다 ------------------
    e8 = newenv("allchecked", "cccc2008", "- [x] 첫 단계\n- [x] 둘째 단계\n")
    r = e8.tick()
    assert r.returncode == 0, "8: tick 실패\n" + r.stderr
    log8 = e8.runner_log()
    assert "DONE cccc2008" in log8, "8: 전부 켠 계획인데 DONE이 안 찍혔다\n" + log8
    assert "FAIL cccc2008" not in log8, "8: 전부 켠 계획인데 FAIL이 찍혔다\n" + log8
    assert e8.ls() == ["cccc2008.done.md"], "8: .done에서 되돌아갔다: " + str(e8.ls())
    passed += 1

    # ---- 9. 계획 절이 아예 없는 `.done`은 이 판정의 입력이 아니다(종전대로 DONE) -----------
    e9 = Env("noplan", "dddd2009", "")
    envs.append(e9)
    mkfile(os.path.join(e9.tickets, "dddd2009.md"),
           "---\nticket: dddd2009\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")
    r = e9.tick()
    assert r.returncode == 0, "9: tick 실패\n" + r.stderr
    log9 = e9.runner_log()
    assert "DONE dddd2009" in log9, "9: 계획 절 없는 .done인데 DONE이 안 찍혔다\n" + log9
    assert "FAIL dddd2009" not in log9, "9: 계획 절 없는 .done인데 FAIL이 찍혔다\n" + log9
    assert e9.ls() == ["dddd2009.done.md"], "9: .done에서 되돌아갔다: " + str(e9.ls())
    passed += 1

    # ---- 10. 예산(REAP_FAIL_BUDGET_OTHER=10)을 넘기면 서른세 번째 승인의 백오프가 걸린다 --
    e10 = newenv("budget", "eeee2010", "- [ ] 안 한 단계\n", extra="attempts: 10\n")
    r = e10.tick()
    assert r.returncode == 0, "10: tick 실패\n" + r.stderr
    log10 = e10.runner_log()
    assert "FAIL eeee2010" in log10, "10: FAIL이 안 찍혔다\n" + log10
    assert "백오프" in log10, "10: 예산 초과인데 백오프가 안 걸렸다\n" + log10
    assert e10.ls() == ["eeee2010.md"], "10: 열린 이름으로 안 돌아왔다: " + str(e10.ls())
    passed += 1

    # ---- 11. `.wip`을 남긴 갈래(바로 앞 판정, test_wip_after_ok.py)와 안 갈린다 - 여기서는
    #          `.done`으로 안 닫혔으면 이 판정 자체가 안 도는 것만 확인한다 ------------------
    e11 = Env("bare", "ffff2011", "")
    envs.append(e11)
    mkfile(os.path.join(e11.tickets, "ffff2011.md"),
           "---\nticket: ffff2011\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n"
           "\n## 진행 계획\n\n- [ ] 안 한 단계\n")
    bare_engine = mkfile(os.path.join(e11.tmp, "fake-engine.sh"), """\
#!/bin/bash
echo '{"is_error":false,"type":"result","session_id":"sess-x","subtype":"success"}'
exit 0
""", 0o755)
    e11.w1 = mkfile(os.path.join(e11.root, "workers", "w1.sh"),
                     WORKER_TMPL.format(cwd=e11.tmp, engine=bare_engine, tick=TICK), 0o755)
    r = e11.tick()
    assert r.returncode == 0, "11: tick 실패\n" + r.stderr
    log11 = e11.runner_log()
    assert "FAIL ffff2011" in log11, "11: .wip 남은 갈래가 FAIL이 아니다\n" + log11
    assert "계획 상자를 안 켠 채" not in log11, "11: .wip 갈래가 판정 2 문구를 냈다\n" + log11
    assert e11.ls() == ["ffff2011.wip.md"], "11: .wip 파일이 그대로 안 남았다: " + str(e11.ls())
    passed += 1

    print("test_plan_done_revert: {} passed".format(passed))
finally:
    for e in envs:
        e.cleanup()
