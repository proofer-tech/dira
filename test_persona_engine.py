#!/usr/bin/env python3
"""페르소나별 실행 엔진 자체검증 (docs/DESIGN.md §제약 1 §결정 기록 §열한 번째,
요구 `3917dbda` · 답 `7563d133`, 티켓 `53ba2fd9`).

지금까지 `TICKET_ENGINE`은 워커 `.sh`가 정적으로 고정했다. 이 개정은 **티켓의 `persona:`가
엔진을 정한다** - 그 페르소나에 `personas/<이름>/engine` 파일이 있으면 그 값으로
`TICKET_ENGINE`을 재구성하고, 없으면 종전 그대로(워커 대입 -> 기본값)다. 재구성은 티켓
선정 루프 안, 후보의 persona가 확정된 뒤에 일어난다 - 그래야 어느 엔진인지가 어느 티켓을
고르느냐에 달릴 수 있다.

① 페르소나 engine 파일이 있으면 그 값이 dryrun 출력과 실제로 도는 명령 양쪽에 반영된다.
② 재구성된 엔진이 쿨다운 중이면 그 후보를 건너뛰고(SKIP, §5-4 페르소나 상한과 같은 로그
   낱말) 쿨다운이 안 걸린 다음 후보(다른 persona, 다른 엔진)가 디스패치된다.

진짜 claude를 부르지 않는다 - 인자를 받아 적고 즉시 성공 result를 내는 비스트리밍 가짜
엔진으로 판정한다(도그푸딩으로 안 잰다 - DESIGN.md §제약 1). 임시 큐를 쓴다.
실패하면 assert로 죽는다.
"""
import hashlib
import os
import shutil
import subprocess
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/engine-base.sh" "{{sid}}")
. "{tick}"
"""

# 비스트리밍 가짜 엔진: 자기 이름을 ran.log에 적고 즉시 성공 result를 낸다(codex 모양과 같은
# 갈래 - `--input-format stream-json`이 없어서 FIFO 없이 rc로 판정된다).
ENGINE = """\
#!/bin/bash
echo "$(basename "$0")" >> "{tmp}/ran.log"
printf '{{"session_id":"%s","type":"result","is_error":false,"subtype":"success"}}\\n' "$1"
exit 0
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    tickets = os.path.join(root, "tickets")
    runlog = os.path.join(root, "workers", "runner.log")
    ranlog = os.path.join(tmp, "ran.log")
    env = dict(os.environ, TICKET_LOCAL=local)

    mkfile(os.path.join(tmp, "engine-base.sh"), ENGINE.format(tmp=tmp), 0o755)
    mkfile(os.path.join(tmp, "engine-pm.sh"), ENGINE.format(tmp=tmp), 0o755)
    mkfile(os.path.join(tmp, "engine-dev.sh"), ENGINE.format(tmp=tmp), 0o755)
    w1 = mkfile(os.path.join(root, "workers", "w1.sh"),
                WORKER.format(tmp=tmp, tick=TICK), 0o755)
    # persona `pm`의 engine 파일 - `lib/workers.ts`의 renderEngineBlock()과 같은 한 줄 형식.
    mkfile(os.path.join(root, "personas", "pm", "engine"),
           'TICKET_ENGINE=("%s/engine-pm.sh" "{sid}")\n' % tmp)
    mkfile(os.path.join(root, "personas", "developer", "engine"),
           'TICKET_ENGINE=("%s/engine-dev.sh" "{sid}")\n' % tmp)

    def queue(open_):
        """큐를 원하는 모양으로 다시 세운다."""
        if os.path.isdir(tickets):
            shutil.rmtree(tickets)
        os.makedirs(tickets)
        for h, p in open_:
            fm = "persona: {}\n".format(p) if p else ""
            mkfile(os.path.join(tickets, h + ".md"),
                   "---\nticket: {h}\ntitle: t\nkind: work\n{fm}---\n\n## Goal\ntest\n"
                   .format(h=h, fm=fm))

    def dryrun():
        r = subprocess.run([w1, "dryrun"], capture_output=True, text=True,
                           env=env, timeout=30)
        assert r.returncode == 0, "dryrun rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)
        return r.stdout

    def tick():
        r = subprocess.run([w1, "tick"], capture_output=True, text=True,
                           env=env, timeout=60)
        assert r.returncode == 0, "tick rc={}\n{}".format(r.returncode, r.stderr)
        return r

    def log():
        try:
            with open(runlog, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def ran():
        try:
            with open(ranlog, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def wips():
        return sorted(f for f in os.listdir(tickets) if f.endswith(".wip.md"))

    # --- ① persona 없음: dryrun이 워커 기본 엔진을 그대로 보여준다(회귀 없음) ---
    queue([("cafe0001", "")])
    out = dryrun()
    assert "엔진: {}/engine-base.sh".format(tmp) in out, \
        "persona 없는 후보인데 기본 엔진이 안 보인다:\n" + out

    # --- ① persona=pm: dryrun이 personas/pm/engine으로 재구성된 엔진을 보여준다 ---
    queue([("cafe0002", "pm")])
    out = dryrun()
    assert "엔진: {}/engine-pm.sh".format(tmp) in out, \
        "persona engine 파일이 dryrun에 안 반영됐다:\n" + out
    assert "engine-base.sh" not in out, "재구성 없이 기본 엔진이 그대로 남았다:\n" + out

    # --- ① persona=pm: 실제로 도는 명령도 재구성된 엔진이다(dryrun뿐 아니라 tick도) ---
    queue([("cafe0003", "pm")])
    before = len(log())
    tick()
    added = log()[before:]
    assert "DISPATCH cafe0003" in added and "persona=pm" in added, \
        "persona 엔진 디스패치가 안 났다:\n" + added
    assert "engine-pm.sh" in ran(), "실제로 도는 명령이 재구성된 엔진이 아니다: " + ran()
    assert "engine-base.sh" not in ran(), "기본 엔진이 대신 돌았다: " + ran()

    # --- ② 재구성된 엔진이 쿨다운 중이면 그 후보는 SKIP, 다른 엔진 쓰는 후보가 대신 뜬다 ---
    os.remove(ranlog)  # ①의 흔적을 지운다 - 이번 판정은 engine-dev.sh만 돌아야 한다
    fp = hashlib.sha1(b"").hexdigest()[:12]  # oauth-token이 없을 때 engine_fp()와 같은 값
    cool_pm = os.path.join(local, "run", "cooldown-engine-pm.sh")
    mkfile(cool_pm, "{}\n{}\n".format(int(time.time()) + 9999, fp))
    # aaaa < bbbb라 birth가 같은 초에 묶여도 tie-break(경로)가 pm을 먼저 보게 한다
    # (tickets.py select()의 정렬 키가 (birth, path)다) - 이 순서가 SKIP-continue의 전제다.
    queue([("aaaa0001", "pm"), ("bbbb0002", "developer")])
    before = len(log())
    tick()
    added = log()[before:]
    assert "SKIP 엔진 쿨다운" in added, "쿨다운 중인 재구성 엔진을 안 걸렀다:\n" + added
    assert "DISPATCH bbbb0002" in added and "persona=developer" in added, \
        "쿨다운 아닌 다음 후보가 안 떴다:\n" + added
    assert wips() == ["bbbb0002.wip.md"], \
        "쿨다운 후보가 claim됐거나 dispatch 후보가 안 잡혔다: " + str(wips())
    assert "engine-dev.sh" in ran(), "다음 후보의 엔진이 안 돌았다: " + ran()
    assert "engine-pm.sh" not in ran(), "쿨다운 중인 엔진이 그래도 돌았다: " + ran()
    assert os.path.exists(cool_pm), "건너뛴 것뿐인데 쿨다운 파일이 사라졌다"

    print("OK - 페르소나별 실행 엔진 (dryrun 반영 · 실제 디스패치 반영 · "
          "쿨다운 중인 재구성 엔진 SKIP + 다음 후보 디스패치)")
finally:
    subprocess.run(["pkill", "-f", os.path.join(tmp, "engine-base.sh")], capture_output=True)
    subprocess.run(["pkill", "-f", os.path.join(tmp, "engine-pm.sh")], capture_output=True)
    subprocess.run(["pkill", "-f", os.path.join(tmp, "engine-dev.sh")], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
