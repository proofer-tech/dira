#!/usr/bin/env python3
"""엔진 불능 쿨다운 자체검증: 리밋·네트워크로 엔진이 죽으면 디스패치가 멈추는가.

2026-08-04 실측 재현: 엔진이 불능인 5.1시간 동안 워커 8이 1,648회를 헛디스패치했고(전체
디스패치의 86%), 그 13초짜리 세션들이 티켓을 진행중↔대기로 왕복시키며 세션 로그 170.2MB를
썼다. 판정 값은 `result` 줄의 `terminal_reason`이다 - `api_error_status`로는 못 가른다
(429가 아닌 ENOTFOUND 103건엔 그 키가 없는데 똑같이 불능이다).

기다리는 길이는 리밋이 알려준 복귀 시각(`rate_limit_event`의 `resetsAt`)이고, 그 값이 없으면
300초다(실측: api_error 로그 1,987건 중 1,587건이 `status: rejected`인 resetsAt을 들고 있고,
앞으로 p50 2.7시간·max 4.2시간이다). 사람이 계정이나 모델을 갈면 그 창은 즉시 풀린다.

진짜 claude를 부르지 않는다 -- 프롬프트를 받아 적고 지정된 줄을 뱉은 뒤 스스로는 안 끝나는
가짜 스트림 엔진으로 판정한다(그게 실측된 진짜 엔진의 행동이다).
실패하면 assert로 죽는다.
"""
import os
import shutil
import subprocess
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

W = 300  # tick.sh의 CDOWN_W. 사람이 승인한 값이라 테스트도 그 수를 안다.

WORKER = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/fake-engine.sh" "{{sid}}" "--input-format" "stream-json" $EXTRA)
. "{tick}"
"""

# 가짜 스트림 엔진. `mode` 파일이 갈래를 정한다:
#   api_error = 복귀 시각을 안 주는 불능(네트워크 실패)  |  limit = 리밋이 복귀 시각을 준 불능
#   other     = 진짜 세션 실패                          |  ok    = 정상 완료
# limit 갈래는 `allowed_warning` 이벤트를 미끼로 먼저 흘린다 - 그건 아직 통과한 요청이라
# 그 resetsAt을 물면 안 된다(실측 1,058건이 그 모양으로 온다).
# `exec`는 필수다 - 없으면 bash 래퍼 + 자식 sleep 두 개가 되어 tick.sh의 kill이 래퍼만 죽이고
# 고아 sleep이 워커의 stdout을 60초 더 쥔다(test_feed_stall.py가 그 함정을 실측해 뒀다).
ENGINE = """\
#!/bin/bash
IFS= read -r _first
printf '{{"type":"system","subtype":"init"}}\\n'
ERR='{{"is_error":true,"session_id":"%s","type":"result","subtype":"error_during_execution"'
case "$(cat "{tmp}/mode")" in
  api_error) printf "$ERR"',"terminal_reason":"api_error","api_error_status":429}}\\n' "$1" ;;
  limit)
    printf '{{"type":"rate_limit_event","rate_limit_info":{{"status":"allowed_warning","resetsAt":%s,"rateLimitType":"five_hour"}}}}\\n' "$(cat "{tmp}/decoy")"
    printf '{{"type":"rate_limit_event","rate_limit_info":{{"status":"rejected","resetsAt":%s,"rateLimitType":"five_hour","overageDisabledReason":"out_of_credits"}}}}\\n' "$(cat "{tmp}/resets")"
    printf "$ERR"',"terminal_reason":"api_error","api_error_status":429}}\\n' "$1" ;;
  other) printf "$ERR"',"terminal_reason":"aborted_streaming"}}\\n' "$1" ;;
  *)     printf '{{"is_error":false,"num_turns":1,"session_id":"%s","type":"result","subtype":"success"}}\\n' "$1" ;;
