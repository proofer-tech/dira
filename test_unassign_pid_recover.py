#!/usr/bin/env python3
"""§개정(요구 421f440d) 결정 3 - ps에서 pid를 못 떼어내면 거부하지 않고 평범한 종료 경로로 내려간다.

`session=` 갈래가 `--session-id`를 문 행을 찾긴 했는데 그 행의 첫 필드가 숫자가 아니면
(형식이 예상과 다르면) 죽일 대상도 산 세션이라 말할 근거도 없다 - `$ALIVE`를 비우고
`--force` 없이도 clear+release로 내려간다(결정 1의 "행복한 길"은 test_unassign_force.py
케이스 5가 이미 잰다).

`ps`를 가짜로 바꿔서 그 형식만 재현한다 - tick.sh는 자기 PATH를 `$HOME/.local/bin`부터
다시 세우므로(17행) `$HOME`만 픽스처로 돌리면 실제 `/bin/ps`는 안 건드린다.
도그푸딩 큐를 건드리지 않는다 - 전부 임시 큐다. 실패하면 assert로 죽는다.
"""
import os
import shutil
import stat
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{tmp}"
TICKET_INPROGRESS=".wip"
TICKET_DONE=".done"
. "{tick}"
"""

WIP = "---\nticket: {h}\ntitle: t\nsession_id: {sid}\n---\n\n## Goal\ntest\n"

FAKE_PS = """\
#!/usr/bin/env python3
import os, sys
if sys.argv[1:] == ["-eo", "pid=,command="]:
    print("nope --session-id " + os.environ.get("FAKE_SID", ""))
else:
    os.execv("/bin/ps", ["ps"] + sys.argv[1:])
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


tmp = os.path.realpath(tempfile.mkdtemp())
home = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    tickets = os.path.join(root, "tickets")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    w1 = mkfile(os.path.join(root, "workers", "w1.sh"),
                WORKER.format(tmp=tmp, tick=TICK), 0o755)
    ps = mkfile(os.path.join(home, ".local", "bin", "ps"), FAKE_PS)
    os.chmod(ps, os.stat(ps).st_mode | stat.S_IEXEC)

    sid = "malformed-sid"
    mkfile(os.path.join(tickets, "aaaa0001.wip.md"), WIP.format(h="aaaa0001", sid=sid))
    env = dict(os.environ, TICKET_LOCAL=local, HOME=home, FAKE_SID=sid)

    r = subprocess.run([w1, "unassign", "aaaa0001"], capture_output=True, text=True,
                        timeout=60, env=env)
    assert r.returncode == 0, \
        "pid를 못 떼어냈는데 거부했다(결정 3 위반): {}\n{}{}".format(r.returncode, r.stdout, r.stderr)
    assert os.path.exists(os.path.join(tickets, "aaaa0001.md")), \
        "평범한 종료 경로로 안 내려갔다: " + str(os.listdir(tickets))
    body = open(os.path.join(tickets, "aaaa0001.md"), encoding="utf-8").read()
    assert "awaiting:" not in body, "죽일 대상이 없는데 답변 대기로 잠갔다\n" + body

    print("OK - ps 형식이 예상과 달라도 unassign이 거부하지 않는다(결정 3)")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(home, ignore_errors=True)
