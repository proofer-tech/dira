#!/usr/bin/env python3
"""디스패치 감시자 판정 - docs/DESIGN.md `§디스패치 감시자`(P428-1, 티켓 6d9919ad).

이 파일 하나가 멎음 일곱(G1~G7)을 위에서부터 재고 `<코드> <자력|사람> <한 줄>`로
낸다. `diagnose()`가 유일한 진입점이고 test_watchdog.py가 이 함수만 임시 디렉터리로
잰다 - 실제 pgrep/crontab/git 결과는 인자로 주입한다(기본값은 진짜 명령).

recover(P428-2)·alert(P428-3)는 아직 없다. 이 파일은 읽기만 한다.
"""
import json
import os
import subprocess
import sys
import time


def _real_pgrep_count(path):
    # shell-cap.sh와 같은 수법 - 첫 글자를 대괄호로 싸서 pgrep이 동시에 도는 다른 pgrep의
    # 인자열까지 훑어 자기 자신을 무는 사고를 막는다(cold-boot.sh §_cb_reap의 그 사고).
    pattern = f"[{path[0]}]{path[1:]}" if path else path
    try:
        out = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
    except OSError:
        return 0
    return len([l for l in out.stdout.splitlines() if l.strip()])


def _real_crontab_lines():
    try:
        out = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    except OSError:
        return []
    if out.returncode != 0:
        return []
    return out.stdout.splitlines()


def _real_git_version():
    try:
        out = subprocess.run(["git", "--version"], capture_output=True, text=True)
    except OSError:
        return (127, "git: 실행 파일을 못 찾는다")
    return (out.returncode, (out.stdout or "") + (out.stderr or ""))


