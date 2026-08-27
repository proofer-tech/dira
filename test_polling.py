#!/usr/bin/env python3
"""폴링 대기(§폴링 대기) 자체검증 - 수용조건 1번부터 11번까지. 화면(12·13)은 이 티켓이
아니다(`4be14983`). 진짜 claude를 부르지 않는다 - argv 기반 즉시 성공 가짜 엔진 하나로
DISPATCH 여부만 본다. 실패하면 assert로 죽는다."""
import os
import sys
import time
import shutil
import tempfile
import subprocess
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
PY = os.path.join(HERE, "tickets.py")

WORKER_TMPL = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{cwd}"
TICKET_PROMPT_FMT="pick up %s"
TICKET_ENGINE=("{engine}" "{{prompt}}")
. "{tick}"
"""

# 비스트리밍 즉시 성공 가짜 엔진(test_cooldown.py CODEX_ENGINE과 같은 모양) - DISPATCH가
# 로그에 남는 것만 보면 되므로 세션 내용은 관심사가 아니다.
FAKE_ENGINE = """\
#!/bin/bash
echo '{"is_error":false,"type":"result","session_id":"x","subtype":"success"}'
exit 0
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


def iso(delta_sec):
    return (datetime.now().astimezone() + timedelta(seconds=delta_sec)).isoformat(timespec="seconds")


def mk(troot, h, fm_lines, body="## 목표\n테스트\n", suffix=""):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + suffix + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\n{}\n---\n\n{}".format(h, "\n".join(fm_lines), body))
    return p


def count(path):
    try:
        with open(path, encoding="utf-8") as f:
            return int((f.read().strip() or "0"))
    except (OSError, ValueError):
        return 0


