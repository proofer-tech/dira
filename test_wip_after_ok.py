#!/usr/bin/env python3
"""엔진 수정 서른네 번째 승인 §판정 2 자체검증 - 수용조건 8~11.
`result` 줄이 `ok`로 끝나도 티켓이 `.wip`으로 남아 있으면 `DONE`이 아니다. 진짜 claude를
부르지 않는다 - 세션의 파일 조작(닫기 / 블록 남기기 / unassign / 아무 것도 안 하기)만
흉내내는 가짜 엔진 하나로 tick.sh의 종료 로그 분기를 본다. 실패하면 assert로 죽는다."""
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

# 비스트리밍 가짜 엔진(test_polling.py FAKE_ENGINE과 같은 모양) - `mode` 파일이 세션이 죽기
# 전에 자기 `.wip` 파일에 하는 손질을 가른다. 셋 다 result는 `is_error:false`(ok)로 낸다.
ENGINE = """\
#!/bin/bash
wip=$(ls "{tickets}"/*.wip.md 2>/dev/null | head -1)
case "$(cat "{modef}")" in
  closed)     mv "$wip" "${{wip%.wip.md}}.done.md" ;;
  block)      printf '\\n## 블록\\n\\n사람 확인 필요\\n' >> "$wip" ;;
  unassigned) mv "$wip" "{tickets}/$(basename "${{wip%.wip.md}}.md")" ;;
  bare)       : ;;
esac
echo '{{"is_error":false,"type":"result","session_id":"sess-x","subtype":"success"}}'
exit 0
"""

BODY = "---\nticket: {h}\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n"


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


class Env:
    """티켓 하나 + 워커 하나짜리 격리 환경. 시나리오마다 새로 만든다."""

    def __init__(self, tag, h):
        self.tmp = tempfile.mkdtemp(prefix="wipafterok-" + tag + "-")
        self.root = os.path.join(self.tmp, "dira")
        self.local = os.path.join(self.tmp, "local")
        self.tickets = os.path.join(self.root, "tickets")
        os.makedirs(self.local)
        self.h = h
        mkfile(os.path.join(self.tickets, h + ".md"), BODY.format(h=h))
        self.modef = mkfile(os.path.join(self.tmp, "mode"), "bare\n")
        engine = mkfile(os.path.join(self.tmp, "fake-engine.sh"),
                         ENGINE.format(tickets=self.tickets, modef=self.modef), 0o755)
        self.w1 = mkfile(os.path.join(self.root, "workers", "w1.sh"),
                          WORKER_TMPL.format(cwd=self.tmp, engine=engine, tick=TICK), 0o755)
        self.env = dict(os.environ, TICKET_LOCAL=self.local)

    def mode(self, m):
        mkfile(self.modef, m + "\n")

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

    def cleanup(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


envs = []


def newenv(tag, h):
    e = Env(tag, h)
    envs.append(e)
    return e


passed = 0
try:
    # ---- 8. 세션이 .done rename까지 마치고 ok로 끝나면 로그가 종전대로 DONE이다 ----------
    e8 = newenv("closed", "aaaa1008")
    e8.mode("closed")
    r = e8.tick()
    assert r.returncode == 0, "8: tick 실패\n" + r.stderr
    log8 = e8.runner_log()
    assert "DONE aaaa1008" in log8, "8: DONE이 안 찍혔다\n" + log8
    assert "FAIL aaaa1008" not in log8, "8: 닫힌 티켓인데 FAIL이 찍혔다\n" + log8
    assert e8.ls() == ["aaaa1008.done.md"], "8: 파일이 안 닫힌 채 남았다: " + str(e8.ls())
    passed += 1

    # ---- 9. ok로 끝났는데 .wip이 남고 신선한 블록이 없으면 FAIL이다 ----------------------
    e9 = newenv("bare", "bbbb1009")
    e9.mode("bare")
    r = e9.tick()
    assert r.returncode == 0, "9: tick 실패\n" + r.stderr  # 종료코드는 이 승인이 안 건드린다
    log9 = e9.runner_log()
    assert "FAIL bbbb1009" in log9, "9: FAIL이 안 찍혔다\n" + log9
    assert "DONE bbbb1009" not in log9, "9: FAIL 갈래인데 DONE도 찍혔다\n" + log9
    assert e9.ls() == ["bbbb1009.wip.md"], "9: .wip 파일이 그대로 안 남았다: " + str(e9.ls())
    passed += 1

    # ---- 10. 같은 자리에 신선한 블록이 있으면 종전 그대로다(FAIL이 아니다) ----------------
    e10 = newenv("block", "cccc1010")
    e10.mode("block")
    r = e10.tick()
    assert r.returncode == 0, "10: tick 실패\n" + r.stderr
    log10 = e10.runner_log()
    assert "DONE cccc1010" in log10, "10: 신선한 블록인데 DONE이 안 찍혔다\n" + log10
    assert "FAIL cccc1010" not in log10, "10: 신선한 블록인데 FAIL이 찍혔다\n" + log10
    assert e10.ls() == ["cccc1010.wip.md"], "10: .wip 파일이 그대로 안 남았다: " + str(e10.ls())
    passed += 1

    # ---- 11. `## 질문 n` + unassign으로 끝난 세션은 FAIL이 아니다(그 시점에 .wip이 없다) --
    e11 = newenv("unassigned", "dddd1011")
    e11.mode("unassigned")
    r = e11.tick()
    assert r.returncode == 0, "11: tick 실패\n" + r.stderr
    log11 = e11.runner_log()
    assert "DONE dddd1011" in log11, "11: unassign 뒤인데 DONE이 안 찍혔다\n" + log11
    assert "FAIL dddd1011" not in log11, "11: unassign 뒤인데 FAIL이 찍혔다\n" + log11
    assert e11.ls() == ["dddd1011.md"], "11: 열린 형태로 안 돌아왔다: " + str(e11.ls())
    passed += 1

    print("test_wip_after_ok: {} passed".format(passed))
finally:
    for e in envs:
        e.cleanup()
