#!/usr/bin/env python3
"""P460-1·P460-2 - agy-gui.sh 중계, tick.sh의 Background 세션 감싸기, 죽은 워커가 남긴
agy-gui 잡 걷기 자체검증(docs/design/요구-절.md §다른 사용자도 agy CLI만 깔려 있으면
워커에서 agy가 돈다, 요구 `1a839f60`, 티켓 `3f749924`·`f627ab3a`).

세 갈래를 잰다:

① tick.sh의 감싸기 판정(결정 1) - `launchctl managername` 스텁으로 Background/Aqua를
   재현하고, dryrun이 찍는 `엔진:` 줄(runner.log)로 다섯 경우를 가린다: Background+dira-agy는
   감싸고, Aqua+dira-agy는 안 감싸고, 이미 감싼 argv는 두 번 안 감싸고, Background라도
   dira-agy가 아닌 엔진(claude)은 안 감싸고, dira-agy가 실행 불가라 PATH 폴백으로 bare
   `agy`가 돼도(§27 계약 3) 여전히 감싼다.
② agy-gui.sh 단독 실행(결정 2) - `launchctl print gui/<uid>`가 실패하는 픽스처에서
   1초 안에 종료 코드 75와 stderr `GUI 세션 없음`을 낸다.
③ tick.sh의 `reap_dead_agy_gui`(P460-2, 결정 2 둘째 항목) - `launchctl print gui/<uid>`가
   agy-gui 잡 둘(라벨에 박힌 pid가 산 것 하나·죽은 것 하나)을 돌려주는 픽스처에서, 죽은
   pid 라벨만 `bootout` 한 번 걸고 그 짝 작업 디렉터리를 지우며, 산 pid 라벨은 그대로 둔다.
   `launchctl print`가 실패하는 픽스처에서는 WARN 없이 tick이 그대로 디스패치를 끝낸다.

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
TICKET_ENGINE=("{engine}" {extra}"{{sid}}")
. "{tick}"
"""

FAKE_LAUNCHCTL = """\
#!/bin/bash
case "$1" in
  managername) echo "$FAKE_MANAGERNAME" ;;
  print)
    [ "${FAKE_PRINT_FAIL:-0}" = "1" ] && exit 1
    case "$2" in
      */*/*)
        # 결정 2(P460-2) 단독 잡 조회 - gui/<uid>/<라벨> 형태. 워크디렉터리만 되돌려준다.
        label="${2##*/}"
        wd=$(awk -F'\t' -v l="$label" '$1==l{print $2}' "${FAKE_WORKDIR_MAP:-/dev/null}" 2>/dev/null)
        [ -n "$wd" ] && printf '\\tpath = %s/job.plist\\n' "$wd"
        exit 0 ;;
      *)
        # 세션 조회(gui/<uid>) - agy-gui.sh의 GUI 세션 유무 검사와 reap_dead_agy_gui의
        # 잡 목록 조회가 같은 형태를 공유한다.
        [ "$FAKE_GUI_OK" = "1" ] || exit 1
        printf '\\tservices = {\\n'
        [ -n "${FAKE_SERVICES_FILE:-}" ] && cat "$FAKE_SERVICES_FILE" 2>/dev/null
        printf '\\t}\\n'
        exit 0 ;;
    esac ;;
  bootout)
    [ -n "${FAKE_BOOTOUT_LOG:-}" ] && echo "$2" >> "$FAKE_BOOTOUT_LOG"
    exit 0 ;;
  bootstrap)
    [ "${FAKE_BOOTSTRAP_FAIL:-0}" = "1" ] && exit 1
    exit 0 ;;
  list) exit 0 ;;
  *) exit 1 ;;
esac
"""

STUB_ENGINE = """\
#!/bin/bash
exit 0
"""

