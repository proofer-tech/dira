#!/usr/bin/env python3
"""멀티플레잉(§0-18 §엔진) 자체검증: TICKET_SLOT이 토큰 파일과 엔진 쿨다운을 같이 가르는가.

비었을 때 오늘과 같은 경로($LOCAL/oauth-token, $LOCAL/run/cooldown-claude) -
슬롯이 있을 때 그 슬롯만의 경로 - 슬롯이 다른 워커끼리는 쿨다운이 안 섞이는 것 셋을 잰다.
가짜 스트림 엔진으로 판정한다(진짜 claude를 안 부른다). 실패하면 assert로 죽는다.
"""
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

# ENGINE_NAME이 claude여야 engine_gate_ok의 토큰 게이트가 걸린다 - basename이 "claude"인
# 엔진 파일을 둔다(진짜 claude는 안 부른다).
WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/claude" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

# mode 파일이 갈래를 정한다: ok = 정상 완료 | api_error = 복귀 시각 없는 불능(쿨다운 무장)
ENGINE = """\
#!/bin/bash
IFS= read -r _first
printf '{{"type":"system","subtype":"init"}}\\n'
case "$(cat "{tmp}/mode")" in
  api_error)
    printf '{{"is_error":true,"session_id":"%s","type":"result","subtype":"error_during_execution","terminal_reason":"api_error","api_error_status":429}}\\n' "$1" ;;
  *)
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


def mk(root, name):
    return mkfile(os.path.join(root, "tickets", name + ".md"),
                  "---\nticket: {}\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n".format(name))


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    mkfile(os.path.join(tmp, "claude"), ENGINE.format(tmp=tmp), 0o755)
    w1 = mkfile(os.path.join(root, "workers", "w1.sh"), WORKER.format(name="w1", tmp=tmp, tick=TICK), 0o755)
    w2 = mkfile(os.path.join(root, "workers", "w2.sh"), WORKER.format(name="w2", tmp=tmp, tick=TICK), 0o755)
    runlog = os.path.join(root, "workers", "runner.log")
    env = dict(os.environ, TICKET_LOCAL=local)

    def mode(m):
        mkfile(os.path.join(tmp, "mode"), m + "\n")

    def tick(worker=w1, **over):
        return subprocess.run([worker, "tick"], capture_output=True, text=True,
                              env=dict(env, **over), timeout=60)

    def log():
        try:
            with open(runlog, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    tokenf = os.path.join(local, "oauth-token")
    tokenf_a = os.path.join(local, "oauth-token-slotA")
    tokenf_b = os.path.join(local, "oauth-token-slotB")
    cdown = os.path.join(local, "run", "cooldown-claude")
    cdown_a = os.path.join(local, "run", "cooldown-claude-slotA")
    cdown_b = os.path.join(local, "run", "cooldown-claude-slotB")

    # --- §검증 1: TICKET_SLOT 없이 -> 토큰·쿨다운이 오늘과 같은 경로(오늘 = 접미사 없음) ---
    mkfile(tokenf, "tok-none")
    mode("ok")
    mk(root, "aaaa0001")
    before = len(log())
    r = tick()
    assert r.returncode == 0, r.stdout + r.stderr
    assert "DONE aaaa0001" in log()[before:], "무슬롯 토큰으로 디스패치를 못 했다\n" + log()[before:]

    mode("api_error")
    mk(root, "aaaa0002")
    before = len(log())
    tick()
    assert "FAIL aaaa0002" in log()[before:], log()[before:]
    assert os.path.exists(cdown), "무슬롯 쿨다운이 $LOCAL/run/cooldown-claude에 안 떴다"
    assert not os.path.exists(cdown_a) and not os.path.exists(cdown_b), \
        "무슬롯 쿨다운이 슬롯 파일에 샜다"
    os.remove(os.path.join(root, "tickets", "aaaa0002.md"))  # FAIL로 되돌아온 티켓 - 뒤 케이스와 안 겹치게 치운다

    # --- §검증 2: TICKET_SLOT=slotA -> 토큰·쿨다운 둘 다 그 슬롯만의 경로 ---
    # 무슬롯 토큰만 있고 슬롯 토큰은 아직 없다 - TOKENF가 실제로 슬롯 파일을 보는지 확인한다.
    mode("ok")
    mk(root, "bbbb0001")
    before = len(log())
    tick(TICKET_SLOT="slotA")
    added = log()[before:]
    assert "SKIP AUTH 대기" in added, \
        "슬롯 토큰이 없는데도 무슬롯 파일을 대신 읽었다(TOKENF가 안 갈렸다)\n" + added
    assert "DONE bbbb0001" not in added, "인증 대기 상태에서 디스패치했다\n" + added

    mkfile(tokenf_a, "tok-a")
    before = len(log())
    tick(TICKET_SLOT="slotA")
    added = log()[before:]
    assert "DONE bbbb0001" in added, "슬롯 토큰 파일을 만든 뒤에도 못 읽었다\n" + added

    mode("api_error")
    mk(root, "bbbb0002")
    before = len(log())
    tick(TICKET_SLOT="slotA")
    assert "FAIL bbbb0002" in log()[before:], log()[before:]
    assert os.path.exists(cdown_a), "슬롯A 쿨다운이 $LOCAL/run/cooldown-claude-slotA에 안 떴다"
    os.remove(os.path.join(root, "tickets", "bbbb0002.md"))  # FAIL로 되돌아온 티켓 - 뒤 케이스와 안 겹치게 치운다

    # --- §검증 3: 슬롯이 다른 워커는 한쪽 쿨다운에 안 걸린다 ---
    mkfile(tokenf_b, "tok-b")
    mode("ok")
    mk(root, "cccc0001")
    before = len(log())
    r = tick(w2, TICKET_SLOT="slotB")
    added = log()[before:]
    assert r.returncode == 0, r.stdout + r.stderr
    assert "SKIP 엔진 쿨다운" not in added, \
        "슬롯A 쿨다운이 슬롯B 디스패치를 막았다\n" + added
    assert "DONE cccc0001" in added, "슬롯B가 디스패치를 못 했다\n" + added

    # 대조: 같은 슬롯A는 여전히 그 창에 막힌다.
    mk(root, "bbbb0003")
    before = len(log())
    tick(TICKET_SLOT="slotA")
    assert "SKIP 엔진 쿨다운" in log()[before:], "슬롯A 자신은 자기 창에 막혀야 한다"

    print("OK - TICKET_SLOT이 토큰·쿨다운 경로를 같이 가른다(무슬롯 무변화 - 슬롯별 격리)")
finally:
    subprocess.run(["pkill", "-f", os.path.join(tmp, "claude")], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
