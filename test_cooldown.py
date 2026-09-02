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
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime

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

# codex 모양 재현용: 스트리밍 플래그가 없다 - INBOX가 안 뜨고 RC로 판정한다(§4-9 §개정).
WORKER2 = """\
#!/bin/bash
TICKET_NAME="w2"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/codex-engine.sh" "{{sid}}")
. "{tick}"
"""

# 이름이 "claude"인 가짜 엔진(내용은 fake-engine.sh와 같다) - engine_gate_ok()의 claude 전용
# 분기(TOKENF/AUTH 대기)는 ENGINE_NAME이 정확히 "claude"일 때만 돈다(§0-18 §엔진).
WORKER3 = """\
#!/bin/bash
TICKET_NAME="w3"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/claude" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

# 비스트리밍 가짜 엔진: 최상위 `error` 줄 한 개만 내고 죽는다(codex `exec`의 실측 모양).
CODEX_ENGINE = """\
#!/bin/bash
printf '{"type":"error","message":"usage limit reached, try again later"}\\n'
exit 1
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

# 실제 세션은 일을 마친 마지막 동작으로 자기 티켓을 .wip에서 .done으로 스스로 닫고, 그 다음에야
# `result` 줄을 낸다 - tick.sh는 그 rename에 관여하지 않는다(§자리 표 ④, CORE.md §티켓 수명).
# `donedeath`(닫고 죽는 모양)와 보통 성공(`*`) 둘 다 이 동작이 필요해서 함수 하나로 묶는다 -
# 실패 갈래(`api_error`-`limit`-`other`-`grok`-`fp_rotate` 등)는 일을 못 마쳤으니 안 부른다.
# **이름이 아니라 가장 최근에 claim된**(mtime 최신) `.wip.md`를 고른다 - 이 큐엔 이미 self-close한
# 앞선 티켓들의 `.done.md`가 쌓여 있다. tick.sh의 setinbox도 init 직후에 같은 파일에 쓰므로,
# 그 기록(`inbox:`)이 보일 때까지 기다린 뒤에 rename한다 - 안 그러면 setinbox 경합이 생긴다
# (실사고는 세션이 한참 뒤에 죽는 모양이라 이 간극이 실제로는 항상 넓다). 5초(25*0.2)는 부하
# 아래서 setpid+setinbox의 python3 기동 자체가 못 따라온다(2026-09-02: 이 창을 놓쳐 tick.sh의
# setpid/setinbox가 이미 지워진 파일에 쓰다 FileNotFoundError를 냈다) - 60초(300*0.2)로 잡는다.
#
# 이걸 안 부르면(옛 동작) 성공한 티켓의 `.wip.md`가 죽은 세션의 claim인 채로 큐에 남아, 나중
# tick이 그걸 REAP - 재디스패치해 버려서 그 시점에 의도한 다른 티켓(zzzz0005 등)을 밀어낸다 -
# 부하가 낮을 땐 그 전에 테스트가 끝나 안 보이다가, 큐가 바쁠수록(예: load 290대) tick() 한
# 번의 벽시계 시간이 늘어나며 그 REAP 창을 스스로 여는 레이스였다(실측 §⑨·§⑫ 둘 다 이 모양으로
# 죽었다 - 티켓 1d0120f3).
close_self() {{
  wip=$(ls -t "{tmp}/dira/tickets"/*.wip.md 2>/dev/null | head -1)
  i=0
  while [ "$i" -lt 300 ] && ! grep -q '^inbox: ' "$wip" 2>/dev/null; do
    sleep 0.2; i=$((i+1))
  done
  mv "$wip" "${{wip%.wip.md}}.done.md"
}}

case "$(cat "{tmp}/mode")" in
  api_error) printf "$ERR"',"terminal_reason":"api_error","api_error_status":429}}\\n' "$1" ;;
  limit)
    printf '{{"type":"rate_limit_event","rate_limit_info":{{"status":"allowed_warning","resetsAt":%s,"rateLimitType":"five_hour"}}}}\\n' "$(cat "{tmp}/decoy")"
    printf '{{"type":"rate_limit_event","rate_limit_info":{{"status":"rejected","resetsAt":%s,"rateLimitType":"five_hour","overageDisabledReason":"out_of_credits"}}}}\\n' "$(cat "{tmp}/resets")"
    printf "$ERR"',"terminal_reason":"api_error","api_error_status":429}}\\n' "$1" ;;
  bad_request) printf "$ERR"',"terminal_reason":"api_error","api_error_status":400}}\\n' "$1" ;;
  other) printf "$ERR"',"terminal_reason":"aborted_streaming"}}\\n' "$1" ;;
  donedeath)
    # 세션이 자기 손으로 .done rename까지 마친 뒤 죽는 모양(§4-10).
    close_self
    printf "$ERR"',"terminal_reason":"aborted_streaming"}}\\n' "$1" ;;
  grok)
    # grok 모양: is_error true · terminal_reason 키 없음 · errors에 한도 낱말(§4-9 §개정).
    printf '{{"is_error":true,"session_id":"%s","type":"result","errors":["usage limit reached, please retry"]}}\\n' "$1" ;;
  fp_rotate)
    # 티켓 0ae738c3 §검증 케이스 1: result 줄을 내기 전에 계정이 갈린다(딴 워커의 회전을
    # 흉내낸다). tick.sh가 이 세션을 동기로 기다리므로, 이 줄이 먼저 실행된 뒤에야 아래
    # api_error result가 나가고, arm_cdown은 그 뒤에야 불린다 - 순서가 보장된다.
    printf '%s' "$(cat "{tmp}/rotate_to")" > "{tmp}/local/oauth-token"
    printf "$ERR"',"terminal_reason":"api_error","api_error_status":429}}\\n' "$1" ;;
  *)     close_self
         printf '{{"is_error":false,"num_turns":1,"session_id":"%s","type":"result","subtype":"success"}}\\n' "$1" ;;
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
    mkfile(os.path.join(tmp, "codex-engine.sh"), CODEX_ENGINE, 0o755)
    w2 = mkfile(os.path.join(root, "workers", "w2.sh"),
                WORKER2.format(tmp=tmp, tick=TICK), 0o755)
    cool2 = os.path.join(local, "run", "cooldown-codex-engine.sh")
    mkfile(os.path.join(tmp, "claude"), ENGINE.format(tmp=tmp), 0o755)
    w3 = mkfile(os.path.join(root, "workers", "w3.sh"),
                WORKER3.format(tmp=tmp, tick=TICK), 0o755)
    for h in ("aaaa0001", "bbbb0002", "cccc0003", "dddd0004"):
        mkfile(os.path.join(tickets, h + ".md"),
               "---\nticket: {}\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n".format(h))
    OPEN = sorted(h + ".md" for h in ("aaaa0001", "bbbb0002", "cccc0003", "dddd0004"))

    def mode(m):
        mkfile(os.path.join(tmp, "mode"), m + "\n")

    def _refresh_wip():
        # ④에서 DONE된 aaaa0001·bbbb0002는 가짜 엔진이 .done으로 안 닫아 .wip 잔해로 남는다
        # (§89-91 - 그건 세션의 몫이다) - ⑧까지 decoy로 일부러 살려 둔다. 이 파일 자체의 실행이
        # 부하 아래 REAP_GRACE_SEC(180s)를 넘기면, 다음 tick()의 reap()이 죽은 세션으로 보고
        # 되살려 새 티켓의 디스패치 자리를 가로챈다(2026-09-03 load 242 실측: ⑧·⑬에서 각각
        # "DONE dddd0004"·"DONE 3333c003" 대신 aaaa0001의 REAP+DISPATCH+DONE을 봤다). 이 파일은
        # 쿨다운 게이트만 검증하고 reap 자체의 유예 판정은 다른 파일(test_generic.py)이 검증하니,
        # 매 tick 앞에서 남아있는 .wip 전부의 assigned_at을 지금으로 되돌려도 안전하다 - 그 순간
        # 실제로 도는 세션은 없다(직전 tick()이 이미 동기로 끝난 뒤라서).
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        for f_ in os.listdir(tickets):
            if not f_.endswith(".wip.md"):
                continue
            p = os.path.join(tickets, f_)
            with open(p, encoding="utf-8") as fh:
                body = fh.read()
            new_body = re.sub(r"(?m)^assigned_at:.*$", "assigned_at: " + now, body, count=1)
            if new_body != body:
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write(new_body)

    def tick(**over):
        _refresh_wip()
        return subprocess.run([w1, "tick"], capture_output=True, text=True,
                              env=dict(env, **over), timeout=180)

    def tick2(**over):
        _refresh_wip()
        return subprocess.run([w2, "tick"], capture_output=True, text=True,
                              env=dict(env, **over), timeout=180)

    def tick3(**over):
        _refresh_wip()
        return subprocess.run([w3, "tick"], capture_output=True, text=True,
                              env=dict(env, **over), timeout=180)

    def epoch_of(path):
        with open(path, encoding="utf-8") as f:
            return f.read().split("\n")[0].strip()

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
    # ponytail: 가짜 엔진은 스스로 안 끝나므로 실제로 세션을 띄웠으면 180초 타임아웃까지
    # 간다 - SKIP과 DISPATCH의 시간 차는 120초로 갈라도 안전하다. 30초는 이 큐 자체가 여러
    # 워커를 동시에 돌리는 부하 아래서 스케줄링 지연만으로도 넘겼다(2026-09-02 실측 31.6s·
    # 34.6s - 이 tick() 자체가 python3 기동 하나뿐인데도 그 시간이 걸렸다. 5초짜리 옛 값의
    # 실측 5.2s·7.7s는 남겨 둔다).
    assert took < 120, "게이트가 세션을 띄웠다({:.1f}s)".format(took)

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

    # --- ⑥ 토큰이 갈리면 남은 창을 안 기다리고 즉시 재시도한다 ---
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
    # --- ⑦ 모델만 다른 tick은 **남의 창을 못 지운다** ---
    # 창은 이름이 엔진별일 뿐 머신에 하나인데 argv는 큐마다 다르다. 지문이 argv를 물면
    # "지문이 갈리면 푼다"가 남의 창을 지우는 동작이 된다 - 실측 2026-08-05: `--model sonnet`인
    # dira와 모델 플래그가 없는 stream이 서로의 창을 1분마다 풀어서, 16:30까지 닫혀 있어야 할
    # 창에서 같은 티켓을 27번 태웠다. 모델을 갈아도 5시간 리밋은 계정에 걸린 채다.
    before = len(log())
    tick(EXTRA="--model opus")                  # 모델이 다른 큐가 같은 창을 만난다
    added = log()[before:]
    assert "NOTE 엔진 쿨다운 해제" not in added, "모델만 갈렸는데 남의 창을 지웠다:\n" + added
    assert "SKIP 엔진 쿨다운" in added, "모델이 다른 큐가 창을 안 지킨다:\n" + added
    assert cooldown() == str(resets), "창이 짧아졌다(재무장까지 갔다)"

    # --- ⑧ 세션이 .done으로 닫은 뒤 죽으면: FAIL이 아니라 DONE(...세션은 rc=... 죽었다) (§4-10) ---
    # ⑦이 남긴 창(2시간짜리 resets)부터 지운다 - 지문은 그대로 두고 만료만 시킨다.
    mode("donedeath")
    expire()
    before = len(log())
    r = tick()  # 남은 열린 티켓은 dddd0004 하나 - donedeath 엔진이 그 .wip.md를 스스로 닫는다
    added = log()[before:]
    assert "FAIL dddd0004" not in added, "닫힌 티켓인데 FAIL로 기록됐다:\n" + added
    assert "DONE dddd0004 sid=" in added and "(세션은 rc=" in added and "로 죽었다)" in added, \
        "DONE ...세션은 rc=...로 죽었다 표기가 없다:\n" + added
    assert "Traceback" not in (r.stderr or ""), "clear의 traceback이 stderr에 남았다:\n" + r.stderr
    assert r.returncode == 0, "rc가 정상이 아니다: {}".format(r.returncode)
    assert "dddd0004.done.md" in ls(), "티켓이 .done으로 안 남았다: " + str(ls())

    # ④에서 DONE된 aaaa0001·bbbb0002는 가짜 엔진이 .done으로 안 닫아 .wip 잔해로 남는다(§자리
    # 표 ④ 주석, §72-92 - 그건 세션의 몫이다). ⑧의 "최근 claim" 선택 decoy로 쓸모를 다했다 -
    # 안 치우면 REAP_GRACE_SEC(180s)를 넘긴 뒤 tick()의 reap()이 되살려, 부하로 전체 실행이
    # 길어질 때 뒤 절의 새 티켓 디스패치 자리를 가로챈다(2026-09-03 실측: load 242에서 ⑬가
    # "DONE 3333c003" 대신 REAP+DISPATCH+DONE aaaa0001을 봤다).
    for h in ("aaaa0001", "bbbb0002"):
        for f_ in os.listdir(tickets):
            if f_.startswith(h):
                os.remove(os.path.join(tickets, f_))

    # --- ⑨ grok 모양: result.is_error + errors에 한도 낱말, terminal_reason 키 없음 -> 쿨다운 ---
    mkfile(os.path.join(tickets, "zzzz0005.md"),
           "---\nticket: zzzz0005\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")
    mode("grok")
    expire()  # ⑧의 claim이 나가면서 창을 now+300으로 재무장했다(§자리 - 파일이 있으면 무조건) - 지운다
    before = len(log())
    t0 = int(time.time())
    tick()
    t1 = int(time.time())
    added = log()[before:]
    assert "FAIL zzzz0005" in added, "grok 모양이 FAIL로 안 떨어졌다:\n" + added
    assert t0 + W <= int(cooldown()) <= t1 + W, \
        "grok 모양(errors에 한도 낱말)인데 쿨다운이 안 걸렸다: {}\n".format(cooldown()) + log()
    # scan()은 생성시각(birth) 오름차순이라 이름이 아니라 만든 순서가 우선이다 - FAIL로 되돌아온
    # 이 티켓을 치우지 않으면 ⑩에서 codex 엔진보다 먼저 다시 집힌다.
    os.remove(os.path.join(tickets, "zzzz0005.md"))

    # --- ⑩ codex 모양: 최상위 error 줄 + usage limit 문자열, rc!=0(비스트리밍) -> 쿨다운 ---
    mkfile(os.path.join(tickets, "ffff0006.md"),
           "---\nticket: ffff0006\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")
    before = len(log())
    t0 = int(time.time())
    tick2()
    t1 = int(time.time())
    added = log()[before:]
    assert "FAIL ffff0006" in added, "codex 모양이 FAIL로 안 떨어졌다:\n" + added
    assert os.path.exists(cool2), "codex 모양(최상위 error+usage limit)인데 쿨다운이 안 걸렸다\n" + log()
    assert t0 + W <= int(epoch_of(cool2)) <= t1 + W, \
        "codex 쿨다운 창이 now+{}가 아니다: {}".format(W, epoch_of(cool2))

    # --- ⑪ 멀티플레잉(§0-18): TICKET_SLOT 없으면 claude 엔진 경로가 오늘과 글자 그대로 같다 ---
    # ⑩이 FAIL로 되돌린 ffff0006이 아직 열려 있다 - 안 지우면 birth 순서상 그게 먼저 집힌다.
    os.remove(os.path.join(tickets, "ffff0006.md"))
    claude_cool = os.path.join(local, "run", "cooldown-claude")
    mode("ok")
    mkfile(os.path.join(tickets, "1111a001.md"),
           "---\nticket: 1111a001\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")
    before = len(log())
    tick3()
    added = log()[before:]
    assert "DONE 1111a001" in added, "슬롯 없는 claude 경로가 안 돈다:\n" + added
    assert "SKIP AUTH 대기" not in added, "슬롯 없는데 종전 토큰 파일을 못 읽었다:\n" + added

    # --- ⑫ TICKET_SLOT=9f2c1a: 토큰·쿨다운 파일이 그 슬롯 하나로 갈린다(§검증 2) ---
    slot = "9f2c1a"
    slot_token = os.path.join(local, "oauth-token-" + slot)
    slot_cool = os.path.join(local, "run", "cooldown-claude-" + slot)
    mkfile(slot_token, "tok-slot")
    mode("api_error")
    mkfile(os.path.join(tickets, "2222b002.md"),
           "---\nticket: 2222b002\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")
    before = len(log())
    tick3(TICKET_SLOT=slot)
    added = log()[before:]
    assert "FAIL 2222b002" in added, "슬롯 있는 claude 경로가 안 돌았다:\n" + added
    assert os.path.exists(slot_cool), "슬롯 쿨다운 파일이 슬롯 경로(" + slot_cool + ")에 안 생겼다"
    assert not os.path.exists(claude_cool) or epoch_of(claude_cool) != epoch_of(slot_cool), \
        "슬롯 쿨다운이 종전 경로(cooldown-claude)와 같은 창을 걸었다"

    # --- ⑬ 슬롯이 다른 워커 둘 중 하나가 쿨다운에 걸려도 다른 하나는 안 막힌다(§검증 3) ---
    # ⑫가 FAIL로 되돌린 2222b002가 아직 열려 있다 - 안 지우면 그게 먼저 집힌다.
    os.remove(os.path.join(tickets, "2222b002.md"))
    slot2 = "aa11bb22"
    mkfile(os.path.join(local, "oauth-token-" + slot2), "tok-slot2")
    mode("ok")
    mkfile(os.path.join(tickets, "3333c003.md"),
           "---\nticket: 3333c003\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")
    before = len(log())
    tick3(TICKET_SLOT=slot2)
    added = log()[before:]
    assert "SKIP 엔진 쿨다운" not in added, "슬롯이 다른데 남의 쿨다운에 막혔다:\n" + added
    assert "DONE 3333c003" in added, "슬롯2가 디스패치되지 않았다:\n" + added

    # --- ⑭ 세션이 도는 동안 계정이 갈려도 쿨다운 지문은 그 세션이 실제로 쓴 계정(A)의 것이다
    #      (요구 74d9ac39, 티켓 0ae738c3 - 늦은 보고가 다음 계정을 태우는 사고의 재현) ---
    import hashlib

    def fp(raw):
        return hashlib.sha1(raw).hexdigest()[:12]

    def cooldown_fp():
        with open(cool, encoding="utf-8") as f:
            return f.read().split("\n")[1]

    for f_ in os.listdir(tickets):          # 이전 케이스의 잔여 상태를 안 물려받는다
        if not f_.endswith(".done.md"):
            os.remove(os.path.join(tickets, f_))
    if os.path.exists(cool):
        os.remove(cool)
    mkfile(os.path.join(tickets, "5555e005.md"),
           "---\nticket: 5555e005\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")

    mkfile(token, "tok-A")                              # 세션을 계정 A로 내보낸다
    fp_a, fp_b = fp(b"tok-A"), fp(b"tok-B")
    assert fp_a != fp_b, "테스트 픽스처 결함: A·B 지문이 같다"
    mkfile(os.path.join(tmp, "rotate_to"), "tok-B")      # 도는 동안 갈아 끼울 계정
    mode("fp_rotate")
    before = len(log())
    tick()
    added = log()[before:]
    assert "FAIL 5555e005" in added, "회전 시나리오가 FAIL로 안 떨어졌다:\n" + added
    with open(token, encoding="utf-8") as f_:
        assert f_.read() == "tok-B", "엔진이 도는 중에 토큰을 못 갈았다(테스트 결함)"
    got = cooldown_fp()
    assert got == fp_a, \
        "쿨다운 지문이 세션이 실제로 쓴 계정(A)이 아니다: {} (fp(A)={}, fp(B)={})".format(
            got, fp_a, fp_b)

    # --- ⑮ 재시도해도 안 낫는 요청 오류(4xx)는 창을 안 건다 ---
    # api_error_status가 400이면 5분 뒤 같은 요청을 다시 보내도 같은 자리에서 같이 죽는다.
    # 그때 창을 걸면 워커 전부가 게이트에서 막히고, 만료 직전 나간 워커가 또 같은 400을 받아
    # 창을 되감는다(2026-08-28 실사고: cache_control 5개 400 하나가 큐를 6시간 세웠다).
    # 창 없이 평범한 FAIL이어야 한다 - 티켓은 열림으로 돌아오고 다음 tick이 막히지 않는다.
    for f_ in os.listdir(tickets):
        if not f_.endswith(".done.md"):
            os.remove(os.path.join(tickets, f_))
    if os.path.exists(cool):
        os.remove(cool)
    mkfile(token, "tok-A")
    mkfile(os.path.join(tickets, "6666f006.md"),
           "---\nticket: 6666f006\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")
    mode("bad_request")
    before = len(log())
    tick()
    added = log()[before:]
    assert not os.path.exists(cool), \
        "요청 오류(400)인데 쿨다운을 걸었다 - 다음 워커까지 같이 막힌다:\n" + added
    assert "FAIL 6666f006" in added, "요청 오류가 FAIL로 안 떨어졌다:\n" + added
    assert "6666f006.md" in ls(), "티켓이 열림으로 안 돌아왔다: " + str(ls())
    # 사람이 로그만 보고도 "엔진이 아니라 요청이 틀렸다"를 알아야 한다.
    assert "요청 오류" in added, "요청 오류를 알리는 줄이 없다:\n" + added
    # 뒤이은 tick이 게이트에 안 막힌다(같은 400을 또 받아도 그건 창이 아니라 그 세션의 실패다).
    before = len(log())
    tick()
    assert "SKIP 엔진 쿨다운" not in log()[before:], \
        "요청 오류 뒤 다음 tick이 쿨다운 게이트에 막혔다:\n" + log()[before:]

    print("OK - 엔진 쿨다운 (복귀 시각 · 게이트 · 재무장 · 토큰 교체 해제 · 모델 교체는 안 푼다 · "
          ".done 뒤 죽은 세션 · codex/grok 한도 판정 · TICKET_SLOT이 토큰·쿨다운을 같이 가른다 · "
          "재시도해도 안 낫는 4xx는 창을 안 건다)")
finally:
    subprocess.run(["pkill", "-f", os.path.join(tmp, "fake-engine.sh")], capture_output=True)
    subprocess.run(["pkill", "-f", os.path.join(tmp, "codex-engine.sh")], capture_output=True)
    subprocess.run(["pkill", "-f", os.path.join(tmp, "claude")], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