def diagnose(root, local=None, now=None, pgrep_count=_real_pgrep_count,
             crontab_lines=_real_crontab_lines, git_version=_real_git_version):
    """`<코드> <자력|사람> <한 줄>` 목록을 반환한다. 하나도 안 걸리면 빈 리스트.

    root - `<루트>`(reaper.sh·push.sh가 사는 그 디렉터리, workers/의 부모).
    local - `TICKET_LOCAL`에 해당하는 값. 기본은 `$HOME/.config/dira`.
    now - epoch 초. 기본은 실제 현재 시각(테스트가 고정값을 준다).
    """
    now = now if now is not None else time.time()
    local = local or os.environ.get("TICKET_LOCAL") or os.path.join(
        os.path.expanduser("~"), ".config", "dira")
    lines = []

    # --- 전제: 열린 티켓이 0이면 아무것도 안 잰다. 빈 큐는 멎은 것이 아니다 ---
    tickets_dir = os.path.join(root, "tickets")
    open_tickets = 0
    if os.path.isdir(tickets_dir):
        for name in os.listdir(tickets_dir):
            if name.endswith(".md") and not name.endswith(".done.md"):
                open_tickets += 1
    if open_tickets == 0:
        return lines

    workers_dir = os.path.join(root, "workers")
    worker_paths = []
    if os.path.isdir(workers_dir):
        for name in sorted(os.listdir(workers_dir)):
            if name.endswith(".sh"):
                worker_paths.append(os.path.join(workers_dir, name))

    # --- G1: 받는 트리가 더럽다 (workers/.gate-dirty, dispatch-gate.sh가 쓴다) ---
    gate_dirty = os.path.join(workers_dir, ".gate-dirty")
    if os.path.isfile(gate_dirty):
        with open(gate_dirty, encoding="utf-8", errors="replace") as f:
            body = f.read().splitlines()
        # 1번째 줄은 <타임스탬프> <받는 트리 경로>다(dispatch-gate.sh가 쓰는 그 모양) -
        # 판정 대상이 아니라 건너뛴다. 2번째 줄부터 <git status 줄><탭><잔해|사람편집>.
        verdicts = []
        for l in body[1:]:
            if not l:
                continue
            parts = l.split("\t")
            verdicts.append(parts[1] if len(parts) > 1 else None)
        if verdicts:
            who = "자력" if all(v == "잔해" for v in verdicts) else "사람"
            lines.append(f"G1 {who} 받는 트리가 더러워 push가 막힌다({len(verdicts)}건)")

    # --- G2: 워커 전부가 전용 워크트리가 없다 (workers/.gate-notree-*) ---
    if worker_paths:
        notree_n = len([n for n in os.listdir(workers_dir)
                         if n.startswith(".gate-notree-")])
        if notree_n == len(worker_paths):
            lines.append(f"G2 사람 워커 {len(worker_paths)}개 전부 전용 워크트리가 없다")

    # --- G3: 엔진 쿨다운이 살아 있다 (run/cooldown-*, 무접미사 + 슬롯 접미사 둘 다) ---
    run_dir = os.path.join(local, "run")
    if os.path.isdir(run_dir):
        alive = []
        for name in sorted(os.listdir(run_dir)):
            if not name.startswith("cooldown-"):
                continue
            try:
                with open(os.path.join(run_dir, name), encoding="utf-8", errors="replace") as f:
                    first = f.readline().strip()
                until = int(first)
            except (OSError, ValueError):
                continue
            if until > now:
                alive.append((name, until))
        if alive:
            has_eligible = False
            tokens_path = os.path.join(local, "tokens.json")
            try:
                with open(tokens_path, encoding="utf-8") as f:
                    data = json.load(f)
                for t in data.get("claude", {}).get("tokens", []):
                    exhausted_until = t.get("exhaustedUntil")
                    if t.get("enabled") and (exhausted_until is None or exhausted_until <= now):
                        has_eligible = True
                        break
            except (OSError, ValueError):
                pass
            _, worst_until = max(alive, key=lambda kv: kv[1])
            who = "자력" if has_eligible else "사람"
            extra = "" if has_eligible else "(계정 전부 소진)"
            lines.append(
                f"G3 {who} 엔진 쿨다운이 {int(worst_until - now)}초 더 남았다{extra}")

    # --- G4: claude 인증 토큰이 없거나 비었다 ---
    token_path = os.path.join(local, "oauth-token")
    if not os.path.isfile(token_path) or os.path.getsize(token_path) == 0:
        lines.append("G4 사람 claude 인증 토큰이 없거나 비었다")

    # --- G5: 워커 셸이 상한을 넘게 쌓였다 (임계는 shell-cap.sh와 같은 자리에서 읽는다) ---
    threshold = 25
    try:
        with open(os.path.join(local, "shell-limit"), encoding="utf-8") as f:
            threshold = int(f.readline().strip())
    except (OSError, ValueError):
        threshold = 25
    over = []
    for p in worker_paths:
        n = pgrep_count(p)
        if n > threshold:
            over.append((os.path.basename(p), n))
    if over:
        name, n = max(over, key=lambda kv: kv[1])
        lines.append(f"G5 자력 워커 {name} 셸이 {n}벌(상한 {threshold})")

    # --- G6: 살아 있는 워커가 있는데 크론 줄이 0개다 ---
    if worker_paths:
        found = False
        for cl in crontab_lines():
            cl = cl.strip()
            if cl.startswith("#"):
                continue
            for p in worker_paths:
                if f'"{p}"' in cl:
                    found = True
                    break
            if found:
                break
        if not found:
            # ponytail: 이 검사 자체가 감시자 자신의 크론 줄을 안 본다 - 감시자의 크론 줄까지
            # 빠지면 이 파일이 아예 안 돌아서 여기까지 못 온다. 그 경우는 이 칸이 못 잡는다
            # (DESIGN.md §멎음의 목록: "G6은 자기를 못 고친다"). 크론 밖에 감시자용 상위
            # 감시자를 하나 더 세우면 그것을 또 감시할 것이 필요해지므로 늘리지 않는다.
            lines.append(
                f"G6 자력 살아 있는 워커 {len(worker_paths)}개의 크론 줄이 0개다")

    # --- G7: git 자체가 죽어 있다 ---
    code, out = git_version()
    if code != 0:
        first_line = out.splitlines()[0] if out else "(출력 없음)"
        lines.append(f"G7 사람 git --version이 죽는다: {first_line}")

    return lines


# --- recover: G1-G3-G5-G6만 고친다 (DESIGN.md §고치는 손은 되돌릴 수 있는 것만 잡는다,
# 티켓 3db4cc2a). G2-G4-G7은 diagnose()가 줄을 내도 이 함수가 아예 안 읽는다.
#
# 처방마다 `<루트>/workers/.watchdog-<코드>`에 (시각, 이번에 고친 상태의 신호) 두 줄을
# 남긴다. 같은 신호가 다시 오면 시각을 갱신하지 않고 건너뛴다 - "같은 원인에 두 번 안
# 친다"는 계약이 시각 비교가 아니라 신호 비교로 서는 이유는, G5(kill)처럼 신호가 5분마다
# 다시 재는 실시간 값(프로세스 목록)일 때 mtime만으로는 "상태가 그대로인지"를 못 가른다 -
# 신호(죽일 pid 집합·잔해 판정 결과 등)가 같으면 상태도 같다.

