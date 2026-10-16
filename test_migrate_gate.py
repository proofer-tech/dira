#!/usr/bin/env python3
"""tick.sh 마이그레이션 게이트(P505-2): 미적용 항목이 있으면 claim하지 않는다.

고정하는 것 셋:
  1. 미적용 항목이 있으면 `SKIP 마이그레이션 미적용 <id>`가 runner.log에 남고 티켓은 열림 그대로다.
     `migrate.py apply --root` 뒤 같은 tick은 claim한다.
  2. 러너 락에 산 pid가 있으면 `SKIP 마이그레이션 진행 중`이다.
  3. migrate.py가 깨지면 `WARN 마이그레이션 게이트 실패`를 남기고 claim하지 않는다.
임시 큐와 가짜 엔진만 쓴다. 실패하면 assert로 죽는다.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

ITEM = ('import os\nID = "0001-touch"; DESC = "d"; DESC_EN = "e"; SCOPE = "project"; REVERSIBLE = True\n'
        'def targets(ctx): return [os.path.join(ctx.root, "m.txt")]\n'
        'def apply(ctx): open(targets(ctx)[0], "w").write("x")\n'
        'def verify(ctx): assert os.path.exists(targets(ctx)[0])\n')
ENGINE = '#!/bin/bash\nprintf \'{"type":"system","subtype":"init"}\\n\'\nexec cat > /dev/null\n'
WORKER = ('#!/bin/bash\nTICKET_NAME="w1"\nTICKET_CWD="{tmp}"\nTICKET_INPROGRESS=".wip"\nTICKET_DONE=".done"\n'
          'TICKET_FEED_TIMEOUT=30\nTICKET_MAXRUN=20\nTICKET_ENGINE=("{tmp}/fake-engine.sh" --input-format stream-json)\n'
          '. "{tick}"\n')


def mk(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    tdir = os.path.join(root, "tickets")
    local = os.path.join(tmp, "local")
    mig = os.path.join(tmp, "mig")
    eng = os.path.join(tmp, "eng")
    os.makedirs(local)
    os.makedirs(mig)
    mk(os.path.join(mig, "0001_touch.py"), ITEM)
    mk(os.path.join(tmp, "fake-engine.sh"), ENGINE, 0o755)
    w1 = mk(os.path.join(root, "workers", "w1.sh"), WORKER.format(tmp=tmp, tick=TICK), 0o755)
    env = dict(os.environ, TICKET_LOCAL=local, DIRA_MIGRATIONS_DIR=mig)
    t = mk(os.path.join(tdir, "aaaa0001.md"), "---\nticket: aaaa0001\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")
    runlog = os.path.join(root, "workers", "runner.log")

    def tick():
        subprocess.run([w1, "tick"], env=env, capture_output=True, text=True, timeout=60)
        try:
            return open(runlog, encoding="utf-8").read()
        except OSError:
            return ""

    # 1) 미적용: SKIP, claim 없음
    log = tick()
    assert "SKIP 마이그레이션 미적용 0001-touch" in log, log
    assert os.path.exists(t), "게이트가 막았는데 티켓이 움직였다: " + str(os.listdir(tdir))

    # 2) 러너 락에 산 pid: 진행 중
    live = subprocess.Popen(["sleep", "60"])
    try:
        lock = os.path.join(local, "run", "migrate.lock")
        mk(os.path.join(lock, "pid"), str(live.pid))
        log = tick()
        assert "SKIP 마이그레이션 진행 중" in log, log
        assert os.path.exists(t)
    finally:
        live.kill()
        live.wait()
        shutil.rmtree(lock, ignore_errors=True)

    # 3) migrate.py가 깨짐: WARN, claim 없음
    shutil.copytree(HERE, eng, ignore=shutil.ignore_patterns("node_modules", ".git", "apps", "docs", ".dira", "__pycache__"))
    # tick.sh는 자기 옆 migrate.py를 부른다 - 사본 옆의 migrate.py를 깨뜨린다
    open(os.path.join(eng, "migrate.py"), "w").write("raise SystemExit(2)\n")
    w2 = mk(os.path.join(root, "workers", "w1.sh"), WORKER.format(tmp=tmp, tick=os.path.join(eng, "tick.sh")), 0o755)
    w1 = w2
    log = tick()
    assert "WARN 마이그레이션 게이트 실패" in log, log
    assert os.path.exists(t)

    # 4) apply 뒤 같은 tick이 claim한다
    w1 = mk(os.path.join(root, "workers", "w1.sh"), WORKER.format(tmp=tmp, tick=TICK), 0o755)
    r = subprocess.run([sys.executable, os.path.join(HERE, "migrate.py"), "apply", "--root", root],
                       env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    p = subprocess.Popen([w1, "tick"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        for _ in range(40):
            if not os.path.exists(t):
                break
            time.sleep(0.5)
        assert not os.path.exists(t), "apply 뒤에도 claim이 안 됐다\n" + open(runlog).read()
    finally:
        os.killpg(p.pid, 9)
    print("test_migrate_gate OK")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
