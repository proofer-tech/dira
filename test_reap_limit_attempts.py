#!/usr/bin/env python3
"""한도로 죽은 세션은 회수 자리(reclaim/reap_release)가 어디든 attempts를 안 쓴다(P360-4).
자체검증 - 실패하면 assert로 죽는다.

실측(2026-09-02, 86a26ad2): 같은 한도 사망이 부모 워커의 사후처리(reap_release, attempts를
안 건드림)로 회수되면 예산을 안 쓰고, 남의 리퍼의 reclaim으로 회수되면 종전엔 attempts를
그대로 올려 세었다. 이 파일은 reclaim이 dead_reason으로 한도를 미리 갈라 attempts를 그대로
두는지, 한도가 아닌 사인은 종전대로 올리고 상한을 넘기면 상신하는지를 고정한다.
"""
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T


def iso(delta_sec):
    from datetime import datetime, timedelta
    return (datetime.now().astimezone() + timedelta(seconds=delta_sec)).isoformat(timespec="seconds")


def mk(troot, h, fm_lines, body="## Goal\n테스트\n\n## Done when\n- [ ] 하나\n"):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + T.IN_PROGRESS + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\n{}\n---\n\n{}".format(h, "\n".join(fm_lines), body))
    return p


def L(t, w, h, msg):
    return "{} [{}] {}".format(t, w, msg.format(h=h))


