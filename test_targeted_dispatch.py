#!/usr/bin/env python3
"""지목 디스패치 `tick <해시>` + 선점 `preempt <해시> [--dryrun]` (docs/DESIGN.md §1-5,
엔진 계약 `3acc1a56`).

① `tick <해시>`가 FIFO 맨 앞이 아닌 티켓을 집는다.
② 그 해시가 후보가 아니면(이미 할당됨·deps 미충족·없는 티켓) 디스패치 없이 사유 한 줄만
   로그하고 큐는 안 바뀐다.
③ 게이트(페르소나 상한)에 걸리는 후보는 종전 SKIP 로그 그대로 걸리고 디스패치가 안 뜬다.
④ `preempt --dryrun`은 피해자 없으면 빈 출력 + 0이 아닌 종료 코드, 있으면 한 줄
   (해시 - 제목 - 워커)만 내고 큐를 한 글자도 안 고친다.
⑤ `preempt <해시>`(실제) — 소유자 필터 없이 큐 전체에서 피해자를 고르고, `## 선점` 표의
   `밀어낸 티켓` 칸에 지목한 해시가 오고, 피해자는 답변 대기가 아니라 열림으로 돌아오고,
   피해자를 물었던 워커(자신이 아니어도)가 지목한 해시를 집는다.

②·⑤ 이외의 게이트·정렬은 test_priority.py·test_duedate.py가 이미 잰다 - 여기서 다시 안 짠다.
가짜 엔진(test_unassign_force.py·test_priority.py와 같은 관용구)만 쓴다. 실패하면 assert로 죽는다.
"""
import datetime
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

TICKET = "---\nticket: {h}\ntitle: t\n{fm}---\n\n## Goal\ntest\n"

