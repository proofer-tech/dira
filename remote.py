#!/usr/bin/env python3
"""원격 큐 - 연결 설정, 자격 증명, connect/disconnect, sync 골격 (DESIGN.md P478).

표준 라이브러리만 쓴다. remote.json이 없는 큐에서는 전부 아무것도 안 하고 rc 0이다.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
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


ROOT_FILES = ("last-sync", "manifest.json", "state.json", "progress.json",
              "personas-version", "bundles-checked", "last-error")


def root_dir(ws, root):
    key = hashlib.sha256(os.path.realpath(root).encode()).hexdigest()[:16]
    return os.path.join(ws_dir(ws), "roots", key)


def load_runtime(ws):
    """워크스페이스 런타임 {server, runtime_id} 또는 None (P491)."""
    r = read_json(os.path.join(ws_dir(ws), "runtime.json"))
    return r if isinstance(r, dict) and r.get("runtime_id") else None


def load_token(ws, root=None):
    c = read_json(os.path.join(ws_dir(ws), "credentials.json"))
    return c.get("runtime_token") if isinstance(c, dict) else None


def list_projects(ws):
    """이 워크스페이스에 연결된 루트 [{project, queue_root}] - root.json과 그 루트의 remote.json이 다 맞는 것만."""
    out, base = [], os.path.join(ws_dir(ws), "roots")
    for k in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        r = read_json(os.path.join(base, k, "root.json"))
        qr = r.get("queue_root") if isinstance(r, dict) else None
        c = load_config(qr) if isinstance(qr, str) and qr else None
        if c and c.get("workspace_id") == ws:
            out.append({"project": r.get("project"), "queue_root": qr})
    return out


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
        self.server, self.ws = cfg["server"], cfg["workspace_id"]
        self.project = cfg.get("project")
        rt = load_runtime(self.ws)
        self.runtime_id = rt["runtime_id"] if rt else cfg["runtime_id"]  # 정본은 runtime.json

    def call(self, method, path, body=None):
        return http(self.server, method, path, body, self.token)

    def q(self):
        """루트별 호출의 project 쿼리 조각 (P491)."""
        return "&project=" + urllib.parse.quote(str(self.project), safe="") if self.project else ""



# ---- 온톨로지 올리기(O4)와 원격 쓰기(O5) ----

PUSH_MAX = 200
SUBDIRS = ("objects", "versions")


def worker_ontology(root):
    """워커 스크립트 `TICKET_ONTOLOGY="..."` 첫 줄. 크론의 sync-all에는 환경변수가 없어 스크립트에서 읽는다."""
    try:
        names = sorted(os.listdir(os.path.join(root, "workers")))
    except OSError:
        return None
    for n in names:
        if not n.endswith(".sh"):
            continue
        try:
            with open(os.path.join(root, "workers", n), encoding="utf-8") as f:
                for line in f.readlines()[:20]:
                    m = re.match(r"""\s*(?:export\s+)?TICKET_ONTOLOGY=(["']?)(.+?)\1\s*$""", line)
                    if m and os.path.isdir(m.group(2)):
                        return m.group(2)
        except (OSError, UnicodeDecodeError):
            continue
    return None


def ont_root(root):
    return os.path.abspath(os.environ.get("TICKET_ONTOLOGY") or worker_ontology(root) or os.path.join(root, "ontology"))


def ont_roots(root):
    """올릴 온톨로지 위치들. 앞이 주(쓰기 기본)이고 큐 안 ontology는 옛 객체 보존용 보조다."""
    a, b = ont_root(root), os.path.abspath(os.path.join(root, "ontology"))
    return [a] if a == b else [a, b]


def sha_of(data):
    return hashlib.sha256(data).hexdigest()


def scan_ontology(ont):
    """{ont 상대경로: sha256}. 심링크는 따라가지 않는다."""
    out = {}
    for sub in SUBDIRS:
        for d, dirs, files in os.walk(os.path.join(ont, sub)):
            dirs[:] = [x for x in dirs if not os.path.islink(os.path.join(d, x))]
            for n in files:
                f = os.path.join(d, n)
                if n.endswith(".md") and not os.path.islink(f):
                    with open(f, "rb") as fh:
                        out[os.path.relpath(f, ont).replace(os.sep, "/")] = sha_of(fh.read())
    return out


def scan_all(onts):
    """({상대경로: sha256}, {상대경로: 소유 위치}). 같은 경로면 앞 위치가 이긴다."""
    now, owner = {}, {}
    for ont in onts:
        for p, h in scan_ontology(ont).items():
            if p not in now:
                now[p], owner[p] = h, ont
    return now, owner


def ontology_push(ctx):
    onts = ont_roots(ctx.root)
    mpath = os.path.join(root_dir(ctx.ws, ctx.root), "manifest.json")
    old = read_json(mpath) or {}
    now, owner = scan_all(onts)
    todo = [p for p in sorted(now) if old.get(p) != now[p]] + [p for p in sorted(old) if p not in now]
    todo = todo[:PUSH_MAX]  # ponytail: 한 번에 200건. 남은 것은 다음 sync가 올린다
    if not todo:
        return
    changes = []
    for p in todo:
        if p in now:
            with open(os.path.join(owner[p], p), "rb") as f:
                data = f.read()
            changes.append({"path": p, "sha256": sha_of(data), "content": data.decode("utf-8", "replace")})
        else:
            changes.append({"path": p, "deleted": True})
    st, _ = ctx.call("PUT", "objects" + ("?project=" + urllib.parse.quote(str(ctx.project), safe="") if ctx.project else ""),
                     {"changes": changes})
    if st not in (200, 204):
        log("objects HTTP %s" % st)
        return
    for p in todo:
        if p in now:
            old[p] = now[p]
        else:
            old.pop(p, None)
    write_json(mpath, old)


def safe_target(ont, rel):
    """objects/-versions/ 안의 .md 절대경로. 밖이면 None(.. 절대경로 심링크 포함)."""
    if not isinstance(rel, str) or not rel or "\0" in rel or os.path.isabs(rel):
        return None
    parts = rel.split("/")
    if parts[0] not in SUBDIRS or len(parts) < 2 or any(x in ("", ".", "..") for x in parts) \
            or not rel.endswith(".md"):
        return None
    base = os.path.realpath(os.path.join(ont, parts[0]))
    path = os.path.join(ont, *parts)
    if os.path.islink(path):
        return None
    # objects/-versions/ 자체가 없으면(새 프로젝트) 아래가 전부 새로 만들 폴더라 심링크가 끼어들 수 없다
    if not os.path.lexists(os.path.join(ont, parts[0])):
        return path
    # 아직 없는 중간 폴더까지 따져 가장 깊은 기존 조상을 확인한다(깨진 심링크도 조상으로 잡아 밖이면 막는다)
    anc = os.path.dirname(path)
    while not os.path.lexists(anc):
        anc = os.path.dirname(anc)
    r = os.path.realpath(anc)
    return path if r == base or r.startswith(base + os.sep) else None


def log_action(ont, action, name, op_id):
    d = os.path.join(ont, "action-log")
    os.makedirs(d, exist_ok=True)
    t = time.localtime()
    line = "- %s %s: %s - 원격 편집 (op %s)\n" % (time.strftime("%H:%M", t), action, name, op_id)
    fd = os.open(os.path.join(d, time.strftime("%Y-%m-%d", t) + ".md"), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        os.write(fd, line.encode("utf-8"))  # O_APPEND 한 번
    finally:
        os.close(fd)


def apply_write(ont, w):
    """('applied', None) 또는 ('conflict', 지금 sha256 또는 None)."""
    path = safe_target(ont, w.get("path"))
    if not path:
        return "conflict", None
    try:
        with open(path, "rb") as f:
            cur = sha_of(f.read())
    except FileNotFoundError:
        cur = None
    if cur != w.get("base_sha256"):
        return "conflict", cur
    content = w.get("content")
    if not isinstance(content, str):
        return "conflict", cur
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.remote-tmp-%d" % (path, os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, "wb") as f:
        f.write(content.encode("utf-8"))
    os.replace(tmp, path)
    log_action(ont, "새객체" if cur is None else "값갱신", os.path.basename(path)[:-3], w.get("op_id"))
    return "applied", None


def apply_writes(ctx):
    st, r = ctx.call("GET", "writes?runtime_id=" + urllib.parse.quote(str(ctx.runtime_id), safe="") + ctx.q())
    if st != 200 or not r:
        return
    onts = ont_roots(ctx.root)
    mpath = os.path.join(root_dir(ctx.ws, ctx.root), "manifest.json")
    for w in r.get("writes", []):
        op = w.get("op_id")
        if not op or "/" in str(op):
            continue
        # 파일이 있는 위치에 쓴다. 어디에도 없으면 주 위치
        ont = next((o for o in onts if os.path.lexists(os.path.join(o, str(w.get("path"))))), onts[0])
        result, sha = apply_write(ont, w)
        if result == "applied":
            m = read_json(mpath) or {}
            m[w["path"]] = sha_of(w["content"].encode("utf-8"))  # 서버가 이미 아는 내용이라 다시 안 올린다
            write_json(mpath, m)
            ctx.call("POST", "writes/%s" % urllib.parse.quote(str(op), safe=""), {"result": "applied"})
        else:
            ctx.call("POST", "writes/%s" % urllib.parse.quote(str(op), safe=""), {"result": "conflict", "sha256": sha})


# 단계 함수 f(ctx)를 순서대로 부른다. 뒤 장(P478-2..7)이 여기에 채운다:
# 살아 있음 신호 -> 작업 잡기 -> 상태-진행 기록-질문 올리기 -> 답 내려받기 ->
# 온톨로지 올리기 -> 원격 쓰기 적용 -> 페르소나-스키마 묶음 확인
STEPS = []  # 아래 단계 함수 정의 뒤에 채운다


def log(msg):
    print("REMOTE " + msg, flush=True)


# ---- 작업 잡기 / 상태 보고 (P478-3) ----

TICKET_RE = re.compile(r"^([0-9a-f]{8})(\.wip|\.done)?\.md$")


def jobs_dir():
    return os.path.join(os.path.expanduser("~"), ".config", "dira", "run", "remote-jobs")


def split_fm(text):
    """(fm 줄 목록, 본문). fm이 없으면 ([], text)."""
    if not text.startswith("---\n"):
        return [], text
    end = text.find("\n---\n", 3)
    if end < 0:
        return [], text
    return text[4:end].split("\n"), text[end + 5:]


def fm_get(lines, key):
    for l in lines:
        if l.startswith(key + ":"):
            return l[len(key) + 1:].strip()
    return None


def remote_tickets(root):
    """remote_job 이 있는 티켓: [{job_id, hash, path, suffix, fm, body}]. 상태는 파일명과 fm이 정한다."""
    tdir = os.path.join(root, "tickets")
    out = []
    # ponytail: 매 sync 전체 재스캔. 티켓 수천 건 되면 mtime 캐시
    for n in os.listdir(tdir):
        m = TICKET_RE.match(n)
        if not m:
            continue
        path = os.path.join(tdir, n)
        try:
            text = open(path, encoding="utf-8").read()
        except OSError:
            continue
        fm, body = split_fm(text)
        job = fm_get(fm, "remote_job")
        if job:
            out.append({"job_id": job, "hash": m.group(1), "path": path,
                        "suffix": (m.group(2) or "")[1:], "fm": fm, "body": body})
    return out


def one_line(s):
    return " ".join(str(s if s is not None else "").split())


def new_hash(tdir):
    while True:
        h = secrets.token_hex(4)
        if not any(n.startswith(h + ".") for n in os.listdir(tdir)):
            return h


def create_ticket(root, job, token_info):
    tdir = os.path.join(root, "tickets")
    h = new_hash(tdir)
    persona = one_line(job.get("persona"))
    if not re.fullmatch(r"[\w.-]+", persona):
        raise ValueError("persona가 올바르지 않습니다: %r" % persona)
    fm = ["---", "ticket: " + h, "title: " + one_line(job.get("title")), "kind: work",
          "persona: " + persona]
    for k in ("priority", "duedate"):
        if job.get(k) not in (None, ""):
            fm.append("%s: %s" % (k, one_line(job[k])))
    fm += ["remote_job: " + one_line(job["job_id"]), "---", ""]
    text = "\n".join(fm) + "\n" + (job.get("body") or "")
    if not text.endswith("\n"):
        text += "\n"
    # 토큰 파일이 먼저다. 티켓이 보이는 순간 tick.sh가 읽을 수 있어야 한다
    write_json(os.path.join(jobs_dir(), h + ".json"),
               {"job_id": job["job_id"], "job_token": token_info[0],
                "job_token_expires_at": token_info[1]}, 0o600)
    tmp = os.path.join(root, ".remote-tmp-" + h)
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.link(tmp, os.path.join(tdir, h + ".md"))  # 새 이름만 허용(덮어쓰기 없음)
    except BaseException:
        drop_token(h)
        raise
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    return h


def drop_token(h):
    try:
        os.unlink(os.path.join(jobs_dir(), h + ".json"))
    except FileNotFoundError:
        pass


def free_workers(root):
    wdir = os.path.join(root, "workers")
    n = len([x for x in os.listdir(wdir) if x.endswith(".sh")]) if os.path.isdir(wdir) else 0
    wip = len([x for x in os.listdir(os.path.join(root, "tickets")) if x.endswith(".wip.md")])
    return max(0, n - wip)


def claim_jobs(ctx):
    free = free_workers(ctx.root)
    if free <= 0:
        return
    tools = claim_tools(ctx.ws)
    if not tools:
        return  # 로그인 점검을 통과한 도구가 없으면 작업을 안 잡는다
    body = {"runtime_id": ctx.runtime_id, "tools": tools, "max": free}
    if ctx.project:
        body["project"] = ctx.project
    st, r = ctx.call("POST", "jobs/claim", body)
    if st != 200 or not r:
        log("claim HTTP %s" % st)
        return
    have = {t["job_id"] for t in remote_tickets(ctx.root)}
    made = []
    for job in r.get("jobs", []):
        jid = one_line(job.get("job_id"))
        if not jid or jid in have:
            continue
        try:
            made.append(create_ticket(ctx.root, job, (job.get("job_token"), job.get("job_token_expires_at"))))
            have.add(jid)
        except (ValueError, KeyError, OSError) as e:
            log("claim-skip %s: %s" % (jid, e))
    dispatch_made(ctx.root, made)


DISPATCH_TIMEOUT = 10  # 초. 해시 하나당 dispatch.py를 기다리는 상한
NOT_CANDIDATE = "그 해시는 후보가 아니다"


def dispatch_made(root, hashes):
    """잡은 작업을 같은 sync에서 띄운다(P492). 최적화라서 어떤 실패도 올리지 않는다 - 안 뜨면 cron이 집는다."""
    if not hashes:
        return
    disp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch.py")
    if not os.path.isfile(disp):
        log("dispatch-missing")
        return
    wdir = os.path.join(root, "workers")
    try:
        pool = sorted(f[:-3] for f in os.listdir(wdir) if f.endswith(".sh"))
    except OSError:
        return
    for h in hashes:
        while pool:
            w = pool.pop(0)  # 시도한 워커는 rc와 무관하게 이번 sync에서 다시 안 쓴다
            try:
                r = subprocess.run([sys.executable, disp, "run", root, "--reason", "direct", "--hash", h,
                                    "--worker", w], capture_output=True, text=True,
                                   stdin=subprocess.DEVNULL, timeout=DISPATCH_TIMEOUT)
            except (OSError, subprocess.SubprocessError) as e:
                log("dispatch %s: %s" % (h, type(e).__name__))
                break
            if r.returncode == 0:
                break
            try:
                why = json.loads(r.stdout).get("why")
            except (ValueError, AttributeError):
                log("dispatch %s: rc %s, JSON 아님" % (h, r.returncode))
                break
            if why == NOT_CANDIDATE:
                break


def job_state(root, t):
    """.done = done, 본문 ## 블록 = failed, awaiting: stem 파일이 없으면 awaiting, .wip = running. 아니면 None."""
    if t["suffix"] == "done":
        return "done"
    if re.search(r"^## 블록\s*$", t["body"], re.M):
        return "failed"
    stem = fm_get(t["fm"], "awaiting")
    if stem and not os.path.exists(os.path.join(root, "tickets", stem + ".done.md")):
        return "awaiting"
    if t["suffix"] == "wip":
        return "running"
    return None


def mark_revoked(t):
    # 돌고 있는 세션의 편집을 덮지 않도록 쓰기 직전에 다시 읽는다
    with open(t["path"], encoding="utf-8") as f:
        text = f.read()
    fm, _ = split_fm(text)
    if fm_get(fm, "remote_revoked") is not None:
        return
    end = text.find("\n---\n", 3)
    tmp = "%s.remote-%d" % (t["path"], os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text[:end] + "\nremote_revoked: true" + text[end:])
    os.replace(tmp, t["path"])


def report_status(ctx):
    sp = os.path.join(root_dir(ctx.ws, ctx.root), "state.json")
    state = read_json(sp) or {}
    changed = False
    for t in remote_tickets(ctx.root):
        if fm_get(t["fm"], "remote_revoked") == "true":
            continue
        s = job_state(ctx.root, t)
        if s is None or state.get(t["job_id"]) == s:
            continue
        at = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        st, _ = ctx.call("POST", "jobs/%s/status" % urllib.parse.quote(t["job_id"], safe=""),
                         {"state": s, "hash": t["hash"], "at": at})
        if st == 410:
            mark_revoked(t)
            drop_token(t["hash"])
            continue
        if st not in (200, 204):
            log("status %s HTTP %s" % (t["hash"], st))
            continue
        state[t["job_id"]] = s
        changed = True
        if s in ("done", "failed"):
            drop_token(t["hash"])
    if changed:
        os.makedirs(os.path.dirname(sp), exist_ok=True)
        tmp = sp + ".tmp-%d" % os.getpid()
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
        os.replace(tmp, sp)


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
        try:
            merge_legacy(cfg["workspace_id"])
        except (OSError, Unauthorized) as e:
            log("merge %s: %s" % (type(e).__name__, e))
        stamp = os.path.join(root_dir(cfg["workspace_id"], root), "last-sync")
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
        fail = None
        for step in STEPS:
            try:
                step(ctx)
            except Unauthorized:
                print("unauthorized", file=sys.stderr)
                return 1
            except Exception as e:  # 다음 단계는 계속 돈다. 마지막 실패를 stderr 마지막 줄로 남긴다
                fail = "%s %s: %s" % (step.__name__, type(e).__name__, one_line(e))
                log(fail)
        if fail:
            print(fail, file=sys.stderr)
            return 1
        return 0
    finally:
        try:
            os.rmdir(lock)
        except OSError:
            pass


# ---- 페르소나 묶음 (R9) - 스키마 묶음 (O1) ----

BUNDLE_INTERVAL = 600  # 초. 묶음 확인은 10분마다


class Rejected(Exception):
    pass


def safe_rel(rel):
    """묶음이 준 상대경로. 절대경로-'..'-NUL이면 묶음 전체를 거절한다."""
    if (not isinstance(rel, str) or not rel or "\0" in rel or "\\" in rel
            or rel.startswith("/") or ".." in rel.split("/")):
        raise Rejected("경로가 올바르지 않습니다: %r" % (rel,))
    return rel


def inside(base, path):
    # 심링크를 풀고도 base 안이어야 한다
    b, p = os.path.realpath(base), os.path.realpath(path)
    return p == b or p.startswith(b + os.sep)


def fetch_bundle(ctx, path):
    """GET <path> -> (version, sha256, 파싱한 묶음). sha256이 틀리면 Rejected.
    bundle은 JSON 문자열이고 sha256은 그 UTF-8 바이트에 건다(객체로 오면 정렬-압축 직렬화)."""
    st, r = ctx.call("GET", path)
    if st != 200 or not r:
        raise Rejected("HTTP %s" % st)
    raw = r.get("bundle")
    if not isinstance(raw, str):
        raw = json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    if hashlib.sha256(raw.encode("utf-8")).hexdigest() != r.get("sha256"):
        raise Rejected("sha256이 맞지 않습니다")
    try:
        b = json.loads(raw)
    except ValueError:
        raise Rejected("묶음이 JSON이 아닙니다")
    if not isinstance(b, dict):
        raise Rejected("묶음 형식이 올바르지 않습니다")
    return str(r.get("version", b.get("version"))), r["sha256"], b


def write_new(path, text):
    """임시 파일(O_EXCL)에 쓴 뒤 replace."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.remote-tmp-%d" % (path, os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def install_personas(ctx):
    ver, sha, b = fetch_bundle(ctx, "personas/bundle")
    state = os.path.join(root_dir(ctx.ws, ctx.root), "personas-version")
    if (read_json(state) or {}).get("sha256") == sha:
        return
    pers = b.get("personas")
    if not isinstance(pers, dict):
        raise Rejected("personas가 없습니다")
    # 쓰기 전에 전부 검증한다 - 하나라도 나쁘면 아무것도 안 바꾼다
    for name, files in pers.items():
        safe_rel(name)
        if "/" in name or not isinstance(files, dict):
            raise Rejected("페르소나 이름이 올바르지 않습니다: %r" % (name,))
        for rel, body in files.items():
            safe_rel(rel)
            if not isinstance(body, str):
                raise Rejected("본문이 문자열이 아닙니다: %s/%s" % (name, rel))
    pdir = os.path.join(ctx.root, "personas")
    for name, files in pers.items():
        d = os.path.join(pdir, name)
        mark = os.path.join(d, ".remote")
        if os.path.exists(d) and not os.path.exists(mark):
            log("persona-skip " + name)  # 사용자 것이라 덮지 않는다
            continue
        # ponytail: 묶음에 든 파일만 덮는다(memory/ 같은 사용자 파일은 남는다). 옛 판에만 있던 파일은 안 지운다
        for rel, body in files.items():
            if not inside(pdir, os.path.join(d, rel)):
                raise Rejected("페르소나 밖으로 나가는 경로: %s/%s" % (name, rel))
        for rel, body in files.items():
            write_new(os.path.join(d, rel), body)
        write_json(mark, {"workspace_id": ctx.ws, "version": ver, "sha256": sha})
    write_json(state, {"version": ver, "sha256": sha})


def install_schema(ctx):
    """충돌이 있으면 [경로...]를 담은 Rejected 대신 (2, 경로들)을 돌려준다. 성공은 (0, [])."""
    ver, sha, b = fetch_bundle(ctx, "schema/bundle")
    files, lines = b.get("files"), b.get("schema_lines", [])
    if not isinstance(files, dict) or not isinstance(lines, list):
        raise Rejected("files/schema_lines 형식이 올바르지 않습니다")
    ont = ont_root(ctx.root)
    base = os.path.join(ont, "_ontology")
    todo, conflicts = [], []
    for rel, body in files.items():
        safe_rel(rel)
        if not isinstance(body, str):
            raise Rejected("본문이 문자열이 아닙니다: " + rel)
        path = os.path.join(base, rel)
        if not inside(base, path):
            raise Rejected("_ontology 밖으로 나가는 경로: " + rel)
        if os.path.lexists(path):
            try:
                same = open(path, "rb").read() == body.encode("utf-8")
            except OSError:
                same = False
            if not same:
                conflicts.append(rel)
                continue
        else:
            todo.append((path, body))
    if conflicts:
        return 2, conflicts
    schema = os.path.join(base, "SCHEMA.md")
    cur = open(schema, encoding="utf-8").read() if os.path.exists(schema) else ""
    have = set(cur.splitlines())
    add = [l for l in lines if isinstance(l, str) and l.strip() and l not in have]
    for path, body in todo:
        write_new(path, body)
    if add:
        write_new(schema, cur + ("" if cur == "" or cur.endswith("\n") else "\n") + "\n".join(add) + "\n")
    if todo or add:
        now = datetime.datetime.now()
        d = os.path.join(ont, "action-log")
        os.makedirs(d, exist_ok=True)
        out = ""
        for l in add:
            cells = [c.strip() for c in l.strip().strip("|").split("|")]
            rng = cells[1] if len(cells) > 1 and "->" in cells[1] else "타입"
            out += ("- %s 스키마개정: %s(중량, %s) - 원격 스키마 묶음 v%s - 버린 대안: 사용자마다 시딩\n"
                    % (now.strftime("%H:%M"), cells[0], rng, ver))
        if out:
            fd = os.open(os.path.join(d, now.strftime("%Y-%m-%d") + ".md"),
                         os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
            try:
                os.write(fd, out.encode("utf-8"))  # O_APPEND 한 번
            finally:
                os.close(fd)
    return 0, []


def step_bundles(ctx):
    stamp = os.path.join(root_dir(ctx.ws, ctx.root), "bundles-checked")
    try:
        if time.time() - os.stat(stamp).st_mtime < BUNDLE_INTERVAL:
            return
    except OSError:
        pass
    with open(stamp, "w") as f:
        f.write(str(time.time()))
    for fn in (install_personas, install_schema):
        try:
            rc, bad = (fn(ctx) or (0, []))
            if rc:
                log("schema-conflict " + ", ".join(bad))
        except Rejected as e:
            log("%s rejected: %s" % (fn.__name__, e))


STEPS.append(step_bundles)


def bundle_cmd(root, which):
    cfg = load_config(root)
    if not cfg:
        return 0
    token = load_token(cfg["workspace_id"])
    if not token:
        log("no-credentials")
        return 0
    ctx = Ctx(root, cfg, token)
    try:
        rc, bad = (install_personas(ctx) or (0, [])) if which == "persona-install" else install_schema(ctx)
    except Rejected as e:
        print("거절: %s" % e, file=sys.stderr)
        return 1
    except Unauthorized:
        log("unauthorized")
        return 0
    for p in bad:
        print("충돌: " + p, file=sys.stderr)
    return rc

# ---- 진행 기록(R4)과 사람 결정(R5) ----

CMD_MAX = 2000
READ_TOOLS = ("Read", "Grep", "Glob")
WRITE_TOOLS = ("Write", "Edit")
NEW_TICKET = re.compile(r"tickets/[0-9a-f]{8}\.md\b")


def step_of(name, inp, own_hash):
    """도구 사용 하나의 단계 이름 또는 None. handoff는 tickets/ 아래 새 티켓 파일을 만드는 쓰기다."""
    inp = inp if isinstance(inp, dict) else {}
    if name in READ_TOOLS:
        return "read"
    if name in WRITE_TOOLS:
        m = NEW_TICKET.search(str(inp.get("file_path", "")))
        return "handoff" if m and own_hash not in m.group(0) else "wrote"
    if name == "Bash":
        for m in re.finditer(r">\s*\S*(tickets/[0-9a-f]{8}\.md)\b", str(inp.get("command", ""))):
            if own_hash not in m.group(1):
                return "handoff"
    return None


def trim(cmd):
    b = str(cmd).encode("utf-8")
    return cmd if len(b) <= CMD_MAX else b[:CMD_MAX].decode("utf-8", "ignore")


def session_events(path, offset, seen, own_hash):
    """(이벤트 목록, 새 offset, 새로 본 단계). 완결된 줄까지만 읽는다. 모델 본문-도구 결과는 만지지 않는다."""
    with open(path, "rb") as f:
        f.seek(offset)
        raw = f.read()
    end = raw.rfind(b"\n") + 1
    events, seen = [], set(seen)
    for line in raw[:end].split(b"\n"):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if not isinstance(o, dict) or o.get("type") != "assistant":
            continue
        at = o.get("timestamp") or datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        content = (o.get("message") or {}).get("content")
        for c in content if isinstance(content, list) else []:
            if not isinstance(c, dict) or c.get("type") != "tool_use":
                continue
            step = step_of(c.get("name"), c.get("input"), own_hash)
            if step and (step not in seen or step == "handoff"):
                seen.add(step)
                events.append({"at": at, "step": step, "command": None})
            if c.get("name") == "Bash" and isinstance(c.get("input"), dict) and c["input"].get("command"):
                events.append({"at": at, "step": None, "command": trim(c["input"]["command"])})
    return events, offset + end, seen


def load_prog(ctx):
    return read_json(os.path.join(root_dir(ctx.ws, ctx.root), "progress.json")) or {}


def save_prog(ctx, prog):
    write_json(os.path.join(root_dir(ctx.ws, ctx.root), "progress.json"), prog)


def report_events(ctx):
    import glob
    prog = load_prog(ctx)
    logs = os.path.join(ctx.root, "workers", "logs")
    for t in remote_tickets(ctx.root):
        if fm_get(t["fm"], "remote_revoked") == "true":
            continue
        p = prog.setdefault(t["job_id"], {})
        offs, seen = p.setdefault("offsets", {}), p.setdefault("seen", [])
        evs, newoffs, newseen = [], {}, set(seen)
        for lp in sorted(glob.glob(os.path.join(logs, "*-%s.log" % t["hash"]))):
            k = os.path.basename(lp)
            e, newoffs[k], newseen = session_events(lp, offs.get(k, 0), newseen, t["hash"])
            evs += e
        if t["suffix"] != "done" and job_state(ctx.root, t) == "awaiting" and "awaiting" not in newseen:
            newseen.add("awaiting")
            evs.append({"at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
                        "step": "awaiting", "command": None})
        if evs:
            st, _ = ctx.call("POST", "jobs/%s/events" % urllib.parse.quote(t["job_id"], safe=""), {"events": evs})
            if st == 410:
                mark_revoked(t)
                drop_token(t["hash"])
                continue
            if st not in (200, 204):
                log("events %s HTTP %s" % (t["hash"], st))
                continue
        offs.update(newoffs)
        p["seen"] = sorted(newseen)
    save_prog(ctx, prog)


def last_question(body):
    """마지막 `## 질문 n` 절 전문(다음 `## ` 앞까지). 없으면 None."""
    ms = list(re.finditer(r"^## 질문 \d+.*$", body, re.M))
    if not ms:
        return None
    rest = body[ms[-1].start():]
    nxt = re.search(r"^## (?!질문 \d)", rest[3:], re.M)
    return (rest[:nxt.start() + 3] if nxt else rest).strip() + "\n"


def report_questions(ctx):
    prog = load_prog(ctx)
    for t in remote_tickets(ctx.root):
        stem = fm_get(t["fm"], "awaiting")
        if not stem or job_state(ctx.root, t) != "awaiting" or fm_get(t["fm"], "remote_revoked") == "true":
            continue
        p = prog.setdefault(t["job_id"], {})
        md = last_question(t["body"])
        if not md or p.get("asked") == [stem, len(md)]:
            continue
        st, _ = ctx.call("POST", "jobs/%s/questions" % urllib.parse.quote(t["job_id"], safe=""),
                         {"stem": stem, "markdown": md})
        if st in (200, 204):
            p["asked"] = [stem, len(md)]  # ponytail: 같은 stem에 질문 절이 늘면 길이가 달라져 다시 간다
        else:
            log("questions %s HTTP %s" % (t["hash"], st))
    save_prog(ctx, prog)


def fetch_answers(ctx):
    st, r = ctx.call("GET", "answers?runtime_id=" + urllib.parse.quote(str(ctx.runtime_id), safe="") + ctx.q())
    if st != 200 or not r:
        return
    # 서버가 준 stem은 그 작업 티켓이 실제로 기다리는 stem일 때만 쓴다(경로 이탈 방지)
    waiting = {(t["job_id"], fm_get(t["fm"], "awaiting")) for t in remote_tickets(ctx.root)}
    tdir = os.path.join(ctx.root, "tickets")
    for a in r.get("answers", []):
        stem, md = a.get("stem"), a.get("markdown")
        if (a.get("job_id"), stem) not in waiting or not isinstance(md, str) \
                or not re.fullmatch(r"[\w-]+", stem):
            log("answer-skip %s" % one_line(stem))
            continue
        text = "---\nkind: answer\nticket: %s\n---\n\n%s" % (stem, md if md.endswith("\n") else md + "\n")
        tmp = os.path.join(ctx.root, ".remote-tmp-ans-%s-%d" % (stem, os.getpid()))
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(text)
            os.link(tmp, os.path.join(tdir, stem + ".done.md"))  # 이미 있으면 FileExistsError - 덮지 않는다
        except FileExistsError:
            pass
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass


STEPS += [report_events, report_questions, fetch_answers]


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
    env = dict(os.environ)
    if name == "claude":  # 디스패치(tick.sh engine_gate_ok)와 같은 토큰으로 점검한다
        tf = os.path.join(os.environ.get("TICKET_LOCAL") or os.path.join(os.path.expanduser("~"), ".config", "dira"),
                          "oauth-token")
        try:
            with open(tf, encoding="utf-8") as f:
                env["CLAUDE_CODE_OAUTH_TOKEN"] = f.read().strip()
        except OSError:
            pass
    try:
        return subprocess.run(cmd, capture_output=True, stdin=subprocess.DEVNULL, env=env,
                              timeout=60).returncode == 0
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


# 백그라운드 점검이 이 시간 안에 안 끝나면 죽은 것으로 보고 다시 띄운다(도구당 60초 상한 x 4 + 여유)
CHECK_PENDING_MAX = 600


def run_check(ws, names):
    """도구 로그인 점검을 돌려 health.json에 합친다. sync 밖의 분리된 자식에서 돈다."""
    res = {n: {"health": "ok" if login_ok(n) else "needs_check", "checked_at": now()} for n in names}
    st = read_json(health_path(ws)) or {}
    st.setdefault("tools", {}).update(res)
    st["auth_error"] = [n for n in st.get("auth_error", []) if n not in res]
    st.pop("checking_since", None)
    write_json(health_path(ws), st)


def spawn_check(ws, names):
    # tick이 sync를 `timeout 20`으로 감싼다 - 새 세션이라야 timeout의 프로세스 그룹 kill을 피하고,
    # fd를 다 떼야 tick의 `| while read`가 자식을 기다리지 않는다
    subprocess.Popen([sys.executable, os.path.abspath(__file__), "check-health", "--ws", ws] + names,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True, close_fds=True)


def refresh_health(ws, force=False):
    """점검 시점 - 처음(연결 때)-6시간마다-인증 오류 표식. 그 밖에는 안 돌린다.
    force(연결 때)만 그 자리에서 기다리고, sync에서는 분리된 자식으로 띄우고 직전 값을 돌려준다.
    점검 한 번이 수 분 걸려(실측 166초) sync의 `timeout 20` 안에 하트비트를 막았다."""
    st = read_json(health_path(ws)) or {}
    tools, errs, t = st.get("tools", {}), st.get("auth_error", []), now()
    names = tool_names()
    due = [n for n in names if force or n in errs or not tools.get(n)
           or t - tools[n]["checked_at"] >= LOGIN_CHECK_EVERY]
    if force:
        for n in due:
            tools[n] = {"health": "ok" if login_ok(n) else "needs_check", "checked_at": t}
        st = {"tools": {n: tools[n] for n in names}, "auth_error": []}
        write_json(health_path(ws), st)
        return st["tools"]
    for n in names:
        tools.setdefault(n, {"health": "needs_check", "checked_at": 0})
    st["tools"] = {n: tools[n] for n in names}
    if due and t - st.get("checking_since", 0) >= CHECK_PENDING_MAX:
        st["checking_since"] = t
        write_json(health_path(ws), st)
        spawn_check(ws, due)
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


ERROR_MAX = 500


def signal_body(ws, projs=None):
    entries = []
    for p in list_projects(ws) if projs is None else projs:
        e = {"project": p["project"], "workers": workers_payload(p["queue_root"]),
             "next_claim_at": next_dispatch_iso()}  # 시계가 :00 :30에 돈다(P492)
        try:
            with open(os.path.join(root_dir(ws, p["queue_root"]), "last-error"), encoding="utf-8") as f:
                err = one_line(f.read())
        except OSError:
            err = ""
        if err:
            e["error"] = err.encode("utf-8")[:ERROR_MAX].decode("utf-8", "ignore")
        entries.append(e)
    return {"tools": tools_payload(ws, refresh_health(ws)), "projects": entries}


def send_signal(server, rid, token, ws, projs=None):
    st, _ = http(server, "POST", "runtimes/%s/heartbeat" % rid, signal_body(ws, projs), token)
    return st


STEPS += [claim_jobs, report_status]  # 잡기 -> 상태 올리기. 살아 있음 신호는 sync-all이 보낸다(P491)
STEPS += [ontology_push, apply_writes]


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


CLOCK_MARK = " sync-all "


def clock_lines():
    log_ = os.path.join(cfg_home(), "sync.log")
    one = 'python3 "%s" sync-all >> "%s" 2>&1' % (os.path.abspath(__file__), log_)
    return ["* * * * * " + one, "* * * * * sleep 30; " + one]


def has_clock():
    return any(CLOCK_MARK in l and "remote.py" in l for l in crontab_rw().splitlines())


def ensure_clock():
    """컴퓨터 시계 두 줄을 crontab에 넣는다. 이미 sync-all 줄이 있으면 아무것도 안 한다. 시계가 있으면 True."""
    try:
        if not has_clock():
            crontab_rw(clock_lines())
        return has_clock()
    except (OSError, subprocess.SubprocessError):
        return False


def remove_clock():
    f = os.environ.get("DIRA_CRONTAB_FILE")
    keep = [l for l in crontab_rw().splitlines() if not (CLOCK_MARK in l and "remote.py" in l)]
    text = "\n".join(keep) + ("\n" if keep else "")
    if f:
        open(f, "w", encoding="utf-8").write(text)
    else:
        subprocess.run(["crontab", "-"], input=text, text=True, check=True)


def ensure_worker(root):
    wdir = os.path.join(root, "workers")
    if os.path.isdir(wdir) and any(n.endswith(".sh") for n in os.listdir(wdir)):
        return False
    os.makedirs(wdir, exist_ok=True)
    sh = os.path.join(wdir, "w1.sh")
    here = os.path.dirname(os.path.abspath(__file__))
    tick = os.path.join(here, "tick.sh")
    if not os.path.exists(tick):  # 구운 사본(engines/)에서 돌 때: tick.sh가 code-dir에 적어 둔 자리
        try:
            tick = os.path.join(open(os.path.join(here, "code-dir"), encoding="utf-8").read().strip(), "tick.sh")
        except OSError:
            pass
    with open(sh, "w", encoding="utf-8") as f:
        f.write('#!/bin/bash\n. "%s"\n' % tick)
    os.chmod(sh, 0o755)
    log_ = os.path.join(wdir, "cron.log")
    one = '"%s" >> "%s" 2>&1' % (sh, log_)
    crontab_rw(["* * * * * " + one, "* * * * * sleep 30; " + one])
    return True


def reuse_candidates(server):
    """같은 서버의 런타임과 토큰이 이미 있는 워크스페이스 id 목록."""
    home, out = cfg_home(), []
    for ws in sorted(os.listdir(home)) if os.path.isdir(home) else []:
        rt = read_json(os.path.join(home, ws, "runtime.json"))
        if isinstance(rt, dict) and str(rt.get("server", "")).rstrip("/") == server and load_token(ws):
            out.append(ws)
    return out


def device_login(server, body):
    """기기 코드 승인을 기다려 (토큰 응답, rc)."""
    st, r = http(server, "POST", "device/code", body)
    if st != 200 or not r:
        print("기기 코드를 받지 못했습니다 (HTTP %s)" % st, file=sys.stderr)
        return None, 1
    print("코드: %s" % r["user_code"])
    print("다음 주소에서 코드를 승인하세요: %s" % r["verification_uri"], flush=True)
    deadline = time.monotonic() + r.get("expires_in", 600)
    while time.monotonic() < deadline:
        time.sleep(max(r.get("interval", 5), 0))
        st, t = http(server, "POST", "device/token", {"device_code": r["device_code"]})
        if st == 428:
            continue
        if st == 200 and t:
            return t, 0
        print("승인을 확인하지 못했습니다 (HTTP %s)" % st, file=sys.stderr)
        return None, 1
    print("코드가 만료됐습니다", file=sys.stderr)
    return None, 1


def cmd_connect(server, root, workspace=None, new=False):
    server = server.rstrip("/")
    old = load_config(root)
    machine = socket.gethostname()
    project = os.path.basename(os.path.dirname(os.path.abspath(root)))
    qr = os.path.realpath(root)
    ws = None
    if not new:
        cands = reuse_candidates(server)
        if workspace:
            if workspace not in cands:
                print("이 컴퓨터에 그 워크스페이스의 연결이 없습니다: %s" % workspace, file=sys.stderr)
                return 2
            ws = workspace
        elif old and old.get("workspace_id") in cands:
            ws = old["workspace_id"]
        elif len(cands) == 1:
            ws = cands[0]
        elif len(cands) > 1:
            print("워크스페이스가 둘 이상입니다. --workspace로 고르세요: %s" % ", ".join(cands), file=sys.stderr)
            return 2
    reuse = ws is not None
    if reuse:
        rt = load_token(ws)
    else:
        body = {"machine_name": machine}
        if 1 <= len(project) <= 200:
            body["project"] = project
        if 1 <= len(qr) <= 1000:
            body["queue_root"] = qr
        body["tools"] = [str(n) for n in tool_names()][:20]
        tok, rc = device_login(server, body)
        if not tok:
            return rc
        ws, rt = tok["workspace_id"], tok["runtime_token"]
    if old and old.get("workspace_id") != ws:
        print(ALREADY, file=sys.stderr)
        return 2
    others = [p for p in list_projects(ws) if p["queue_root"] != qr]
    for p in others:
        if p["project"] == project:
            print("같은 이름의 프로젝트가 이 워크스페이스에 이미 연결돼 있습니다: %s" % p["queue_root"], file=sys.stderr)
            return 2
    projects = others + [{"project": project, "queue_root": qr}]
    try:
        st, reg = http(server, "POST", "runtimes",
                       {"machine_name": machine, "project": project, "projects": projects,
                        "tools": tools_payload(ws, refresh_health(ws, force=not reuse))}, rt)
    except Unauthorized:
        print("저장된 토큰이 거절됐습니다. --new로 다시 연결하세요", file=sys.stderr)
        return 1
    if st != 200 or not reg:
        print("런타임을 등록하지 못했습니다 (HTTP %s)" % st, file=sys.stderr)
        return 1
    rid = reg["runtime_id"]
    prev, prev_tok = load_runtime(ws), load_token(ws)
    write_json(os.path.join(ws_dir(ws), "credentials.json"), {"runtime_token": rt}, 0o600)
    write_json(os.path.join(ws_dir(ws), "runtime.json"), {"server": server, "runtime_id": rid})
    write_json(os.path.join(root_dir(ws, root), "root.json"), {"queue_root": qr, "project": project})
    write_json(os.path.join(root, "remote.json"),
               {"server": server, "workspace_id": ws, "runtime_id": rid, "project": project})
    if prev and prev["runtime_id"] != rid:
        for p in others:  # remote.json의 runtime_id는 옛 클라이언트용 사본이라 같은 값으로 맞춘다
            c = load_config(p["queue_root"])
            write_json(os.path.join(p["queue_root"], "remote.json"), dict(c, runtime_id=rid))
        if not reuse and prev_tok:
            try:
                http(server, "DELETE", "runtimes/" + str(prev["runtime_id"]), None, prev_tok)
            except (Unauthorized, OSError) as e:
                log("old-runtime-delete %s" % e)
    if reuse:
        print("이미 연결된 워크스페이스 %s에 프로젝트를 더했습니다" % ws)
    if ensure_worker(root):
        print("워커 w1과 크론 두 줄을 만들었습니다")
    ensure_clock()
    print("연결했습니다. 크론 실행을 위해 전체 디스크 접근 권한을 켜 주세요.")
    print("구독 로그인이면 `claude setup-token`으로 장기 토큰을 만들어 두세요.")
    return 0


def cmd_disconnect(root):
    cfg = load_config(root)
    if not cfg:
        print("연결돼 있지 않습니다")
        return 0
    ws, qr = cfg["workspace_id"], os.path.realpath(root)
    rt, token = load_runtime(ws), load_token(ws)
    last = not [p for p in list_projects(ws) if p["queue_root"] != qr]
    try:
        os.unlink(os.path.join(root, "remote.json"))
    except FileNotFoundError:
        pass
    shutil.rmtree(root_dir(ws, root), ignore_errors=True)
    if last and rt:  # 마지막 루트면 런타임을 해제한다. 아니면 다음 신호의 목록이 이 프로젝트를 뺀다
        if token:
            try:
                http(cfg["server"], "DELETE", "runtimes/" + str(rt["runtime_id"]), None, token)
            except (Unauthorized, OSError) as e:
                log("disconnect %s" % e)  # 서버에 못 알려도 로컬 연결은 끊는다
        for n in ("runtime.json", "credentials.json"):
            try:
                os.unlink(os.path.join(ws_dir(ws), n))
            except FileNotFoundError:
                pass
        home = cfg_home()
        if not any(os.path.exists(os.path.join(home, w, "runtime.json")) for w in os.listdir(home)):
            remove_clock()  # 이 컴퓨터에 런타임이 하나도 안 남았다
    print("연결을 해제했습니다")
    return 0


# ---- 옛 배치 합치기 (P491) ----

def merge_legacy(ws):
    """루트마다 credentials.json(P485) 또는 <ws>/credentials.json만(P485 이전)인 배치를 워크스페이스 런타임 하나로 합친다.
    runtime.json이 있으면 아무것도 안 한다. 네트워크 오류는 OSError로 올라가고 다음에 다시 시도한다."""
    wd = ws_dir(ws)
    if not os.path.isdir(wd) or os.path.exists(os.path.join(wd, "runtime.json")):
        return
    lock = os.path.join(wd, ".merge.lock")
    if not take_lock(lock):
        return
    try:
        if not os.path.exists(os.path.join(wd, "runtime.json")):
            merge_locked(ws, wd)
    finally:
        try:
            os.rmdir(lock)
        except OSError:
            pass


def merge_locked(ws, wd):
    cands = []  # (정렬키, 루트, 토큰, 그 루트의 remote.json)
    wc = read_json(os.path.join(wd, "credentials.json"))
    pre485 = isinstance(wc, dict) and bool(wc.get("runtime_token"))
    if pre485:
        r = wc.get("root")
        c = load_config(r) if isinstance(r, str) and r else None
        if c and c.get("workspace_id") == ws and c.get("runtime_id"):
            cands.append((0, r, wc["runtime_token"], c))
    else:
        base = os.path.join(wd, "roots")
        for k in sorted(os.listdir(base)) if os.path.isdir(base) else []:
            cr = read_json(os.path.join(base, k, "credentials.json"))
            r = cr.get("root") if isinstance(cr, dict) else None
            c = load_config(r) if isinstance(r, str) and r else None
            if c and c.get("workspace_id") == ws and c.get("runtime_id") and cr.get("runtime_token"):
                try:
                    mt = os.stat(os.path.join(base, k, "last-sync")).st_mtime
                except OSError:
                    mt = 0
                cands.append((mt, r, cr["runtime_token"], c))
        cands.sort(key=lambda x: -x[0])
    if not cands:
        return
    projs = [{"project": c.get("project"), "queue_root": r} for _, r, _, c in cands]
    win = None
    for cand in cands:
        try:
            send_signal(cand[3]["server"], cand[3]["runtime_id"], cand[2], ws, projs)
            win = cand
            break
        except Unauthorized:
            continue
    if not win:
        log("unauthorized " + ws)
        return
    rid, server = win[3]["runtime_id"], win[3]["server"]
    write_json(os.path.join(wd, "credentials.json"), {"runtime_token": win[2]}, 0o600)
    write_json(os.path.join(wd, "runtime.json"), {"server": server, "runtime_id": rid})
    for _, r, tok, c in cands:
        if c["runtime_id"] != rid:
            try:
                http(c["server"], "DELETE", "runtimes/" + str(c["runtime_id"]), None, tok)
            except (Unauthorized, OSError) as e:
                log("merge-delete %s" % e)
            write_json(os.path.join(r, "remote.json"), dict(c, runtime_id=rid))
        rd = root_dir(ws, r)
        try:
            os.unlink(os.path.join(rd, "credentials.json"))
        except FileNotFoundError:
            pass
        if pre485 and r == win[1]:  # 루트 소유 파일은 그 루트가 가져간다
            for n in ROOT_FILES:
                try:
                    os.makedirs(rd, exist_ok=True)
                    os.replace(os.path.join(wd, n), os.path.join(rd, n))
                except OSError:
                    pass
        write_json(os.path.join(rd, "root.json"), {"queue_root": r, "project": c.get("project")})


def merge_all():
    """이 컴퓨터의 모든 워크스페이스를 합친다. P491-2의 sync-all이 부른다."""
    home = cfg_home()
    for ws in sorted(os.listdir(home)) if os.path.isdir(home) else []:
        try:
            merge_legacy(ws)
        except (OSError, ValueError) as e:
            log("merge %s: %s" % (ws, e))


# ---- 컴퓨터 시계 (P491) ----

SIGNAL_INTERVAL = 10  # 초
LOG_MAX = 1 << 20


def child_timeout():
    return float(os.environ.get("DIRA_SYNC_TIMEOUT") or 20)


def rotate_log(home):
    p = os.path.join(home, "sync.log")
    try:
        if os.stat(p).st_size > LOG_MAX:
            os.replace(p, p + ".1")
    except OSError:
        pass


def prune_roots(ws):
    """root.json은 있는데 조건이 깨진 루트 디렉터리를 지운다. root.json 없는 디렉터리(합치기 전)는 둔다."""
    ok = {os.path.realpath(p["queue_root"]) for p in list_projects(ws)}
    base = os.path.join(ws_dir(ws), "roots")
    for k in os.listdir(base) if os.path.isdir(base) else []:
        r = read_json(os.path.join(base, k, "root.json"))
        if isinstance(r, dict) and os.path.realpath(str(r.get("queue_root"))) not in ok:
            shutil.rmtree(os.path.join(base, k), ignore_errors=True)


def run_child(ws, qr):
    """루트 하나의 sync를 자식 프로세스로 돌리고 결과를 그 루트의 last-error에 적는다."""
    import signal
    p = subprocess.Popen([sys.executable, os.path.abspath(__file__), "sync", "--root", qr],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        out, err = p.communicate(timeout=child_timeout())
        msg = "" if p.returncode == 0 else (
            ([l for l in err.splitlines() if l.strip()] or ["rc %d" % p.returncode])[-1])
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        out, err = p.communicate()
        msg = "timeout"
    for l in (out or "").splitlines():
        print(l, flush=True)
    path = os.path.join(root_dir(ws, qr), "last-error")
    if msg:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(one_line(msg) + "\n")
        log("sync-fail %s: %s" % (qr, one_line(msg)))
    else:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


def sync_all():
    home = cfg_home()
    os.makedirs(home, exist_ok=True)
    lock = os.path.join(home, ".sync-all.lock")
    if not take_lock(lock):
        return 0
    try:
        rotate_log(home)
        merge_all()
        for ws in sorted(os.listdir(home)):
            if ws.startswith(".") or not os.path.isdir(os.path.join(home, ws)):
                continue
            rt, token = load_runtime(ws), load_token(ws)
            if not (rt and token):
                continue
            prune_roots(ws)
            stamp = os.path.join(home, ws, "last-heartbeat")
            try:
                fresh = time.time() - os.stat(stamp).st_mtime < SIGNAL_INTERVAL
            except OSError:
                fresh = False
            if not fresh:
                with open(stamp, "w") as f:
                    f.write(str(time.time()))
                try:
                    send_signal(rt.get("server") or "", rt["runtime_id"], token, ws)
                except Unauthorized:
                    log("unauthorized " + ws)
                    continue
                except Exception as e:  # 신호 실패는 루트 sync를 막지 않는다
                    log("signal %s %s: %s" % (ws, type(e).__name__, e))
            for p in list_projects(ws):
                run_child(ws, p["queue_root"])
        return 0
    finally:
        try:
            os.rmdir(lock)
        except OSError:
            pass


def cmd_tick(root):
    """시계 줄이 있으면 이 큐의 sync만, 못 넣었으면 신호가 끊기지 않게 sync-all."""
    if ensure_clock():
        return cmd_sync(root)
    return sync_all()


def main(argv=None):
    ap = argparse.ArgumentParser(prog="remote.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync-all")
    for name in ("connect", "disconnect", "sync", "tick", "persona-install", "schema-install"):
        p = sub.add_parser(name)
        if name == "connect":
            p.add_argument("server")
            p.add_argument("--workspace")
            p.add_argument("--new", action="store_true")
        p.add_argument("--root", default=os.environ.get("TICKET_ROOT"))
    p = sub.add_parser("check-health")
    p.add_argument("--ws", required=True)
    p.add_argument("names", nargs="*")
    a = ap.parse_args(argv)
    if a.cmd == "sync-all":
        return sync_all()
    if a.cmd == "check-health":
        run_check(a.ws, [n for n in a.names if n in tool_names()])
        return 0
    if not a.root:
        ap.error("--root가 필요합니다")
    root = os.path.abspath(a.root)
    if a.cmd == "connect":
        return cmd_connect(a.server, root, a.workspace, a.new)
    if a.cmd == "disconnect":
        return cmd_disconnect(root)
    if a.cmd in ("persona-install", "schema-install"):
        return bundle_cmd(root, a.cmd)
    if a.cmd == "tick":
        return cmd_tick(root)
    return cmd_sync(root)


if __name__ == "__main__":
    sys.exit(main())