def _marker_path(root, code):
    return os.path.join(root, "workers", f".watchdog-{code}")


def _read_marker(root, code):
    # 신호(signature)가 여러 줄일 수 있다(G1은 gate-dirty 파일 전체를 신호로 쓴다) - 그래서
    # 둘째 줄만 읽지 않고 첫 줄 뒤 나머지 전부를 읽는다. write가 끝에 붙이는 개행 하나만 뗀다.
    try:
        with open(_marker_path(root, code), encoding="utf-8") as f:
            head = f.readline().strip()
            sig = f.read()
    except OSError:
        return None
    if sig.endswith("\n"):
        sig = sig[:-1]
    try:
        return (float(head), sig)
    except ValueError:
        return None


def _write_marker(root, code, now, signature):
    p = _marker_path(root, code)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(f"{now}\n{signature}\n")


def _already_treated(root, code, signature):
    prev = _read_marker(root, code)
    return prev is not None and prev[1] == signature


def _real_classify(recv, paths, root):
    # push.sh classify를 그대로 부른다 - 판정식을 여기서 새로 안 짓는다. cwd를 recv로 둬야
    # push.sh 안의 `git rev-parse --git-common-dir`가 받는 트리를 가리킨다(root는 push.sh
    # 파일이 있는 자리일 뿐, push.sh가 실제로 판정할 트리가 아니다).
    push_sh = os.path.join(root, "push.sh")
    if not paths or not os.path.isfile(push_sh):
        return []
    out = subprocess.run(["bash", push_sh, "classify", *paths], cwd=recv,
                          capture_output=True, text=True)
    return [l for l in out.stdout.splitlines() if l]


def _real_restore(recv, paths):
    subprocess.run(["git", "-C", recv, "restore", "--staged", "--worktree", "--", *paths])


def _real_pids_by_age(path):
    # (pid, etimes초) 목록, 오래된 것(etimes 큰 것)부터. pgrep 패턴은 shell-cap.sh와 같은
    # 수법(첫 글자 대괄호) - 동시에 도는 다른 pgrep의 인자열을 자기 자신으로 무는 사고를 막는다.
    pattern = f"[{path[0]}]{path[1:]}" if path else path
    try:
        out = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
    except OSError:
        return []
    pids = [l.strip() for l in out.stdout.splitlines() if l.strip()]
    if not pids:
        return []
    try:
        ps_out = subprocess.run(["ps", "-o", "pid=,etimes=", "-p", ",".join(pids)],
                                 capture_output=True, text=True)
    except OSError:
        return []
    result = []
    for l in ps_out.stdout.splitlines():
        parts = l.split()
        if len(parts) != 2:
            continue
        try:
            result.append((int(parts[0]), int(parts[1])))
        except ValueError:
            continue
    result.sort(key=lambda kv: -kv[1])
    return result


def _real_kill(pid):
    try:
        os.kill(pid, 15)
    except OSError:
        pass


def _real_token_rotate(root):
    subprocess.run(["bash", os.path.join(root, "token-rotate.sh"), "exhausted"])


def _real_crontab_read():
    try:
        out = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    except OSError:
        return (False, [])
    if out.returncode != 0:
        return (False, [])
    return (True, out.stdout.splitlines())


def _real_crontab_write(lines):
    subprocess.run(["crontab", "-"], input="\n".join(lines) + ("\n" if lines else ""),
                    text=True)


def _cron_lines_for(worker_path):
    # workers.ts의 cronLine()과 같은 모양 - 등록 단위 2줄, `;`로 안 붙인다(:00/:30이 결정적
    # 이어야 한다는 이유도 같다). GUI가 아니라 여기서 새로 짓는 이유는 이 파일이 node에
    # 안 기댄다는 계약(bash+python3+git+osascript) 때문이다 - 모양만 같게 맞춘다.
    log = os.path.join(os.path.dirname(worker_path), "cron.log")
    run = f'"{worker_path}" >> "{log}" 2>&1'
    return [f"* * * * * {run}", f"* * * * * sleep 30; {run}"]


