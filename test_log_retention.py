#!/usr/bin/env python3
"""로그 보존(P409-2) 자체검증. tick.sh가 workers/logs·workers/health 아래 오래된 파일을
지우는 훑기를 `CMD=tick` 경로에 얹은 것을 검증한다. 실제 클로드 엔진은 안 띄운다 - 빈 티켓
큐로 돌리면 select가 후보 0건을 만나 곧장 종료하므로(§select 직후 `[ -z "$CANDS" ] && exit 0`)
훑기 이후 아무 디스패치도 일어나지 않는다.

실패하면 assert로 죽는다.
"""
import os
import time
import shutil
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="lr"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_PLAN_NUDGE=0
TICKET_REUSE=0
. "{tick}"
"""


def mkworker(root):
    w = os.path.join(root, "workers", "lr.sh")
    os.makedirs(os.path.dirname(w), exist_ok=True)
    with open(w, "w", encoding="utf-8") as f:
        f.write(WORKER.format(tmp=root, tick=TICK))
    os.chmod(w, 0o755)
    return w


def touch(path, age_days=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("x")
    if age_days is not None:
        t = time.time() - age_days * 86400
        os.utime(path, (t, t))


def run_tick(w, root, extra_env=None):
    env = dict(os.environ, TICKET_LOCAL=os.path.join(root, "local"))
    if extra_env:
        env.update(extra_env)
    r = subprocess.run([w, "tick"], capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0, "tick.sh가 0이 아닌 코드로 끝났다: {}\n{}".format(r.returncode, r.stderr)


def new_root():
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "tickets"), exist_ok=True)  # 빈 큐
    return root


# 1·2 - 기본 보존기간(14일): 15일 전 파일은 지워지고 13일 전 파일은 남는다.
# 대상은 logs/·health/ 뿐이고 runner.log·cron.log는 절대 안 지워진다.
root = new_root()
try:
    w = mkworker(root)
    old = os.path.join(root, "workers", "logs", "old.log")
    fresh = os.path.join(root, "workers", "logs", "fresh.log")
    old_health = os.path.join(root, "workers", "health", "old.log")
    touch(old, age_days=15)
    touch(fresh, age_days=13)
    touch(old_health, age_days=15)
    runner = os.path.join(root, "workers", "runner.log")
    cron = os.path.join(root, "workers", "cron.log")
    touch(runner, age_days=999)
    touch(cron, age_days=999)

    run_tick(w, root)

    assert not os.path.exists(old), "조건 1: 15일 전 파일이 안 지워졌다"
    assert os.path.exists(fresh), "조건 1: 13일 전 파일이 지워졌다"
    assert not os.path.exists(old_health), "조건 2: health/ 아래 오래된 파일이 안 지워졌다"
    assert os.path.exists(runner), "조건 2: runner.log가 지워졌다"
    assert os.path.exists(cron), "조건 2: cron.log가 지워졌다"
    print("PASS 조건 1·2 - 기본 14일 보존, runner.log·cron.log 무사")
finally:
    shutil.rmtree(root, ignore_errors=True)


# 3 - 같은 날 두 번 돌려도 훑기는 한 번만: 마커를 세운 뒤 심어 둔 오래된 파일이 두 번째 tick에서
# 살아남으면(=두 번째 훑기가 안 돎) 통과. 날짜가 갈리면(마커를 어제로 되돌리면) 다시 돈다.
root = new_root()
try:
    w = mkworker(root)
    p1 = os.path.join(root, "workers", "logs", "a.log")
    touch(p1, age_days=15)
    run_tick(w, root)
    assert not os.path.exists(p1), "선행 조건: 첫 tick이 오래된 파일을 안 지웠다"

    marker = os.path.join(root, "local", "run", "log-retention-date")
    assert os.path.exists(marker), "마커 파일이 안 생겼다"

    p2 = os.path.join(root, "workers", "logs", "b.log")
    touch(p2, age_days=15)
    run_tick(w, root)
    assert os.path.exists(p2), "조건 3: 같은 날 두 번째 tick에서 또 훑었다"
    print("PASS 조건 3 전반 - 같은 날 재훑기 없음")

    yesterday = time.strftime("%Y-%m-%d", time.localtime(time.time() - 86400))
    with open(marker, "w", encoding="utf-8") as f:
        f.write(yesterday)
    run_tick(w, root)
    assert not os.path.exists(p2), "조건 3: 날이 갈렸는데 다시 안 훑었다"
    print("PASS 조건 3 후반 - 날이 갈리면 다시 훑는다")
finally:
    shutil.rmtree(root, ignore_errors=True)


# 4 - TICKET_LOG_KEEP_DAYS=0이면 아무것도 안 지운다.
root = new_root()
try:
    w = mkworker(root)
    p = os.path.join(root, "workers", "logs", "old.log")
    touch(p, age_days=999)
    run_tick(w, root, extra_env={"TICKET_LOG_KEEP_DAYS": "0"})
    assert os.path.exists(p), "조건 4: KEEP_DAYS=0인데 지워졌다"
    print("PASS 조건 4 - TICKET_LOG_KEEP_DAYS=0이면 무삭제")
finally:
    shutil.rmtree(root, ignore_errors=True)


# 5 - 훑기가 실패해도(대상 디렉터리가 없어도) 디스패치는 종전대로 exit 0으로 끝난다.
root = new_root()
try:
    w = mkworker(root)
    # workers/logs·workers/health를 아예 만들지 않은 채로 돈다 - find 대상이 없어도 죽지 않는다.
    run_tick(w, root)
    print("PASS 조건 5 - 대상 디렉터리가 없어도 디스패치가 정상 종료한다")
finally:
    shutil.rmtree(root, ignore_errors=True)

print("PASS 5/5")
