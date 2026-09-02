#!/usr/bin/env python3
"""P360-2 자체검증: 리퍼가 부모 워커의 사후처리 창(tick.sh 696행 워커 락)을 기다리되,
상한(REAP_GRACE_SEC + REAP_POST_GRACE_SEC)을 넘기거나 락 pid가 죽으면 종전대로 가져간다.
실패하면 assert로 죽는다.
"""
import os
import sys
import hashlib
import shutil
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T


def mk(troot, h, fm_lines, body="## 목표\n테스트\n"):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + T.IN_PROGRESS + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\n{}\n---\n\n{}".format(h, "\n".join(fm_lines), body))
    return p


def iso(delta_sec):
    from datetime import datetime, timedelta
    return (datetime.now().astimezone() + timedelta(seconds=delta_sec)).isoformat(timespec="seconds")


def lockpid(local, worker, troot, pid):
    """tick.sh 696행과 같은 해시로 워커 락을 만들고 그 안에 pid를 적는다."""
    h = hashlib.sha1("{}/workers/{}".format(troot, worker).encode()).hexdigest()[:8]
    d = os.path.join(local, "run", "{}-{}.lock".format(worker, h))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "pid"), "w") as f:
        f.write(str(pid))


DEAD_PID = "99999"
LIVE_PID = str(os.getpid())
assert T.pid_alive(DEAD_PID) is False, "테스트 전제 깨짐: 99999가 살아있다"

ws = tempfile.mkdtemp()
local = tempfile.mkdtemp()
try:
    # A) 유예(REAP_GRACE_SEC)는 지났지만 부모 워커 w9의 락을 산 pid가 쥐고 있다
    #    -> 상한(POST_GRACE) 안이니 리퍼가 앞지르지 않는다
    pa = mk(ws, "aaaa1111", ["session_id: nosuchsession-a", "owner: developer / w9-aaaa1111",
                             "assigned_at: " + iso(-T.REAP_GRACE_SEC - 5)])
    lockpid(local, "w9", ws, LIVE_PID)

    # B) 같은 모양인데 부모 워커 락 pid가 죽어 있다(부모마저 죽었다, <뒤집는 조건>)
    #    -> 상한을 기다리지 않고 즉시 회수
    pb = mk(ws, "bbbb2222", ["session_id: nosuchsession-b", "owner: developer / w10-bbbb2222",
                             "assigned_at: " + iso(-T.REAP_GRACE_SEC - 5)])
    lockpid(local, "w10", ws, DEAD_PID)

    # C) 부모 락이 산 pid로 계속 쥐고 있어도, 경과가 상한(POST_GRACE)을 넘으면 종전대로 가져간다
    #    (상한 없는 대기 금지)
    pc = mk(ws, "cccc3333", ["session_id: nosuchsession-c", "owner: developer / w11-cccc3333",
                             "assigned_at: " + iso(-T.REAP_GRACE_SEC - T.REAP_POST_GRACE_SEC - 5)])
    lockpid(local, "w11", ws, LIVE_PID)

    # D) owner가 아예 없는 옛 형태 티켓 - 가드가 없어도 종전대로 회수(회귀 방지)
    pd = mk(ws, "dddd4444", ["session_id: nosuchsession-d",
                             "assigned_at: " + iso(-T.REAP_GRACE_SEC - 5)])

    msgs = T.reap(ws, local)
    joined = "\n".join(msgs)

    assert os.path.exists(pa), "A: 부모가 사후처리 중인데 리퍼가 가져갔다\n" + joined
    assert "aaaa1111" not in joined, "A: 상한 안인데 보고했다\n" + joined

    assert not os.path.exists(pb), "B: 부모마저 죽었는데 상한까지 기다렸다"
    assert "REAP bbbb2222" in joined, "B: 죽은 부모 락을 즉시 회수하지 않았다\n" + joined

    assert not os.path.exists(pc), "C: 상한을 넘겼는데도 리퍼가 안 가져갔다(상한 없는 대기)"
    assert "REAP cccc3333" in joined, "C: 상한 초과 회수 메시지 없음\n" + joined

    assert not os.path.exists(pd), "D: owner 없는 옛 티켓 회귀 - 회수 안 됨"
    assert "REAP dddd4444" in joined, "D: 회귀 메시지 없음\n" + joined

    # 다음 tick에서 부모가 사후처리를 마치면(락 해제) A도 정상 회수된다
    shutil.rmtree(os.path.dirname(list(
        __import__("glob").glob(os.path.join(local, "run", "w9-*.lock")))[0]))
    msgs2 = T.reap(ws, local)
    assert not os.path.exists(pa), "A뒤: 부모 락이 풀렸는데도 계속 대기했다\n" + "\n".join(msgs2)
    assert "REAP aaaa1111" in "\n".join(msgs2), "A뒤: 락 해제 후 회수 메시지 없음"

    print("PASS 4/4 + 락 해제 후속 1")
    for m in msgs:
        print("  " + m)
finally:
    shutil.rmtree(ws, ignore_errors=True)
    shutil.rmtree(local, ignore_errors=True)
