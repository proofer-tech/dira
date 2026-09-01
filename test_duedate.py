#!/usr/bin/env python3
"""§1-4 마감 자체검증(docs/DESIGN.md §1-4): frontmatter `duedate:` 한 줄이 시계로 §1-3의
우선순위 기준값을 덮는가.

판정은 임시 큐에서만 낸다(§제약 1 — 도그푸딩 큐를 안 쓴다). §1-4 §검증의 ①~⑬을 전부 잰다.

①~⑨·⑬은 `tickets.py`(scan) 순수 로직이라 `now`를 인자로 넣어 직접 잰다(시계를 안 기다린다).
⑫(1 게이트)와 DISPATCH 로그 출처 표기는 `tick.sh` 선정 루프의 일이라 워커 + dryrun/실제
tick(가짜 엔진)으로 잰다. ⑩·⑪(선점, §1-3 §5가 파생 5로도 발동하는가)은 §1-3 자기 ⑦~⑨와
같은 관용구 — 가짜 스트리밍 엔진(init+cat)으로 실제 디스패치 한 바퀴를 돌려 잰다(`40ce8b2a`가
그 메커니즘을 세운 뒤에야 잴 수 있어서 여기 있다 - test_priority.py가 스스로 정한 값 그대로다).

실패하면 assert로 죽는다.
"""
import contextlib
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(HERE, "tickets.py")
TICK = os.path.join(HERE, "tick.sh")

sys.path.insert(0, HERE)
import tickets as T  # noqa: E402 (경로 삽입 뒤에 임포트)

NOW = datetime(2026, 8, 7, 12, 0, 0)


def due(delta):
    return (NOW + delta).isoformat()


# ⑭ 큐 무수정: 이 티켓이 새로 쓰는 frontmatter 키는 `duedate` 하나뿐이고, 그것도 사람이
# 적은 값이라 안 쓴다(계산값은 파일에 안 남는다). 아래 픽스처가 손으로 심는 키만 허용한다.
ALLOWED_FM = {"ticket", "title", "priority", "duedate", "deps",
              "session_id", "assigned_at", "owner", "pid", "inbox"}