# 비스트리밍 가짜 엔진 - test_persona_engine.py와 같은 갈래. 즉시 성공 result를 내고 죽는다.
FLAT_ENGINE = """\
#!/bin/bash
printf '{{"session_id":"%s","type":"result","is_error":false,"subtype":"success"}}\\n' "$2"
exit 0
"""
FLAT_WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_ENGINE=("{tmp}/flat-engine.sh" "{{prompt}}" "{{sid}}")
. "{tick}"
"""

# 스트리밍 가짜 엔진 - test_priority.py와 같은 관용구. init 한 줄 + cat으로 살아 남는다(피해자 역).
FAKE_ENGINE = """\
#!/bin/bash
printf '{"type":"system","subtype":"init"}\\n'
exec cat > /dev/null
"""
STREAM_WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_INPROGRESS=".wip"
TICKET_DONE=".done"
TICKET_FEED_TIMEOUT=30
TICKET_MAXRUN=120
TICKET_ENGINE=("{tmp}/fake-engine.sh" --input-format stream-json)
. "{tick}"
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


def mk(root, h, fm=""):
    return mkfile(os.path.join(root, "tickets", h + ".md"), TICKET.format(h=h, fm=fm))


def wait_for(cond, limit=40, step=0.5):
    for _ in range(int(limit / step)):
        if cond():
            return True
        time.sleep(step)
    return False


def pid_of(path):
    m = re.search(r"^pid:\s*(\d+)", open(path, encoding="utf-8").read(), re.M)
    return int(m.group(1)) if m else None


tmp = os.path.realpath(tempfile.mkdtemp())
alive_pids = []
try:
    root = os.path.join(tmp, "dira")
    tickets = os.path.join(root, "tickets")
    workers = os.path.join(root, "workers")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    env = dict(os.environ, TICKET_LOCAL=local)
    runlog_path = os.path.join(workers, "runner.log")

    def runlog():
        try:
            with open(runlog_path, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def run(*argv, timeout=60):
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=env)

    # --- ①~③: 비스트리밍 엔진으로 `tick <해시>` 자체를 잰다(즉시 끝나서 살려 둘 게 없다) ---
    mkfile(os.path.join(tmp, "flat-engine.sh"), FLAT_ENGINE, 0o755)
    w1 = mkfile(os.path.join(workers, "w1.sh"),
                FLAT_WORKER.format(name="w1", tmp=tmp, tick=TICK), 0o755)

    # ① FIFO 맨 앞(aaaa5001)이 아니라 지목한 bbbb5002가 집힌다
    mk(root, "aaaa5001")
    mk(root, "bbbb5002")
    r = run(w1, "tick", "bbbb5002")
    assert r.returncode == 0, r.stdout + r.stderr
    assert os.path.exists(os.path.join(tickets, "bbbb5002.wip.md")), \
        "지목한 해시가 안 집혔다: " + str(os.listdir(tickets))
    assert os.path.exists(os.path.join(tickets, "aaaa5001.md")), \
        "지목 안 한 FIFO 맨 앞이 대신 집혔다"
    assert re.search(r"DISPATCH bbbb5002\b", runlog()), "DISPATCH 로그가 없다\n" + runlog()
    os.remove(os.path.join(tickets, "bbbb5002.wip.md"))
    os.remove(os.path.join(tickets, "aaaa5001.md"))

    # ② 이미 할당됨(.wip) - 디스패치 없이 사유 한 줄, 큐 무변화. `assigned_at`을 지금으로
    # 심어야 reap의 유예(REAP_GRACE_SEC)에 걸려 회수되지 않는다(회수되면 다시 후보가 된다).
    now_iso = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    mkfile(os.path.join(tickets, "cccc5003.wip.md"),
           "---\nticket: cccc5003\ntitle: t\nsession_id: s1\nassigned_at: {}\n---\n\n"
           "## Goal\ntest\n".format(now_iso))
    before = len(runlog())
    r = run(w1, "tick", "cccc5003")
    assert r.returncode == 0, r.stdout + r.stderr
    added = runlog()[before:]
    assert "SKIP 지목 cccc5003" in added, "이미 할당된 지목의 SKIP 로그가 없다\n" + added
    # `.wip` 파일은 scan()이 안 보여주므로(열린 티켓만 본다) 사유는 find_any 폴백이 낸다 -
    # 파일명의 `.wip` 접미사 자체가 «이미 진행중»이라는 사실이다.
    assert ".wip" in added, "사유가 진행중(.wip)을 안 가리킨다\n" + added
    assert os.path.exists(os.path.join(tickets, "cccc5003.wip.md")), "큐가 바뀌었다"
    os.remove(os.path.join(tickets, "cccc5003.wip.md"))

    # ② deps 미충족 - 사유가 «deps 미충족»
    mk(root, "dddd5004", "deps: [eeee9999]\n")
    before = len(runlog())
    r = run(w1, "tick", "dddd5004")
    assert r.returncode == 0, r.stdout + r.stderr
    added = runlog()[before:]
    assert "SKIP 지목 dddd5004" in added and "deps 미충족" in added, \
        "deps 미충족 사유가 없다\n" + added
    assert os.path.exists(os.path.join(tickets, "dddd5004.md")), "큐가 바뀌었다"
    os.remove(os.path.join(tickets, "dddd5004.md"))

    # ② 없는 티켓 - 사유가 «못 찾음»
    before = len(runlog())
    r = run(w1, "tick", "ffff0000")
    assert r.returncode == 0, r.stdout + r.stderr
    added = runlog()[before:]
    assert "SKIP 지목 ffff0000" in added and "못 찾음" in added, \
        "없는 해시의 사유가 없다\n" + added

    # ③ 페르소나 상한 게이트 - 종전 SKIP 로그 그대로, 디스패치 없음(narrowing이 게이트를 안 뚫는다)
    os.makedirs(os.path.join(root, "personas", "dev"))
    mkfile(os.path.join(root, "personas", "dev", "limit"), "0\n")
    mk(root, "gggg5005", "persona: dev\n")
    before = len(runlog())
    r = run(w1, "tick", "gggg5005")
    assert r.returncode == 0, r.stdout + r.stderr
    added = runlog()[before:]
    assert "SKIP 페르소나 상한 dev" in added, "페르소나 상한 SKIP이 없다\n" + added
    assert not os.path.exists(os.path.join(tickets, "gggg5005.wip.md")), "상한 걸렸는데 집혔다"
    shutil.rmtree(os.path.join(root, "personas"))
    os.remove(os.path.join(tickets, "gggg5005.md"))

    print("OK - test_targeted_dispatch ①~③ (tick <해시>)")

    # --- ④~⑤: 스트리밍 엔진으로 `preempt`를 잰다(살아 있는 피해자가 필요하다) ---
    mkfile(os.path.join(tmp, "fake-engine.sh"), FAKE_ENGINE, 0o755)
    w2 = mkfile(os.path.join(workers, "w2.sh"),
                STREAM_WORKER.format(name="w2", tmp=tmp, tick=TICK), 0o755)

    def dispatch_busy(w, h, fm=""):
        mk(root, h, fm)
        p = subprocess.Popen([w, "tick"], env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wip = os.path.join(tickets, h + ".wip.md")
        assert wait_for(lambda: os.path.exists(wip) and "inbox:" in
                        open(wip, encoding="utf-8").read()), \
            "{} 디스패치가 안 떴다\n{}".format(h, runlog())
        return p, wip

    # ④ 피해자 없음(도는 티켓이 0건) - dryrun은 빈 출력 + 0이 아닌 종료 코드, 큐 무변화
    r = run(w1, "preempt", "zzzz0000", "--dryrun")
    assert r.returncode != 0, "피해자가 없는데 성공했다: " + r.stdout
    assert r.stdout.strip() == "", "피해자가 없는데 출력이 있다: " + r.stdout

    # ④ 피해자 있음 - dryrun 한 줄(해시 - 제목 - 워커), 아무것도 안 끊는다
    victim_proc, victim_wip = dispatch_busy(w2, "hhhh5006", "priority: 3\n")
    before_mtime = os.path.getmtime(victim_wip)
    r = run(w1, "preempt", "iiii0000", "--dryrun")
    assert r.returncode == 0, r.stdout + r.stderr
    line = r.stdout.strip()
    assert line.count(" - ") == 2, "한 줄(해시 - 제목 - 워커) 모양이 아니다: " + line
    vhash, vtitle, vworker = line.split(" - ")
    assert vhash == "hhhh5006" and vworker == "w2", "피해자 판정이 다르다: " + line
    assert os.path.exists(victim_wip), "dryrun인데 피해자가 끊겼다"
    assert os.path.getmtime(victim_wip) == before_mtime, "dryrun인데 피해자 파일이 갈렸다"

    # ⑤ 실제 선점 - 소유자 필터 없음(w1이 불러도 w2의 피해자가 죽는다) + 지목한 해시가 그
    # 피해자를 물었던 워커(w2)에 뜬다(부르는 워커 w1이 아니다)
    mk(root, "jjjj5007")   # 지목할 티켓
    before = len(runlog())
    r = run(w1, "preempt", "jjjj5007")
    assert r.returncode == 0, r.stdout + r.stderr
    added = runlog()[before:]
    assert re.search(r"PREEMPT hhhh5006 -> jjjj5007 \(사람 요청\) pid=\d+", added), \
        "PREEMPT 로그가 없다\n" + added

    backlog = os.path.join(tickets, "hhhh5006.md")
    assert wait_for(lambda: os.path.exists(backlog), 10), \
        "피해자가 열림으로 안 돌아왔다: " + str(os.listdir(tickets))
    body = open(backlog, encoding="utf-8").read()
    assert "awaiting:" not in body, \
        "선점이 답변 대기로 잠갔다(unassign --force와 달라야 한다)\n" + body
    assert not re.search(r"^(session_id|pid|inbox):[ \t]*\S", body, re.M), \
        "할당 값이 안 비었다\n" + body
    assert "## 선점" in body and "밀어낸 티켓 | jjjj5007" in body, \
        "`## 선점` 표에 지목한 해시가 없다\n" + body
    assert "w2 · wt/w2" in body, "워커·브랜치가 피해자를 물었던 워커(w2)가 아니다\n" + body
    assert os.path.join(root, "worktrees", "w2") in body, "워크트리가 w2 것이 아니다\n" + body

    # 비워진 워커(w2)가 지목한 해시를 집는다 - w1(부르는 쪽)이 아니라 w2가 뜬다(§검증 (5))
    target_wip = os.path.join(tickets, "jjjj5007.wip.md")
    assert wait_for(lambda: os.path.exists(target_wip), 15), \
        "지목한 해시가 안 떴다(선점 4단계 실패)\n" + runlog()
    target_pid = wait_for(lambda: pid_of(target_wip) is not None, 10) and pid_of(target_wip)
    assert target_pid, "지목 디스패치의 pid를 못 얻었다"
    alive_pids.append(target_pid)
    assert "[w2]" in runlog().split("DISPATCH jjjj5007")[0][-40:] or \
        re.search(r"\[w2\][^\n]*DISPATCH jjjj5007", runlog()), \
        "지목 디스패치를 w2가 아니라 부르는 워커가 했다\n" + runlog()

    print("OK - test_targeted_dispatch ④~⑤ (preempt <해시> [--dryrun])")
finally:
    for pid in alive_pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    subprocess.run(["pkill", "-9", "-f", tmp], stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)
    shutil.rmtree(tmp, ignore_errors=True)
