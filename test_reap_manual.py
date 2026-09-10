#!/usr/bin/env python3
"""손 클레임 스테일 판정(reap_manual) 자체검증. 실패하면 assert로 죽는다."""
import os
import sys
import time
import shutil
import tempfile
import subprocess

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
    # G) attempts 상한 초과 -> HOLD로 굳지 않고 답변 요청(열림 + 없는 dep + awaiting)
    pg = mk(ws, "gggg7777", ["session_id: nosuchsession-zzzz", "deps: [aaaa0000]",
                             "attempts: " + str(T.REAP_MAX_ATTEMPTS),
                             "assigned_at: " + iso(-T.REAP_GRACE_SEC - 60)],
            body="## 목표\n테스트\n\n## 블록\n인증서가 없다.\n")
    # I) 신선한 블록(마지막 절 = `## 블록`) -> attempts 0인데도 1회로 답변 요청(결정 7)
    pi = mk(ws, "iiii9999", ["session_id: nosuchsession-zzzz", "deps: [aaaa0000]",
                             "assigned_at: " + iso(-T.REAP_GRACE_SEC - 60)],
            body="## 목표\n테스트\n\n## 블록\n사람이 로그인해야 한다.\n")
    # J) 묵은 블록(뒤에 `## 질문 1`이 붙었다) -> 종전대로 자동 회수 1회
    pj = mk(ws, "jjjj0000", ["session_id: nosuchsession-zzzz",
                             "assigned_at: " + iso(-T.REAP_GRACE_SEC - 60)],
            body="## 목표\n테스트\n\n## 블록\n사람이 로그인해야 한다.\n\n## 질문 1\n\n답해주세요.\n")
    # L) 결정 16 - REAP_CLEAR 여섯 키 전부 빔 + mtime이 유예를 넘음 -> 주인 없는 `.wip` -> 회수
    pl = mk(ws, "llll1111", [])
    old = time.time() - T.REAP_GRACE_SEC - 60
    os.utime(pl, (old, old))
    # M) 같은 모양인데 마지막 절이 `## 블록` -> 열림 + awaiting + `## 질문 1`(결정 7과 같은 결과)
    pm = mk(ws, "mmmm2222", [], body="## 목표\n테스트\n\n## 블록\n결정해주세요.\n")
    os.utime(pm, (old, old))
    # N) 같은 모양인데 mtime이 유예 이내 -> claim 직후일 수 있으니 아직 안 본다
    pn = mk(ws, "nnnn3333", [])

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

    # G) 상한 초과는 사람이 답할 수 있는 자리(열림)로 올라간다. .wip에 남으면 GUI가 못 만진다.
    gopen = os.path.join(ws, "tickets/gggg7777.md")
    assert not os.path.exists(pg) and os.path.exists(gopen), "G: 상한 초과인데 .wip에 굳었다"
    assert "ASK gggg7777" in joined, "G: ASK 메시지 없음\n" + joined
    gfm, glines, gend = T.read_fm(gopen)
    gawait = gfm["awaiting"].strip()
    assert len(gawait) == 8, "G: awaiting 미기록 " + repr(gawait)
    assert T.deps_of(glines, gend) == ["aaaa0000", gawait], "G: 기존 dep 유실 또는 잠금 누락"
    body = "\n".join(glines[gend:])
    assert "## 질문 1" in body and "`## 블록`" in body, "G: 질문 절이 없다\n" + body
    assert gfm["attempts"].strip() == "0" and not gfm["session_id"].strip(), "G: 할당이 안 풀렸다"
    grow = [r for r in T.scan(ws) if r["hash"] == "gggg7777"][0]
    assert grow["unmet"] and not grow["assigned"], "G: 답변 전에 디스패치 후보다"

    # I) 블록을 남긴 세션은 재실행이 얻는 게 없다. attempts를 태우지 않고 바로 사람에게.
    iopen = os.path.join(ws, "tickets/iiii9999.md")
    assert not os.path.exists(pi) and os.path.exists(iopen), "I: 신선한 블록인데 .wip에 굳었다"
    assert "ASK iiii9999" in joined, "I: 1회로 답변 요청 안 됨(백로그로 되돌렸다)\n" + joined
    ifm, ilines, iend = T.read_fm(iopen)
    iawait = ifm["awaiting"].strip()
    assert len(iawait) == 8, "I: awaiting 미기록 " + repr(iawait)
    assert T.deps_of(ilines, iend) == ["aaaa0000", iawait], "I: 기존 dep 유실 또는 잠금 누락"
    ibody = "\n".join(ilines[iend:])
    assert "## 질문 1" in ibody, "I: 질문 절이 없다\n" + ibody
    assert "자동 회수" not in ibody, "I: 실패하지 않은 세션을 실패로 적었다\n" + ibody
    assert "아래 인용한 `## 블록`" in ibody, "I: 지시어가 `아래`가 아니다\n" + ibody

    # J) 답을 받은 뒤 그냥 죽은 세션까지 블록으로 오인하면 정당한 자동 회수 2회가 사라진다
    jopen = os.path.join(ws, "tickets/jjjj0000.md")
    assert not os.path.exists(pj) and os.path.exists(jopen), "J: 백로그 복귀 안 됨"
    assert "REAP jjjj0000 attempts=1" in joined, "J: 묵은 블록을 신선으로 봤다\n" + joined
    assert not T.read_fm(jopen)[0].get("awaiting", "").strip(), "J: 묵은 블록에 awaiting을 걸었다"

    # L) 주인 없는 `.wip`(결정 16) - 열림으로 회수되고 메시지에 해시가 남는다
    lopen = os.path.join(ws, "tickets/llll1111.md")
    assert not os.path.exists(pl) and os.path.exists(lopen), "L: 주인 없는 .wip이 회수되지 않았다"
    assert "llll1111" in joined, "L: 회수 메시지에 해시가 없다\n" + joined

    # M) 같은 모양 + 신선한 블록 -> 답변 요청(결정 7과 같은 결과)
    mopen = os.path.join(ws, "tickets/mmmm2222.md")
    assert not os.path.exists(pm) and os.path.exists(mopen), "M: 주인 없는 블록 .wip이 열리지 않았다"
    assert "ASK mmmm2222" in joined, "M: 답변 요청으로 안 올라갔다\n" + joined
    mfm, mlines, mend = T.read_fm(mopen)
    mawait = mfm["awaiting"].strip()
    assert len(mawait) == 8, "M: awaiting 미기록 " + repr(mawait)
    assert "## 질문 1" in "\n".join(mlines[mend:]), "M: 질문 절이 없다"

    # N) 여섯 키 전부 빈 것은 같지만 mtime이 유예 이내 -> claim 직후일 수 있어 손대지 않는다
    assert os.path.exists(pn), "N: 유예 이내인데 회수했다"
    assert "nnnn3333" not in joined, "N: 유예 이내인데 보고했다\n" + joined

    # H) 판정 3(§엔진 수정 서른여섯 번째 승인) - 리퍼 둘이 겹치면 진 쪽도 REAP-FAIL 없이
    #    성공으로 끝나고, .wip을 되살리지 않으며, attempts는 이긴 쪽 한 번만 오른다.
    ph = mk(ws, "hhhh8888", ["session_id: nosuchsession-zzzz",
                             "assigned_at: " + iso(-T.REAP_GRACE_SEC - 60)])
    hfm = T.read_fm(ph)[0]
    hopen = os.path.join(ws, "tickets", "hhhh8888.md")
    assert "REAP hhhh8888" in T.reclaim(ph, hfm, "이긴 쪽")
    win_attempts = int((T.read_fm(hopen)[0].get("attempts") or "0").strip() or 0)
    out_h2 = T.reclaim(ph, hfm, "진 쪽")
    assert "REAP-FAIL" not in out_h2, "H: 진 쪽이 REAP-FAIL로 실패했다(멱등 안 됨): " + out_h2
    assert "hhhh8888" in out_h2, "H: 진 쪽 결과에 해시가 없다: " + out_h2
    assert not os.path.exists(ph), "H: 진 쪽이 .wip을 되살렸다 - 주인 없는 유령이 남는다"
    lose_attempts = int((T.read_fm(hopen)[0].get("attempts") or "0").strip() or 0)
    assert lose_attempts == win_attempts, \
        "H: 진 쪽이 attempts를 또 올렸다(두 번 오름): {} -> {}".format(win_attempts, lose_attempts)

    # K) 결정 9 - `askhuman <path> --if-blocked`: 신선한 블록 ∧ deps_unmet==[]일 때만 잠근다.
    #    `unassign`의 플래그 없는 종료 경로가 clear+release **앞에서** 부르는 바로 그 CLI다.
    py = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tickets.py")

    def if_blocked(path):
        r = subprocess.run([sys.executable, py, "askhuman", path, "--if-blocked"],
                            capture_output=True, text=True, timeout=30)
        assert r.returncode == 0, "askhuman --if-blocked 실패: " + r.stderr
        return r.stdout.strip()

    kdep = os.path.join(ws, "tickets", "kdep0000.done.md")
    with open(kdep, "w", encoding="utf-8") as f:
        f.write("---\nticket: kdep0000\nkind: answer\n---\n\n## 답변 1\n\n됐다.\n")

    # K1) 마지막 절이 `## 블록` + deps 전부 `.done` -> 잠긴다, 그리고 열린 뒤에도 디스패치 후보가 아니다
    pk1 = mk(ws, "kkkk0001", ["deps: [kdep0000]"],
             body="## 목표\n테스트\n\n## 블록\n결정해주세요.\n")
    out = if_blocked(pk1)
    assert out.startswith("ASK kkkk0001 awaiting="), "K1: 블록+충족 deps인데 안 잠겼다: " + out
    k1fm, k1lines, k1end = T.read_fm(pk1)
    assert len(k1fm["awaiting"].strip()) == 8, "K1: awaiting 미기록 " + repr(k1fm.get("awaiting"))
    assert "kdep0000" in T.deps_of(k1lines, k1end), "K1: 기존 dep 유실"
    k1open = T.release(pk1)          # tick.sh는 이 잠금 뒤에 clear+release로 연다(순서 계약)
    assert k1open.endswith("kkkk0001.md") and not k1open.endswith(".wip.md"), \
        "K1: 열리지 않았다: " + k1open
    k1row = [r for r in T.scan(ws) if r["hash"] == "kkkk0001"][0]
    assert k1row["unmet"] and not k1row["assigned"], "K1: 잠겼는데 디스패치 후보로 남았다"

    # K2) 마지막 절이 `## 질문 n`(PM 왕복 모양) -> 안 잠긴다
    pk2 = mk(ws, "kkkk0002", [],
             body="## 목표\n테스트\n\n## 블록\n결정해주세요.\n\n## 질문 1\n\n답해주세요.\n")
    out = if_blocked(pk2)
    assert out == "", "K2: 묵은 블록(질문 뒤)인데 잠갔다: " + out
    assert not T.read_fm(pk2)[0].get("awaiting", "").strip(), "K2: awaiting이 생겼다"

    # K3) 마지막 절이 `## 블록`인데 미충족 dep -> 안 잠긴다(그 dep가 .done되면 저절로 뜬다)
    pk3 = mk(ws, "kkkk0003", ["deps: [no-such-dep]"],
             body="## 목표\n테스트\n\n## 블록\n결정해주세요.\n")
    out = if_blocked(pk3)
    assert out == "", "K3: 미충족 dep인데 잠갔다: " + out
    assert not T.read_fm(pk3)[0].get("awaiting", "").strip(), "K3: awaiting이 생겼다"

    # O) afd21f07 회귀 - `tick.sh` 실패 회수 자리가 쓰는 `reap_release`: release가 지면
    #    frontmatter를 안 건드린다(session_id·pid·owner가 그대로 남는다) - 옛 결함처럼
    #    clear가 먼저 돌아 필드를 지워 owner만 남기지 않는다. 그런데도 다음 reap은 죽은 pid
    #    경로(owner를 안 보는 디스패처 경로)로 정상 회수한다 - 2820116e 실사고 재발 방지.
    po = mk(ws, "oooo4444", ["session_id: nosuchsession-oooo", "pid: " + DEAD_PID,
                             "owner: developer / w9-oooo4444",
                             "assigned_at: " + iso(-T.REAP_GRACE_SEC - 60)])
    oopen = os.path.join(ws, "tickets", "oooo4444.md")
    open(oopen, "w", encoding="utf-8").close()   # 복귀 대상을 선점해 release를 강제로 지운다
    out = T.reap_release(po)
    assert out.startswith("REAP-FAIL oooo4444"), "O: release 실패인데 REAP-FAIL이 아니다: " + out
    assert os.path.exists(po), "O: 실패했는데 .wip이 사라졌다"
    ofm = T.read_fm(po)[0]
    assert ofm.get("owner", "").strip() and ofm.get("pid", "").strip() == DEAD_PID, \
        "O: 실패했는데 필드가 지워졌다(옛 결함 재발) " + repr(ofm)
    os.remove(oopen)                             # 선점 해제 - 다음 reap이 정상 경로를 타게
    msgs2 = T.reap(ws)
    joined2 = "\n".join(msgs2)
    assert not os.path.exists(po), "O: owner가 남았다는 이유로 다음 reap도 못 잡았다"
    assert "REAP oooo4444" in joined2, "O: 다음 reap 메시지에 해시가 없다\n" + joined2

    # P) 8785c425 회귀 - claim의 하드링크가 백로그 mtime을 그대로 물려받으면 유예가 0초다.
    #    수정 전 코드는 pp_wip의 mtime이 여전히 옛 백로그 시각이라 이 assert가 실패해야 한다.
    from datetime import datetime as _dt, timezone as _tz
    pp_backlog = os.path.join(ws, "tickets", "pppp5555.md")
    with open(pp_backlog, "w", encoding="utf-8") as f:
        f.write("---\nticket: pppp5555\n---\n\n## 목표\n테스트\n")
    stale = time.time() - T.REAP_GRACE_SEC - 3600
    os.utime(pp_backlog, (stale, stale))
    pp_wip = T.claim(pp_backlog)
    pp_fm = T.read_fm(pp_wip)[0]
    p_msgs = T.reap_manual(pp_wip, pp_fm, _dt.now(_tz.utc))
    assert p_msgs == [], "P: claim 직후인데 하드링크 mtime 재상속으로 회수됐다\n" + str(p_msgs)
    assert os.path.exists(pp_wip), "P: claim 직후 티켓이 사라졌다"

    # Q) 판정 3 - `tick.sh`의 조용한 실패 회수 자리(`reap_release`)도 같은 티켓을 두 번
    #    부르면(부모의 사후처리와 리퍼가 겹치는 모양) 둘째 호출이 REAP-FAIL 없이 성공하고
    #    attempts는 첫 호출 한 번만 오른다.
    pq = mk(ws, "qqqq6666", ["session_id: nosuchsession-zzzz",
                             "assigned_at: " + iso(-T.REAP_GRACE_SEC - 60)])
    qopen = os.path.join(ws, "tickets", "qqqq6666.md")
    out_q1 = T.reap_release(pq, "other")
    assert "REAP-FAIL" not in out_q1, "Q: 첫 호출이 실패했다: " + out_q1
    assert os.path.exists(qopen), "Q: 첫 호출 뒤 열린 이름이 없다"
    q_attempts = int((T.read_fm(qopen)[0].get("attempts") or "0").strip() or 0)
    out_q2 = T.reap_release(pq, "other")
    assert "REAP-FAIL" not in out_q2, "Q: 둘째 호출이 REAP-FAIL로 실패했다(멱등 안 됨): " + out_q2
    q_attempts2 = int((T.read_fm(qopen)[0].get("attempts") or "0").strip() or 0)
    assert q_attempts2 == q_attempts, \
        "Q: 둘째 호출이 attempts를 또 올렸다: {} -> {}".format(q_attempts, q_attempts2)

    print("PASS 20/20")
    for m in msgs:
        print("  " + m)
finally:
    shutil.rmtree(ws, ignore_errors=True)
    shutil.rmtree(tmp, ignore_errors=True)
