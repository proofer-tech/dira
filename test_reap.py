#!/usr/bin/env python3
"""tickets.py reap 단위 검증 다섯 계열(구 test_reap_done_awaiting - limit_attempts - orphan_ps_timeout - pid_lock - pre_stage).
자체검증 - 실패하면 assert로 죽는다. 계열마다 함수 하나이고 각자 임시 디렉터리를 쓴다.
"""
__import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())
import sys


HERE = __import__("os").path.dirname(__import__("os").path.abspath(__file__))
sys.path.insert(0, HERE)


def test_done_awaiting():
    """`reap_release`가 `.done`을 되돌릴 때 답 없는 `awaiting` stem을 deps에서 빼는지(P437 결정 1).
자체검증 - 실패하면 assert로 죽는다.

실측(`e4bcae3c`, 2026-09-26): 세션이 답변 대기 티켓을 직접 풀고 `.done`으로 닫았는데 계획
상자 미점검(사유 `plan`)으로 되돌려지면, 되돌린 파일이 닫히기 전 잠금(`awaiting` stem이
`deps`에 남은 상태)을 그대로 들고 백로그로 간다. 그 stem 파일이 큐에 없으면(사람이 답할
생각이 없다) 영구히 멈춘다. `awaiting` 키는 남기고(GUI 판정은 deps로만 한다) deps만 뺀다.

넷 - (1) 답 파일 없음 -> deps에서 뺀다, awaiting은 남는다, 반환 문자열이 정해진 접미사로
끝난다 (2) 답 파일 있음 -> deps를 안 건드린다 (3) `.wip` 되돌림 -> deps를 안 건드린다
(4) `awaiting` 값이 따옴표로 감싸여 있어도(사람이 손으로 고친 frontmatter) (1)과 같이 뺀다
(P437-3 ②) - 고치기 전엔 `awaiting in deps` 비교가 따옴표 비대칭 때문에 항상 거짓이라
조용히 안 걸렸다."""
    import os
    import shutil
    import sys
    import tempfile

    import tickets as T


    def mk(troot, h, fm_lines, body="## Goal\n테스트\n\n## Done when\n- [ ] 하나\n", suffix=""):
        d = os.path.join(troot, "tickets")
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, h + suffix + ".md")
        with open(p, "w", encoding="utf-8") as f:
            f.write("---\nticket: {}\n{}\n---\n\n{}".format(h, "\n".join(fm_lines), body))
        return p


    ws = tempfile.mkdtemp()
    try:
        # (1) `.done` + `awaiting: X` + `deps: [Y, X]`이고 X 파일이 없다 -> reap_release(path,
        #     "plan") 뒤 열린 파일의 deps가 [Y]이고 awaiting: X는 남는다. 반환 문자열은
        #     ", 답 없는 잠금 X 해제"로 끝난다.
        p1 = mk(ws, "aaaa1111", ["awaiting: nosuchstem", "deps: [ffff9999, nosuchstem]"],
                suffix=T.DONE)
        mk(ws, "ffff9999", ["priority: 1"])  # deps에 남을 정상 stem - 실재한다
        out = T.reap_release(p1, "plan")
        open1 = os.path.join(ws, "tickets", "aaaa1111.md")
        assert os.path.exists(open1), "1: .done이 안 열렸다"
        fm1 = T.read_fm(open1)[0]
        assert fm1.get("deps", "").strip() == "[ffff9999]", \
            "1: deps에서 답 없는 stem이 안 빠졌다 - " + repr(fm1.get("deps"))
        assert fm1.get("awaiting", "").strip() == "nosuchstem", \
            "1: awaiting 키가 지워졌다 - " + repr(fm1.get("awaiting"))
        assert out.endswith(", 답 없는 잠금 nosuchstem 해제"), \
            "1: 반환 문자열이 정해진 접미사로 안 끝난다 - " + out

        # (2) 같은 조건인데 X 파일(`X.done.md`)이 있으면 deps가 안 바뀐다.
        p2 = mk(ws, "bbbb2222", ["awaiting: ccccstem", "deps: [ffff9999, ccccstem]"], suffix=T.DONE)
        mk(ws, "ccccstem", ["kind: answer"], suffix=T.DONE)  # 답 파일이 실재한다
        out2 = T.reap_release(p2, "plan")
        open2 = os.path.join(ws, "tickets", "bbbb2222.md")
        fm2 = T.read_fm(open2)[0]
        assert fm2.get("deps", "").strip() == "[ffff9999, ccccstem]", \
            "2: 답 파일이 있는데 deps가 바뀌었다 - " + repr(fm2.get("deps"))
        assert ", 답 없는 잠금" not in out2, "2: 답 파일이 있는데 해제 메시지를 냈다\n" + out2

        # (3) `.wip` 이름을 되돌리면 X 파일이 없어도 deps가 안 바뀐다(닫은 적 없으니 잠금 근거 0).
        p3 = mk(ws, "cccc3333", ["awaiting: nosuchstem2", "deps: [ffff9999, nosuchstem2]"],
                suffix=T.IN_PROGRESS)
        out3 = T.reap_release(p3, "plan")
        open3 = os.path.join(ws, "tickets", "cccc3333.md")
        fm3 = T.read_fm(open3)[0]
        assert fm3.get("deps", "").strip() == "[ffff9999, nosuchstem2]", \
            "3: .wip 되돌림인데 deps가 바뀌었다 - " + repr(fm3.get("deps"))
        assert ", 답 없는 잠금" not in out3, "3: .wip 되돌림인데 해제 메시지를 냈다\n" + out3

        # (4) `awaiting: "X"`처럼 따옴표가 붙어도 (1)과 같은 결과가 나온다(따옴표 비대칭 회귀).
        p4 = mk(ws, "dddd4444", ['awaiting: "nosuchstem3"', "deps: [ffff9999, nosuchstem3]"],
                suffix=T.DONE)
        out4 = T.reap_release(p4, "plan")
        open4 = os.path.join(ws, "tickets", "dddd4444.md")
        fm4 = T.read_fm(open4)[0]
        assert fm4.get("deps", "").strip() == "[ffff9999]", \
            "4: 따옴표 붙은 awaiting이 deps에서 안 빠졌다 - " + repr(fm4.get("deps"))
        assert out4.endswith(", 답 없는 잠금 nosuchstem3 해제"), \
            "4: 따옴표 붙은 awaiting에서 반환 문자열이 정해진 접미사로 안 끝난다 - " + out4

        print("PASS (1)-(4) - 답 없는 stem 제거+awaiting 유지+반환 문자열 접미사 / "
              "답 있으면 무변 / .wip 되돌림 무변 / 따옴표 붙은 awaiting도 제거")
    finally:
        shutil.rmtree(ws, ignore_errors=True)