class Env:
    """티켓 루트 + 로컬 상태 + 워커 하나짜리 격리 환경. 시나리오마다 새로 만든다."""

    def __init__(self, tag):
        self.tmp = tempfile.mkdtemp(prefix="poll-" + tag + "-")
        self.root = os.path.join(self.tmp, "dira")
        self.local = os.path.join(self.tmp, "local")
        os.makedirs(self.local)
        engine = mkfile(os.path.join(self.tmp, "fake-engine.sh"), FAKE_ENGINE, 0o755)
        self.w1 = mkfile(os.path.join(self.root, "workers", "w1.sh"),
                          WORKER_TMPL.format(cwd=self.tmp, engine=engine, tick=TICK), 0o755)
        self.env = dict(os.environ, TICKET_LOCAL=self.local)

    def run(self, *args, timeout=180):
        return subprocess.run([self.w1] + list(args), capture_output=True, text=True,
                               env=self.env, timeout=timeout)

    def runner_log(self):
        p = os.path.join(self.root, "workers", "runner.log")
        try:
            with open(p, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def cleanup(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


envs = []


def newenv(tag):
    e = Env(tag)
    envs.append(e)
    return e


passed = 0
try:
    # ---- 1. `poll` 서브커맨드 성공 경로 -------------------------------------------------
    e1 = newenv("start")
    h1 = "aaaa0001"
    p1 = mk(e1.root, h1,
            ["session_id: sess-1", "assigned_at: " + iso(0),
             "pid: " + str(os.getpid()), "owner: developer / w1-sess1234"],
            suffix=T.IN_PROGRESS)
    mkfile(os.path.join(e1.root, "polls", "ok.sh"), "#!/bin/bash\nexit 1\n", 0o755)
    until1 = iso(3600)
    r = e1.run("poll", h1, "ok.sh", until1)
    assert r.returncode == 0, "1: poll 거절됨 rc={}\n{}".format(r.returncode, r.stderr)
    assert not os.path.exists(p1), "1: .wip 파일이 그대로 남았다"
    opened1 = os.path.join(e1.root, "tickets", h1 + ".md")
    assert os.path.exists(opened1), "1: 열린 파일이 안 생겼다"
    fm1 = T.read_fm(opened1)[0]
    assert fm1["polling"].strip() == "ok.sh", "1: polling 미기록 " + repr(fm1.get("polling"))
    assert fm1["polling_until"].strip() == until1, "1: polling_until 불일치"
    assert not fm1.get("session_id", "").strip(), "1: session_id가 안 비었다"
    assert not fm1.get("owner", "").strip(), "1: owner가 안 비었다"
    passed += 1

    # ---- 2. select에서 빠지고 list는 `폴링 대기`로 낸다 ---------------------------------
    sel = subprocess.run([sys.executable, PY, "select", e1.root],
                          capture_output=True, text=True, timeout=10)
    assert h1 not in sel.stdout, "2: select에 폴링 대기 티켓이 여전히 뜬다\n" + sel.stdout
    lst = subprocess.run([sys.executable, PY, "list", e1.root],
                          capture_output=True, text=True, timeout=10)
    assert h1 in lst.stdout and "폴링 대기" in lst.stdout, "2: list가 폴링 대기로 안 낸다\n" + lst.stdout
    passed += 1

    # ---- 3. rc=1이 계속되면 tick 세 번을 돌려도 DISPATCH 0, polled_at만 갱신 -------------
    e3 = newenv("rc1")
    h3 = "bbbb0003"
    mk(e3.root, h3, ["polling: wait.sh", "polling_until: " + iso(3600)])
    mkfile(os.path.join(e3.root, "polls", "wait.sh"), "#!/bin/bash\nexit 1\n", 0o755)
    for _ in range(3):
        r = e3.run("tick")
        assert r.returncode == 0, "3: tick 실패\n" + r.stderr
    assert "DISPATCH {}".format(h3) not in e3.runner_log(), "3: 폴링 중인데 DISPATCH가 났다"
    fm3 = T.read_fm(os.path.join(e3.root, "tickets", h3 + ".md"))[0]
    assert fm3.get("polled_at", "").strip(), "3: polled_at이 안 갱신됐다"
    assert fm3["polling"].strip() == "wait.sh", "3: polling이 지워졌다"
    passed += 1

    # ---- 4. rc=0으로 바꾸면 같은 tick 안에서 polling이 지워지고 DISPATCH가 난다 ----------
    e4 = newenv("rc0")
    h4 = "cccc0004"
    mk(e4.root, h4, ["polling: ok.sh", "polling_until: " + iso(3600)])
    mkfile(os.path.join(e4.root, "polls", "ok.sh"), "#!/bin/bash\nexit 0\n", 0o755)
    r = e4.run("tick")
    assert r.returncode == 0, "4: tick 실패\n" + r.stderr
    assert "DISPATCH {}".format(h4) in e4.runner_log(), "4: 같은 tick에 DISPATCH가 안 났다\n" + e4.runner_log()
    passed += 1

    # ---- 5. dira-poll-interval: 300 - 300초 안 지났으면 안 돈다 --------------------------
    e5 = newenv("interval300")
    h5 = "dddd0005"
    counter5 = os.path.join(e5.tmp, "counter5")
    mk(e5.root, h5,
       ["polling: cnt.sh", "polling_until: " + iso(3600), "polled_at: " + iso(-5)])
    mkfile(os.path.join(e5.root, "polls", "cnt.sh"),
           "#!/bin/bash\n# dira-poll-interval: 300\nn=0\n[ -f {c} ] && n=$(cat {c})\n"
           "echo $((n+1)) > {c}\nexit 1\n".format(c=counter5), 0o755)
    r = e5.run("tick")
    assert r.returncode == 0, "5: tick 실패\n" + r.stderr
    assert count(counter5) == 0, "5: 300초 안 지났는데 돌았다"
    passed += 1

    # ---- 6. 주기를 5로 적으면(하한 30보다 작다) 매 tick 돌고 눌린 로그가 남는다 ----------
    e6 = newenv("interval5")
    h6 = "eeee0006"
    counter6 = os.path.join(e6.tmp, "counter6")
    mk(e6.root, h6,
       ["polling: cnt.sh", "polling_until: " + iso(3600), "polled_at: " + iso(-40)])
    mkfile(os.path.join(e6.root, "polls", "cnt.sh"),
           "#!/bin/bash\n# dira-poll-interval: 5\nn=0\n[ -f {c} ] && n=$(cat {c})\n"
           "echo $((n+1)) > {c}\nexit 1\n".format(c=counter6), 0o755)
    r = e6.run("tick")
    assert r.returncode == 0, "6: tick 실패\n" + r.stderr
    assert count(counter6) == 1, "6: 주기 5인데 안 돌았다"
    assert "눌렸다" in e6.runner_log(), "6: 눌린 사실 로그가 없다\n" + e6.runner_log()
    passed += 1

    # ---- 7. polling_until이 지난 뒤 tick 한 번 -> 답변 대기 + 마지막 폴링 출력 인용 -------
    e7 = newenv("expire")
    h7 = "ffff0007"
    p7 = mk(e7.root, h7, ["polling: cond.sh", "polling_until: " + iso(-10)])
    mkfile(os.path.join(e7.root, "polls", "지난-출력.log"), "", 0o644)  # 안 씀(경로 확인용 아님)
    logf7 = os.path.join(e7.root, "polls", h7 + ".log")
    mkfile(logf7, "빌드가 아직 안 끝났다\n", 0o644)
    r = e7.run("tick")
    assert r.returncode == 0, "7: tick 실패\n" + r.stderr
    fm7, lines7, end7 = T.read_fm(p7)
    assert not fm7["polling"].strip(), "7: polling이 안 지워졌다"
    assert fm7["polling_until"].strip(), "7: polling_until이 지워졌다(이력으로 남아야 한다)"
    awaiting7 = fm7["awaiting"].strip()
    assert len(awaiting7) == 8, "7: awaiting 미기록 " + repr(fm7.get("awaiting"))
    assert awaiting7 in T.deps_of(lines7, end7), "7: deps에 안 걸렸다"
    body7 = "\n".join(lines7[end7:])
    assert "## 질문 1" in body7, "7: 질문 절이 없다\n" + body7
    assert "빌드가 아직 안 끝났다" in body7, "7: 마지막 폴링 출력이 인용에 없다\n" + body7
    passed += 1

    # ---- 8. polling_fails가 3에 닿으면 같은 자리로 올라간다 -----------------------------
    e8 = newenv("fails3")
    h8 = "gggg0008"
    p8 = mk(e8.root, h8,
            ["polling: err.sh", "polling_until: " + iso(3600),
             "polling_fails: 2", "polled_at: " + iso(-40)])
    mkfile(os.path.join(e8.root, "polls", "err.sh"), "#!/bin/bash\nexit 2\n", 0o755)
    r = e8.run("tick")
    assert r.returncode == 0, "8: tick 실패\n" + r.stderr
    fm8, lines8, end8 = T.read_fm(p8)
    assert fm8["polling_fails"].strip() == "3", "8: polling_fails가 3이 아니다 " + repr(fm8.get("polling_fails"))
    assert not fm8["polling"].strip(), "8: polling이 안 지워졌다"
    assert len(fm8["awaiting"].strip()) == 8, "8: awaiting 미기록"
    body8 = "\n".join(lines8[end8:])
    assert "3회 오류" in body8, "8: 3연속 오류 사유가 없다\n" + body8
    passed += 1

    # ---- 9. 30초 넘게 매달리는 스크립트도 tick이 60초 안에 끝나고 오류로 세어진다 --------
    e9 = newenv("hang")
    h9 = "hhhh0009"
    p9 = mk(e9.root, h9, ["polling: hang.sh", "polling_until: " + iso(3600)])
    mkfile(os.path.join(e9.root, "polls", "hang.sh"), "#!/bin/bash\nsleep 40\nexit 1\n", 0o755)
    t0 = time.time()
    r = e9.run("tick", timeout=240)
    elapsed = time.time() - t0
    assert r.returncode == 0, "9: tick 실패\n" + r.stderr
    assert elapsed < 60, "9: tick이 60초 안에 안 끝났다 ({:.1f}s)".format(elapsed)
    fm9 = T.read_fm(p9)[0]
    assert fm9["polling_fails"].strip() == "1", "9: 상한 초과가 오류로 안 세어졌다 " + repr(fm9.get("polling_fails"))
    passed += 1

    # ---- 10. 워커 여섯이 같은 초에 떠도 스크립트 실행 횟수는 1만 오른다 -----------------
    e10 = newenv("lock6")
    h10 = "iiii0010"
    counter10 = os.path.join(e10.tmp, "counter10")
    mk(e10.root, h10, ["polling: cnt.sh", "polling_until: " + iso(3600)])
    mkfile(os.path.join(e10.root, "polls", "cnt.sh"),
           "#!/bin/bash\nn=0\n[ -f {c} ] && n=$(cat {c})\nsleep 0.3\n"
           "echo $((n+1)) > {c}\nexit 1\n".format(c=counter10), 0o755)
    workers10 = []
    for i in range(2, 8):    # w2..w7 - w1은 위에서 이미 만든 것과 이름이 겹치지 않게
        w = mkfile(os.path.join(e10.root, "workers", "w{}.sh".format(i)),
                   WORKER_TMPL.format(cwd=e10.tmp,
                                       engine=os.path.join(e10.tmp, "fake-engine.sh"),
                                       tick=TICK).replace('TICKET_NAME="w1"',
                                                           'TICKET_NAME="w{}"'.format(i)),
                   0o755)
        workers10.append(w)
    procs = [subprocess.Popen([w, "tick"], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, env=e10.env) for w in workers10]
    for pr in procs:
        assert pr.wait(timeout=180) == 0, "10: 워커 tick이 비정상 종료했다"
    assert count(counter10) == 1, "10: 스크립트 실행 횟수가 1이 아니다 - {}".format(count(counter10))
    passed += 1

    # ---- 11. poll 검사 다섯이 각각 거절을 내고 fm이 한 글자도 안 갈린다 -----------------
    e11 = newenv("reject")

    def snapshot(path):
        with open(path, "rb") as f:
            return f.read()

    # (a) 없는 파일
    ha = "jjjj0011"
    pa = mk(e11.root, ha,
            ["session_id: s", "pid: " + str(os.getpid()), "owner: dev / w1-x"], suffix=T.IN_PROGRESS)
    before_a = snapshot(pa)
    r = e11.run("poll", ha, "no-such.sh", iso(3600))
    assert r.returncode != 0, "11a: 없는 파일인데 통과했다"
    assert snapshot(pa) == before_a, "11a: fm이 바뀌었다"

    # (b) '/'가 든 값(`../`류)
    hb = "jjjj0012"
    pb = mk(e11.root, hb,
            ["session_id: s", "pid: " + str(os.getpid()), "owner: dev / w1-x"], suffix=T.IN_PROGRESS)
    before_b = snapshot(pb)
    r = e11.run("poll", hb, "../evil.sh", iso(3600))
    assert r.returncode != 0, "11b: '/'가 든 값인데 통과했다"
    assert snapshot(pb) == before_b, "11b: fm이 바뀌었다"

    # (c) 과거 시각
    hc = "jjjj0013"
    pc = mk(e11.root, hc,
            ["session_id: s", "pid: " + str(os.getpid()), "owner: dev / w1-x"], suffix=T.IN_PROGRESS)
    mkfile(os.path.join(e11.root, "polls", "ok11.sh"), "#!/bin/bash\nexit 1\n", 0o755)
    before_c = snapshot(pc)
    r = e11.run("poll", hc, "ok11.sh", iso(-10))
    assert r.returncode != 0, "11c: 과거 시각인데 통과했다"
    assert snapshot(pc) == before_c, "11c: fm이 바뀌었다"

    # (d) 남의 티켓(pid가 조상 사슬 밖 - "1"은 절대 못 만난다, tick.sh의 while 조건이 그 값에서 멈춘다)
    hd = "jjjj0014"
    pd = mk(e11.root, hd,
            ["session_id: s", "pid: 1", "owner: dev / w1-x"], suffix=T.IN_PROGRESS)
    before_d = snapshot(pd)
    r = e11.run("poll", hd, "ok11.sh", iso(3600))
    assert r.returncode != 0, "11d: 남의 티켓인데 통과했다"
    assert snapshot(pd) == before_d, "11d: fm이 바뀌었다"

    # (e) 처음부터 0을 내는 스크립트 - 이미 조건 도달, 대기에 안 넣고 그대로 둔다(fm 무수정)
    he = "jjjj0015"
    pe = mk(e11.root, he,
            ["session_id: s", "pid: " + str(os.getpid()), "owner: dev / w1-x"], suffix=T.IN_PROGRESS)
    mkfile(os.path.join(e11.root, "polls", "rc0-11.sh"), "#!/bin/bash\nexit 0\n", 0o755)
    before_e = snapshot(pe)
    r = e11.run("poll", he, "rc0-11.sh", iso(3600))
    assert snapshot(pe) == before_e, "11e: fm이 바뀌었다"

    passed += 1

    print("PASS {}/11".format(passed))
finally:
    for e in envs:
        e.cleanup()
