#!/usr/bin/env python3
"""프롬프트 주입이 막힐 때 워커가 정지하지 않는가 + 산 세션을 unassign이 막는가.

2026-08-01 실사고 재현: 프롬프트가 FIFO 버퍼(macOS 16KB)보다 크면 엔진이 stdin을 빨아야만
write가 끝난다. 엔진이 기동 중 멎으면 tick.sh가 그 write에서 영영 안 돌아왔고, 그 아래
setpid·감시자·wait이 통째로 안 돌아 티켓이 진행중에 영구 잔류했다(reap도 pid가 없어 못 봤다).
그 사이 사람이 unassign으로 풀자 같은 티켓에 세션이 둘 붙었다.

실패하면 assert로 죽는다.
"""
import os
import shutil
import subprocess
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
PY = os.path.join(HERE, "tickets.py")

# stdin을 한 글자도 안 읽고 버티는 엔진. argv에 `--input-format stream-json`이 인접해 있어
# tick.sh가 FIFO 경로를 탄다(그게 갈림의 유일한 근거다).
DEAF_ENGINE = """\
#!/bin/bash
printf '{"type":"system","subtype":"init"}\\n'
sleep 60
"""

WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_INPROGRESS=".wip"
TICKET_DONE=".done"
TICKET_FEED_TIMEOUT={feed}
TICKET_PROMPT_FMT="%s {filler}"
TICKET_ENGINE=("{tmp}/deaf-engine.sh" --input-format stream-json)
. "{tick}"
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
    env = dict(os.environ, TICKET_LOCAL=local)
    mkfile(os.path.join(tmp, "deaf-engine.sh"), DEAF_ENGINE, 0o755)

    # --- 1) 귀먹은 엔진 + 버퍼보다 큰 프롬프트: 정지가 아니라 STALL로 떨어져야 한다 ---
    w1 = mkfile(os.path.join(root, "workers", "w1.sh"),
                WORKER.format(name="w1", tmp=tmp, tick=TICK, feed=3, filler="x" * 20000),
                0o755)
    mkfile(os.path.join(root, "tickets", "aaaa0001.md"),
           "---\nticket: aaaa0001\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")

    began = time.time()
    r = subprocess.run([w1, "tick"], capture_output=True, text=True, env=env, timeout=90)
    took = time.time() - began
    # 전경 write였다면 여기서 timeout=90에 걸려 죽는다. 상한 3s + 여유 안에 끝나야 한다.
    assert took < 45, "프롬프트 주입에서 정지했다({:.0f}s)".format(took)

    runlog = open(os.path.join(root, "workers", "runner.log"), encoding="utf-8").read()
    assert "STALL aaaa0001" in runlog, "주입 실패를 STALL로 안 남겼다\n" + runlog
    assert os.path.exists(os.path.join(root, "tickets", "aaaa0001.md")), \
        "STALL 뒤 티켓이 백로그로 안 돌아왔다: " + str(os.listdir(os.path.join(root, "tickets")))
    assert not os.path.exists(os.path.join(root, "tickets", "aaaa0001.wip.md")), \
        "진행중 접미사가 남았다"
    # 정지 중에도 reap이 볼 pid가 있어야 한다 - 주입보다 먼저 적히는 것이 그 근거다
    assert "setpid" not in r.stderr, r.stderr

    # --- 2) 산 세션을 두고 unassign 하면 거부한다 ---
    live = subprocess.Popen(["sleep", "30"])
    try:
        mkfile(os.path.join(root, "tickets", "bbbb0002.wip.md"),
               "---\nticket: bbbb0002\ntitle: t\nsession_id: dead-sid\npid: {}\n---\n\n"
               "## Goal\ntest\n".format(live.pid))
        r = subprocess.run([w1, "unassign", "bbbb0002"], capture_output=True, text=True,
                           env=env, timeout=30)
        assert r.returncode != 0, "산 세션인데 unassign이 통과했다\n" + r.stdout + r.stderr
        assert "거부" in r.stdout + r.stderr, r.stdout + r.stderr
        assert os.path.exists(os.path.join(root, "tickets", "bbbb0002.wip.md")), \
            "거부했는데 티켓이 풀렸다"
    finally:
        live.kill()
        live.wait()

    # --- 3) 주인 세션이 자기 손으로 푸는 것은 통과한다(PM 왕복 3단계, 티켓 828dc247) ---
    # 부르는 쪽의 조상에 그 pid가 있으면 주인이다. 여기서는 이 테스트 프로세스가 곧 조상이다.
    mkfile(os.path.join(root, "tickets", "cccc0003.wip.md"),
           "---\nticket: cccc0003\ntitle: t\nsession_id: dead-sid\npid: {}\n---\n\n"
           "## Goal\ntest\n".format(os.getpid()))
    r = subprocess.run([w1, "unassign", "cccc0003"], capture_output=True, text=True,
                       env=env, timeout=30)
    assert r.returncode == 0, "주인 세션이 자기 티켓을 못 풀었다\n" + r.stdout + r.stderr
    assert os.path.exists(os.path.join(root, "tickets", "cccc0003.md")), \
        "주인 세션 unassign 뒤 백로그로 안 돌아왔다"

    # 세션이 죽으면 같은 명령이 통과한다
    r = subprocess.run([w1, "unassign", "bbbb0002"], capture_output=True, text=True,
                       env=env, timeout=30)
    assert r.returncode == 0, "죽은 세션인데 unassign이 막혔다\n" + r.stdout + r.stderr
    assert os.path.exists(os.path.join(root, "tickets", "bbbb0002.md")), \
        "unassign 뒤 백로그로 안 돌아왔다: " + str(os.listdir(os.path.join(root, "tickets")))

    print("OK - 주입 정지 방어 + unassign 생존 가드")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