def mk(root, h, fm=""):
    d = os.path.join(root, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\ntitle: t\n{}---\n\n## Goal\ntest\n".format(h, fm))
    return p


def audit(root):
    """지금 큐에 있는 티켓 전부의 frontmatter 키가 ALLOWED_FM 안인지 본다(⑭)."""
    tdir = os.path.join(root, "tickets")
    if not os.path.isdir(tdir):
        return
    for f in sorted(os.listdir(tdir)):
        with open(os.path.join(tdir, f), encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        assert lines[0] == "---", "frontmatter가 깨졌다: " + f
        for line in lines[1:]:
            if line.strip() == "---":
                break
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):", line)
            assert not m or m.group(1) in ALLOWED_FM, \
                "새 frontmatter 키가 생겼다: {} ({})".format(m.group(1), f)


def reset(root):
    audit(root)
    tdir = os.path.join(root, "tickets")
    if os.path.isdir(tdir):
        shutil.rmtree(tdir)


def scan_at(root, now=NOW):
    """T.scan을 stderr 캡처와 함께 부른다 -> (rows, stderr 문자열)."""
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        rows = T.scan(root, now=now)
    return rows, buf.getvalue()


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")

    # --- ① 파생 5 — 마감이 가까우면(<=5h) raw priority가 낮아도 5로 뜬다 ---
    mk(root, "aaaa0001", "priority: 3\n")                                     # 먼저 태어난다
    mk(root, "zzzz0002", "priority: 1\nduedate: {}\n".format(due(timedelta(hours=4))))
    rows, err = scan_at(root)
    eff = {r["hash"]: r["effective"] for r in rows}
    order = [r["hash"] for r in rows]
    assert eff["zzzz0002"] == 5, eff
    assert eff["aaaa0001"] == 3, eff
    assert order[0] == "zzzz0002", "파생 5가 raw priority 3을 못 이겼다: " + str(order)
    reset(root)

    # --- ② 파생 1 — 마감이 멀면(>=7d) raw priority가 높아도 1로 뜬다(덮는다는 뜻) ---
    mk(root, "aaaa0003", "priority: 3\n")
    mk(root, "zzzz0004", "priority: 5\nduedate: {}\n".format(due(timedelta(days=8))))
    rows, err = scan_at(root)
    eff = {r["hash"]: r["effective"] for r in rows}
    order = [r["hash"] for r in rows]
    assert eff["zzzz0004"] == 1, eff
    assert order == ["aaaa0003", "zzzz0004"], \
        "파생 1이 raw priority 5를 못 덮었다: " + str(order)
    reset(root)

    # --- ③ 가운데(5시간 초과 ~ 7일 미만)는 안 갈린다 - 명시값이 그대로 남는다 ---
    mk(root, "aaaa0005", "priority: 3\nduedate: {}\n".format(due(timedelta(days=2))))
    mk(root, "bbbb0006", "priority: 3\n")
    rows, err = scan_at(root)
    byh = {r["hash"]: r for r in rows}
    assert byh["aaaa0005"]["baseline"] == 3 and byh["aaaa0005"]["effective"] == 3, byh
    assert byh["bbbb0006"]["baseline"] == 3 and byh["bbbb0006"]["effective"] == 3, byh
    assert [r["hash"] for r in rows] == ["aaaa0005", "bbbb0006"], \
        "duedate가 가운데 값인데 마감 없는 자리와 순서가 갈렸다"
    reset(root)

    # --- ④ 지난 마감(남은 시간이 음수)도 5다 ---
    mk(root, "cccc0007", "priority: 2\nduedate: {}\n".format(due(timedelta(hours=-1))))
    rows, err = scan_at(root)
    eff = {r["hash"]: r["effective"] for r in rows}
    assert eff["cccc0007"] == 5, eff
    reset(root)

    # --- ⑤ 경계 — 정확히 5시간=5, 정확히 7일=1(둘 다 포함) ---
    mk(root, "dddd0008", "priority: 2\nduedate: {}\n".format(due(timedelta(hours=5))))
    mk(root, "eeee0009", "priority: 4\nduedate: {}\n".format(due(timedelta(days=7))))
    rows, err = scan_at(root)
    eff = {r["hash"]: r["effective"] for r in rows}
    assert eff["dddd0008"] == 5, eff
    assert eff["eeee0009"] == 1, eff
    reset(root)

    # --- ⑥ 못 읽는 값 — 자연어·빈 값 둘 다 마감 없음 + WARN 한 줄씩 ---
    mk(root, "ffff0010", "priority: 3\nduedate: 내일\n")
    mk(root, "gggg0011", "priority: 3\nduedate:\n")
    rows, err = scan_at(root)
    eff = {r["hash"]: r["effective"] for r in rows}
    assert eff["ffff0010"] == 3 and eff["gggg0011"] == 3, eff
    assert err.count("WARN duedate 못 읽음") == 2, "WARN이 2줄이 아니다:\n" + err
    reset(root)

    # --- ⑦ 전이 — 마감은 급한 쪽(5)으로 dep 역방향을 탄다. 체인 3단·순환 둘 다 안 멈춘다 ---
    mk(root, "aaaa0012", "duedate: {}\ndeps: [bbbb0013]\n".format(due(timedelta(hours=3))))
    mk(root, "bbbb0013", "deps: [cccc0014]\n")
    mk(root, "cccc0014", "deps: [dddd0015]\n")
    mk(root, "dddd0015", "")
    rows, err = scan_at(root)
    eff = {r["hash"]: r["effective"] for r in rows}
    assert eff == {"aaaa0012": 5, "bbbb0013": 5, "cccc0014": 5, "dddd0015": 5}, eff

    mk(root, "xxxx0016", "duedate: {}\ndeps: [yyyy0017]\n".format(due(timedelta(hours=3))))
    mk(root, "yyyy0017", "deps: [xxxx0016]\n")
    rows, err = scan_at(root)
    eff = {r["hash"]: r["effective"] for r in rows}
    assert eff["xxxx0016"] == 5 and eff["yyyy0017"] == 5, \
        "순환에서 전이가 안 멈추거나 값이 안 접혔다: " + str(eff)
    reset(root)

    # --- ⑧ 강등(1)은 전이하지 않는다 - A(마감 +10d) deps [B(priority 5)]에서 B는 유효 5 그대로 ---
    mk(root, "aaaa0018", "duedate: {}\ndeps: [bbbb0019]\n".format(due(timedelta(days=10))))
    mk(root, "bbbb0019", "priority: 5\n")
    rows, err = scan_at(root)
    eff = {r["hash"]: r["effective"] for r in rows}
    assert eff["aaaa0018"] == 1, "A 자신은 강등돼야 한다: " + str(eff)
    assert eff["bbbb0019"] == 5, "강등이 전이됐다 - B가 5 밑으로 떨어졌다: " + str(eff)

    # --- ⑨ 파일 무수정 - 위 시나리오를 돌린 뒤에도 frontmatter가 한 글자도 안 갈렸다 ---
    with open(os.path.join(root, "tickets", "bbbb0019.md"), encoding="utf-8") as f:
        assert "priority: 5" in f.read(), "파생 계산이 B의 frontmatter를 고쳤다"
    with open(os.path.join(root, "tickets", "aaaa0018.md"), encoding="utf-8") as f:
        assert "duedate: {}".format(due(timedelta(days=10))) in f.read(), \
            "유효마감 계산이 A의 duedate를 고쳤다"
    reset(root)

    # --- 역전 — 선행(B) duedate가 후행(A) duedate보다 늦으면 WARN 한 줄, 판정은 그대로 ---
    mk(root, "aaaa0020", "duedate: {}\ndeps: [bbbb0021]\n".format(due(timedelta(hours=2))))
    mk(root, "bbbb0021", "duedate: {}\n".format(due(timedelta(days=1))))
    rows, err = scan_at(root)
    assert "WARN 마감 역전 bbbb0021 > aaaa0020" in err, "역전 WARN이 안 찍혔다:\n" + err
    eff = {r["hash"]: r["effective"] for r in rows}
    assert eff["bbbb0021"] == 5, "역전이어도 판정은 그대로 돈다(전이가 이미 당겨놨다): " + str(eff)
    reset(root)

    # --- ⑬ now가 인자다 - 같은 큐 스냅샷에 다른 now 둘을 주면 값이 갈린다(시계를 안 기다린다) ---
    mk(root, "aaaa0030", "priority: 3\nduedate: {}\n".format(due(timedelta(hours=4))))
    eff_near, _ = scan_at(root, now=NOW)
    eff_far, _ = scan_at(root, now=NOW - timedelta(days=2))
    v_near = {r["hash"]: r["effective"] for r in eff_near}["aaaa0030"]
    v_far = {r["hash"]: r["effective"] for r in eff_far}["aaaa0030"]
    assert v_near == 5, v_near
    assert v_far == 3, v_far
    reset(root)

    print("OK - test_duedate §1-4 §검증 ①~⑨·⑬ (⑩·⑪ 선점은 파일 맨 끝에서 잰다)")

    # =====================================================================
    # ⑫ 1 게이트 + DISPATCH 로그 출처 표기 — tick.sh를 실제로 태운다(실시계, dryrun/tick)
    # =====================================================================
    workers = os.path.join(root, "workers")
    os.makedirs(workers, exist_ok=True)
    w1 = os.path.join(workers, "w1.sh")
    with open(w1, "w", encoding="utf-8") as f:
        f.write('#!/bin/bash\n'
                'TICKET_NAME="w1"\n'
                'TICKET_CWD="{tmp}"\n'
                'TICKET_ENGINE=("/bin/true" "{{prompt}}" "{{sid}}")\n'
                '. "{tick}"\n'.format(tmp=tmp, tick=TICK))
    os.chmod(w1, 0o755)
    local = os.path.join(tmp, "local")

    def dryrun():
        r = subprocess.run([w1, "dryrun"], capture_output=True, text=True,
                           env=dict(os.environ, TICKET_LOCAL=local), timeout=30)
        assert r.returncode == 0, r.stdout + r.stderr
        return r.stdout

    def runlog():
        try:
            with open(os.path.join(workers, "runner.log"), encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    # 실시계 기준 8일 뒤 마감 -> 파생 1. .wip 1건 있으면 후보가 아니다.
    real_far = (datetime.now() + timedelta(days=8)).isoformat()
    mk(root, "aaaa0022", "priority: 5\n")
    shutil.move(os.path.join(root, "tickets", "aaaa0022.md"),
               os.path.join(root, "tickets", "wwww0023.wip.md"))
    with open(os.path.join(root, "tickets", "wwww0023.wip.md"), "w", encoding="utf-8") as f:
        f.write("---\nticket: wwww0023\ntitle: t\n---\n\n## Goal\ntest\n")
    mk(root, "bbbb0024", "priority: 5\nduedate: {}\n".format(real_far))
    before = len(runlog())
    out = dryrun()
    added = runlog()[before:]
    assert "선정:" not in out, "진행중 1건인데 파생 1이 떴다:\n" + out
    assert "SKIP 우선순위 1 bbbb0024" in added, "1 게이트 SKIP 로그가 없다:\n" + added

    os.remove(os.path.join(root, "tickets", "wwww0023.wip.md"))
    out = dryrun()
    assert "선정: bbbb0024" in out, "진행중 0건인데 파생 1이 안 떴다:\n" + out
    reset(root)
    shutil.rmtree(workers, ignore_errors=True)

    print("OK - test_duedate §1-4 §검증 ⑫ (1 게이트)")

    # --- DISPATCH 로그 출처 — (마감) · (상속 N) · (마감·상속 N) 세 꼴을 실제 tick으로 잰다 ---
    workers = os.path.join(root, "workers")
    os.makedirs(workers, exist_ok=True)
    eng = os.path.join(tmp, "fake-engine.sh")
    with open(eng, "w", encoding="utf-8") as f:
        f.write('#!/bin/bash\nprintf \'{{"session_id":"%s"}}\\n\' "$2"\n')
    os.chmod(eng, 0o755)
    w2 = os.path.join(workers, "w2.sh")
    with open(w2, "w", encoding="utf-8") as f:
        f.write('#!/bin/bash\n'
                'TICKET_NAME="w2"\n'
                'TICKET_CWD="{tmp}"\n'
                'TICKET_ENGINE=("{eng}" "{{prompt}}" "{{sid}}")\n'
                '. "{tick}"\n'.format(tmp=tmp, eng=eng, tick=TICK))
    os.chmod(w2, 0o755)

    def tick():
        r = subprocess.run([w2, "tick"], capture_output=True, text=True,
                           env=dict(os.environ, TICKET_LOCAL=local), timeout=60)
        assert r.returncode == 0, r.stdout + r.stderr

    # (마감) 단독 - 자기 파생이 기준을 덮고, 그 위에 더 얹히는 상속이 없다.
    mk(root, "aaaa0025", "priority: 3\nduedate: {}\n".format(
        (datetime.now() + timedelta(hours=1)).isoformat()))
    tick()
    log = runlog()
    assert re.search(r"DISPATCH aaaa0025 .*prio=5\(마감\)\n", log), \
        "(마감) 표기가 없다:\n" + log
    reset(root)

    # (상속 N) 단독 - §1-3 종전 그대로(회귀 확인). duedate가 아예 없다.
    mk(root, "dddd0028", "priority: 3\n")
    mk(root, "eeee0029", "priority: 5\ndeps: [dddd0028]\n")     # dddd0028을 기다린다
    tick()
    log = runlog()
    assert re.search(r"DISPATCH dddd0028 .*prio=5\(상속 3\)\n", log), \
        "(상속 N) 표기가 회귀했다:\n" + log
    reset(root)

    # (마감·상속 N) - 자기 파생(1로 강등)이 기준을 덮고, 그 위에 상속(4)이 더 얹힌다.
    mk(root, "bbbb0026", "priority: 3\nduedate: {}\n".format(
        (datetime.now() + timedelta(days=10)).isoformat()))
    mk(root, "cccc0027", "priority: 4\ndeps: [bbbb0026]\n")     # bbbb0026을 기다린다
    tick()
    log = runlog()
    assert re.search(r"DISPATCH bbbb0026 .*prio=4\(마감·상속 1\)\n", log), \
        "(마감·상속 N) 표기가 없다:\n" + log
    reset(root)
    shutil.rmtree(workers, ignore_errors=True)

    print("OK - test_duedate §1-4 §로그 (마감)·(상속 N)·(마감·상속 N)")

    # =====================================================================
    # ⑩·⑪ 선점(§1-3 §5) — 파생 5도 시계만으로 발동한다. 새 메커니즘 0개, 죽이는 경로가
    # §2-5 강제 종료와 글자 그대로 같아서 흉내로는 못 잰다 - 실제 디스패치 한 바퀴로 잰다
    # (test_priority.py §검증 ⑦~⑨와 같은 관용구).
    # =====================================================================
    FAKE_ENGINE = """\
#!/bin/bash
printf '{"type":"system","subtype":"init"}\\n'
exec cat > /dev/null
"""
    WORKER_TMPL = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_INPROGRESS=".wip"
TICKET_DONE=".done"
TICKET_FEED_TIMEOUT=30
TICKET_MAXRUN=120
TICKET_ENGINE=("{tmp}/fake-stream-engine.sh" --input-format stream-json)
. "{tick}"
"""

    def mkfile(path, body, mode=0o644):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        os.chmod(path, mode)
        return path

    def wait_for(cond, limit=40, step=0.5):
        for _ in range(int(limit / step)):
            if cond():
                return True
            time.sleep(step)
        return False

    workers = os.path.join(root, "workers")
    local3 = os.path.join(tmp, "local3")
    os.makedirs(local3, exist_ok=True)
    penv = dict(os.environ, TICKET_LOCAL=local3)
    mkfile(os.path.join(tmp, "fake-stream-engine.sh"), FAKE_ENGINE, 0o755)
    w1 = mkfile(os.path.join(workers, "w1.sh"),
                WORKER_TMPL.format(name="w1", tmp=tmp, tick=TICK), 0o755)
    runlog_path = os.path.join(workers, "runner.log")

    def preemptlog():
        try:
            with open(runlog_path, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def dispatch_busy(w, h, extra=""):
        mkfile(os.path.join(root, "tickets", h + ".md"),
               "---\nticket: {}\ntitle: t\n{}---\n\n## Goal\ntest\n".format(h, extra))
        p = subprocess.Popen([w, "tick"], env=penv,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        procs.append(p)
        wip = os.path.join(root, "tickets", h + ".wip.md")
        assert wait_for(lambda: os.path.exists(wip) and "inbox:" in
                        open(wip, encoding="utf-8").read()), \
            "{} 디스패치가 안 떴다\n{}".format(h, preemptlog())
        return wip

    procs = []
    try:
        # --- ⑩ 선점 — 파생 5(마감 now+1h)가 뜨면 도는 세션(파생 없음, eff 3)이 끊긴다 ---
        wip_a = dispatch_busy(w1, "aaaa1101")
        due5 = (datetime.now() + timedelta(hours=1)).isoformat()
        mkfile(os.path.join(root, "tickets", "bbbb1102.md"),
               "---\nticket: bbbb1102\ntitle: t\nduedate: {}\n---\n\n## Goal\ntest\n".format(due5))
        before = len(preemptlog())
        subprocess.run([w1, "tick"], capture_output=True, text=True, env=penv, timeout=30)
        assert wait_for(lambda: "KILLED aaaa1101" in preemptlog(), 20), \
            "파생 5가 도는 세션을 안 죽였다:\n" + preemptlog()[before:]
        added = preemptlog()[before:]
        assert re.search(r"PREEMPT aaaa1101 -> bbbb1102 pid=\d+", added), \
            "PREEMPT 로그가 없다:\n" + added
        backlog = os.path.join(root, "tickets", "aaaa1101.md")
        assert wait_for(lambda: os.path.exists(backlog), 10), \
            "끊긴 티켓이 열림으로 안 돌아왔다"
        body = open(backlog, encoding="utf-8").read()
        assert "밀어낸 티켓 | bbbb1102" in body, \
            "`## 선점`의 «누가 밀었나»에 마감 티켓 해시가 없다\n" + body
        os.remove(os.path.join(root, "tickets", "bbbb1102.md"))
        reset(root)

        # --- ⑪ 마감으로 뜬 유효 5끼리는 안 끊는다 ---
        wip_b = dispatch_busy(w1, "cccc1103",
                              "duedate: {}\n".format((datetime.now()
                                                       + timedelta(hours=4)).isoformat()))
        mkfile(os.path.join(root, "tickets", "dddd1104.md"),
               "---\nticket: dddd1104\ntitle: t\nduedate: {}\n---\n\n## Goal\ntest\n".format(
                   (datetime.now() + timedelta(hours=1)).isoformat()))
        before = len(preemptlog())
        subprocess.run([w1, "tick"], capture_output=True, text=True, env=penv, timeout=30)
        added = preemptlog()[before:]
        assert "PREEMPT" not in added, "유효 5끼리인데 죽였다:\n" + added
        assert os.path.exists(wip_b), "마감 5인데 죽어서 열림으로 돌아갔다"

        print("OK - test_duedate §1-4 §검증 ⑩~⑪ (선점 — 파생 5도 §1-3 §선점을 그대로 탄다)")
    finally:
        for p in procs:
            try:
                p.kill()
                p.wait(timeout=5)
            except Exception:
                pass
        shutil.rmtree(workers, ignore_errors=True)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