esac
exec sleep 60
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    env = dict(os.environ, TICKET_LOCAL=local, EXTRA="")
    cool = os.path.join(local, "run", "cooldown-fake-engine.sh")
    token = os.path.join(local, "oauth-token")
    tickets = os.path.join(root, "tickets")
    runlog = os.path.join(root, "workers", "runner.log")

    mkfile(token, "tok-1")
    mkfile(os.path.join(tmp, "fake-engine.sh"), ENGINE.format(tmp=tmp), 0o755)
    w1 = mkfile(os.path.join(root, "workers", "w1.sh"),
                WORKER.format(tmp=tmp, tick=TICK), 0o755)
    for h in ("aaaa0001", "bbbb0002", "cccc0003", "dddd0004"):
        mkfile(os.path.join(tickets, h + ".md"),
               "---\nticket: {}\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n".format(h))
    OPEN = sorted(h + ".md" for h in ("aaaa0001", "bbbb0002", "cccc0003", "dddd0004"))

    def mode(m):
        mkfile(os.path.join(tmp, "mode"), m + "\n")

    def tick(**over):
        return subprocess.run([w1, "tick"], capture_output=True, text=True,
                              env=dict(env, **over), timeout=180)

    def log():
        try:
            with open(runlog, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def ls():
        return sorted(os.listdir(tickets))

    def cooldown():
        with open(cool, encoding="utf-8") as f:
            return f.read().split("\n")[0].strip()

    def expire():
        """만료된 창을 만든다. 엔진 지문은 그대로 둔다 - 갈면 ⑥의 갈래를 재게 된다."""
        with open(cool, encoding="utf-8") as f:
            fp = f.read().split("\n")[1]
        mkfile(cool, "{}\n{}\n".format(int(time.time()) - 1, fp))

    # --- ① 복귀 시각 없는 불능: 티켓은 열림으로 돌아오고 쿨다운에 now+300이 남는다 ---
    mode("api_error")
    assert not os.path.exists(cool), "시작부터 쿨다운 파일이 있다"
    t0 = int(time.time())
    tick()
    t1 = int(time.time())
    assert os.path.exists(cool), "불능 result인데 쿨다운을 안 걸었다\n" + log()
    assert t0 + W <= int(cooldown()) <= t1 + W, \
        "복귀 시각이 없으면 now+{}여야 한다: {} (now={})".format(W, cooldown(), t1)
    assert ls() == OPEN, "티켓이 열림으로 안 돌아왔다: " + str(ls())
    assert "FAIL aaaa0001" in log(), log()

    # --- ② 창이 살아 있는 동안: claim 자체가 안 일어난다(.wip이 안 생긴다) + SKIP 한 줄 ---
    armed = cooldown()
    before = len(log())
    began = time.time()
    tick()
    took = time.time() - began
    added = log()[before:]
    assert ls() == OPEN, "쿨다운 중에 티켓을 건드렸다: " + str(ls())
    assert added.count("SKIP 엔진 쿨다운") == 1, "SKIP 한 줄이 아니다:\n" + added
    assert "DISPATCH" not in added, "쿨다운 중에 디스패치했다:\n" + added
    assert cooldown() == armed, "게이트가 창을 다시 감았다(재무장은 통과할 때만이다)"
    assert took < 5, "게이트가 세션을 띄웠다({:.1f}s)".format(took)

    # --- ③ 만료 뒤: 딱 한 번 통과하고, 나가면서 창을 now+300으로 다시 감는다 ---
    # 재무장만 따로 보려고 여기서는 api_error가 아닌 실패를 쓴다 - api_error면 ④의 기록과
    # 구분이 안 된다. 재무장이 없으면 워커 8이 같은 창에서 한꺼번에 나가 8회가 또 돈다.
    mode("other")
    expire()
    before = len(log())
    t0 = int(time.time())
    tick()
    t1 = int(time.time())
    added = log()[before:]
    assert "DISPATCH aaaa0001" in added, "만료됐는데 안 나갔다:\n" + added
    assert "SKIP 엔진 쿨다운" not in added, "만료된 창이 막았다:\n" + added
    assert os.path.exists(cool), "나가면서 창을 다시 안 감았다"
    assert t0 + W <= int(cooldown()) <= t1 + W, \
        "재무장 값이 now+{}가 아니다: {}".format(W, cooldown())
    before = len(log())
    tick()
    assert "SKIP 엔진 쿨다운" in log()[before:], "재무장한 창이 안 막는다:\n" + log()[before:]

    # --- ④ 정상 result면 파일이 지워지고, 파일이 없는 상태의 tick은 파일을 만들지 않는다 ---
    mode("ok")
    expire()
    before = len(log())
    tick()
    added = log()[before:]
    assert "DONE aaaa0001" in added, "정상 result인데 DONE이 아니다:\n" + added
    assert not os.path.exists(cool), "정상 완료인데 쿨다운이 남았다: " + cooldown()

    before = len(log())
    tick()
    added = log()[before:]
    assert "DONE bbbb0002" in added, "쿨다운 없는 상태에서 디스패치가 안 됐다:\n" + added
    assert not os.path.exists(cool), "정상 상태의 tick이 쿨다운 파일을 만들었다"

    # --- ⑤ 리밋이 복귀 시각을 주면 300초가 아니라 그 시각까지 기다린다 ---
    resets = int(time.time()) + 7200
    mkfile(os.path.join(tmp, "resets"), str(resets))
    mkfile(os.path.join(tmp, "decoy"), str(resets + 99999))   # allowed_warning = 물면 안 된다
    mode("limit")
    before = len(log())
    tick()
    added = log()[before:]
    assert "FAIL cccc0003" in added, "리밋 실패가 FAIL로 안 떨어졌다:\n" + added
    assert cooldown() == str(resets), \
        "복귀 시각을 안 썼다: {} (기대 {}, 미끼 {})".format(cooldown(), resets, resets + 99999)
    before = len(log())
    tick()
    assert "SKIP 엔진 쿨다운" in log()[before:], "복귀 시각 창이 안 막는다"

    # --- ⑥ 토큰·모델이 갈리면 남은 창을 안 기다리고 즉시 재시도한다 ---
    mode("ok")
    mkfile(token, "tok-2")                      # 사람이 계정을 바꿨다
    before = len(log())
    tick()
    added = log()[before:]
    assert "NOTE 엔진 쿨다운 해제" in added, "토큰이 갈렸는데 안 풀렸다:\n" + added
    assert "DONE " in added, "쿨다운을 풀고도 디스패치를 안 했다:\n" + added
    assert not os.path.exists(cool), "푼 쿨다운 파일이 남았다"

    mode("limit")
    tick()
    assert cooldown() == str(resets), "다시 걸린 창이 없다"
    before = len(log())
    tick(EXTRA="--model opus")                  # 사람이 모델을 갈았다
    added = log()[before:]
    assert "NOTE 엔진 쿨다운 해제" in added, "모델이 갈렸는데 안 풀렸다:\n" + added

    print("OK - 엔진 쿨다운 (복귀 시각 · 게이트 · 재무장 · 해제 · 토큰/모델 교체)")
finally:
    subprocess.run(["pkill", "-f", os.path.join(tmp, "fake-engine.sh")], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
