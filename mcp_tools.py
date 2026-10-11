"""엔진 MCP 도구 표 (DESIGN.md P476). 프로토콜 층은 mcp_server.py가 맡는다.

엔진 파일(tick.sh-tickets.py 등)은 고치지 않고 부르기만 한다. python3 표준 라이브러리만 쓴다.
모든 도구는 `root`(큐 루트 = <프로젝트>/.dira) 인자를 받고, 없으면 $TICKET_ROOT를 쓴다.
"""
import glob
import json
import os
import re
import subprocess
import sys
import unicodedata
import uuid

ENGINE_DIR = os.path.dirname(os.path.realpath(__file__))
IN_PROGRESS = os.environ.get("TICKET_INPROGRESS") or ".wip"
DONE = os.environ.get("TICKET_DONE") or ".done"
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
WORKER_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*\Z")
ENGINE_SCRIPTS = ("tickets.py", "graph.py", "learn.py", "dira_env.py")
HOOKS = ("push.sh", "token-rotate.sh")
DEFAULT_TIMEOUT = 600


class ToolError(Exception):
    pass


def nfc(s):
    return unicodedata.normalize("NFC", s)


# ---------------------------------------------------------------- 큐와 실행

def get_root(a):
    root = a.get("root") or os.environ.get("TICKET_ROOT")
    if not root:
        raise ToolError("root가 필요합니다")
    root = os.path.realpath(os.path.expanduser(root))
    if not os.path.isdir(os.path.join(root, "tickets")):
        raise ToolError("큐 루트가 아닙니다(tickets/ 없음): " + root)
    return root


