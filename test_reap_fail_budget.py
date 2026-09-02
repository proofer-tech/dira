#!/usr/bin/env python3
"""`tick.sh`의 FAIL 경로가 사유별 회수 예산을 태우고, 넘긴 티켓이 사유로 갈린다(P362-2).
자체검증 - 실패하면 assert로 죽는다.

`reap_release(path, reason)`의 `reason`은 이 세션 자신의 판정(tick.sh REASON/VERDICT/RC)이라
runner.log 재파싱이 없다 - 그래서 이 파일은 `dead_reason`용 로그를 안 만들고 reason을 직접
넘긴다(P360-4 계열 test_reap_limit_attempts.py와 다른 자리 - 그 파일은 `reclaim`을 문다).

다섯 - (A) FAIL(is_error)이 attempts를 올린다, (B) TIMEOUT도 같은 "other" 사유로 올린다,
(C) api_error·killed는 attempts를 안 올린다, (D) bad_request가 예산을 넘기면 답변 대기,
(E) 그 밖의 사유가 예산을 넘기면 백오프를 걸고(`select`가 그동안 후보에서 뺀다), 백오프
상한을 넘기면 종전대로(백오프 없이) 다시 뜬다.
"""
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T


def mk(troot, h, fm_lines, body="## Goal\n테스트\n\n## Done when\n- [ ] 하나\n"):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\n{}\n---\n\n{}".format(h, "\n".join(fm_lines), body))
    return p


ws = tempfile.mkdtemp()
local = tempfile.mkdtemp()
try:
    # A) FAIL(is_error) - reason="other", attempts 0 -> 1
    pa = mk(ws, "aaaa1111", ["attempts: 0"])
    out = T.reap_release(pa, "other", local=local)
    assert out.startswith("REAP aaaa1111 attempts=1 - other"), \
        "A: FAIL이 attempts를 안 올렸다\n" + out
    aopen = os.path.join(ws, "tickets/aaaa1111.md")
    assert T.read_fm(aopen)[0]["attempts"].strip() == "1", "A: attempts 기록이 다르다"

    # B) TIMEOUT도 같은 "other" 사유다(tick.sh DEATH_KIND가 FAIL·TIMEOUT을 하나로 묶는다) -
    #    attempts를 올린다.
    pb = mk(ws, "bbbb2222", ["attempts: 1"])
    out = T.reap_release(pb, "other", local=local)
    assert out.startswith("REAP bbbb2222 attempts=2 - other"), \
        "B: TIMEOUT이 attempts를 안 올렸다\n" + out

    # C) api_error(한도)·killed(밖에서 끊김 - 선점 포함)는 attempts를 안 쓴다.
    pc1 = mk(ws, "cccc3333", ["attempts: 1"])
    out = T.reap_release(pc1, "api_error", local=local)
    assert out == "", "C1: api_error인데 REAP/ASK 메시지를 냈다\n" + out
    assert T.read_fm(os.path.join(ws, "tickets/cccc3333.md"))[0]["attempts"].strip() == "1", \
        "C1: api_error가 attempts를 건드렸다"

    pc2 = mk(ws, "dddd4444", ["attempts: 1"])
    out = T.reap_release(pc2, "killed", local=local)
    assert out == "", "C2: killed인데 REAP/ASK 메시지를 냈다\n" + out
    assert T.read_fm(os.path.join(ws, "tickets/dddd4444.md"))[0]["attempts"].strip() == "1", \
        "C2: killed가 attempts를 건드렸다"

    # D) bad_request 예산(REAP_FAIL_BUDGET_BAD_REQUEST)을 넘기면 답변 대기로 올린다.
    pd = mk(ws, "eeee5555", ["attempts: " + str(T.REAP_FAIL_BUDGET_BAD_REQUEST)])
    out = T.reap_release(pd, "bad_request", local=local)
    assert out.startswith("ASK eeee5555"), "D: bad_request 예산 초과인데 상신 안 함\n" + out
    edir = os.path.join(ws, "tickets")
    assert os.path.exists(os.path.join(edir, "eeee5555.md")), "D: 답변 요청 티켓이 안 열렸다"
    efm = T.read_fm(os.path.join(edir, "eeee5555.md"))[0]
    assert (efm.get("awaiting") or "").strip(), "D: awaiting이 안 걸렸다"

    # bad_request가 예산 밑이면 종전처럼 백로그 복귀만 한다(상신 없음) - 회귀 방지.
    pd2 = mk(ws, "ffff6666", ["attempts: 0"])
    out = T.reap_release(pd2, "bad_request", local=local)
    assert out.startswith("REAP ffff6666 attempts=1 - bad_request"), \
        "D2: bad_request가 예산 안인데 상신했다\n" + out

    # E) 그 밖의 사유(other)가 예산(REAP_FAIL_BUDGET_OTHER)을 넘기면 백오프를 걸고, 티켓은
    #    열림 상태 그대로다(잠그지 않는다) - `select`가 그 동안 후보에서 뺀다.
    pe = mk(ws, "gggg7777", ["attempts: " + str(T.REAP_FAIL_BUDGET_OTHER)])
    out = T.reap_release(pe, "other", local=local)
    assert "백오프" in out, "E: other 예산 초과인데 백오프를 안 걸었다\n" + out
    gopen = os.path.join(ws, "tickets/gggg7777.md")
    assert os.path.exists(gopen), "E: 백오프가 걸렸는데 티켓이 안 열렸다(잠기면 안 된다)"
    assert not T.read_fm(gopen)[0].get("deps"), "E: 백오프가 deps로 잠갔다 - 열림이어야 한다"
    assert T.backoff_active(local, "gggg7777"), "E: 백오프 표식이 안 걸렸다"

    # 다른 티켓(정상)은 같은 select 후보 목록에서 그대로 나오고, 백오프 걸린 티켓만 빠진다.
    mk(ws, "hhhh8888", ["priority: 1"])
    env = dict(os.environ, TICKET_LOCAL=local)
    out = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "tickets.py"), "select", ws],
                         capture_output=True, text=True, env=env, timeout=30).stdout
    assert "hhhh8888" in out, "E: 정상 티켓이 select 후보에서 빠졌다\n" + out
    assert "gggg7777" not in out, "E: 백오프 걸린 티켓이 select 후보에 그대로 나온다\n" + out

    # 백오프 상한(REAP_BACKOFF_CAP)을 넘기면 표식이 지워지고, 종전대로(백오프 없이) 다시 뜬다.
    for _ in range(T.REAP_BACKOFF_CAP - 1):
        T._arm_backoff(local, "gggg7777")
    assert T.backoff_active(local, "gggg7777"), "E: 상한 전인데 이미 풀렸다"
    assert T._arm_backoff(local, "gggg7777") is None, "E: 상한을 넘겼는데 다시 백오프를 걸었다"
    assert not T.backoff_active(local, "gggg7777"), \
        "E: 상한을 넘겼는데 여전히 백오프 상태다 - 종전대로 안 돌아왔다"
    out = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "tickets.py"), "select", ws],
                         capture_output=True, text=True, env=env, timeout=30).stdout
    assert "gggg7777" in out, "E: 상한을 넘겼는데도 select 후보에 안 돌아왔다\n" + out

    print("PASS 5/5 - A(FAIL attempts+1) B(TIMEOUT attempts+1) C(api_error/killed 무변) "
          "D(bad_request 예산 초과 -> ASK) E(other 예산 초과 -> 백오프, select 제외, 상한 넘으면 복귀)")
finally:
    shutil.rmtree(ws, ignore_errors=True)
    shutil.rmtree(local, ignore_errors=True)
