#!/usr/bin/env python3
"""원격 큐 - 연결 설정, 자격 증명, connect/disconnect, sync 골격 (DESIGN.md P478).

표준 라이브러리만 쓴다. remote.json이 없는 큐에서는 전부 아무것도 안 하고 rc 0이다.
"""
import argparse
import datetime
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "/api/runtime/v1/"
SYNC_INTERVAL = 10  # 초. 직전 sync 뒤 이 시간이 안 지났으면 빠진다
LOCK_STALE = 120  # 초. timeout 20에 죽은 sync가 남긴 락을 이 시간 뒤 치운다
ALREADY = "이 프로젝트는 이미 다른 워크스페이스에 연결돼 있습니다"


class Unauthorized(Exception):
    pass


def cfg_home():
    return os.path.join(os.path.expanduser("~"), ".config", "dira", "remote")


def ws_dir(ws):
    # 워크스페이스 id는 서버가 준 값이라 경로 이탈을 막는다
    if not ws or ws in (".", "..") or "/" in ws or "\\" in ws or "\0" in ws:
        raise ValueError("workspace_id가 올바르지 않습니다")
    return os.path.join(cfg_home(), ws)


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_json(path, obj, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.tmp-%d" % (path, os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def load_config(root):
    return read_json(os.path.join(root, "remote.json"))


def load_token(ws):
    c = read_json(os.path.join(ws_dir(ws), "credentials.json"))
    return c.get("runtime_token") if c else None


def http(server, method, path, body=None, token=None, timeout=15):
    """(status, 파싱한 JSON 또는 None). 4xx-5xx도 값으로 돌려준다. 401은 Unauthorized."""
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(server.rstrip("/") + API + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
        e.close()
    if status == 401 and token:
        raise Unauthorized()
    try:
        return status, (json.loads(raw) if raw else None)
    except ValueError:
        return status, None


# ---- sync ----

class Ctx:
    def __init__(self, root, cfg, token):
        self.root, self.cfg, self.token = root, cfg, token
        self.server, self.ws, self.runtime_id = cfg["server"], cfg["workspace_id"], cfg["runtime_id"]

    def call(self, method, path, body=None):
        return http(self.server, method, path, body, self.token)


# 단계 함수 f(ctx)를 순서대로 부른다. 뒤 장(P478-2..7)이 여기에 채운다:
# 살아 있음 신호 -> 작업 잡기 -> 상태-진행 기록-질문 올리기 -> 답 내려받기 ->
# 온톨로지 올리기 -> 원격 쓰기 적용 -> 페르소나-스키마 묶음 확인
STEPS = []


def log(msg):
    print("REMOTE " + msg, flush=True)


def take_lock(lock):
    try:
        os.mkdir(lock)
        return True
    except FileExistsError:
        try:
            if time.time() - os.stat(lock).st_mtime > LOCK_STALE:
                os.rmdir(lock)
                os.mkdir(lock)
                return True
        except OSError:
            pass
        return False


def cmd_sync(root):
    cfg = load_config(root)
    if not cfg:
        return 0
    lock = os.path.join(root, ".remote-sync.lock")
    if not take_lock(lock):
        return 0
    try:
        stamp = os.path.join(ws_dir(cfg["workspace_id"]), "last-sync")
        try:
            if time.time() - os.stat(stamp).st_mtime < SYNC_INTERVAL:
                return 0
        except OSError:
            pass
        os.makedirs(os.path.dirname(stamp), exist_ok=True)
        with open(stamp, "w") as f:
            f.write(str(time.time()))
        token = load_token(cfg["workspace_id"])
        if not token:
            log("no-credentials")
            return 0
        ctx = Ctx(root, cfg, token)
        for step in STEPS:
            try:
                step(ctx)
            except Unauthorized:
                log("unauthorized")
                return 0
            except Exception as e:  # sync의 실패는 tick을 막지 않는다
                log("%s %s: %s" % (step.__name__, type(e).__name__, e))
        return 0
    finally:
        try:
            os.rmdir(lock)
        except OSError:
            pass


# ---- connect / disconnect ----

def engines_dir():
    return os.path.join(os.path.expanduser("~"), ".config", "dira", "bin", "engines")


def now():
    return time.time()  # 테스트가 갈아 끼우는 시계


def tool_names():
    d = engines_dir()
    return [n for n in ("claude", "codex", "agy", "grok") if os.access(os.path.join(d, n), os.X_OK)]


def tool_version(name):
    try:
        r = subprocess.run([os.path.join(engines_dir(), name), "--version"], capture_output=True,
                           text=True, timeout=5)
        lines = r.stdout.strip().splitlines()
        return lines[0] if r.returncode == 0 and lines else None
    except (OSError, subprocess.SubprocessError):
        return None


# ponytail: agy-grok 최소 프롬프트 형식은 -p로 추정. 틀리면 needs_check로 떠서 드러난다
LOGIN_ARGS = {"codex": ["exec", "ok"]}
LOGIN_CHECK_EVERY = 6 * 3600


def login_ok(name):
    cmd = [os.path.join(engines_dir(), name)] + LOGIN_ARGS.get(name, ["-p", "ok"])
    try:
        return subprocess.run(cmd, capture_output=True, stdin=subprocess.DEVNULL, timeout=60).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def health_path(ws):
    return os.path.join(ws_dir(ws), "health.json")


def mark_auth_error(ws, tool):
    """인증 오류로 끝난 세션 직후 부른다. 다음 sync가 그 도구를 다시 점검한다."""
    st = read_json(health_path(ws)) or {}
    errs = st.setdefault("auth_error", [])
    if tool not in errs:
        errs.append(tool)
    write_json(health_path(ws), st)


def refresh_health(ws, force=False):
    """점검 시점 - 처음(연결 때)-6시간마다-인증 오류 표식. 그 밖에는 안 돌린다."""
    st = read_json(health_path(ws)) or {}
    tools, errs, t = st.get("tools", {}), st.get("auth_error", []), now()
    names = tool_names()
    for n in names:
        rec = tools.get(n)
        if force or n in errs or not rec or t - rec["checked_at"] >= LOGIN_CHECK_EVERY:
            tools[n] = {"health": "ok" if login_ok(n) else "needs_check", "checked_at": t}
    st = {"tools": {n: tools[n] for n in names}, "auth_error": []}
    write_json(health_path(ws), st)
    return st["tools"]


def tools_payload(ws, health):
    return [{"name": n, "version": tool_version(n), "health": health[n]["health"]} for n in health]


def claim_tools(ws):
    """jobs/claim의 tools - 점검에 실패한 도구는 뺀다."""
    h = (read_json(health_path(ws)) or {}).get("tools", {})
    return [n for n in tool_names() if h.get(n, {}).get("health") == "ok"]


def ticket_owners(root):
    """{워커 이름 접두 판정용 owner: 해시} - .wip 티켓의 fm owner."""
    out = []
    tdir = os.path.join(root, "tickets")
    for f in os.listdir(tdir) if os.path.isdir(tdir) else []:
        if not f.endswith(".wip.md"):
            continue
        try:
            with open(os.path.join(tdir, f), encoding="utf-8") as fh:
                head = fh.read(4096)
        except OSError:
            continue
        for line in head.splitlines():
            if line.startswith("owner:"):
                out.append((line[6:].split("/")[-1].strip(), f[:-len(".wip.md")]))
    return out


def next_dispatch_iso():
    # ponytail: 크론이 :00과 :30에 뜬다고 가정한 계산. 간격을 바꾸면 여기도 바꾼다
    t = (int(now()) // 30 + 1) * 30
    return datetime.datetime.fromtimestamp(t).astimezone().isoformat(timespec="seconds")


def workers_payload(root):
    wdir = os.path.join(root, "workers")
    names = sorted(f[:-3] for f in os.listdir(wdir) if f.endswith(".sh")) if os.path.isdir(wdir) else []
    owners = ticket_owners(root)
    nxt = next_dispatch_iso()
    return [{"name": n,
             "busy": next((h for o, h in owners if o == n or o.startswith(n + "-")), None),
             "next_dispatch_at": nxt} for n in names]


def step_heartbeat(ctx):
    health = refresh_health(ctx.ws)
    ctx.call("POST", "runtimes/%s/heartbeat" % ctx.runtime_id,
             {"tools": tools_payload(ctx.ws, health), "workers": workers_payload(ctx.root)})


STEPS.append(step_heartbeat)


def crontab_rw(new_lines=None):
    """현재 crontab 문자열을 돌려주고, new_lines가 있으면 덧붙여 쓴다.
    DIRA_CRONTAB_FILE이 있으면 그 파일을 crontab 대신 쓴다(테스트용)."""
    f = os.environ.get("DIRA_CRONTAB_FILE")
    if f:
        cur = open(f, encoding="utf-8").read() if os.path.exists(f) else ""
    else:
        r = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        cur = r.stdout if r.returncode == 0 else ""
    if new_lines:
        add = [l for l in new_lines if l not in cur]
        if add:
            cur = cur + ("" if cur == "" or cur.endswith("\n") else "\n") + "\n".join(add) + "\n"
            if f:
                open(f, "w", encoding="utf-8").write(cur)
            else:
                subprocess.run(["crontab", "-"], input=cur, text=True, check=True)
    return cur


def ensure_worker(root):
    wdir = os.path.join(root, "workers")
    if os.path.isdir(wdir) and any(n.endswith(".sh") for n in os.listdir(wdir)):
        return False
    os.makedirs(wdir, exist_ok=True)
    sh = os.path.join(wdir, "w1.sh")
    tick = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tick.sh")
    with open(sh, "w", encoding="utf-8") as f:
        f.write('#!/bin/bash\n. "%s"\n' % tick)
    os.chmod(sh, 0o755)
    log_ = os.path.join(wdir, "cron.log")
    one = '"%s" >> "%s" 2>&1' % (sh, log_)
    crontab_rw(["* * * * * " + one, "* * * * * sleep 30; " + one])
    return True


def cmd_connect(server, root):
    server = server.rstrip("/")
    old = load_config(root)
    machine = socket.gethostname()
    st, r = http(server, "POST", "device/code", {"machine_name": machine})
    if st != 200 or not r:
        print("기기 코드를 받지 못했습니다 (HTTP %s)" % st, file=sys.stderr)
        return 1
    print("코드: %s" % r["user_code"])
    print("다음 주소에서 코드를 승인하세요: %s" % r["verification_uri"], flush=True)
    deadline = time.monotonic() + r.get("expires_in", 600)
    tok = None
    while time.monotonic() < deadline:
        time.sleep(max(r.get("interval", 5), 0))
        st, t = http(server, "POST", "device/token", {"device_code": r["device_code"]})
        if st == 428:
            continue
        if st == 200 and t:
            tok = t
            break
        print("승인을 확인하지 못했습니다 (HTTP %s)" % st, file=sys.stderr)
        return 1
    if not tok:
        print("코드가 만료됐습니다", file=sys.stderr)
        return 1
    ws, rt = tok["workspace_id"], tok["runtime_token"]
    if old and old.get("workspace_id") != ws:
        print(ALREADY, file=sys.stderr)
        return 2
    project = os.path.basename(os.path.dirname(os.path.abspath(root)))
    st, reg = http(server, "POST", "runtimes",
                   {"machine_name": machine, "project": project,
                    "tools": tools_payload(ws, refresh_health(ws, force=True))}, rt)
    if st != 200 or not reg:
        print("런타임을 등록하지 못했습니다 (HTTP %s)" % st, file=sys.stderr)
        return 1
    write_json(os.path.join(ws_dir(ws), "credentials.json"), {"runtime_token": rt}, 0o600)
    write_json(os.path.join(root, "remote.json"),
               {"server": server, "workspace_id": ws, "runtime_id": reg["runtime_id"], "project": project})
    if ensure_worker(root):
        print("워커 w1과 크론 두 줄을 만들었습니다")
    print("연결했습니다. 크론 실행을 위해 전체 디스크 접근 권한을 켜 주세요.")
    print("구독 로그인이면 `claude setup-token`으로 장기 토큰을 만들어 두세요.")
    return 0


def cmd_disconnect(root):
    cfg = load_config(root)
    if not cfg:
        print("연결돼 있지 않습니다")
        return 0
    ws = cfg["workspace_id"]
    token = load_token(ws)
    if token:
        try:
            http(cfg["server"], "DELETE", "runtimes/" + str(cfg["runtime_id"]), None, token)
        except (Unauthorized, OSError) as e:
            log("disconnect %s" % e)  # 서버에 못 알려도 로컬 연결은 끊는다
    for p in (os.path.join(root, "remote.json"), os.path.join(ws_dir(ws), "credentials.json")):
        try:
            os.unlink(p)
        except FileNotFoundError:
            pass
    print("연결을 해제했습니다")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="remote.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("connect", "disconnect", "sync"):
        p = sub.add_parser(name)
        if name == "connect":
            p.add_argument("server")
        p.add_argument("--root", default=os.environ.get("TICKET_ROOT"))
    a = ap.parse_args(argv)
    if not a.root:
        ap.error("--root가 필요합니다")
    root = os.path.abspath(a.root)
    if a.cmd == "connect":
        return cmd_connect(a.server, root)
    if a.cmd == "disconnect":
        return cmd_disconnect(root)
    return cmd_sync(root)


if __name__ == "__main__":
    sys.exit(main())