def write_log(troot, lines):
    os.makedirs(os.path.join(troot, "workers"), exist_ok=True)
    with open(os.path.join(troot, "workers", "runner.log"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


ws = tempfile.mkdtemp()
local = tempfile.mkdtemp()
try:
    # A) 한도 사망(attempts=0) - reclaim이 attempts를 그대로 둔다, ASK로 안 올라간다
    write_log(ws, [
        L("2026-09-02 20:00:00", "w2", "aaaa1111", "DISPATCH {h} kind=work"),
        L("2026-09-02 20:01:00", "w2", "aaaa1111", "STALL {h} 30s 안에 프롬프트 주입+init을 못 봤다 - 기동 실패"),
        L("2026-09-02 20:01:30", "w2", "", "NOTE 엔진 불능 - 300초 쿨다운(복귀 미상)"),
    ])
    pa = mk(ws, "aaaa1111", ["attempts: 0"])
    afm = T.read_fm(pa)[0]
    out = T.reclaim(pa, afm, "세션 죽음")
    assert out.startswith("REAP aaaa1111"), "A: 한도인데 REAP이 아니다\n" + out
    assert "ASK" not in out, "A: 한도 1회인데 상신했다\n" + out
    aopen = os.path.join(ws, "tickets/aaaa1111.md")
    assert os.path.exists(aopen) and not os.path.exists(pa), "A: 백로그 복귀 안 됨"
    assert int(T.read_fm(aopen)[0].get("attempts", "").strip() or 0) == 0, \
        "A: 한도인데 attempts를 올렸다 - " + out

    # B) 같은 회차를 reap_release(부모의 사후처리)로 회수해도 같은 값(attempts 미기록 = 0)을
    #    남긴다 - A와 B가 어느 자리에서 회수되든 값이 갈리지 않는다는 것이 이 티켓의 계약이다.
    write_log(ws, [
        L("2026-09-02 21:00:00", "w2", "bbbb2222", "DISPATCH {h} kind=work"),
        L("2026-09-02 21:01:00", "w2", "bbbb2222", "STALL {h} 30s 안에 프롬프트 주입+init을 못 봤다 - 기동 실패"),
        L("2026-09-02 21:01:30", "w2", "", "NOTE 엔진 불능 - 300초 쿨다운(복귀 미상)"),
    ])
    pb = mk(ws, "bbbb2222", ["attempts: 0"])
    out = T.reap_release(pb)
    assert out == "", "B: reap_release가 실패로 잡혔다: " + out
    bopen = os.path.join(ws, "tickets/bbbb2222.md")
    assert os.path.exists(bopen), "B: 백로그 복귀 안 됨"
    assert T.read_fm(bopen)[0].get("attempts", "").strip() == "0", \
        "B: reap_release가 attempts를 건드렸다"
    # A(reclaim)와 B(reap_release) 둘 다 "attempts를 안 썼다"는 같은 사실을 남긴다(둘 다
    # 정수로 읽으면 0) - 회수 자리에 따라 예산 소모가 갈리던 실사고(86a26ad2)가 재발하지 않는다.
    assert int(T.read_fm(aopen)[0]["attempts"].strip() or 0) == \
        int(T.read_fm(bopen)[0].get("attempts", "").strip() or 0) == 0, \
        "A/B: 같은 한도 사망인데 남긴 attempts 값이 갈렸다"

    # C) 한도가 REAP_MAX_ATTEMPTS를 넘게 반복돼도(이미 상한에 걸린 attempts) 상신하지 않는다 -
    #    한도는 attempts 카운터 자체를 안 쓰므로 상한 비교 대상이 아니다.
    write_log(ws, [
        L("2026-09-02 22:00:00", "w2", "cccc3333", "DISPATCH {h} kind=work"),
        L("2026-09-02 22:01:00", "w2", "cccc3333", "STALL {h} 30s 안에 프롬프트 주입+init을 못 봤다 - 기동 실패"),
        L("2026-09-02 22:01:30", "w2", "", "NOTE 엔진 불능 - 300초 쿨다운(복귀 미상)"),
    ])
    pc = mk(ws, "cccc3333", ["attempts: " + str(T.REAP_MAX_ATTEMPTS)])
    cfm = T.read_fm(pc)[0]
    out = T.reclaim(pc, cfm, "세션 죽음")
    assert out.startswith("REAP cccc3333"), "C: 상한에 걸린 한도인데 상신했다\n" + out
    copen = os.path.join(ws, "tickets/cccc3333.md")
    assert os.path.exists(copen), "C: 백로그 복귀 안 됨"
    assert T.read_fm(copen)[0]["attempts"].strip() == str(T.REAP_MAX_ATTEMPTS), \
        "C: 한도인데 attempts를 더 올렸다"

    # D) 한도가 아닌 사인(요청 오류)은 종전대로 attempts를 올리고, 상한을 넘기면 상신한다 - 회귀 방지.
    write_log(ws, [
        L("2026-09-02 23:00:00", "w2", "dddd4444", "DISPATCH {h} kind=work"),
        L("2026-09-02 23:01:00", "w2", "dddd4444", "FAIL {h} 세션이 result is_error로 끝났다 -> 꼬리. 로그 x"),
    ])
    pd = mk(ws, "dddd4444", ["attempts: 0"])
    dfm = T.read_fm(pd)[0]
    out = T.reclaim(pd, dfm, "세션 죽음")
    assert "REAP dddd4444 attempts=1" in out, "D: 요청 오류인데 attempts를 안 올렸다\n" + out
    dopen = os.path.join(ws, "tickets/dddd4444.md")
    assert T.read_fm(dopen)[0]["attempts"].strip() == "1", "D: attempts 기록이 다르다"

    # E) 요청 오류가 상한을 넘기면 사람이 쓸 답이 없으므로 이제 상신이 아니라 백오프다
    #    (§답변 대기 결정 1, P395-2) - 티켓은 `awaiting:` 없이 열린 채 남는다.
    pe = mk(ws, "eeee5555", ["attempts: " + str(T.REAP_MAX_ATTEMPTS)],
            body="## Goal\n테스트\n\n## Done when\n- [ ] 하나\n")
    write_log(ws, [
        L("2026-09-02 23:10:00", "w2", "eeee5555", "DISPATCH {h} kind=work"),
        L("2026-09-02 23:11:00", "w2", "eeee5555", "FAIL {h} 세션이 result is_error로 끝났다 -> 꼬리. 로그 x"),
    ])
    efm = T.read_fm(pe)[0]
    out = T.reclaim(pe, efm, "세션 죽음", local=local)
    assert "백오프" in out, "E: 요청 오류가 상한을 넘겼는데 백오프를 안 걸었다\n" + out
    assert "ASK" not in out, "E: 요청 오류인데 여전히 상신한다\n" + out
    eopen = os.path.join(ws, "tickets/eeee5555.md")
    assert os.path.exists(eopen), "E: 백로그 복귀 안 됨(백오프도 열린 티켓이어야 한다)"
    efm2 = T.read_fm(eopen)[0]
    assert not (efm2.get("awaiting") or "").strip(), "E: 요청 오류인데 awaiting이 걸렸다"
    assert T.backoff_active(local, "eeee5555"), "E: 백오프 표식이 안 걸렸다"

    # F) 티켓 fb5865a4(§서른여섯 번째 승인 §판정 1) - FAIL 줄 자신이 reason=api_error를
    #    적으면 NOTE 엔진 불능 상관 없이도 한도로 잡혀 attempts를 안 쓴다.
    write_log(ws, [
        L("2026-09-10 10:00:00", "w2", "ffff6666", "DISPATCH {h} kind=work"),
        L("2026-09-10 10:01:00", "w2", "ffff6666",
          "FAIL {h} 세션이 result is_error로 끝났다 reason=api_error -> 꼬리. 로그 x"),
    ])
    pf = mk(ws, "ffff6666", ["attempts: 0"])
    ffm = T.read_fm(pf)[0]
    out = T.reclaim(pf, ffm, "세션 죽음")
    assert out.startswith("REAP ffff6666"), "F: reason=api_error인데 REAP이 아니다\n" + out
    assert "ASK" not in out, "F: reason=api_error 1회인데 상신했다\n" + out
    fopen = os.path.join(ws, "tickets/ffff6666.md")
    assert os.path.exists(fopen), "F: 백로그 복귀 안 됨"
    assert int(T.read_fm(fopen)[0].get("attempts", "").strip() or 0) == 0, \
        "F: reason=api_error 직독인데 attempts를 올렸다 - " + out

    # G) reason=bad_request는 종전 "요청 오류" 처분 그대로다 - attempts를 올린다(회귀 방지).
    write_log(ws, [
        L("2026-09-10 10:10:00", "w2", "gggg7777", "DISPATCH {h} kind=work"),
        L("2026-09-10 10:11:00", "w2", "gggg7777",
          "FAIL {h} 세션이 result is_error로 끝났다 reason=bad_request -> 꼬리. 로그 x"),
    ])
    pg = mk(ws, "gggg7777", ["attempts: 0"])
    gfm = T.read_fm(pg)[0]
    out = T.reclaim(pg, gfm, "세션 죽음")
    assert "REAP gggg7777 attempts=1" in out, "G: reason=bad_request 처분이 갈렸다\n" + out
    gopen = os.path.join(ws, "tickets/gggg7777.md")
    assert T.read_fm(gopen)[0]["attempts"].strip() == "1", "G: attempts 기록이 다르다"

    print("PASS 7/7")
finally:
    shutil.rmtree(ws, ignore_errors=True)
    shutil.rmtree(local, ignore_errors=True)
