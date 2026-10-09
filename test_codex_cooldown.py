#!/usr/bin/env python3
"""codex 한도 복귀 시각 읽기와 엔진별 쿨다운 지문 자체검증(DESIGN.md §Codex 계정 한도 계약 1-2).

가짜 엔진(`codex`, `claude`)이 `msg` 파일 내용을 최상위 error 줄로 내고 rc 1로 죽는다.
실패하면 assert로 죽는다.
"""
import json
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
W = 300

ENGINE = """\
#!/bin/bash
printf '{{"type":"error","message":%s}}\\n' "$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read().strip()))' "{tmp}/msg")"
exit 1
"""
WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/{name}" "{{sid}}")
. "{tick}"
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


def at(h, m, ampm, now):
    """독립 계산: 지금 이후 처음 오는 로컬 h:m 시각의 epoch."""
    h24 = {("12", "AM"): 0, ("12", "PM"): 12}.get((str(h), ampm), h + (12 if ampm == "PM" else 0))
    t = now.replace(hour=h24, minute=m, second=0, microsecond=0)
    if t <= now:
        t += timedelta(days=1)
    return int(t.timestamp())


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    env = dict(os.environ, TICKET_LOCAL=local)
    env.pop("CODEX_HOME", None)
    run = os.path.join(local, "run")
    runlog = os.path.join(root, "workers", "runner.log")
    tickets = os.path.join(root, "tickets")
    workers = {}
    for n in ("codex", "claude"):
        mkfile(os.path.join(tmp, n), ENGINE.format(tmp=tmp), 0o755)
        workers[n] = mkfile(os.path.join(root, "workers", n + ".sh"),
                            WORKER.format(name=n, tmp=tmp, tick=TICK), 0o755)
    mkfile(os.path.join(local, "oauth-token"), "tok-1")

    def tick(n):
        for f in os.listdir(tickets) if os.path.isdir(tickets) else []:
            os.remove(os.path.join(tickets, f))
        mkfile(os.path.join(tickets, "aaaa0001.md"),
               "---\nticket: aaaa0001\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")
        return subprocess.run([workers[n], "tick"], capture_output=True, text=True,
                              env=env, timeout=180)

    def log():
        try:
            return open(runlog, encoding="utf-8").read()
        except OSError:
            return ""

    def cd(n):
        return open(os.path.join(run, "cooldown-" + n), encoding="utf-8").read().split("\n")

    def clear(n):
        p = os.path.join(run, "cooldown-" + n)
        if os.path.exists(p):
            os.remove(p)

    def msg(text):
        mkfile(os.path.join(tmp, "msg"), text)

    # --- ① 원문 오류 줄: 다음 3:48 AM epoch · known 1 · runner 로그에 복귀 epoch ---
    msg("You've hit your usage limit. Upgrade to Pro or try again at 3:48 AM.")
    now = datetime.now()
    tick("codex")
    want = at(3, 48, "AM", now)
    got = cd("codex")
    assert abs(int(got[0]) - want) <= 1 or int(got[0]) == at(3, 48, "AM", datetime.now()), got
    assert got[2] == "1", got
    assert "복귀 %s" % got[0] in log(), log()
    # 3:48 AM이 지금보다 앞이면(이미 지난 시각) 다음 날 - 24시간 안이다.
    assert time.time() < int(got[0]) <= time.time() + 86400 + 60

    # --- ② 이미 지난 시각 · 12 AM · 12 PM ---
    for h, m, ap in ((now.hour % 12 or 12, 0, "AM" if now.hour < 12 else "PM"),
                     (12, 0, "AM"), (12, 30, "PM")):
        clear("codex")
        msg("usage limit reached, try again at %d:%02d %s." % (h, m, ap))
        now = datetime.now()
        tick("codex")
        got = cd("codex")
        assert abs(int(got[0]) - at(h, m, ap, now)) <= 1, (h, m, ap, got)
        assert got[2] == "1", got

    # --- ③ 시각 없는 한도 메시지: 300초 · known 0 ---
    clear("codex")
    msg("usage limit reached, try again later")
    t0 = int(time.time())
    tick("codex")
    got = cd("codex")
    assert t0 + W <= int(got[0]) <= int(time.time()) + W and got[2] == "0", got

    # --- ④ 지문: claude 토큰만 바꾸면 codex 쿨다운 유지, codex active만 바꾸면 풀린다 ---
    clear("codex")
    msg("usage limit reached, try again at 3:48 AM.")
    tick("codex")
    fp0 = cd("codex")[1]
    mkfile(os.path.join(local, "oauth-token"), "tok-2")
    tick("codex")
    assert "SKIP 엔진 쿨다운" in log().rsplit("DISPATCH", 1)[-1] or cd("codex")[1] == fp0
    assert "쿨다운 해제" not in log(), log()
    mkfile(os.path.join(local, "tokens.json"), json.dumps({"codex": {"active": "acc-b"}}))
    n_before = log().count("쿨다운 해제")
    tick("codex")
    assert log().count("쿨다운 해제") == n_before + 1, log()
    assert cd("codex")[1] != fp0

    # --- ⑤ 반대 방향: claude는 codex active에 안 흔들리고 oauth-token에 풀린다 ---
    msg("usage limit reached, try again at 3:48 AM.")
    tick("claude")
    cfp = cd("claude")[1]
    mkfile(os.path.join(local, "tokens.json"), json.dumps({"codex": {"active": "acc-c"}}))
    n_before = log().count("쿨다운 해제")
    tick("claude")
    assert log().count("쿨다운 해제") == n_before and cd("claude")[1] == cfp, log()
    mkfile(os.path.join(local, "oauth-token"), "tok-3")
    tick("claude")
    assert log().count("쿨다운 해제") == n_before + 1, log()

    print("test_codex_cooldown: ok")
finally:
    subprocess.run(["pkill", "-f", tmp], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
