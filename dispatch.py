#!/usr/bin/env python3
"""공통 디스패치 모듈 (docs/DESIGN.md P489).

  dispatch.py run <루트> --reason cron|request|direct|judge [--hash H] [--worker W] [--dryrun]

띄울지와 어느 워커로 띄울지만 정한다. 어느 티켓을 집을지는 tick.sh가 정한다.
stdout 한 줄 JSON, rc 0 = 띄웠다(dryrun이면 띄울 것이다), 1 = 안 띄웠다, 2 = 사용법 오류.
표준 라이브러리만 쓴다.
"""
import argparse
import datetime
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REASONS = ("cron", "request", "direct", "judge")


def local_dir():
    return os.environ.get("TICKET_LOCAL") or os.path.expanduser("~/.config/dira")


def load_max():
    # ponytail: 파일 형식이 틀리면 cpu_count로 조용히 돌아간다. 경고 줄이 필요하면 그때 더한다.
    try:
        with open(os.path.join(local_dir(), "dispatch.json"), encoding="utf-8") as f:
            v = json.load(f)["load_max"]
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return float(os.cpu_count() or 1)


def crontab_text():
    try:
        r = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=10)
        return r.stdout if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def lock_path(workers_dir, name):
    h = hashlib.sha1(os.path.join(workers_dir, name).encode()).hexdigest()[:8]
    return os.path.join(local_dir(), "run", "%s-%s.lock" % (name, h))


def entry_busy(workers_dir, name):
    """P514: 산 pid가 쥔 tick 진입 잠금이 있으면 True."""
    h = hashlib.sha1(os.path.join(workers_dir, name).encode()).hexdigest()[:8]
    try:
        with open(os.path.join(local_dir(), "run", "%s-%s.entry" % (name, h), "pid")) as f:
            os.kill(int(f.read().strip()), 0)
        return True
    except PermissionError:
        return True
    except (OSError, ValueError):
        return False


def idle_workers(root, only):
    wdir = os.path.join(os.path.abspath(root), "workers")
    cron = crontab_text()
    out = []
    try:
        names = sorted(n[:-3] for n in os.listdir(wdir) if n.endswith(".sh"))
    except OSError:
        return out
    for name in names:
        full = os.path.join(wdir, name + ".sh")
        if only and name != only:
            continue
        if full not in cron:
            continue
        if os.path.exists(lock_path(wdir, name)):
            continue
        if entry_busy(wdir, name):
            continue
        out.append(name)
    return out


def candidates(root):
    r = subprocess.run([sys.executable, os.path.join(HERE, "tickets.py"), "select", root],
                       capture_output=True, text=True)
    return [ln.split("|")[1] for ln in r.stdout.splitlines() if ln.count("|") >= 7]


def decide(root, reason, h, worker):
    """-> (worker 또는 None, why)"""
    idle = idle_workers(root, worker)
    gated = reason == "judge"
    cands = candidates(root) if (reason in ("request", "judge") or (h and reason == "direct")) else []
    if reason == "cron":
        return (idle[0], "idle 워커") if idle else (None, "워커가 idle이 아니다")
    if h and h not in cands:
        return None, "그 해시는 후보가 아니다"
    if gated:
        load, mx = os.getloadavg()[0], load_max()
        if load > mx:
            return None, "부하 %.2f가 상한 %.2f를 넘는다" % (load, mx)
        if not idle:
            return None, "idle 워커가 없다"
        others = [c for c in cands if c != h]
        if others:
            return None, "다른 후보가 있다 (%s)" % ",".join(others[:3])
        return idle[0], "조건 충족"
    return (idle[0], "idle 워커") if idle else (None, "idle 워커가 없다")


def log(root, line):
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with open(os.path.join(root, "workers", "runner.log"), "a", encoding="utf-8") as f:
            f.write("%s [dispatch] %s\n" % (now, line))
    except OSError:
        pass


def launch(root, worker, h):
    wdir = os.path.join(os.path.abspath(root), "workers")
    cmd = ["bash", os.path.join(wdir, worker + ".sh")] + (["tick", h] if h else [])
    out = open(os.path.join(wdir, "cron.log"), "ab")
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=out, stderr=out,
                     start_new_session=True, close_fds=True)
    out.close()


def main(argv):
    ap = argparse.ArgumentParser(prog="dispatch.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run")
    p.add_argument("root")
    p.add_argument("--reason", required=True, choices=REASONS)
    p.add_argument("--hash")
    p.add_argument("--worker")
    p.add_argument("--dryrun", action="store_true")
    try:
        a = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    if not os.path.isdir(a.root):
        print("루트가 디렉터리가 아니다: %s" % a.root, file=sys.stderr)
        return 2
    if a.reason in ("request", "judge") and not a.hash:
        print("--hash가 필요하다", file=sys.stderr)
        return 2
    if a.reason == "cron" and not a.worker:
        print("--worker가 필요하다", file=sys.stderr)
        return 2
    worker = os.path.basename(a.worker)[:-3] if a.worker and a.worker.endswith(".sh") else a.worker
    w, why = decide(a.root, a.reason, a.hash, worker)
    print(json.dumps({"go": w is not None, "worker": w, "hash": a.hash,
                      "reason": a.reason, "why": why}, ensure_ascii=False))
    if not a.dryrun:
        if w:
            launch(a.root, w, a.hash)
            if a.reason != "cron":
                log(a.root, "KICK %s %s %s" % (a.reason, a.hash or "-", w))
        elif a.reason != "cron":
            log(a.root, "KICK-SKIP %s %s %s" % (a.reason, a.hash or "-", why))
    return 0 if w else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