# tick(dryrun이 아닌 실제 CMD=tick) 테스트용 - 디스패치된 티켓을 바로 닫는다
# (test_dispatch_cleanup.py의 같은 수법). reap_dead_agy_gui는 이 엔진이 뜨기 전에 이미 돌아
# 있으므로 엔진 쪽에서 흉내낼 것이 없다.
ENGINE_RESULT = """\
#!/bin/bash
wip=$(ls "{tickets}"/*.wip.md 2>/dev/null | head -1)
[ -n "$wip" ] && mv "$wip" "${{wip%.wip.md}}.done.md"
echo '{{"is_error":false,"type":"result","session_id":"sess-x","subtype":"success"}}'
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

    dira_agy = mkfile(os.path.join(tmp, "bin", "dira"), STUB_ENGINE)
    os.chmod(dira_agy, os.stat(dira_agy).st_mode | stat.S_IEXEC)
    dira_claude = mkfile(os.path.join(tmp, "bin", "claude"), STUB_ENGINE)
    os.chmod(dira_claude, os.stat(dira_claude).st_mode | stat.S_IEXEC)
    # 실행 불가 dira-agy(PATH 폴백 재현용) - basename은 같은 dira-agy지만 실행 비트가 없어
    # tick.sh가 "${ENGSUF:-agy}"로 bare agy에 돌아간다(§27 계약 3 폴백).
    dira_agy_noexec = mkfile(os.path.join(tmp, "bin2", "dira"), STUB_ENGINE, 0o644)
    engine_result = mkfile(os.path.join(tmp, "bin", "engine-result.sh"),
                            ENGINE_RESULT.format(tickets=tickets), 0o755)

    def queue():
        if os.path.isdir(tickets):
            shutil.rmtree(tickets)
        os.makedirs(tickets)
        mkfile(os.path.join(tickets, "cafe0001.md"),
               "---\nticket: cafe0001\ntitle: t\nkind: work\n---\n\n## Goal\ntest\n")

    def dryrun(engine_path, managername, extra=""):
        queue()
        if os.path.exists(runlog):
            os.remove(runlog)
        w1 = mkfile(os.path.join(root, "workers", "w1.sh"),
                    WORKER.format(tmp=tmp, tick=TICK, engine=engine_path, extra=extra), 0o755)
        env = dict(os.environ, TICKET_LOCAL=local, HOME=home,
                   FAKE_MANAGERNAME=managername, FAKE_GUI_OK="1")
        r = subprocess.run([w1, "dryrun"], capture_output=True, text=True,
                           env=env, timeout=30)
        assert r.returncode == 0, "dryrun rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)
        lines = runlog_engine_lines(root)
        assert lines, "runner.log에 엔진: 줄이 없다\n" + r.stdout + r.stderr
        return lines[-1]

    def tick_once(engine_path, extra_env, extra=""):
        queue()
        if os.path.exists(runlog):
            os.remove(runlog)
        w1 = mkfile(os.path.join(root, "workers", "w1.sh"),
                    WORKER.format(tmp=tmp, tick=TICK, engine=engine_path, extra=extra), 0o755)
        env = dict(os.environ, TICKET_LOCAL=local, HOME=home, **extra_env)
        return subprocess.run([w1, "tick"], capture_output=True, text=True,
                               env=env, timeout=60)

    def runner_log_text():
        try:
            with open(runlog, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    # --- ① Background + dira-agy -> 감싼다 ---
    line = dryrun(dira_agy, "Background", '"agy" ')
    first = line.split()[0]
    assert os.path.basename(first) == "agy-gui.sh", \
        "Background + dira-agy인데 안 감쌌다: " + line
    assert line.split()[1:3] == [dira_agy, "agy"], "원래 엔진 argv가 뒤에 안 남았다: " + line

    # --- ② Aqua + dira-agy -> 안 감싼다 ---
    line = dryrun(dira_agy, "Aqua", '"agy" ')
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

    # --- ⑤ Background + dira-agy(실행 불가, PATH 폴백으로 bare agy가 됨) -> 그래도 감싼다 ---
    # ENGBN은 폴백 전 원래 basename(dira-agy)을 기억해 두는 값이라, 폴백으로 첫 칸이 bare
    # "agy"로 바뀌어도 감싸기 판정이 안 흔들려야 한다(재디스패치 복구 3이 고친 실버그).
    line = dryrun(dira_agy_noexec, "Background", '"agy" ')
    parts = line.split()
    assert os.path.basename(parts[0]) == "agy-gui.sh", \
        "PATH 폴백(bare agy)인데 안 감쌌다: " + line
    assert parts[1] == "agy" and parts[2] != "agy", \
        "폴백 뒤 원래 엔진 자리가 bare agy 하나가 아니다: " + line

    print("OK - tick.sh Background 감싸기 판정 다섯 경우 통과")

    # --- ⑥ agy-gui.sh 단독: GUI 세션 없음 -> 1초 안에 75 + stderr 메시지 ---
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

    # --- ⑥-2 agy-gui.sh 단독: launchctl bootstrap 실패 -> 1초 안에 75 + stderr 메시지 ---
    env = dict(os.environ, PATH=os.path.join(home, ".local", "bin") + os.pathsep + os.environ["PATH"],
               FAKE_MANAGERNAME="Aqua", FAKE_GUI_OK="1", FAKE_BOOTSTRAP_FAIL="1")
    t0 = time.monotonic()
    r = subprocess.run([AGY_GUI, "true"], input="", capture_output=True, text=True,
                       env=env, timeout=10)
    elapsed = time.monotonic() - t0
    assert r.returncode == 75, "bootstrap 실패인데 종료 코드가 75가 아니다: {}\n{}".format(
        r.returncode, r.stderr)
    assert "bootstrap" in r.stderr, "stderr에 bootstrap 실패 사유가 없다: " + r.stderr
    assert elapsed < 1.0, "1초 안에 안 끝났다(상한 없이 멈춤 재현): {:.2f}s".format(elapsed)

    print("OK - agy-gui.sh가 launchctl bootstrap 실패를 1초 안에 75로 낸다")

    # --- ⑦ reap_dead_agy_gui(P460-2): 죽은 pid 라벨만 bootout 한 번, 산 pid 라벨은 0번 ---
    alive_pid = os.getpid()  # 이 테스트 프로세스 자신 - tick 서브프로세스가 끝나도 살아 있다
    dead_proc = subprocess.Popen(["true"])
    dead_proc.wait()
    dead_pid = dead_proc.pid  # wait() 뒤라 이미 거둬졌다 - kill -0이 실패하는 죽은 pid

    label_alive = "tech.proofer.dira.agy-gui.{}.1111".format(alive_pid)
    label_dead = "tech.proofer.dira.agy-gui.{}.2222".format(dead_pid)

    workdir_alive = tempfile.mkdtemp(prefix="agy-gui-alive-")
    workdir_dead = tempfile.mkdtemp(prefix="agy-gui-dead-")
    mkfile(os.path.join(workdir_alive, "marker"), "x\n")
    mkfile(os.path.join(workdir_dead, "marker"), "x\n")

    services_file = mkfile(os.path.join(tmp, "services.tsv"),
                            "\t\t0\t-\t{}\n\t\t0\t-\t{}\n".format(label_alive, label_dead))
    workdir_map = mkfile(os.path.join(tmp, "workdir-map.tsv"),
                          "{}\t{}\n{}\t{}\n".format(label_alive, workdir_alive,
                                                     label_dead, workdir_dead))
    bootout_log = os.path.join(tmp, "bootout.log")

    r = tick_once(engine_result, dict(
        FAKE_MANAGERNAME="Aqua", FAKE_GUI_OK="1",
        FAKE_SERVICES_FILE=services_file, FAKE_WORKDIR_MAP=workdir_map,
        FAKE_BOOTOUT_LOG=bootout_log))
    assert r.returncode == 0, "tick rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)

    boot_lines = []
    if os.path.exists(bootout_log):
        with open(bootout_log, encoding="utf-8") as f:
            boot_lines = f.read().splitlines()
    dead_boots = [ln for ln in boot_lines if label_dead in ln]
    alive_boots = [ln for ln in boot_lines if label_alive in ln]
    assert len(dead_boots) == 1, "죽은 pid 라벨을 정확히 한 번 bootout해야 한다: " + repr(boot_lines)
    assert len(alive_boots) == 0, "산 pid 라벨인데 bootout했다: " + repr(boot_lines)
    assert not os.path.isdir(workdir_dead), "죽은 라벨의 작업 디렉터리가 안 지워졌다: " + workdir_dead
    assert os.path.isdir(workdir_alive), "산 라벨의 작업 디렉터리를 잘못 지웠다: " + workdir_alive
    assert label_dead in runner_log_text(), "runner.log에 걷은 라벨 NOTE가 없다"

    shutil.rmtree(workdir_alive, ignore_errors=True)

    print("OK - reap_dead_agy_gui가 죽은 pid 라벨만 걷는다")

    # --- ⑧ launchctl print 실패 -> WARN 없이 tick이 그대로 디스패치를 끝낸다 ---
    r = tick_once(engine_result, dict(
        FAKE_MANAGERNAME="Aqua", FAKE_GUI_OK="1", FAKE_PRINT_FAIL="1"))
    assert r.returncode == 0, "tick rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)
    combined = r.stdout + r.stderr + runner_log_text()
    assert "WARN" not in combined, "launchctl 실패인데 WARN이 찍혔다: " + combined
    done = [f for f in os.listdir(tickets) if f.endswith(".done.md")]
    assert done, "launchctl 실패인데 티켓 디스패치 자체가 막혔다: " + repr(os.listdir(tickets))

    print("OK - launchctl print 실패에도 WARN 없이 디스패치가 끝난다")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(home, ignore_errors=True)
