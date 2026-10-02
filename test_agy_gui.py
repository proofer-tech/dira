#!/usr/bin/env python3
"""P460-1 - agy-gui.sh 중계와 tick.sh의 Background 세션 감싸기 자체검증
(docs/design/요구-절.md §다른 사용자도 agy CLI만 깔려 있으면 워커에서 agy가 돈다,
요구 `1a839f60`, 티켓 `3f749924`).

두 갈래를 잰다:

① tick.sh의 감싸기 판정(결정 1) - `launchctl managername` 스텁으로 Background/Aqua를
   재현하고, dryrun이 찍는 `엔진:` 줄(runner.log)로 네 경우를 가린다: Background+dira-agy는
   감싸고, Aqua+dira-agy는 안 감싸고, 이미 감싼 argv는 두 번 안 감싸고, Background라도
   dira-agy가 아닌 엔진(claude)은 안 감싼다.
② agy-gui.sh 단독 실행(결정 2) - `launchctl print gui/<uid>`가 실패하는 픽스처에서
   1초 안에 종료 코드 75와 stderr `GUI 세션 없음`을 낸다.

tick.sh는 자기 PATH를 `$HOME/.local/bin`부터 다시 세우므로(파일 상단) `$HOME`을 픽스처로
돌려 가짜 `launchctl`을 심는다(test_unassign_pid_recover.py와 같은 수법). 진짜 launchctl -
진짜 agy는 안 건드린다. 전부 임시 큐 - 도그푸딩 없음. 실패하면 assert로 죽는다.
"""
import os
import shutil
import stat
import subprocess
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
AGY_GUI = os.path.join(HERE, "agy-gui.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{engine}" "{{sid}}")
. "{tick}"
"""

FAKE_LAUNCHCTL = """\
#!/bin/bash
case "$1" in
  managername) echo "$FAKE_MANAGERNAME" ;;
  print) [ "$FAKE_GUI_OK" = "1" ] && exit 0 || exit 1 ;;
  bootstrap|bootout|list) exit 0 ;;
  *) exit 1 ;;
esac
"""

STUB_ENGINE = """\
#!/bin/bash
exit 0
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


def runlog_engine_lines(root):
    path = os.path.join(root, "workers", "runner.log")
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return []
    return [ln.split("엔진: ", 1)[1] for ln in lines if "엔진: " in ln]


tmp = os.path.realpath(tempfile.mkdtemp())
home = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    tickets = os.path.join(root, "tickets")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    runlog = os.path.join(root, "workers", "runner.log")

    launchctl = mkfile(os.path.join(home, ".local", "bin", "launchctl"), FAKE_LAUNCHCTL)
    os.chmod(launchctl, os.stat(launchctl).st_mode | stat.S_IEXEC)

    dira_agy = mkfile(os.path.join(tmp, "bin", "dira-agy"), STUB_ENGINE)
    os.chmod(dira_agy, os.stat(dira_agy).st_mode | stat.S_IEXEC)
    dira_claude = mkfile(os.path.join(tmp, "bin", "claude"), STUB_ENGINE)
    os.chmod(dira_claude, os.stat(dira_claude).st_mode | stat.S_IEXEC)

    def queue():
        if os.path.isdir(tickets):
            shutil.rmtree(tickets)
        os.makedirs(tickets)
        mkfile(os.path.join(tickets, "cafe0001.md"),
               "---\nticket: cafe0001\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")

    def dryrun(engine_path, managername):
        queue()
        if os.path.exists(runlog):
            os.remove(runlog)
        w1 = mkfile(os.path.join(root, "workers", "w1.sh"),
                    WORKER.format(tmp=tmp, tick=TICK, engine=engine_path), 0o755)
        env = dict(os.environ, TICKET_LOCAL=local, HOME=home,
                   FAKE_MANAGERNAME=managername, FAKE_GUI_OK="1")
        r = subprocess.run([w1, "dryrun"], capture_output=True, text=True,
                           env=env, timeout=30)
        assert r.returncode == 0, "dryrun rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)
        lines = runlog_engine_lines(root)
        assert lines, "runner.log에 엔진: 줄이 없다\n" + r.stdout + r.stderr
        return lines[-1]

    # --- ① Background + dira-agy -> 감싼다 ---
    line = dryrun(dira_agy, "Background")
    first = line.split()[0]
    assert os.path.basename(first) == "agy-gui.sh", \
        "Background + dira-agy인데 안 감쌌다: " + line
    assert line.split()[1] == dira_agy, "원래 엔진 argv가 뒤에 안 남았다: " + line

    # --- ② Aqua + dira-agy -> 안 감싼다 ---
    line = dryrun(dira_agy, "Aqua")
    first = line.split()[0]
    assert first == dira_agy, "Aqua인데 감쌌다: " + line
    assert "agy-gui.sh" not in line, "Aqua인데 agy-gui.sh가 섞였다: " + line

    # --- ③ 이미 감싼 argv(Background) -> 한 번만 ---
    line = dryrun(AGY_GUI, "Background")
    assert line.count("agy-gui.sh") == 1, \
        "이미 감싼 argv를 다시 감쌌다(두 번 나옴): " + line

    # --- ④ Background + claude 엔진 -> 안 감싼다 ---
    line = dryrun(dira_claude, "Background")
    assert "agy-gui.sh" not in line, "claude 엔진인데 감쌌다: " + line

    print("OK - tick.sh Background 감싸기 판정 네 경우 통과")

    # --- ⑤ agy-gui.sh 단독: GUI 세션 없음 -> 1초 안에 75 + stderr 메시지 ---
    env = dict(os.environ, PATH=os.path.join(home, ".local", "bin") + os.pathsep + os.environ["PATH"],
               FAKE_MANAGERNAME="Aqua", FAKE_GUI_OK="0")
    t0 = time.monotonic()
    r = subprocess.run([AGY_GUI, "true"], capture_output=True, text=True, env=env, timeout=10)
    elapsed = time.monotonic() - t0
    assert r.returncode == 75, "GUI 세션 없음인데 종료 코드가 75가 아니다: {}\n{}".format(
        r.returncode, r.stderr)
    assert "GUI 세션 없음" in r.stderr, "stderr에 GUI 세션 없음이 없다: " + r.stderr
    assert elapsed < 1.0, "1초 안에 안 끝났다: {:.2f}s".format(elapsed)

    print("OK - agy-gui.sh가 GUI 세션 없음을 1초 안에 75로 낸다")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(home, ignore_errors=True)
