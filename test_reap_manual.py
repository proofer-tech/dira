#!/usr/bin/env python3
"""손 클레임 스테일 판정(reap_manual) 자체검증. 실패하면 assert로 죽는다."""
import os
import sys
import time
import shutil
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T


def mk(troot, h, fm_lines):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + T.IN_PROGRESS + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\n{}\n---\n\n## 목표\n테스트\n".format(h, "\n".join(fm_lines)))
    return p


def iso(delta_sec):
    from datetime import datetime, timedelta
    return (datetime.now().astimezone() + timedelta(seconds=delta_sec)).isoformat(timespec="seconds")


def stale_transcript(tmp, age_sec, name="t"):
    p = os.path.join(tmp, name + ".jsonl")   # 케이스별로 달라야 한다(같은 경로면 utime이 서로 덮는다)
    with open(p, "w", encoding="utf-8") as f:
        f.write('{"type":"assistant","message":{"role":"assistant"}}\n')
    os.utime(p, (time.time() - age_sec, time.time() - age_sec))
    return p


DEAD_PID = "99999"
assert T.pid_alive(DEAD_PID) is False, "테스트 전제 깨짐: 99999가 살아있다"
LIVE_PID = str(os.getpid())
assert T.pid_alive(LIVE_PID) is True

ws = tempfile.mkdtemp()
tmp = tempfile.mkdtemp()
try:
    # A) pid 죽음 + 유예 경과 -> 회수(백로그 복귀)
    pa = mk(ws, "aaaa1111", ["pid: " + DEAD_PID, "claimed_at: " + iso(-T.MANUAL_GRACE_SEC - 60)])
    # B) pid 살아있음 + 트랜스크립트 신선 -> 무소음
    pb = mk(ws, "bbbb2222", ["pid: " + LIVE_PID, "claimed_at: " + iso(-T.MANUAL_GRACE_SEC - 60),
                             "transcript: " + stale_transcript(tmp, 0, "fresh")])
    # C) pid 살아있음 + 트랜스크립트 무활동 -> SUSPECT(파일은 그대로)
    pc = mk(ws, "cccc3333", ["pid: " + LIVE_PID, "claimed_at: " + iso(-T.MANUAL_GRACE_SEC - 60),
                             "transcript: " + stale_transcript(tmp, T.MANUAL_IDLE_SEC + 600, "idle")])
    # D) pid 없음 -> 종전대로 손대지 않음
    pd = mk(ws, "dddd4444", ["owner: developer / 손"])
    # E) pid 죽음이지만 유예 이내 -> 아직 안 봄
    pe = mk(ws, "eeee5555", ["pid: " + DEAD_PID, "claimed_at: " + iso(-10)])
    # F) 디스패처 경로 회귀: session_id 죽음 + 유예 경과 -> 종전대로 회수
    pf = mk(ws, "ffff6666", ["session_id: nosuchsession-zzzz",
                             "assigned_at: " + iso(-T.REAP_GRACE_SEC - 60)])

    msgs = T.reap(ws)
    joined = "\n".join(msgs)

    assert not os.path.exists(pa), "A: pid 죽었는데 회수 안 됨"
    assert os.path.exists(os.path.join(ws, "tickets/aaaa1111.md")), "A: 백로그 복귀 안 됨"
    assert "REAP aaaa1111" in joined, "A: REAP 메시지 없음\n" + joined

    assert os.path.exists(pb), "B: 살아있는 세션 티켓을 건드렸다"
    assert "bbbb2222" not in joined, "B: 활동 중인데 보고했다\n" + joined

    assert os.path.exists(pc), "C: SUSPECT인데 파일을 회수했다(자동 회수 금지)"
    assert "SUSPECT cccc3333" in joined, "C: SUSPECT 보고 없음\n" + joined

    assert os.path.exists(pd), "D: pid 없는 손 클레임을 건드렸다"
    assert "dddd4444" not in joined, "D: 판단 근거 없는데 보고했다\n" + joined

    assert os.path.exists(pe), "E: 유예 이내인데 회수했다"
    assert "eeee5555" not in joined, "E: 유예 이내인데 보고했다\n" + joined

    assert not os.path.exists(pf), "F: 디스패처 경로 회귀 - 죽은 세션 회수 안 됨"
    assert "REAP ffff6666" in joined, "F: 디스패처 경로 REAP 메시지 없음\n" + joined

    print("PASS 6/6")
    for m in msgs:
        print("  " + m)
finally:
    shutil.rmtree(ws, ignore_errors=True)
    shutil.rmtree(tmp, ignore_errors=True)