def recover(root, local=None, now=None, lines=None,
            classify=_real_classify, restore=_real_restore,
            pids_by_age=_real_pids_by_age, kill=_real_kill,
            token_rotate=_real_token_rotate,
            crontab_read=_real_crontab_read, crontab_write=_real_crontab_write):
    """G1-G3-G5-G6만 고치고 결과를 `<코드> <조치|건너뜀> <한 줄>`로 낸다."""
    now = now if now is not None else time.time()
    local = local or os.environ.get("TICKET_LOCAL") or os.path.join(
        os.path.expanduser("~"), ".config", "dira")

    cron_ok, cron_lines_now = crontab_read()
    if lines is None:
        lines = diagnose(root, local=local, now=now,
                          crontab_lines=lambda: cron_lines_now)

    codes = {l.split(" ", 1)[0]: l for l in lines}
    workers_dir = os.path.join(root, "workers")
    out = []

    # --- G1: 받는 트리 잔해. 저장된 판정을 안 믿고 push.sh classify를 다시 불러 정한다 ---
    if "G1" in codes:
        gate_dirty = os.path.join(workers_dir, ".gate-dirty")
        try:
            with open(gate_dirty, encoding="utf-8", errors="replace") as f:
                body = f.read().splitlines()
        except OSError:
            body = []
        if body:
            header = body[0].split(" ", 1)
            recv = header[1] if len(header) > 1 else root
            paths = [l.split("\t", 1)[0][3:] for l in body[1:] if l]
            signature = "G1:" + "\n".join(body)
            if not paths:
                pass
            elif _already_treated(root, "G1", signature):
                out.append("G1 건너뜀 이미 처방했다")
            else:
                verdicts = classify(recv, paths, root)
                if verdicts and len(verdicts) == len(paths) and all(v == "잔해" for v in verdicts):
                    restore(recv, paths)
                    out.append(f"G1 처방 잔해 {len(paths)}건 restore")
                    _write_marker(root, "G1", now, signature)
                else:
                    out.append("G1 건너뜀 사람편집이 섞여 있다")

    # --- G3: 엔진 쿨다운. eligible 토큰이 있을 때만(diagnose가 이미 그렇게 갈랐다) ---
    if codes.get("G3", "").startswith("G3 자력"):
        run_dir = os.path.join(local, "run")
        alive = []
        if os.path.isdir(run_dir):
            alive = sorted(n for n in os.listdir(run_dir) if n.startswith("cooldown-"))
        signature = "G3:" + ",".join(alive)
        if _already_treated(root, "G3", signature):
            out.append("G3 건너뜀 이미 처방했다")
        else:
            token_rotate(root)
            out.append("G3 처방 token-rotate.sh exhausted")
            _write_marker(root, "G3", now, signature)

    # --- G5: 워커별로 임계를 넘는 만큼만 오래된 것부터 kill ---
    if "G5" in codes and os.path.isdir(workers_dir):
        threshold = 25
        try:
            with open(os.path.join(local, "shell-limit"), encoding="utf-8") as f:
                threshold = int(f.readline().strip())
        except (OSError, ValueError):
            threshold = 25
        for name in sorted(os.listdir(workers_dir)):
            if not name.endswith(".sh"):
                continue
            wp = os.path.join(workers_dir, name)
            pids = pids_by_age(wp)
            excess = len(pids) - threshold
            if excess <= 0:
                continue
            targets = pids[:excess]
            signature = f"G5:{name}:" + ",".join(str(p) for p, _ in targets)
            if _already_treated(root, "G5", signature):
                out.append(f"G5 건너뜀 {name} 이미 처방했다")
                continue
            for pid, _ in targets:
                kill(pid)
            out.append(f"G5 처방 {name} {len(targets)}벌 kill(상한 {threshold})")
            _write_marker(root, "G5", now, signature)

    # --- G6: 살아 있는 워커마다 크론 2줄을 다시 심는다. 읽기가 애매하면 안 건드린다 ---
    if "G6" in codes:
        if not cron_ok or not cron_lines_now:
            out.append("G6 건너뜀 crontab -l이 실패했거나 비었다")
        else:
            worker_paths = [os.path.join(workers_dir, n)
                             for n in sorted(os.listdir(workers_dir))
                             if n.endswith(".sh")] if os.path.isdir(workers_dir) else []
            if worker_paths:
                signature = "G6:" + ",".join(worker_paths)
                if _already_treated(root, "G6", signature):
                    out.append("G6 건너뜀 이미 처방했다")
                else:
                    new_lines = list(cron_lines_now)
                    for wp in worker_paths:
                        new_lines.extend(_cron_lines_for(wp))
                    crontab_write(new_lines)
                    out.append(f"G6 처방 워커 {len(worker_paths)}개 크론 재등록")
                    _write_marker(root, "G6", now, signature)

    return out


def main(argv):
    if len(argv) > 2 and argv[1] == "recover":
        for line in recover(argv[2]):
            print(line)
        return 0
    root = argv[1] if len(argv) > 1 else os.getcwd()
    for line in diagnose(root):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
