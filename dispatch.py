#!/usr/bin/env python3
"""공통 디스패치 모듈 (docs/DESIGN.md P489).

  dispatch.py run <루트> --reason cron|request|direct|judge [--hash H] [--worker W] [--dryrun]
  dispatch.py sweep [--daemon] [--once]

run: 띄울지와 어느 워커로 띄울지만 정한다. 어느 티켓을 집을지는 tick.sh가 정한다.
stdout 한 줄 JSON, rc 0 = 띄웠다(dryrun이면 띄울 것이다), 1 = 안 띄웠다, 2 = 사용법 오류.

sweep(P565): 머신에 하나만 사는 스케줄러. cron 한 줄(`* * * * * ... sweep`)이 1분마다 살아 있는지
보고 없으면 띄운다. 데몬은 SWEEP_INTERVAL초마다 모든 등록 워커의 큐를 stat과 열린 티켓
frontmatter로만 본다. 일이 있는 워커만 tick을 띄우고, 빈 큐에서는 프로세스도 파일 쓰기도 0이다.
reap과 정리 작업(로그 보존, 슬림, agy-gui 잔여 잡)은 데몬이 느린 주기로 머신에 한 번만 돈다.
표준 라이브러리만 쓴다. /usr/bin/python3(3.9)에서 돈다.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REASONS = ("cron", "request", "direct", "judge")
MARKER = "# dira-worker "   # 등록 표지 줄(P565). cron은 주석을 실행하지 않는다


def local_dir():
    return os.environ.get("TICKET_LOCAL") or os.path.expanduser("~/.config/dira")


def dispatch_cfg():
    try:
        with open(os.path.join(local_dir(), "dispatch.json"), encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def cfg_num(key, default):
    # ponytail: 파일 형식이 틀리면 기본값으로 조용히 돌아간다. 경고 줄이 필요하면 그때 더한다.
    v = dispatch_cfg().get(key)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    return float(default)


def load_max():
    return cfg_num("load_max", os.cpu_count() or 1)


def cron_load_max():
    # 기본값 코어 수 x 60(10코어 맥 600). 이 맥은 세션이 돌 때 load1 중앙값 165, p95 442이고(P522 실측)
    # load 335에서도 원활하다(사람 확인 2026-11-18). 맥이 무겁더라도 일은 진행되고, p99(927) 같은
    # 극단에서만 dira가 새 tick을 보탠다. 빈 큐 부하는 sweep이 없앴으므로 이 상한은 일이 있을 때만 쓰인다.
    return cfg_num("cron_load_max", (os.cpu_count() or 1) * 60)


def crontab_text(strict=False):
    """strict면 읽기 실패에 None을 돌려준다(진짜 빈 crontab "no crontab for"만 "")."""
    try:
        r = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None if strict else ""
    if r.returncode == 0:
        return r.stdout
    if strict and "no crontab" not in (r.stderr or ""):
        return None
    return ""


def registry_path():
    return os.path.join(local_dir(), "run", "registry.txt")


def sweep_lock_path():
    return os.path.join(local_dir(), "run", "sweep.lock")


def sweep_alive():
    """sweep 데몬이 잠금을 쥐고 있으면 True. 잠금 파일을 잠깐 잡아 볼 뿐 아무것도 쓰지 않는다."""
    import fcntl
    try:
        fd = os.open(sweep_lock_path(), os.O_RDONLY)
    except OSError:
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    except OSError:
        return True
    finally:
        os.close(fd)


def registry_text():
    """등록 워커의 원천은 crontab이다(GUI가 쓴다). sweep 데몬이 살아 있으면 데몬이 60초마다
    갱신하는 사본을 읽고 `crontab -l`을 띄우지 않는다. 데몬이 없을 때만 crontab을 직접 읽는다."""
    if sweep_alive():
        try:
            with open(registry_path(), encoding="utf-8") as f:
                return f.read()
        except OSError:
            pass
    return crontab_text()


def lock_path(workers_dir, name):
    h = hashlib.sha1(os.path.join(workers_dir, name).encode()).hexdigest()[:8]
    return os.path.join(local_dir(), "run", "%s-%s.lock" % (name, h))


def whash(workers_dir, name):
    return hashlib.sha1(os.path.join(workers_dir, name).encode()).hexdigest()[:8]


def pid_alive(path):
    """path 파일의 pid가 양의 정수이고 산 프로세스면 True. 파일이 없거나 숫자가 아니면 False."""
    try:
        with open(path) as f:
            pid = int(f.read().strip())
        if pid <= 0:  # kill(0)/kill(-1)은 항상 성공한다
            return False
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except (OSError, ValueError):
        return False


def entry_busy(workers_dir, name):
    """P514: 산 pid가 쥔 tick 진입 잠금이 있으면 True. 죽은 잠금은 로그 없이 걷는다(P522 결정 1)."""
    d = os.path.join(local_dir(), "run", "%s-%s.entry" % (name, whash(workers_dir, name)))
    if not os.path.isdir(d) or pid_alive(os.path.join(d, "pid")):
        return os.path.isdir(d)
    shutil.rmtree(d, ignore_errors=True)
    return False


def pre_max():
    try:
        return int(os.environ.get("TICKET_PRE_MAX") or 600)
    except ValueError:
        return 600


def kill_group(pid):
    # 프로세스 그룹 리더일 때만 그룹째 보낸다. 아니면 사람 셸의 그룹을 죽일 수 있다.
    try:
        pg = os.getpgid(pid)
    except OSError:
        return
    send = (lambda sig: os.killpg(pg, sig)) if pg == pid else (lambda sig: os.kill(pid, sig))
    try:
        send(signal.SIGTERM)
        for _ in range(100):
            time.sleep(0.1)
            try:
                os.kill(pid, 0)
            except OSError:
                return
        send(signal.SIGKILL)
    except OSError:
        pass


def worker_lock_busy(root, wdir, name):
    """P522 결정 1, 5: 워커 락이 산 pid이고 세션 전 단계에 갇히지 않았으면 True. 아니면 락을 걷고 False."""
    d = lock_path(wdir, name)
    if not os.path.isdir(d):
        return False
    pidf = os.path.join(d, "pid")
    try:
        mtime = os.stat(pidf).st_mtime
        has_pid = True
    except OSError:
        mtime, has_pid = os.stat(d).st_mtime if os.path.isdir(d) else time.time(), False
    age = time.time() - mtime
    if not has_pid:
        if age <= 5:
            return True
        pid = "-"
    elif pid_alive(pidf):
        if pid_alive(os.path.join(d, "session")) or age <= pre_max() + 60:
            return True
        with open(pidf) as f:
            pid = f.read().strip()
        kill_group(int(pid))
        log(root, "WARN 세션 없는 tick 회수 pid=%s %d초" % (pid, age))
        shutil.rmtree(d, ignore_errors=True)
        return False
    else:
        try:
            pid = open(pidf).read().strip()
        except OSError:
            pid = "-"
    log(root, "WARN 죽은 워커 락 회수 %s pid=%s" % (name, pid))
    shutil.rmtree(d, ignore_errors=True)
    return False


def launch_busy(wdir, name):
    """P522 결정 2: cron이 띄운 셸이 아직 살아 있으면 True. 죽은 표지는 걷는다."""
    d = os.path.join(local_dir(), "run", "%s-%s.launch" % (name, whash(wdir, name)))
    if not os.path.isdir(d):
        return False
    if pid_alive(os.path.join(d, "pid")):
        return True
    shutil.rmtree(d, ignore_errors=True)
    return False


def idle_workers(root, only, cron=None):
    wdir = os.path.join(os.path.abspath(root), "workers")
    if cron is None:
        cron = registry_text()
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
        if worker_lock_busy(root, wdir, name):
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
    if reason == "cron":
        # P565: 데몬이 있으면 옛 cron 줄은 아무것도 안 한다(데몬이 같은 워커를 맡는다).
        # 설치본에서 데몬이 없으면 띄운다 - 데몬이 첫 갱신에서 이 줄을 표지 줄로 바꾼다.
        # 이번 한 번은 아래 옛 판정을 그대로 한다(데몬이 못 뜨는 경우에도 디스패치가 끊기지 않는다).
        if sweep_alive():
            return None, "sweep 데몬이 맡는다"
        if installed():
            sweep_start()
        wdir = os.path.join(os.path.abspath(root), "workers")
        if worker and launch_busy(wdir, worker):
            return None, "앞 tick이 아직 돈다"
        load, mx = os.getloadavg()[0], cron_load_max()
        if load > mx:
            mark = os.path.join(local_dir(), "run", "loadskip-" + hashlib.sha1(
                os.path.abspath(root).encode()).hexdigest()[:8])
            try:
                fresh = time.time() - os.stat(mark).st_mtime < 600
            except OSError:
                fresh = False
            if not fresh:
                log(root, "SKIP-LOAD 부하 %.2f > 상한 %.2f - cron tick 건너뜀" % (load, mx))
                try:
                    os.makedirs(os.path.dirname(mark), exist_ok=True)
                    with open(mark, "w"):
                        pass
                    os.utime(mark)
                except OSError:
                    pass
            return None, "부하 %.2f가 cron 상한 %.2f를 넘는다" % (load, mx)
        # P565: 빈 큐는 tick을 띄우지 않는다. 띄울 이유는 집을 티켓, 때가 된 폴링, 수거할 .wip뿐이다
        qs = queue_state(root, local_dir())
        if not (qs["eligible"] or qs["poll_due"] or qs["wip"]):
            return None, "빈 큐"
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


def launch(root, worker, h, cron=False):
    wdir = os.path.join(os.path.abspath(root), "workers")
    cmd = ["bash", os.path.join(wdir, worker + ".sh")] + (["tick", h] if h else [])
    out = open(os.path.join(wdir, "cron.log"), "ab")
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=out, stderr=out,
                            start_new_session=True, close_fds=True)
    out.close()
    if cron:  # P522 결정 2: 다음 cron 호출이 이 셸을 센다
        d = os.path.join(local_dir(), "run", "%s-%s.launch" % (worker, whash(wdir, worker)))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "pid"), "w") as f:
            f.write("%d\n" % proc.pid)


#
# ---- 값싼 큐 판정 (P565) ----
#

def _tickets_mod():
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import tickets
    return tickets


def nfc(s):
    return unicodedata.normalize("NFC", s)


POLL_FLOOR = 30


def poll_due(T, path, fm, floor=POLL_FLOOR):
    """tickets.py pollplan의 WAIT 판정만 옮겼다. 상한이 지났거나 주기가 됐으면 True(tick이 마저 판정한다)."""
    now = datetime.datetime.now().astimezone()

    def when(raw):
        raw = (raw or "").strip().strip("\"'")
        if not raw:
            return None
        try:
            dt = datetime.datetime.fromisoformat(raw)
        except ValueError:
            return None
        return dt if dt.tzinfo else dt.astimezone()
    until = when(fm.get("polling_until"))
    if until is not None and until <= now:
        return True
    script = (fm.get("polling") or "").strip().strip("\"'")
    interval = 0
    try:
        with open(os.path.join(os.path.dirname(os.path.dirname(path)), "polls", script),
                  encoding="utf-8", errors="replace") as f:
            for line in f:
                m = re.match(r"^#\s*dira-poll-interval:\s*(\d+)", line)
                if m:
                    interval = int(m.group(1))
                    break
                if line.strip() and not line.startswith("#"):
                    break
    except OSError:
        pass
    polled = when(fm.get("polled_at"))
    return polled is None or (now - polled).total_seconds() >= max(interval, floor)


def queue_state(root, local):
    """stat과 열린 티켓 frontmatter만 읽는다. 프로세스를 띄우지 않고 파일을 쓰지 않는다.
    -> {open, eligible, poll_due, wip, top5}. eligible = 미할당, 폴링 아님, 백오프 아님, deps 충족."""
    T = _tickets_mod()
    tdir = os.path.join(root, "tickets")
    st = {"open": 0, "eligible": 0, "poll_due": False, "wip": 0, "eligible_paths": []}
    try:
        names = os.listdir(tdir)
    except OSError:
        return st
    wip_sfx = nfc(T.IN_PROGRESS)
    opened = []
    for n in names:
        if n.startswith(".") or not n.endswith(".md"):
            continue
        if T.is_open_name(n):
            opened.append(os.path.join(tdir, n))
        elif nfc(n)[:-3].endswith(wip_sfx):
            st["wip"] += 1
    st["open"] = len(opened)
    for p in opened:
        try:
            fm, lines, end = T.read_fm(p)
        except (OSError, UnicodeDecodeError):
            continue
        if end < 0 or T.is_assigned(fm):
            continue
        if T.is_polling(fm):
            if not st["poll_due"] and poll_due(T, p, fm):
                st["poll_due"] = True
            continue
        if T.backoff_active(local, T.ticket_hash(p, fm)):
            continue
        if T.deps_unmet(root, T.deps_of(lines, end)):
            continue
        st["eligible"] += 1
        st["eligible_paths"].append(p)
    return st


#
# ---- sweep 데몬 (P565) ----
#

def sweep_log_path():
    return os.path.join(local_dir(), "sweep.log")


def slog(line):
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with open(sweep_log_path(), "a", encoding="utf-8") as f:
            f.write("%s %s\n" % (now, line))
    except OSError:
        pass


WORKER_RE = re.compile(r'"([^"]+/workers/[^"/]+\.sh)"')


def registered(text):
    """crontab 사본에서 등록 워커 경로들. 표지 줄(`# dira-worker "<경로>"`), 옛 dispatch 줄,
    더 옛 직접 실행 줄을 모두 등록으로 본다. 다른 주석 줄은 보지 않는다."""
    out = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("#") and not s.startswith(MARKER.strip()):
            continue
        for m in WORKER_RE.finditer(s):
            p = m.group(1)
            if p not in out:
                out.append(p)
    return out


ACTIVE_RE = re.compile(
    r'^\s*\*\s+\*\s+\*\s+\*\s+\*\s+(?:sleep 30;\s*)?'
    r'(?:python3\s+"[^"]*dispatch\.py"\s+run\s+"[^"]*"\s+--reason\s+cron\s+--worker\s+"([^"]+/workers/[^"/]+\.sh)"'
    r'\s*>>\s*"[^"]*/workers/cron\.log"\s+2>&1\s*$'
    r'|"(([^"]+/workers)/[^"/]+\.sh)"\s*>>\s*"(\3)/cron\.log"\s+2>&1\s*$)')


def installed():
    """설치본(.version이 있는 엔진 자리)에서 돌 때만 crontab을 고치고 데몬을 자동으로 띄운다.
    레포에서 도는 테스트가 진짜 crontab이나 떠도는 데몬을 남기지 않게 하는 가드다."""
    return os.path.isfile(os.path.join(HERE, ".version")) or os.environ.get("DIRA_SWEEP_INSTALLED") == "1"


def launcher_line():
    return '* * * * * python3 "%s" sweep >> "%s" 2>&1' % (os.path.abspath(__file__), sweep_log_path())


def normalize_crontab(text, launcher):
    """워커마다 1분에 2번 도는 줄(옛 dispatch 줄, 더 옛 직접 실행 줄)을 실행되지 않는 표지 줄 하나로 바꾸고,
    sweep 기동 줄이 없으면 하나 넣는다. 다른 줄은 바이트 그대로다. 바꿀 것이 없으면 text를 그대로 돌려준다.
    GUI가 등록할 때 옛 2줄을 다시 써도 다음 갱신(60초 안)에 다시 표지가 된다."""
    lines = text.split("\n")
    marked = set(m.group(1) for l in lines if l.strip().startswith(MARKER.strip())
                 for m in WORKER_RE.finditer(l))
    out, changed = [], False
    for line in lines:
        m = ACTIVE_RE.match(line)
        if not m:
            out.append(line)
            continue
        changed = True
        p = m.group(1) or m.group(2)
        if p not in marked:
            marked.add(p)
            out.append('%s"%s"' % (MARKER, p))
    if marked and launcher not in out:
        if out and out[-1] == "":
            out.insert(len(out) - 1, launcher)
        else:
            out.append(launcher)
        changed = True
    if not changed:
        return text
    res = "\n".join(out)
    return res if res.endswith("\n") else res + "\n"


def write_crontab(text):
    try:
        r = subprocess.run(["crontab", "-"], input=text, capture_output=True, text=True, timeout=30)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def never_index(d):
    """Spotlight가 이 디렉터리를 색인하지 않게 표지 파일을 한 번만 둔다."""
    p = os.path.join(d, ".metadata_never_index")
    if os.path.isdir(d) and not os.path.exists(p):
        try:
            open(p, "a").close()
        except OSError:
            pass


class Sweep:
    """한 프로세스가 SWEEP_INTERVAL초마다 cycle()을 부른다. 상태는 전부 메모리에 있다."""

    def __init__(self):
        self.local = local_dir()
        self.reg_text, self.reg_at = "", 0.0
        self.qcache = {}        # root -> (tickets 디렉터리 mtime_ns, 상태) - 열린 티켓이 없을 때만 재사용
        self.running = {}       # (root, worker) -> dict(proc, t0, kind, dmt)
        self.hk = {}            # (일, 키) -> 마지막 시각
        self.backoff = {}       # root -> (until, step, dmt)
        self.children = 0
        self.load_noted = {}    # root -> 마지막 SKIP-LOAD 로그 시각
        self.stats = {"cycles": 0, "ms": 0.0, "max_ms": 0.0, "children": 0, "launched": 0, "since": time.time()}
        self.indexed = set()

    # -- 설정 --
    def num(self, key, default):
        return cfg_num(key, default)

    # -- 등록 사본 --
    def refresh_registry(self, now):
        if now - self.reg_at < self.num("registry_ttl", 60) and self.reg_at:
            return
        self.reg_at = now
        self.children += 1
        text = crontab_text(strict=True)
        if text is None:   # 한 번 못 읽었다고 등록을 비우지 않는다 - 지난 사본을 쓴다
            return
        if installed() and text:
            new = normalize_crontab(text, launcher_line())
            if new != text:
                # 읽고 나서 쓰기 직전까지 GUI가 썼으면 이번엔 건너뛴다(남의 쓰기를 덮지 않는다)
                self.children += 2
                if crontab_text() == text and write_crontab(new):
                    n = sum(1 for l in text.splitlines() if ACTIVE_RE.match(l))
                    slog("CRONTAB 워커 실행 줄 %d개를 표지 줄로 바꿨다" % n)
                    text = new
        if text != self.reg_text:
            self.reg_text = text
            p = registry_path()
            try:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p + ".tmp", "w", encoding="utf-8") as f:
                    f.write(text)
                os.replace(p + ".tmp", p)
            except OSError:
                pass

    def roots(self):
        by = {}
        for w in registered(self.reg_text):
            if not os.path.isfile(w):
                continue
            root = os.path.dirname(os.path.dirname(w))
            by.setdefault(root, []).append(os.path.basename(w)[:-3])
        return by

    # -- 큐 상태 (mtime 캐시) --
    def qstate(self, root):
        try:
            dmt = os.stat(os.path.join(root, "tickets")).st_mtime_ns
        except OSError:
            return None, {"open": 0, "eligible": 0, "poll_due": False, "wip": 0, "eligible_paths": []}
        hit = self.qcache.get(root)
        if hit and hit[0] == dmt and hit[1]["open"] == 0:
            return dmt, hit[1]
        st = queue_state(root, self.local)
        self.qcache[root] = (dmt, st)
        return dmt, st

    # -- 띄우기 --
    def launch(self, root, worker, kind, dmt):
        wdir = os.path.join(root, "workers")
        path = os.path.join(wdir, worker + ".sh")
        env = dict(os.environ, DIRA_SWEEP="1")
        try:
            with open(os.path.join(wdir, "cron.log"), "ab") as out:
                proc = subprocess.Popen(["bash", path], stdin=subprocess.DEVNULL, stdout=out, stderr=out,
                                        start_new_session=True, close_fds=True, env=env)
        except OSError as e:
            slog("ERROR launch %s %s: %s" % (root, worker, e))
            return False
        self.children += 1
        d = os.path.join(self.local, "run", "%s-%s.launch" % (worker, whash(wdir, worker)))
        try:
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "pid"), "w") as f:
                f.write("%d\n" % proc.pid)
        except OSError:
            pass
        self.running[(root, worker)] = {"proc": proc, "t0": time.time(), "kind": kind, "dmt": dmt}
        self.stats["launched"] += 1
        return True

    def collect(self):
        """끝난 tick을 걷고 한 줄 남긴다. 집은 것 없이 끝난 work/preempt tick은 그 큐를 잠시 쉰다."""
        for key in list(self.running):
            if key[0] == "hk":
                continue
            r = self.running[key]
            rc = r["proc"].poll()
            if rc is None:
                continue
            del self.running[key]
            root, worker = key
            wdir = os.path.join(root, "workers")
            shutil.rmtree(os.path.join(self.local, "run", "%s-%s.launch" % (worker, whash(wdir, worker))),
                          ignore_errors=True)
            try:
                dmt = os.stat(os.path.join(root, "tickets")).st_mtime_ns
            except OSError:
                dmt = None
            progress = dmt != r["dmt"]
            secs = time.time() - r["t0"]
            slog("TICK-END %s/%s kind=%s rc=%s secs=%.1f progress=%s" % (
                os.path.basename(os.path.dirname(root)), worker, r["kind"], rc, secs,
                "yes" if progress else "no"))
            if r["kind"] == "poll":
                # 폴링 tick이 polled_at을 못 옮기고 끝나면(게이트 exit, 남이 쥔 poll 잠금) 10초마다 다시 뜨지 않게
                if queue_state(root, self.local)["poll_due"]:
                    step = min(self.backoff.get(("poll", root), (0, 15, None))[1] * 2, self.num("idle_backoff_max", 300))
                    self.backoff[("poll", root)] = (time.time() + step, step, None)
                else:
                    self.backoff.pop(("poll", root), None)
            elif r["kind"] in ("work", "preempt") and not progress:
                step = min(self.backoff.get(root, (0, 30, None))[1] * 2, self.num("idle_backoff_max", 300))
                self.backoff[root] = (time.time() + step, step, dmt)
            elif progress:
                self.backoff.pop(root, None)

    def backed_off(self, root, dmt, now):
        b = self.backoff.get(root)
        if not b:
            return False
        if b[2] != dmt or now >= b[0]:
            if b[2] != dmt:
                self.backoff.pop(root, None)
            return False
        return True

    def busy(self, root, worker):
        wdir = os.path.join(root, "workers")
        return ((root, worker) in self.running or launch_busy(wdir, worker)
                or entry_busy(wdir, worker))

    def has_top5(self, root, st):
        """선점(§1-5 갈래 C) 재료가 있는가: 유효 우선순위 5인 집을 수 있는 티켓. 드문 경우에만 scan한다."""
        T = _tickets_mod()
        try:
            want = set(st["eligible_paths"])
            return any(r["effective"] == 5 and r["path"] in want for r in T.scan(root))
        except Exception:
            return False

    def plan_root(self, root, workers, now, load_ok, stop, notes):
        dmt, st = self.qstate(root)
        if not (st["eligible"] or st["poll_due"]):
            return
        if stop:
            return
        if not load_ok:
            last = self.load_noted.get(root, 0)
            if now - last >= 600:
                self.load_noted[root] = now
                log(root, "SKIP-LOAD 부하 %.2f > 상한 %.2f - sweep 띄우기 보류" % (os.getloadavg()[0], cron_load_max()))
            return
        wdir = os.path.join(root, "workers")
        idle = [w for w in sorted(workers) if not self.busy(root, w)
                and not worker_lock_busy(root, wdir, w)]
        name = os.path.basename(os.path.dirname(root))
        if st["eligible"] and not self.backed_off(root, dmt, now):
            if idle:
                for w in idle[:st["eligible"]]:
                    if self.launch(root, w, "work", dmt):
                        notes.append("%s/%s work" % (name, w))
                return
            # 놀고 있는 워커가 없다: 유효 5 후보가 있을 때만 바쁜 워커 tick 하나로 선점 판정을 맡긴다
            if self.has_top5(root, st):
                for w in sorted(workers):
                    if not self.busy(root, w):
                        if self.launch(root, w, "preempt", dmt):
                            notes.append("%s/%s preempt" % (name, w))
                        break
                else:
                    return
            else:
                self.backoff[root] = (now + self.num("idle_backoff_max", 300), 300, dmt)
            return
        pb = self.backoff.get(("poll", root))
        if st["poll_due"] and idle and not (pb and now < pb[0]):
            if self.launch(root, idle[0], "poll", dmt):
                notes.append("%s/%s poll" % (name, idle[0]))

    # -- 느린 주기 정리 (머신에 한 번) --
    def due(self, key, every, now):
        if now - self.hk.get(key, 0) >= every:
            self.hk[key] = now
            return True
        return False

    def spawn_hk(self, key, cmd, timeout):
        """정리 자식은 기다리지 않는다. 앞 것이 아직 돌면 이번 회차는 건너뛴다."""
        cur = self.running.get(("hk", key))
        if cur:
            if cur["proc"].poll() is None:
                if time.time() - cur["t0"] > timeout:
                    try:
                        cur["proc"].kill()
                    except OSError:
                        pass
                return
        try:
            proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE if key[0] == "reap" else subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, start_new_session=True, text=True)
        except OSError as e:
            slog("ERROR %s: %s" % (key, e))
            return
        self.children += 1
        self.running[("hk", key)] = {"proc": proc, "t0": time.time(), "kind": "hk", "dmt": None}

    def collect_hk(self):
        for key in [k for k in self.running if k[0] == "hk"]:
            r = self.running[key]
            if r["proc"].poll() is None:
                continue
            del self.running[key]
            out = r["proc"].stdout.read() if r["proc"].stdout else ""
            if r["proc"].stdout:
                r["proc"].stdout.close()
            kind, root = key[1]
            if kind == "reap":
                for line in out.splitlines():
                    if line.strip() and not line.startswith("SKIP 다른 reap"):
                        log(root, "[sweep] " + line.strip())

    def housekeep(self, roots, now):
        every = self.num("reap_interval", 300)
        for root in roots:
            _, st = self.qstate(root)
            if st["wip"] and self.due(("reap", root), every, now):
                self.spawn_hk(("reap", root), [sys.executable, os.path.join(HERE, "tickets.py"), "reap",
                                               root, self.local], 120)
            if self.due(("logs", root), 86400, now):
                self.log_retention(root)
            if os.path.isfile(os.path.join(root, "slim-checkout")) and self.due(("slim", root), self.num("slim_interval", 3600), now):
                self.spawn_hk(("slim", root), [sys.executable, os.path.join(HERE, "slim.py"), "auto", root], 120)
            if (os.path.isfile(os.path.join(root, "remote.json")) and " sync-all " not in self.reg_text
                    and self.due(("remote", root), 60, now)):
                self.spawn_hk(("remote", root), [sys.executable, os.path.join(HERE, "remote.py"), "tick",
                                                 "--root", root], 60)
            if root not in self.indexed:
                self.indexed.add(root)
                for d in (os.path.join(root, "workers"), os.path.join(root, "workers", "logs"),
                          os.path.join(root, "workers", "health")):
                    never_index(d)
        if self.due(("agy", ""), every, now):
            self.reap_agy_gui()

    def log_retention(self, root):
        days = self.num("log_keep_days", 14)
        if days <= 0:
            return
        cut = time.time() - days * 86400
        for d in (os.path.join(root, "workers", "logs"), os.path.join(root, "workers", "health")):
            for base, _, files in os.walk(d):
                for f in files:
                    if f in ("runner.log", "cron.log") or f.startswith(".metadata"):
                        continue
                    p = os.path.join(base, f)
                    try:
                        if os.stat(p).st_mtime < cut:
                            os.unlink(p)
                    except OSError:
                        pass

    def reap_agy_gui(self):
        """tick.sh reap_dead_agy_gui를 옮겼다: 죽은 pid 라벨의 일회용 LaunchAgent를 걷는다."""
        if sys.platform != "darwin" or not shutil.which("launchctl"):
            return
        target = "gui/%d" % os.getuid()
        self.children += 1
        try:
            svc = subprocess.run(["launchctl", "print", target], capture_output=True, text=True, timeout=10).stdout
        except (OSError, subprocess.SubprocessError):
            return
        pfx = "tech.proofer.dira.agy-gui."
        for label in set(re.findall(r"(tech\.proofer\.dira\.agy-gui\.[^\s]+)", svc)):
            pid = label[len(pfx):].split(".")[0]
            if not pid.isdigit():
                continue
            try:
                os.kill(int(pid), 0)
                continue
            except PermissionError:
                continue
            except OSError:
                pass
            workdir = ""
            try:
                self.children += 1
                info = subprocess.run(["launchctl", "print", "%s/%s" % (target, label)],
                                      capture_output=True, text=True, timeout=10).stdout
                m = re.search(r"^\s*path = (.*)/job\.plist$", info, re.M)
                workdir = m.group(1) if m else ""
                self.children += 1
                subprocess.run(["launchctl", "bootout", "%s/%s" % (target, label)], capture_output=True, timeout=10)
            except (OSError, subprocess.SubprocessError):
                pass
            if workdir:
                shutil.rmtree(workdir, ignore_errors=True)
            slog("NOTE agy-gui 잡 걷음 label=%s pid=%s(사망) workdir=%s" % (label, pid, workdir or "?"))

    # -- 한 회차 --
    def cycle(self):
        t0 = time.time()
        self.children = 0
        self.collect()
        self.collect_hk()
        self.refresh_registry(t0)
        roots = self.roots()
        stop = os.path.exists(os.path.join(self.local, "emergency-stop.json")) and _emergency_on(self.local)
        load_ok = os.getloadavg()[0] <= cron_load_max()
        notes = []
        for root, workers in sorted(roots.items()):
            try:
                self.plan_root(root, workers, t0, load_ok, stop, notes)
            except Exception as e:  # 한 큐의 오류가 다른 큐를 막지 않는다
                slog("ERROR plan %s: %s: %s" % (root, type(e).__name__, e))
        try:
            self.housekeep(list(roots), t0)
        except Exception as e:
            slog("ERROR housekeep: %s: %s" % (type(e).__name__, e))
        ms = (time.time() - t0) * 1000
        s = self.stats
        s["cycles"] += 1
        s["ms"] += ms
        s["max_ms"] = max(s["max_ms"], ms)
        s["children"] += self.children
        # 계측: 무언가 띄운 회차는 한 줄, 빈 회차는 10분 요약 한 줄만 쓴다(빈 회차의 파일 쓰기 0)
        if notes or os.environ.get("DIRA_SWEEP_TRACE"):
            slog("SWEEP ms=%.1f children=%d roots=%d load=%.2f go=%s" % (
                ms, self.children, len(roots), os.getloadavg()[0], ",".join(notes) or "-"))
        if time.time() - s["since"] >= self.num("summary_interval", 600):
            slog("SWEEP-SUM cycles=%d avg_ms=%.1f max_ms=%.1f children=%d launched=%d running=%d load=%.2f" % (
                s["cycles"], s["ms"] / max(s["cycles"], 1), s["max_ms"], s["children"], s["launched"],
                len([k for k in self.running if k[0] != "hk"]), os.getloadavg()[0]))
            self.stats = {"cycles": 0, "ms": 0.0, "max_ms": 0.0, "children": 0, "launched": 0, "since": time.time()}


def _emergency_on(local):
    try:
        with open(os.path.join(local, "emergency-stop.json"), encoding="utf-8") as f:
            return json.load(f).get("on") is True
    except (OSError, ValueError, AttributeError):
        return False


def _code_mtimes():
    out = {}
    for f in ("dispatch.py", "tickets.py"):
        try:
            out[f] = os.stat(os.path.join(HERE, f)).st_mtime_ns
        except OSError:
            out[f] = None
    return out


def sweep_daemon(once=False):
    import fcntl
    run = os.path.join(local_dir(), "run")
    os.makedirs(run, exist_ok=True)
    never_index(run)
    never_index(local_dir())
    fd = os.open(sweep_lock_path(), os.O_RDONLY | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return 0   # 이미 하나가 돈다
    code = _code_mtimes()
    sw = Sweep()
    slog("START sweep pid=%d python=%s interval=%ss cron_load_max=%.1f" % (
        os.getpid(), sys.executable, cfg_num("sweep_interval", 10), cron_load_max()))
    while True:
        t0 = time.time()
        try:
            sw.cycle()
        except Exception as e:
            slog("ERROR cycle: %s: %s" % (type(e).__name__, e))
        if once:
            return 0
        if _code_mtimes() != code:
            # 엔진이 갱신되면 새 데몬에 넘기고 끝낸다. exec로 갈아타지 않는 이유: 이미 띄운 tick이
            # 새 이미지의 모르는 자식이 되어 좀비로 남으면 launch 표지가 영영 산 것으로 보인다.
            # 이 프로세스가 끝나면 tick들은 launchd가 거둔다.
            slog("RELOAD 코드가 바뀌었다 - 새 데몬에 넘긴다")
            os.close(fd)
            sweep_start()
            return 0
        time.sleep(max(1.0, cfg_num("sweep_interval", 10) - (time.time() - t0)))


def sweep_start():
    """cron 한 줄이 1분마다 부른다. 데몬이 살아 있으면 아무것도 안 쓰고 끝낸다."""
    if sweep_alive():
        return 0
    os.makedirs(os.path.join(local_dir(), "run"), exist_ok=True)
    log_ = open(sweep_log_path(), "ab")
    subprocess.Popen([sys.executable, os.path.abspath(__file__), "sweep", "--daemon"],
                     stdin=subprocess.DEVNULL, stdout=log_, stderr=log_, start_new_session=True, close_fds=True)
    log_.close()
    return 0


def main(argv):
    if argv[:1] == ["sweep"]:
        if "--daemon" in argv or "--once" in argv:
            return sweep_daemon(once="--once" in argv)
        return sweep_start()
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
            launch(a.root, w, a.hash, a.reason == "cron")
            if a.reason != "cron":
                log(a.root, "KICK %s %s %s" % (a.reason, a.hash or "-", w))
        elif a.reason != "cron":
            log(a.root, "KICK-SKIP %s %s %s" % (a.reason, a.hash or "-", why))
    return 0 if w else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