def run(argv, root, cwd=None, stdin=None, timeout=DEFAULT_TIMEOUT, scrub=()):
    env = dict(os.environ, TICKET_ROOT=root)
    try:
        p = subprocess.run(argv, cwd=cwd or root, env=env, input=stdin, capture_output=True,
                           text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ToolError("시간 초과(%ss): %s" % (timeout, os.path.basename(argv[-1] if len(argv) < 3 else argv[1])))
    out, err = p.stdout, p.stderr
    for s in scrub:
        if s:
            out, err = out.replace(s, "***"), err.replace(s, "***")
    return {"rc": p.returncode, "stdout": out, "stderr": err}


def worker_script(root, name):
    if not isinstance(name, str) or not WORKER_RE.match(name):
        raise ToolError("worker 이름이 올바르지 않습니다")
    return safe_file(root, "workers/%s.sh" % name)


def safe_file(root, rel):
    """큐 루트 안 실재 파일만. `..`-심링크-절대경로로 나가는 것은 거절한다."""
    if os.path.isabs(rel) or ".." in rel.split("/") or "\x00" in rel:
        raise ToolError("허용되지 않는 경로: " + rel)
    p = os.path.realpath(os.path.join(root, rel))
    if not p.startswith(root + os.sep) or not os.path.isfile(p):
        raise ToolError("큐 루트 안의 실재 파일이 아닙니다: " + rel)
    return p


def worker_of(root, a):
    """worker 인자가 없으면 workers/ 의 첫 .sh. 그것도 없으면 None."""
    if a.get("worker"):
        return worker_script(root, a["worker"])
    c = sorted(glob.glob(os.path.join(root, "workers", "*.sh")))
    return c[0] if c else None


# ---------------------------------------------------------------- 티켓 파일

def stems(root, h):
    """해시에 맞는 티켓 파일들: {접미사: 경로}. 접미사 "" = 열림."""
    if not NAME_RE.match(h or ""):
        raise ToolError("hash가 올바르지 않습니다: %r" % (h,))
    want = nfc(h)
    found = {}
    for p in glob.glob(os.path.join(root, "tickets", "*.md")):
        stem = nfc(os.path.basename(p))[:-3]
        for sfx in ("", IN_PROGRESS, DONE):
            if stem == want + nfc(sfx):
                found[sfx] = p
    return found


def exactly_one(root, h):
    f = stems(root, h)
    if len(f) != 1:
        raise ToolError("티켓 파일이 %d개입니다(1개여야 함): %s" % (len(f), h))
    return next(iter(f.items()))


def check_line(k, v):
    s = str(v)
    if "\n" in s or "\r" in s or "\x00" in s:
        raise ToolError("fm 값에 개행을 쓸 수 없습니다: " + k)
    return s


def t_ticket_create(a):
    root = get_root(a)
    fm = dict(a.get("fm") or {})
    h = a.get("hash") or fm.get("ticket") or uuid.uuid4().hex[:8]
    if stems(root, h):
        raise ToolError("이미 있는 티켓입니다: " + h)
    fm["ticket"] = h
    lines = ["---"]
    for k, v in fm.items():
        if not re.match(r"[A-Za-z_][A-Za-z0-9_]*\Z", str(k)):
            raise ToolError("fm 키가 올바르지 않습니다: %r" % (k,))
        lines.append("%s: %s" % (k, check_line(k, v)))
    lines += ["---", ""]
    body = a.get("body") or ""
    path = os.path.join(root, "tickets", h + ".md")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n" + body.rstrip("\n") + "\n")
    return {"hash": h, "path": path}


def t_ticket_read(a):
    root = get_root(a)
    f = stems(root, a.get("hash"))
    for sfx in (DONE, IN_PROGRESS, ""):
        if sfx in f:
            with open(f[sfx], encoding="utf-8") as fh:
                return {"path": f[sfx], "content": fh.read()}
    raise ToolError("티켓을 못 찾음: %s" % a.get("hash"))


def t_ticket_append(a):
    root = get_root(a)
    text = a.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ToolError("text가 필요합니다")
    _, path = exactly_one(root, a.get("hash"))
    fd = os.open(path, os.O_WRONLY | os.O_APPEND)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n" + text.strip("\n") + "\n")
    return {"path": path}


def t_ticket_done(a):
    root = get_root(a)
    sfx, path = exactly_one(root, a.get("hash"))
    if sfx != IN_PROGRESS:
        raise ToolError("진행중(.wip) 티켓만 완료로 바꿉니다")
    dst = path[: -len(IN_PROGRESS + ".md")] + DONE + ".md"
    os.link(path, dst)  # 이미 있으면 FileExistsError - 덮어쓰지 않는다
    os.unlink(path)
    return {"path": dst}


def t_interject(a):
    root = get_root(a)
    text = (a.get("text") or "").replace("\r\n", "\n").strip()
    if not text:
        raise ToolError("참견 내용이 비어 있습니다")
    sfx, path = exactly_one(root, a.get("hash"))
    if sfx != IN_PROGRESS:
        raise ToolError("진행중(.wip) 티켓에만 참견합니다")
    inbox = ""
    with open(path, encoding="utf-8") as f:
        for ln in f.read().split("\n")[1:]:
            if ln.strip() == "---":
                break
            if ln.startswith("inbox:"):
                inbox = ln[6:].strip().strip("\"'")
    if not inbox:
        raise ToolError("inbox가 없는 티켓입니다")
    if not os.path.isabs(inbox):
        raise ToolError("inbox가 상대경로입니다: " + inbox)
    try:
        fd = os.open(inbox, os.O_WRONLY | os.O_NONBLOCK)
    except OSError as e:
        raise ToolError("inbox를 열지 못했습니다(%s): %s" % (e.strerror, inbox))
    try:
        import stat
        if not stat.S_ISFIFO(os.fstat(fd).st_mode):
            raise ToolError("inbox가 FIFO가 아닙니다: " + inbox)
        line = json.dumps({"type": "user", "message": {"role": "user", "content": text}},
                          ensure_ascii=False) + "\n"
        try:
            os.write(fd, line.encode("utf-8"))
        except OSError as e:
            raise ToolError("참견을 쓰지 못했습니다: " + e.strerror)
    finally:
        os.close(fd)
    try:  # 사람 참견 표지. 실패해도 참견은 나갔다.
        h = os.open(inbox + ".human", os.O_WRONLY | os.O_CREAT, 0o600)
        os.write(h, ("%d\n" % int(__import__("time").time() * 1000)).encode())
        os.close(h)
    except OSError:
        pass
    return {"sent": True}


# ---------------------------------------------------------------- 워커 명령

def worker_cmd(a, *args, tool="worker"):
    root = get_root(a)
    w = worker_of(root, a)
    if not w:
        raise ToolError("workers/<w>.sh가 없습니다")
    return run(["bash", w, *args], root, timeout=a.get("timeout") or DEFAULT_TIMEOUT)


def t_queue_list(a):
    root = get_root(a)
    w = worker_of(root, a)
    if w:
        return run(["bash", w, "list"], root)
    return run([sys.executable, os.path.join(ENGINE_DIR, "tickets.py"), "list", root], root)


def t_unassign(a):
    h = a.get("hash")
    if not NAME_RE.match(h or ""):
        raise ToolError("hash가 올바르지 않습니다")
    return worker_cmd(a, "unassign", h, *(["--force"] if a.get("force") else []))


def t_graph_query(a):
    root = get_root(a)
    q = a.get("question")
    if not isinstance(q, str) or not q:
        raise ToolError("question이 필요합니다")
    return run([sys.executable, os.path.join(ENGINE_DIR, "graph.py"), "query", root, q], root)


def t_ticket_find(a):
    root = get_root(a)
    h = a.get("hash")
    if not NAME_RE.match(h or ""):
        raise ToolError("hash가 올바르지 않습니다")
    return run([sys.executable, os.path.join(ENGINE_DIR, "tickets.py"), "find", root, h], root)


def t_projects(a):
    local = os.environ.get("TICKET_LOCAL") or os.path.expanduser("~/.config/dira")
    try:
        with open(os.path.join(local, "gui-projects.json"), encoding="utf-8") as f:
            return {"projects": json.load(f).get("projects", [])}
    except FileNotFoundError:
        return {"projects": []}


# ---------------------------------------------------------------- 환경변수 (값은 stdin으로만)

def env_run(a, args, value=None):
    root = get_root(a)
    r = run([sys.executable, os.path.join(ENGINE_DIR, "dira_env.py"), *args], root,
            stdin=value, scrub=(value,) if value else ())
    return r


def t_env_list(a):
    return env_run(a, ["list"])


def t_env_create(a):
    return env_run(a, ["create", str(a.get("name")), "--stdin"], str(a.get("value", "")))


def t_env_replace(a):
    return env_run(a, ["replace", str(a.get("name")), "--revision", str(a.get("revision")), "--stdin"],
                   str(a.get("value", "")))


def t_env_delete(a):
    return env_run(a, ["delete", str(a.get("name")), "--revision", str(a.get("revision"))])


# ---------------------------------------------------------------- engine_exec

def t_engine_exec(a):
    root = get_root(a)
    prog, args = a.get("program"), a.get("args") or []
    if not isinstance(prog, str):
        raise ToolError("program이 필요합니다")
    if not isinstance(args, list) or not all(isinstance(x, str) and "\x00" not in x for x in args):
        raise ToolError("args는 문자열 배열이어야 합니다")
    cwd = None
    if prog in ENGINE_SCRIPTS:
        argv = [sys.executable, os.path.join(ENGINE_DIR, prog)]
    elif prog.startswith("workers/") and prog.endswith(".sh"):
        argv = ["bash", safe_file(root, prog)]
    elif prog in HOOKS:
        argv = ["bash", safe_file(root, prog)]
        if prog == "push.sh" and a.get("cwd"):
            wt = os.path.realpath(os.path.join(root, "worktrees"))
            cwd = os.path.realpath(a["cwd"] if os.path.isabs(a["cwd"]) else os.path.join(root, a["cwd"]))
            if not cwd.startswith(wt + os.sep) or not os.path.isdir(cwd):
                raise ToolError("cwd는 큐 루트 worktrees/ 아래 실재 디렉터리여야 합니다")
    else:
        raise ToolError("허용목록에 없는 program: " + prog)
    return run(argv + args, root, cwd=cwd, timeout=a.get("timeout") or DEFAULT_TIMEOUT)


# ---------------------------------------------------------------- 도구 표

def _s(desc, props=None, req=()):
    p = {"root": {"type": "string", "description": "큐 루트(<프로젝트>/.dira). 없으면 $TICKET_ROOT"}}
    p.update(props or {})
    return {"type": "object", "properties": p, "required": list(req)}


STR, BOOL, INT = {"type": "string"}, {"type": "boolean"}, {"type": "integer"}
H = {"hash": STR}
W = {"worker": {"type": "string", "description": "workers/<이름>.sh 의 이름"}}

TOOLS = {
    "projects": ("GUI에 등록된 프로젝트와 큐 루트 목록", {"type": "object", "properties": {}}, t_projects),
    "queue_list": ("열린 티켓 목록(<w>.sh list)", _s("", W), t_queue_list),
    "dispatch": ("워커를 1회 돌린다(<w>.sh)", _s("", W, ["worker"]), lambda a: worker_cmd(a)),
    "dryrun": ("실행 없이 선정 결과만(<w>.sh dryrun)", _s("", W), lambda a: worker_cmd(a, "dryrun")),
    "reap": ("스테일 티켓 회수(<w>.sh reap)", _s("", W), lambda a: worker_cmd(a, "reap")),
    "unassign": ("티켓 할당 풀기", _s("", {**H, **W, "force": BOOL}, ["hash"]), t_unassign),
    "ticket_find": ("해시로 티켓 경로 찾기(tickets.py find)", _s("", H, ["hash"]), t_ticket_find),
    "ticket_read": ("티켓 본문 전문", _s("", H, ["hash"]), t_ticket_read),
    "ticket_create": ("새 티켓 파일 만들기. 이미 있으면 실패",
                      _s("", {"hash": STR, "fm": {"type": "object"}, "body": STR}), t_ticket_create),
    "ticket_append": ("현재 파일명을 다시 찾아 끝에 절을 더한다. 0개-2개 이상이면 실패",
                      _s("", {**H, "text": STR}, ["hash", "text"]), t_ticket_append),
    "ticket_done": ("`.wip`을 `.done`으로 rename", _s("", H, ["hash"]), t_ticket_done),
    "interject": ("진행중 세션에 참견 한 줄", _s("", {**H, "text": STR}, ["hash", "text"]), t_interject),
    "graph_query": ("graph.py query", _s("", {"question": STR}, ["question"]), t_graph_query),
    "env_list": ("프로젝트 환경변수 이름 목록(값 없음)", _s(""), t_env_list),
    "env_create": ("환경변수 만들기. 값은 응답에 안 실린다",
                   _s("", {"name": STR, "value": STR}, ["name", "value"]), t_env_create),
    "env_replace": ("환경변수 값 교체", _s("", {"name": STR, "value": STR, "revision": INT},
                                          ["name", "value", "revision"]), t_env_replace),
    "env_delete": ("환경변수 삭제", _s("", {"name": STR, "revision": INT}, ["name", "revision"]), t_env_delete),
    "engine_exec": ("허용목록 프로그램 실행(tickets.py-graph.py-learn.py-dira_env.py-workers/<w>.sh-"
                    "push.sh-token-rotate.sh). 셸을 안 거친다. {rc,stdout,stderr}",
                    _s("", {"program": STR, "args": {"type": "array", "items": STR}, "cwd": STR,
                            "timeout": INT}, ["program"]), t_engine_exec),
}


def list_tools():
    return [{"name": n, "description": d, "inputSchema": s} for n, (d, s, _) in TOOLS.items()]


def call_tool(name, args):
    if name not in TOOLS:
        raise ToolError("모르는 도구: %s" % name)
    return TOOLS[name][2](args or {})