def test_limit_attempts():
    """한도로 죽은 세션은 회수 자리(reclaim/reap_release)가 어디든 attempts를 안 쓴다(P360-4).
자체검증 - 실패하면 assert로 죽는다.

실측(2026-09-02, 86a26ad2): 같은 한도 사망이 부모 워커의 사후처리(reap_release, attempts를
안 건드림)로 회수되면 예산을 안 쓰고, 남의 리퍼의 reclaim으로 회수되면 종전엔 attempts를
그대로 올려 세었다. 이 파일은 reclaim이 dead_reason으로 한도를 미리 갈라 attempts를 그대로
두는지, 한도가 아닌 사인은 종전대로 올리고 상한을 넘기면 상신하는지를 고정한다."""
    import os
    import shutil
    import sys
    import tempfile

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

        # H) P435 결정 2 - reason=bg FAIL이 상한을 넘기면 dead_reason이 "백그라운드 중단"을 내고
        #    E(요청 오류)와 같은 모양으로 상신이 아니라 백오프로 돌린다(awaiting 없이 열린다).
        ph = mk(ws, "hhhh8888", ["attempts: " + str(T.REAP_MAX_ATTEMPTS)],
                body="## Goal\n테스트\n\n## Done when\n- [ ] 하나\n")
        write_log(ws, [
            L("2026-09-25 23:00:00", "w2", "hhhh8888", "DISPATCH {h} kind=work"),
            L("2026-09-25 23:20:00", "w2", "hhhh8888",
              "FAIL {h} 세션이 ok로 끝났는데 .wip을 남겼다(신선한 블록 없음) reason=bg sid=x"),
        ])
        hfm = T.read_fm(ph)[0]
        assert T.dead_reason(T._log_lines(ws), "hhhh8888") == "백그라운드 중단", \
            "H: reason=bg를 백그라운드 중단으로 못 갈랐다"
        out = T.reclaim(ph, hfm, "세션 죽음", local=local)
        assert "백오프" in out, "H: reason=bg가 상한을 넘겼는데 백오프를 안 걸었다\n" + out
        assert "ASK" not in out, "H: reason=bg인데 여전히 상신한다\n" + out
        hopen = os.path.join(ws, "tickets/hhhh8888.md")
        assert os.path.exists(hopen), "H: 백로그 복귀 안 됨(백오프도 열린 티켓이어야 한다)"
        hfm2 = T.read_fm(hopen)[0]
        assert not (hfm2.get("awaiting") or "").strip(), "H: reason=bg인데 awaiting이 걸렸다"
        assert T.backoff_active(local, "hhhh8888"), "H: 백오프 표식이 안 걸렸다"

        print("PASS 8/8")
    finally:
        shutil.rmtree(ws, ignore_errors=True)
        shutil.rmtree(local, ignore_errors=True)


