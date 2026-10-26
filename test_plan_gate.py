#!/usr/bin/env python3
"""P536-1 자체검증: plan_gate.py 판정과 tick.sh 배선(docs/DESIGN.md §P536 수용조건 1-4).

①+② 결정 2 네 줄 + 마지막 절 + 취소 항목, ③ 예외 둘, ④ 유예, ⑤ 판정 실패 통과, ⑥ GATE 로그,
⑦ claude argv의 --settings(codex와 TICKET_PLAN_GATE=0엔 없다), ⑧ 재활용 뒤 새 티켓 판정.
실패하면 assert로 죽는다.
"""
__import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
GATE = os.path.join(HERE, "plan_gate.py")


def iso(delta):
    return (datetime.now().astimezone() - timedelta(seconds=delta)).replace(microsecond=0).isoformat()


def ticket(plan, age=3600, h="aaaa1111"):
    body = "---\nticket: %s\ntitle: t\nassigned_at: %s\n---\n\n## Goal\ng\n" % (h, iso(age))
    return body + (("\n## 진행 계획\n\n" + plan) if plan is not None else "")


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    def gate(text, tool="Bash", inp=None, env_extra=None, raw=None, h="aaaa1111", mkfile=True):
        tp = os.path.join(tmp, h + ".wip.md")
        with open(tp, "w", encoding="utf-8") as f:
            f.write(text)
        gf = os.path.join(tmp, "gatefile")
        if mkfile:
            with open(gf, "w", encoding="utf-8") as f:
                f.write(tp)
        elif os.path.exists(gf):
            os.remove(gf)
        log = os.path.join(tmp, "runner.log")
        env = dict(os.environ, DIRA_PLAN_GATE_FILE=gf, DIRA_PLAN_GATE_LOG=log)
        env.update(env_extra or {})
        data = raw if raw is not None else json.dumps(
            {"tool_name": tool, "tool_input": inp if inp is not None else {"command": "ls"}})
        r = subprocess.run([sys.executable, GATE], input=data, capture_output=True, text=True, env=env)
        return r.returncode, r.stderr.strip()

    S = iso(60)
    OPEN = "- [x] a (%s -> %s)\n- [ ] b\n" % (S, S)
    ONE = "- [x] a (%s -> %s)\n- [ ] b (%s)\n- [ ] c\n" % (S, S, S)
    TWO = "- [ ] a (%s)\n- [ ] b (%s)\n" % (S, S)
    DONE = "- [x] a (%s -> %s)\n" % (S, S)

    # 결정 2 둘째 줄: 진행중 0개 + 미착수
    rc, err = gate(ticket(OPEN))
    assert rc == 2 and err.startswith("지금 하는 ## 진행 계획 항목 줄 끝에 시작 시각"), (rc, err)
    assert "GATE aaaa1111 open" in open(os.path.join(tmp, "runner.log"), encoding="utf-8").read()
    # 셋째 줄: 진행중 둘
    rc, err = gate(ticket(TWO)); assert rc == 2 and err.startswith("진행중 항목은 하나"), (rc, err)
    # 넷째 줄: 진행중 하나 / 남은 항목 0 / 취소만 남음
    assert gate(ticket(ONE))[0] == 0
    assert gate(ticket(DONE))[0] == 0
    assert gate(ticket("- [x] a (%s -> %s)\n- [ ] ~~b~~\n" % (S, S)))[0] == 0
    # 첫 줄: 절 없음 + 유예 초과 / 유예 안
    rc, err = gate(ticket(None, age=600)); assert rc == 2 and err.startswith("## 진행 계획을 먼저 세우고"), (rc, err)
    assert gate(ticket(None, age=10))[0] == 0
    assert gate(ticket(None, age=10), env_extra={"TICKET_PLAN_GATE_GRACE": "5"})[0] == 2
    # 마지막 절이 기준: 앞 절은 막힐 상태, 뒤 절은 통과
    assert gate(ticket(OPEN) + "\n## 진행 계획\n\n" + ONE)[0] == 0
    assert gate(ticket(ONE) + "\n## 진행 계획\n\n" + OPEN)[0] == 2
    # 예외 (a) 해시 포함, (b) date
    assert gate(ticket(OPEN), inp={"command": "bash push.sh ship aaaa1111 t"})[0] == 0
    assert gate(ticket(OPEN), tool="Read", inp={"file_path": "/x/aaaa1111.wip.md"})[0] == 0
    assert gate(ticket(OPEN), inp={"command": "date +%FT%T%z"})[0] == 0
    assert gate(ticket(OPEN), inp={"command": "echo date"})[0] == 2
    # 결정 5: 판정 실패는 통과
    assert gate(ticket(OPEN), raw="{깨짐")[0] == 0
    assert gate(ticket(OPEN), mkfile=False)[0] == 0
    gf = os.path.join(tmp, "gatefile")
    with open(gf, "w") as f:
        f.write(os.path.join(tmp, "없는.wip.md"))
    r = subprocess.run([sys.executable, GATE], input='{"tool_name":"Bash","tool_input":{}}',
                       capture_output=True, text=True, env=dict(os.environ, DIRA_PLAN_GATE_FILE=gf))
    assert r.returncode == 0
    print("PASS plan_gate 판정(결정 2-3-5, 유예, 마지막 절, GATE 로그)")

    # --- tick.sh 배선: dryrun argv ---
    def mkworker(root, name, engine, extra=""):
        d = os.path.join(root, "workers"); os.makedirs(d, exist_ok=True)
        p = os.path.join(d, name + ".sh")
        with open(p, "w", encoding="utf-8") as f:
            f.write('#!/bin/bash\nTICKET_NAME="%s"\nTICKET_CWD="%s"\nTICKET_PROMPT_FMT="pick %%s"\n'
                    'TICKET_ENGINE=("%s/%s" "{prompt}")\n%s. "%s"\n' % (name, tmp, tmp, engine, extra, TICK))
        os.chmod(p, 0o755)
        return p

    root = os.path.join(tmp, "dira"); local = os.path.join(tmp, "local"); os.makedirs(local)
    os.makedirs(os.path.join(root, "tickets"))
    with open(os.path.join(root, "tickets", "5c211001.md"), "w", encoding="utf-8") as f:
        f.write("---\nticket: 5c211001\ntitle: t\nkind: work\n---\n\n## Goal\ng\n")
    wcl = mkworker(root, "wcl", "claude"); wcx = mkworker(root, "wcx", "codex")

    def dry(w, **e):
        r = subprocess.run([w, "dryrun"], capture_output=True, text=True,
                           env=dict(os.environ, TICKET_LOCAL=local, **e), timeout=60)
        assert r.returncode == 0, r.stdout + r.stderr
        return r.stdout

    out = dry(wcl)
    line = [l for l in out.split("\n") if l.startswith("엔진:")][0]
    st = json.loads(line.split("--settings ", 1)[1])  # dryrun은 argv를 공백으로 이어 찍는다 - JSON이 마지막 칸
    cmd = st["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
    assert "plan_gate.py" in cmd and "TICKET_PLAN_GATE_GRACE=120" in cmd, cmd
    assert "--settings" in dry(wcl, DIRA_INHERIT_USER_CONFIG="1")
    assert "--settings" not in dry(wcl, TICKET_PLAN_GATE="0")
    assert "--settings" not in dry(wcx)
    print("PASS claude argv에만 --settings, TICKET_PLAN_GATE=0 탈출구")

    # --- 재활용: 가짜 claude 스트리밍 엔진이 구간마다 훅 명령을 실행해 rc를 적는다 ---
    ENGINE = '''#!/usr/bin/env python3
import json, os, subprocess, sys, time
argv = sys.argv
settings = json.loads(argv[argv.index("--settings") + 1])
cmd = settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
rcs = argv[1]; tickets = argv[2]
sys.stdin.readline()
def emit(o): sys.stdout.write(json.dumps(o, separators=(",", ":")) + "\\n"); sys.stdout.flush()
emit({"type": "system", "subtype": "init"})
for i, h in enumerate(["bbbb0001", "bbbb0002"]):
    if i: sys.stdin.readline()
    time.sleep(0.3)
    r = subprocess.run(cmd, shell=True, input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "ls"}}),
                       capture_output=True, text=True)
    open(rcs, "a").write("%s %d\\n" % (h, r.returncode))
    p = os.path.join(tickets, h + ".wip.md")
    if os.path.exists(p): os.rename(p, os.path.join(tickets, h + ".done.md"))
    emit({"type": "assistant", "message": {"role": "assistant", "content": "w", "usage": {"input_tokens": 10, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}}})
    emit({"type": "result", "subtype": "success", "is_error": False, "session_id": "x", "num_turns": i + 1})
time.sleep(60)
'''
    r2 = os.path.join(tmp, "q2", "dira"); l2 = os.path.join(tmp, "q2", "local")
    os.makedirs(os.path.join(r2, "tickets")); os.makedirs(l2)
    with open(os.path.join(l2, "oauth-token"), "w") as f:  # claude 인증 게이트 통과용
        f.write("x\n")
    eng = os.path.join(tmp, "claude")
    with open(eng, "w") as f:
        f.write(ENGINE)
    os.chmod(eng, 0o755)
    rcs = os.path.join(tmp, "rcs.txt")
    # 첫 티켓은 진행중 0개(막힌다), 둘째는 진행중 하나(통과한다)
    for h, plan in (("bbbb0001", "- [ ] a\n"), ("bbbb0002", "- [ ] a (%s)\n" % S)):
        with open(os.path.join(r2, "tickets", h + ".md"), "w", encoding="utf-8") as f:
            f.write("---\nticket: %s\ntitle: t\nkind: work\npersona: solo\n---\n\n## Goal\ng\n\n## 진행 계획\n\n%s" % (h, plan))
    w = os.path.join(r2, "workers", "w1.sh"); os.makedirs(os.path.dirname(w))
    with open(w, "w") as f:
        f.write('#!/bin/bash\nTICKET_NAME="w1"\nTICKET_CWD="%s"\nTICKET_PROMPT_FMT="pick %%s"\n'
                'TICKET_ENGINE=("%s" "%s" "%s" --input-format stream-json)\n. "%s"\n'
                % (tmp, eng, rcs, os.path.join(r2, "tickets"), TICK))
    os.chmod(w, 0o755)
    tr = subprocess.run([w, "tick"], capture_output=True, text=True, env=dict(os.environ, TICKET_LOCAL=l2), timeout=90)
    if not os.path.exists(rcs):
        print(tr.stdout, tr.stderr, open(os.path.join(r2, "workers", "runner.log")).read())
    got = open(rcs).read().split("\n")
    assert "bbbb0001 2" in got and "bbbb0002 0" in got, got
    assert "GATE bbbb0001 open" in open(os.path.join(r2, "workers", "runner.log"), encoding="utf-8").read()
    print("PASS 재활용 뒤 훅이 새 티켓을 판정한다:", got[:2])
finally:
    shutil.rmtree(tmp, ignore_errors=True)
