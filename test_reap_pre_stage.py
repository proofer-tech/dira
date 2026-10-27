#!/usr/bin/env python3
"""P541-3 자체검증: pid 빈 .wip + 산 워커 락은 TICKET_PRE_MAX + REAP_POST_GRACE_SEC까지 회수하지
않는다. 락이 죽었거나 pid가 있으면 종전 판정. 실패하면 assert로 죽는다."""
__import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())
import hashlib
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T


def mk(troot, h, fm_lines):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + T.IN_PROGRESS + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\n{}\n---\n\n## 목표\n테스트\n".format(h, "\n".join(fm_lines)))
    return p


def iso(sec_ago):
    return (datetime.now().astimezone() - timedelta(seconds=sec_ago)).isoformat(timespec="seconds")


def lockpid(local, worker, troot, pid):
    h = hashlib.sha1("{}/workers/{}".format(troot, worker).encode()).hexdigest()[:8]
    d = os.path.join(local, "run", "{}-{}.lock".format(worker, h))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "pid"), "w") as f:
        f.write(str(pid))


def case(h, worker, age, lock_pid, pid_line=None, env=None):
    """티켓 하나를 만들어 reap을 돌리고 회수 여부를 돌려준다."""
    ws, local = tempfile.mkdtemp(), tempfile.mkdtemp()
    old = os.environ.get("TICKET_PRE_MAX")
    if env:
        os.environ["TICKET_PRE_MAX"] = env
    try:
        fm = ["session_id: nosuchsession-" + h, "owner: developer / {}-{}".format(worker, h),
              "assigned_at: " + iso(age)]
        if pid_line is not None:
            fm.append(pid_line)
        p = mk(ws, h, fm)
        lockpid(local, worker, ws, lock_pid)
        T.reap(ws, local)
        return not os.path.exists(p)
    finally:
        if env:
            if old is None:
                os.environ.pop("TICKET_PRE_MAX")
            else:
                os.environ["TICKET_PRE_MAX"] = old
        shutil.rmtree(ws, ignore_errors=True)
        shutil.rmtree(local, ignore_errors=True)


LIVE, DEAD = str(os.getpid()), "99999"
assert T.pid_alive(DEAD) is False
POST = T.REAP_POST_GRACE_SEC

# 1) pid 빈 + 락 생존: 300초는 안 회수, 600+POST 초과는 회수
assert not case("aaaa0001", "w9", 300, LIVE, "pid:"), "300초에 회수했다"
assert not case("aaaa0002", "w9", 600 + POST - 10, LIVE, "pid:"), "상한 안에서 회수했다"
assert case("aaaa0003", "w9", 600 + POST + 10, LIVE, "pid:"), "상한 초과인데 안 회수했다"
# 2) TICKET_PRE_MAX가 상한을 끌고 간다
assert not case("aaaa0004", "w9", 900, LIVE, None, env="1000"), "PRE_MAX=1000인데 900초에 회수"
assert case("aaaa0005", "w9", 300, LIVE, None, env="100"), "PRE_MAX=100인데 300초에 안 회수"
# 3) 락이 죽었으면 GRACE 뒤 회수, pid가 적히면 종전(POST 창) 판정
assert case("aaaa0006", "w9", T.REAP_GRACE_SEC + 5, DEAD, "pid:"), "죽은 락인데 안 회수"
assert case("aaaa0007", "w9", T.REAP_GRACE_SEC + POST + 5, LIVE, "pid: 99999"), "pid 있음 종전 판정 깨짐"
assert not case("aaaa0008", "w9", T.REAP_GRACE_SEC + 5, LIVE, "pid: 99999"), "pid 있음 POST 창 깨짐"
print("PASS 8/8")