def test_orphan_ps_timeout():
    """ps가 시간을 넘겨도 REAP_CLEAR 전부 빈 .wip만 회수하는지 검증(P522 결정 6). 실패하면 assert로 죽는다."""
    import os
    import sys
    import stat
    import time
    import shutil
    import tempfile
    import subprocess

    HERE = os.path.dirname(os.path.abspath(__file__))
    tmp = tempfile.mkdtemp()
    try:
        bindir = os.path.join(tmp, "bin")
        os.makedirs(bindir)
        ps = os.path.join(bindir, "ps")
        with open(ps, "w") as f:
            f.write("#!/bin/sh\nsleep 15\n")
        os.chmod(ps, os.stat(ps).st_mode | stat.S_IXUSR)

        td = os.path.join(tmp, "q", "tickets")
        os.makedirs(td)
        paths = {}
        for h, extra in (("aaaa1111", ""), ("bbbb2222", "owner: developer / w1-x\n")):
            p = os.path.join(td, h + ".wip.md")
            with open(p, "w", encoding="utf-8") as f:
                f.write("---\nticket: {}\nkind: work\npersona: developer\npid:\n{}---\n\n## Goal\nx\n".format(h, extra))
            old = time.time() - 181
            os.utime(p, (old, old))
            paths[h] = p

        env = dict(os.environ, PATH=bindir + os.pathsep + os.environ["PATH"])
        r = subprocess.run([sys.executable, os.path.join(HERE, "tickets.py"), "reap", os.path.join(tmp, "q")],
                           capture_output=True, text=True, env=env, timeout=120)
        print(r.stdout, r.stderr)
        assert r.returncode == 0, r.returncode
        assert os.path.exists(os.path.join(td, "aaaa1111.md")), "전부 빈 .wip이 열림으로 안 돌아왔다"
        assert not os.path.exists(paths["aaaa1111"])
        assert os.path.exists(paths["bbbb2222"]), "owner가 찬 .wip은 보류여야 한다"
        print("OK")
    finally:
        shutil.rmtree(tmp)


def test_pid_lock():
    """P514-1 자체검증: reap 루트 잠금(결정 3)과 ps 실패 때 pid 판정(결정 4). 실패하면 assert로 죽는다."""
    import os
    import sys
    import hashlib
    import tempfile
    from datetime import datetime, timedelta

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
    _orig_live = T.live_session_ids  # 같은 프로세스의 다음 함수가 진짜 ps 판정을 쓰도록 끝에서 되돌린다
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
    T.live_session_ids = _orig_live


def test_pre_stage():
    """P541-3 자체검증: pid 빈 .wip + 산 워커 락은 TICKET_PRE_MAX + REAP_POST_GRACE_SEC까지 회수하지
않는다. 락이 죽었거나 pid가 있으면 종전 판정. 실패하면 assert로 죽는다."""
    import hashlib
    import os
    import shutil
    import sys
    import tempfile
    from datetime import datetime, timedelta

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


if __name__ == "__main__":
    for _n, _f in sorted(globals().items()):
        if _n.startswith("test_") and callable(_f):
            _f()
            print("ok  ", _n)
