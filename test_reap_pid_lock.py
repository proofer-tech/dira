#!/usr/bin/env python3
"""P514-1 자체검증: reap 루트 잠금(결정 3)과 ps 실패 때 pid 판정(결정 4). 실패하면 assert로 죽는다."""
__import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())
import os
import sys
import hashlib
import tempfile
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T


def mk(troot, h, pid):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    at = (datetime.now().astimezone() - timedelta(seconds=T.REAP_GRACE_SEC + T.REAP_POST_GRACE_SEC + 60)).isoformat(timespec="seconds")
    p = os.path.join(d, h + T.IN_PROGRESS + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\nsession_id: s-{}\npid: {}\nassigned_at: {}\n---\n\n## 목표\nx\n".format(h, h, pid, at))
    return p


ws, local = tempfile.mkdtemp(), tempfile.mkdtemp()
dead = mk(ws, "dead0001", "99999")
mine = mk(ws, "mine0002", str(os.getpid()))
nopid = mk(ws, "nopid003", "")
assert not T._kill0("99999"), "테스트 전제 깨짐: 99999가 살아있다"

# ps가 시간을 넘긴 상태(live_session_ids -> None)
T.live_session_ids = lambda: None
out = T.reap(ws, local)
assert not any("SKIP ps 조회 실패" in m for m in out), out
assert not os.path.exists(dead), "죽은 pid의 wip이 회수되지 않았다"
assert os.path.exists(mine) and os.path.exists(nopid), "산 pid와 pid 없는 wip은 남아야 한다"

# 잠금: 끝나면 없다
run = os.path.join(local, "run")
assert not [f for f in os.listdir(run) if f.startswith("reap-")], os.listdir(run)

# 산 pid가 잠금을 쥐면 SKIP, 죽은 pid의 잠금은 걷는다
h = hashlib.sha1(os.path.realpath(ws).encode()).hexdigest()[:8]
lock = os.path.join(run, "reap-{}.lock".format(h))
os.makedirs(lock)
open(os.path.join(lock, "pid"), "w").write(str(os.getpid()))
assert T.reap(ws, local) == ["SKIP 다른 reap이 도는 중"]
assert os.path.isdir(lock), "남의 잠금을 걷으면 안 된다"
open(os.path.join(lock, "pid"), "w").write("99999")
out = T.reap(ws, local)
assert out != ["SKIP 다른 reap이 도는 중"] and not os.path.exists(lock), out
print("OK")
