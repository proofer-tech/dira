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
    res = {"hash": h, "path": path}
    if str(fm.get("kind", "")).strip() == "request":
        try:  # 즉시 디스패치는 최적화다(P489 결정 3). 실패해도 티켓 생성은 성공이다
            res["dispatch"] = dispatch_run(root, "request", hash=h)
        except ToolError as e:
            res["dispatch"] = {"go": False, "worker": None, "hash": h, "reason": "request",
                               "why": "티켓은 만들어졌고 cron 다음 틱에 배정됩니다. 사람이 할 일은 없습니다. " + str(e)}
    return res


def dispatch_run(root, reason, hash=None, worker=None):
    """dispatch.py run의 한 줄 JSON. rc 1(안 띄움)은 정상 응답이다."""
    argv = [sys.executable, os.path.join(ENGINE_DIR, "dispatch.py"), "run", root, "--reason", reason]
    if hash:
        argv += ["--hash", str(hash)]
    if worker:
        if not isinstance(worker, str) or not WORKER_RE.match(worker):
            raise ToolError("worker 이름이 올바르지 않습니다")
        argv += ["--worker", worker]
    r = run(argv, root)
    try:
        return json.loads(r["stdout"])
    except ValueError:
        raise ToolError("dispatch.py 실패(rc=%s): %s" % (r["rc"], r["stderr"].strip()[:200]))


def t_dispatch_now(a):
    return dispatch_run(get_root(a), "direct", a.get("hash"), a.get("worker"))


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


# ---------------------------------------------------------------- 프로젝트 레지스트리 (P543)

def _local():
    return os.environ.get("TICKET_LOCAL") or os.path.expanduser("~/.config/dira")


def read_registry():
    """화면 readProjects와 같다: 새 파일이 없으면 옛 gui-tenants.json(키 tenants). 깨진 JSON은 던진다."""
    raw = ""
    for name in ("gui-projects.json", "gui-tenants.json"):
        try:
            with open(os.path.join(_local(), name), encoding="utf-8") as f:
                raw = f.read()
            break
        except FileNotFoundError:
            continue
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except ValueError as e:
        raise ToolError("레지스트리 JSON이 깨졌습니다: %s" % e)
    lst = parsed.get("projects", parsed.get("tenants")) if isinstance(parsed, dict) else None
    if not isinstance(lst, list):
        raise ToolError("레지스트리 모양이 올바르지 않습니다")
    return lst


def write_registry(projects):
    """화면 writeProjects와 같은 바이트. 임시 파일 + os.replace."""
    local = _local()
    os.makedirs(local, exist_ok=True)
    dst = os.path.join(local, "gui-projects.json")
    tmp = "%s.%d.tmp" % (dst, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(json.dumps({"version": 1, "projects": projects}, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, dst)


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", nfc(name).lower()).strip("-")[:40]
    return s.strip("-")


def ensure_gitignore_line(project):
    f = os.path.join(project, ".gitignore")
    try:
        with open(f, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        text = None
    if text is not None and any(re.match(r"/?\.dira/?\Z", ln.strip()) for ln in text.split("\n")):
        return
    prefix = (text if text.endswith("\n") else text + "\n") if text else ""
    try:
        with open(f, "w", encoding="utf-8") as fh:
            fh.write(prefix + ".dira\n")
    except OSError:
        pass  # 화면과 같다: 이 한 줄이 등록을 막지 않는다


def _str(a, k):
    v = a.get(k)
    if not isinstance(v, str):
        raise ToolError("%s가 필요합니다" % k)
    return v


def t_project_register(a):
    name, given = _str(a, "name"), _str(a, "path").strip()
    if not name.strip():
        raise ToolError("이름이 비었습니다")
    given = os.path.expanduser(given)
    if not os.path.isabs(given):
        raise ToolError("절대경로가 아닙니다: %s" % (given or "(빈 값)"))
    if not os.path.exists(given):
        raise ToolError("경로가 없습니다: %s" % given)
    root = os.path.realpath(given)
    if not os.path.isdir(root):
        raise ToolError("디렉터리가 아닙니다: " + root)
    if not any(os.path.exists(os.path.join(root, x)) for x in ("tickets", "workers")):
        raise ToolError("큐가 아닙니다(tickets/ 나 workers/ 가 없음): " + root)
    ensure_gitignore_line(os.path.dirname(root))
    projects = read_registry()
    dup = next((p for p in projects if p.get("root") == root), None)
    if dup:
        raise ToolError("이미 등록된 큐입니다: %s" % dup.get("name"))
    pid = a.get("id") or slugify(name)
    if not re.match(r"[a-z0-9-]+\Z", pid) or len(pid) > 40:
        raise ToolError(("id 형식이 올바르지 않습니다: " + pid) if a.get("id")
                        else "이름에서 id를 만들 수 없습니다. id를 직접 주세요")
    if any(p.get("id") == pid for p in projects):
        raise ToolError("이미 쓰는 id입니다: " + pid)
    proj = {"id": pid, "name": name.strip(), "root": root}
    projects.append(proj)
    write_registry(projects)
    return {"projects": projects, "project": proj}


def t_project_rename(a):
    pid, name = _str(a, "id"), _str(a, "name")
    if not name.strip():
        raise ToolError("이름이 비었습니다")
    projects = read_registry()
    p = next((x for x in projects if x.get("id") == pid), None)
    if not p:
        raise ToolError("없는 프로젝트 id: " + pid)
    p["name"] = name.strip()
    write_registry(projects)
    return {"projects": projects}


def t_project_reorder(a):
    ids = a.get("ids")
    if not isinstance(ids, list):
        raise ToolError("ids가 필요합니다")
    projects = read_registry()
    ordered = [p for i in ids for p in projects if p.get("id") == i]
    ordered = [p for n, p in enumerate(ordered) if p not in ordered[:n]]
    rest = [p for p in projects if not any(p is o for o in ordered)]
    projects = ordered + rest
    write_registry(projects)
    return {"projects": projects}


def t_project_unregister(a):
    pid = _str(a, "id")
    projects = read_registry()
    if not any(x.get("id") == pid for x in projects):
        raise ToolError("없는 프로젝트 id: " + pid)
    projects = [x for x in projects if x.get("id") != pid]
    write_registry(projects)
    return {"projects": projects}


# ---------------------------------------------------------------- 답변 대기 (P516)

HASH8_RE = re.compile(r"[0-9a-f]{8}\Z")
Q_HEADING_RE = re.compile(r"^###\s+(\d+(?:-\d+)*)\.(?:\s|$)")
Q_OPTION_RE = re.compile(r"^\s*(?:[-*]|\d+\.)\s+\**\(([a-z](?:-\d+)*)\)")


def _tickets():
    import tickets  # 엔진 판정(read_fm, deps_unmet, find_any)을 그대로 쓴다. 의미를 복제하지 않는다
    return tickets


def _unq(v):
    return (v or "").strip().strip("\"'")


def question_sections(body):
    """lib/queue.ts questionsOf와 같다: `## 질문` 절들의 (제목, 본문)."""
    out, cur = [], None
    for line in body.split("\n"):
        if re.match(r"^#{1,2}\s", line):
            if cur:
                out.append((cur[0], "\n".join(cur[1]).strip()))
            cur = None
            if re.match(r"^##\s*질문", line):
                cur = (re.sub(r"^#+\s*", "", line).strip(), [])
            continue
        if cur:
            cur[1].append(line)
    if cur:
        out.append((cur[0], "\n".join(cur[1]).strip()))
    return out


def question_items(text):
    """lib/queue.ts optionsOf와 같다. 하위 문항은 평평하게 펴서 [{number, title, options}]로 낸다."""
    items, path, cur, opt_depth = [], [], None, 0
    for line in text.split("\n"):
        h = Q_HEADING_RE.match(line)
        if h:
            depth = h.group(1).count("-") + 1
            if depth > 1 and len(path) < depth - 1:
                cur = None  # 부모 문항이 없는 하위 문항은 버린다
                continue
            cur = {"number": h.group(1) + ".", "title": re.sub(r"^###\s+\d+(?:-\d+)*\.\s*", "", line).strip(),
                   "options": []}
            items.append(cur)
            del path[depth - 1:]
            path.append(cur)
            opt_depth = 0
            continue
        m = Q_OPTION_RE.match(line)
        if not m or cur is None:
            continue
        depth = m.group(1).count("-") + 1
        if depth > 1 and opt_depth < depth - 1:
            continue  # 부모 선택지가 없는 하위 선택지는 버린다
        cur["options"].append({"letter": m.group(1), "label": line[m.end():].replace("**", "").strip()})
        opt_depth = depth
    return items


def awaiting_rows(root):
    T = _tickets()
    rows = []
    for p in T.tickets_in(os.path.join(root)):
        if not T.is_open_name(os.path.basename(p)):
            continue
        try:
            fm, lines, end = T.read_fm(p)
        except (OSError, UnicodeDecodeError):
            continue
        a = _unq(fm.get("awaiting"))
        if end < 0 or not a:
            continue
        if nfc(a) not in [nfc(d) for d in T.deps_unmet(root, T.deps_of(lines, end))]:
            continue
        rows.append((os.path.getmtime(p), p, fm, lines, end, a))
    rows.sort(key=lambda r: (r[0], r[1]))
    return rows


def t_awaiting_list(a):
    if a.get("root"):
        targets = [{"id": "", "name": "", "root": a["root"]}]
    else:
        targets = t_projects({})["projects"]
    T, out, skipped = _tickets(), [], []
    for pr in targets:
        label = pr.get("id") or pr.get("name") or pr.get("root")
        try:
            root = get_root({"root": pr.get("root")})
            for _, p, fm, lines, end, aw in awaiting_rows(root):
                secs = question_sections("\n".join(lines[end + 1:]))
                head, text = secs[-1] if secs else ("", "")
                m = re.search(r"질문\s*(\d+)", head)
                out.append({"project": label, "root": root, "hash": T.ticket_hash(p, fm), "title": _unq(fm.get("title")),
                            "persona": T.persona_of(fm), "awaiting": aw, "round": int(m.group(1)) if m else 0,
                            "question": ("## " + head + "\n\n" + text).strip() if head else "",
                            "items": question_items(text)})
        except (ToolError, OSError) as e:
            skipped.append({"project": label, "why": str(e)})
    return {"awaiting": out, "skipped": skipped}


def compose_answer(picks):
    """lib/urls.ts composeAnswer와 같다."""
    out = []
    for p in picks:
        marks = "".join("(%s)" % l for l in sorted(p["letters"]))
        note = p["note"].strip()
        if marks or note:
            out.append(p["number"] + marks + (" " + note if note else ""))
    return "\n".join(out)


def t_ticket_answer(a):
    root = get_root(a)
    T = _tickets()
    h = a.get("hash")
    sfx, path = exactly_one(root, h)
    row = next((r for r in awaiting_rows(root) if r[1] == path), None) if sfx == "" else None
    if not row:
        raise ToolError("답변 대기 티켓이 아닙니다(열림 + awaiting + 미충족 dep): %s" % h)
    _, _, fm, lines, end, stem = row
    if not HASH8_RE.match(stem):
        raise ToolError("awaiting 값이 8자 소문자 16진이 아닙니다: %r" % stem)
    if T.find_any(root, stem):
        raise ToolError("%s 파일이 이미 큐에 있습니다(이미 답했거나 이름 충돌)" % stem)
    secs = question_sections("\n".join(lines[end + 1:]))
    items = {i["number"]: {o["letter"] for o in i["options"]} for i in question_items(secs[-1][1])} if secs else {}
    picks = a.get("picks") or []
    if not isinstance(picks, list):
        raise ToolError("picks는 배열이어야 합니다")
    norm = []
    for p in picks:
        if not isinstance(p, dict) or not isinstance(p.get("letters") or [], list):
            raise ToolError("picks 항목이 올바르지 않습니다: %r" % (p,))
        num, letters = str(p.get("number")), [str(l) for l in p.get("letters") or []]
        if num not in items:
            raise ToolError("마지막 질문 절에 없는 문항 번호입니다: " + num)
        for l in letters:
            if l not in items[num]:
                raise ToolError("문항 %s에 없는 선택지 글자입니다: %s" % (num, l))
            if "-" in l and l.rsplit("-", 1)[0] not in letters:
                raise ToolError("하위 선택지 %s는 부모 글자도 같이 골라야 합니다" % l)
        norm.append({"number": num, "letters": letters, "note": str(p.get("note") or "")})
    text = str(a.get("text") or "").replace("\r\n", "\n").strip()
    answer = "\n\n".join(x for x in (compose_answer(norm), text) if x)
    if not answer:
        raise ToolError("답이 비어 있습니다(picks나 text가 필요)")
    n = 1
    for d in T.deps_of(lines, end):
        dp = T.find_any(root, d)
        if dp and _unq(T.read_fm(dp)[0].get("kind")) == "answer":
            n += 1
    r_stem = T.ticket_hash(path, fm)
    dst = os.path.join(root, "tickets", stem + DONE + ".md")
    body = "\n".join(["---", "ticket: " + stem, "title: 답변 \u2014 %s #%d" % (r_stem, n), "kind: answer", "---", "",
                      "## 답변 %d" % n, "", answer, ""])
    try:
        fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError:
        raise ToolError("답변 파일이 이미 있습니다: " + os.path.basename(dst))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(body)
    try:  # 즉시 디스패치는 최적화다. 실패해도 답 파일 생성은 성공이다
        d = dispatch_run(root, "direct", hash=r_stem)
    except ToolError as e:
        d = {"go": False, "worker": None, "hash": r_stem, "reason": "direct", "why": str(e)}
    return {"path": dst, "round": n, "body": body, "dispatch": d}


# ---------------------------------------------------------------- 온톨로지 읽기 (P496)

def ontology_tool(op):
    def f(a):
        import ontology_read
        root = get_root(a)
        args = {k: v for k, v in a.items() if k != "root"}
        try:
            return ontology_read.run(root, op, args)
        except ValueError as e:
            raise ToolError(str(e))
    return f


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


# ---------------------------------------------------------------- 머신 설정과 프로젝트 설정 (P543)

def _local():
    return os.environ.get("TICKET_LOCAL") or os.path.expanduser("~/.config/dira")


def _read(name):
    try:
        with open(os.path.join(_local(), name), encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None


def _autonomy_file():
    """lib/projects.ts readAutonomyFile과 같다: (level, 파일의 autopilot이 JSON true인가)."""
    raw = _read("autonomy.json")
    try:
        o = json.loads(raw)
    except (TypeError, ValueError):
        return 4, False
    o = o if isinstance(o, dict) else {}
    lv = o.get("level")
    ok = type(lv) is int and 1 <= lv <= 5
    return (lv if ok else 4), o.get("autopilot") is True


def t_settings_get(a):
    lang = "en" if _lang_en() else "ko"
    level, flag = _autonomy_file()
    mt = (_read("multitoken") or "").strip()
    sl = _read("session-limit")
    if sl is None:
        limit = {"limit": None, "warn": False}
    elif re.fullmatch(r"[0-9]+", sl.strip()):
        limit = {"limit": int(sl.strip()), "warn": False}
    else:
        limit = {"limit": 0, "warn": True}
    return {"language": lang, "autonomy": {"level": level, "autopilot": level == 5 and flag},
            "multiplay": _read("multiplay") is not None,
            "multitoken": {"1": True, "0": False}.get(mt), "session_limit": limit}


def _lang_en():
    try:
        return json.loads(_read("language.json")).get("locale") == "en"
    except (TypeError, ValueError, AttributeError):
        return False


def _atomic(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.tmp.%d" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def t_settings_set(a):
    level, flag = _autonomy_file()
    new_level, new_flag = level, flag
    if "language" in a and a["language"] not in ("ko", "en"):
        raise ToolError("language는 ko 또는 en이어야 합니다")
    if "autonomy_level" in a:
        v = a["autonomy_level"]
        if type(v) is not int or not 1 <= v <= 5:
            raise ToolError("autonomy_level은 1~5 정수여야 합니다")
        new_level = v
    if "autopilot" in a:
        if not isinstance(a["autopilot"], bool):
            raise ToolError("autopilot은 true 또는 false여야 합니다")
        new_flag = a["autopilot"]
        if new_flag and new_level != 5:
            raise ToolError("autopilot은 autonomy_level이 5일 때만 켤 수 있습니다")
    for k in ("multiplay", "multitoken"):
        if k in a and not isinstance(a[k], bool):
            raise ToolError("%s는 true 또는 false여야 합니다" % k)
    if "session_limit" in a:
        v = a["session_limit"]
        if v is not None and (type(v) is not int or v < 0):
            raise ToolError("session_limit은 0 이상의 정수 또는 null이어야 합니다")
    # 검사 끝 - 아래부터 쓴다
    L = _local()
    if "language" in a:
        _atomic(os.path.join(L, "language.json"), json.dumps({"locale": a["language"]}, indent=2) + "\n")
    if "autonomy_level" in a or "autopilot" in a:
        o = {"level": new_level}
        if new_flag:
            o["autopilot"] = True
        _atomic(os.path.join(L, "autonomy.json"), json.dumps(o, indent=2) + "\n")
    if "multiplay" in a:
        if a["multiplay"]:
            _atomic(os.path.join(L, "multiplay"), "")
        elif os.path.exists(os.path.join(L, "multiplay")):
            os.remove(os.path.join(L, "multiplay"))
    if "multitoken" in a:
        _atomic(os.path.join(L, "multitoken"), "1" if a["multitoken"] else "0")
    if "session_limit" in a:
        if a["session_limit"] is None:
            if os.path.exists(os.path.join(L, "session-limit")):
                os.remove(os.path.join(L, "session-limit"))
        else:
            _atomic(os.path.join(L, "session-limit"), "%d\n" % a["session_limit"])
    return t_settings_get({})


def _queue_dir(a):
    root = a.get("root") or os.environ.get("TICKET_ROOT")
    if not root:
        raise ToolError("root가 필요합니다")
    return os.path.realpath(os.path.expanduser(root))


def _slim_status(root):
    r = run([sys.executable, os.path.join(ENGINE_DIR, "slim.py"), "status", root], root)
    try:
        return json.loads(r["stdout"])
    except ValueError:
        return {"rc": r["rc"], "out": r["stdout"].strip()}


def t_project_settings_get(a):
    root = _queue_dir(a)
    try:
        with open(os.path.join(root, "integration-branch"), encoding="utf-8") as f:
            first = f.readline().strip()
    except FileNotFoundError:
        first = ""
    ib = first if re.fullmatch(r"[A-Za-z0-9._/-]+", first) else None
    workers = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(root, "workers", "*.sh")))
    return {"integration_branch": ib, "slim": _slim_status(root), "workers": workers}


def t_project_slim(a):
    root = _queue_dir(a)
    if not isinstance(a.get("on"), bool):
        raise ToolError("on은 true 또는 false여야 합니다")
    _atomic(os.path.join(root, "slim-checkout"), "on\n" if a["on"] else "off\n")
    r = run([sys.executable, os.path.join(ENGINE_DIR, "slim.py"), "empty" if a["on"] else "fill", root], root)
    view = _slim_status(root)
    if r["rc"] != 0:
        msg = r["stdout"].strip()
        try:
            msg = json.loads(r["stdout"]).get("reason") or msg
        except (ValueError, AttributeError):
            pass
        view = dict(view, message=msg or "slim rc %d" % r["rc"])
    return view


# ---------------------------------------------------------------- 도구 표

def _s(desc, props=None, req=()):
    p = {"root": {"type": "string", "description": "큐 루트(<프로젝트>/.dira). 없으면 $TICKET_ROOT"}}
    p.update(props or {})
    return {"type": "object", "properties": p, "required": list(req)}


STR, BOOL, INT = {"type": "string"}, {"type": "boolean"}, {"type": "integer"}
def _o(props, req=()):
    return {"type": "object", "properties": props, "required": list(req)}


H = {"hash": STR}
W = {"worker": {"type": "string", "description": "workers/<이름>.sh 의 이름"}}

TOOLS = {
    "projects": ("GUI에 등록된 프로젝트와 큐 루트 목록", {"type": "object", "properties": {}}, t_projects),
    # P543 프로젝트
    "project_register": ("이미 있는 큐를 GUI 레지스트리에 등록한다(화면 등록과 같은 검증 순서). 쓴 뒤의 projects와 project",
                         _o({"path": STR, "name": STR, "id": STR}, ["path", "name"]), t_project_register),
    "project_rename": ("프로젝트 이름 바꾸기. 쓴 뒤의 projects", _o({"id": STR, "name": STR}, ["id", "name"]),
                       t_project_rename),
    "project_reorder": ("ids 순서대로 앞에 놓고 나머지는 원래 순서로 뒤에. 모르는 id는 무시",
                        _o({"ids": {"type": "array", "items": STR}}, ["ids"]), t_project_reorder),
    "project_unregister": ("레지스트리에서만 지운다(큐 파일은 안 건드린다)", _o({"id": STR}, ["id"]),
                           t_project_unregister),
    "awaiting_list": ("답변 대기 티켓(열림 + awaiting + 미충족 dep)과 마지막 질문 절-문항-선택지. "
                      "root가 없으면 GUI 등록 프로젝트 전체", _s("", {}), t_awaiting_list),
    "ticket_answer": ("답변 대기 티켓에 답을 단다(화면 답변 쓰기와 같은 파일). picks=[{number, letters, note?}], "
                      "text=직접 쓴 답. 만든 뒤 그 티켓을 디스패치한다",
                      _s("", {**H, "picks": {"type": "array", "items": {"type": "object"}}, "text": STR},
                         ["hash"]), t_ticket_answer),
    "queue_list": ("열린 티켓 목록(<w>.sh list)", _s("", W), t_queue_list),
    "dispatch": ("워커를 1회 돌린다(<w>.sh)", _s("", W, ["worker"]), lambda a: worker_cmd(a)),
    "dispatch_now": ("지금 워커를 띄운다(dispatch.py run --reason direct). 해시가 있으면 그 티켓을 지목. "
                     "{go, worker, hash, reason, why}", _s("", {**H, **W}), t_dispatch_now),
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
    "ontology_objects": ("온톨로지 객체 목록(본문 없음, path 순, cursor로 쪽 넘김)",
                         _s("", {"types": {"type": "array", "items": STR}, "cursor": STR, "limit": INT}),
                         ontology_tool("objects")),
    "ontology_object": ("온톨로지 객체 하나(본문-원문 포함). backlinks: true면 이 객체를 가리키는 관계도",
                        _s("", {"name": STR, "backlinks": BOOL}, ["name"]), ontology_tool("object")),
    "ontology_search": ("온톨로지 객체를 이름-제목-속성-본문에서 부분 일치로 검색",
                        _s("", {"q": STR, "types": {"type": "array", "items": STR}, "limit": INT}, ["q"]),
                        ontology_tool("search")),
    "ontology_versions": ("객체의 버전 목록", _s("", {"name": STR}, ["name"]), ontology_tool("versions")),
    "ontology_version": ("객체의 버전 하나", _s("", {"name": STR, "version": STR}, ["name", "version"]),
                         ontology_tool("version")),
    "ontology_schema": ("온톨로지 ObjectType-LinkType 정의", _s(""), ontology_tool("schema")),
    "env_list": ("프로젝트 환경변수 이름 목록(값 없음)", _s(""), t_env_list),
    "env_create": ("환경변수 만들기. 값은 응답에 안 실린다",
                   _s("", {"name": STR, "value": STR}, ["name", "value"]), t_env_create),
    "env_replace": ("환경변수 값 교체", _s("", {"name": STR, "value": STR, "revision": INT},
                                          ["name", "value", "revision"]), t_env_replace),
    "env_delete": ("환경변수 삭제", _s("", {"name": STR, "revision": INT}, ["name", "revision"]), t_env_delete),
    # P543 설정
    "settings_get": ("머신 설정 읽기(language-autonomy-multiplay-multitoken-session_limit)", _s("", {}), t_settings_get),
    "settings_set": ("머신 설정 바꾸기. 준 키만, 하나라도 틀리면 아무것도 안 쓴다. autopilot: true는 autonomy_level 5일 때만. "
                     "session_limit: null은 상한 해제",
                     _s("", {"language": STR, "autonomy_level": INT, "autopilot": BOOL, "multiplay": BOOL,
                             "multitoken": BOOL, "session_limit": {"type": ["integer", "null"]}}), t_settings_set),
    "project_settings_get": ("프로젝트 설정 읽기 {integration_branch, slim, workers}", _s("", {}), t_project_settings_get),
    "project_slim": ("슬림 체크아웃 켜고 끄기(slim-checkout + slim.py empty|fill)", _s("", {"on": BOOL}, ["on"]),
                     t_project_slim),
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


# 엔진 서브커맨드 -> 그것에 닿는 도구. test_mcp_parity.py가 소스에서 긁은 이름과 이 표를 맞춘다.
# 엔진에 서브커맨드가 늘면 여기에 한 줄 더해야 테스트가 통과한다(닿는 도구가 없으면 engine_exec).
_X = "engine_exec"
COVERS = {
    "tickets.py": {"select": _X, "wips": _X, "list": "queue_list", "reap": "reap", "find": "ticket_find",
                   "claim": _X, "handclaim": _X, "release": _X, "reapclear": _X, "assign": _X,
                   "setpid": _X, "setpersona": _X, "setinbox": _X, "askhuman": _X, "pollrows": _X,
                   "pollstart": _X, "pollplan": _X, "pollresult": _X, "clear": _X},
    "tick.sh": {"list": "queue_list", "unassign": "unassign", "reap": "reap", "poll": _X, "preempt": _X,
                "dryrun": "dryrun", "tick": "dispatch"},
    "dispatch.py": {"run": "dispatch_now"},
    "graph.py": {"build": _X, "query": "graph_query", "path": _X, "explain": _X},
    "dira_env.py": {"list": "env_list", "create": "env_create", "replace": "env_replace",
                    "delete": "env_delete", "run": _X, "context": _X},
}
