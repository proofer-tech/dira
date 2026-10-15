#!/usr/bin/env python3
"""온톨로지 읽기 여섯 조회 (docs/DESIGN.md P496). 원격 읽기(remote.py)와 MCP 도구(mcp_tools.py)가
같은 `run`을 부른다. 해석은 여기서만 한다. python3 표준 라이브러리 + graph.py/remote.py만."""
import datetime
import hashlib
import os
import re
import sys
import threading
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from graph import block_list, nfc, ontology_links, read_fm, strip_quotes  # noqa: E402
from remote import ont_roots  # noqa: E402

KEY_RE = re.compile(r"^([A-Za-z_가-힣][A-Za-z0-9_가-힣]*):\s*(.*)$")


def walk(onts, sub):
    """{위치 상대경로: 절대경로}. 심링크는 따라가지 않고, 같은 상대경로면 앞 위치가 이긴다."""
    out = {}
    for ont in onts:
        for d, dirs, files in os.walk(os.path.join(ont, sub)):
            dirs[:] = [x for x in dirs if not os.path.islink(os.path.join(d, x))]
            for n in files:
                f = os.path.join(d, n)
                if n.endswith(".md") and not os.path.islink(f):
                    out.setdefault(os.path.relpath(f, ont).replace(os.sep, "/"), f)
    return dict(sorted(out.items()))


def props_of(lines, end):
    props = {}
    i = 1
    while i < end:
        m = KEY_RE.match(lines[i])
        i += 1
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        items = []
        while i < end and re.match(r"^\s+-\s", lines[i]):
            items.append(strip_quotes(re.sub(r"^\s+-\s*", "", lines[i])))
            i += 1
        if key in ("name", "type", "links"):
            continue
        if val.startswith("[") and val.endswith("]"):
            props[key] = [strip_quotes(x) for x in val[1:-1].split(",") if x.strip()]
        elif val:
            props[key] = strip_quotes(val)
        elif items:
            props[key] = [x for x in items if x]
        else:
            props[key] = None
    return props


def parse(rel, path):
    """(객체 구조 + _body/_content, None) 또는 (None, reason)."""
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        return None, "read-failed"
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None, "not-utf8"
    lines = text.split("\n")
    if lines[0].strip() != "---":
        return None, "no-frontmatter"
    fm, lines, end = read_fm(text)
    if end < 0:
        return None, "unclosed-frontmatter"
    props = props_of(lines, end)
    stem = os.path.splitext(os.path.basename(rel))[0]
    parts = rel.split("/")
    typ = strip_quotes(fm.get("type")) or (parts[1] if rel.startswith("objects/") and len(parts) > 2 else "")
    name = nfc(strip_quotes(fm.get("name")) or stem)
    body = "\n".join(lines[end + 1:])
    if body.startswith("\n"):
        body = body[1:]
    links = []
    for rt, to, prop in ontology_links(lines, end):
        links.append({"type": rt, "to": to, "props": {"property": prop} if prop else {}})
    title = props.get("title")
    return {"name": name, "type": typ, "path": rel, "sha256": hashlib.sha256(data).hexdigest(),
            "title": title if isinstance(title, str) and title else name, "props": props,
            "links": links, "_body": body, "_content": text}, None


# P500-2: 열쇠 (경로, mtime_ns, size)가 같으면 해석을 다시 안 한다. 메모리에만 둔다.
# ponytail: mtime과 크기가 같은 채 내용만 바뀐 파일은 못 잡는다. 필요하면 열쇠에 inode나 해시를 더한다.
_CACHE = {}
_LOCK = threading.Lock()


def parse_cached(rel, path):
    try:
        st = os.stat(path)
    except OSError:
        return parse(rel, path)
    key = (st.st_mtime_ns, st.st_size)
    with _LOCK:
        hit = _CACHE.get(path)
    if hit and hit[0] == key and hit[1] == rel:
        return hit[2], hit[3]
    o, why = parse(rel, path)
    with _LOCK:
        _CACHE[path] = (key, rel, o, why)
    return o, why


def load_objects(root):
    objs, errors, seen, paths = [], [], set(), set()
    for rel, path in walk(ont_roots(root), "objects").items():
        paths.add(path)
        o, why = parse_cached(rel, path)
        if o is None:
            errors.append({"path": rel, "reason": why})
        elif o["name"] in seen:
            errors.append({"path": rel, "reason": "duplicate-name"})
        else:
            seen.add(o["name"])
            objs.append(dict(o))
    with _LOCK:
        for k in [k for k in _CACHE if k not in paths]:
            del _CACHE[k]
    return objs, errors


def public(o):
    return {k: v for k, v in o.items() if not k.startswith("_")}


def int_arg(args, key, default, top):
    v = args.get(key)
    if v is None:
        return default
    if isinstance(v, bool) or not isinstance(v, int) or v < 1:
        raise ValueError("%s는 1 이상의 정수여야 한다" % key)
    return min(v, top)


def want_types(args):
    t = args.get("types")
    if t is None:
        return None
    if isinstance(t, str):
        t = [t]
    if not isinstance(t, list):
        raise ValueError("types는 문자열 목록이어야 한다")
    return set(t)


def need_name(args, key="name"):
    v = args.get(key)
    if not isinstance(v, str) or not v or "/" in v or "\\" in v or v in (".", "..") or "\0" in v:
        raise ValueError("%s가 비었거나 올바르지 않다" % key)
    return nfc(v)


def op_objects(root, args):
    objs, errors = load_objects(root)
    types, cursor = want_types(args), args.get("cursor")
    limit = int_arg(args, "limit", 200, 1000)
    rows = [o for o in objs if (types is None or o["type"] in types) and (not cursor or o["path"] > cursor)]
    page = rows[:limit]
    res = {"objects": [public(o) for o in page]}
    if len(rows) > limit:
        res["cursor"] = page[-1]["path"]
    return {"result": res, "errors": [] if cursor else errors}


def op_object(root, args):
    name = nfc(args.get("name") or "")
    if not name:
        raise ValueError("name이 비었다")
    objs, _ = load_objects(root)
    hit = next((o for o in objs if o["name"] == name), None)
    if hit is None:
        return {"result": {"object": None}, "errors": []}
    obj = dict(public(hit), body=hit["_body"], content=hit["_content"])
    res = {"object": obj}
    if args.get("backlinks"):
        res["backlinks"] = [{"from": o["name"], "type": l["type"], "props": l["props"]}
                            for o in objs for l in o["links"] if l["to"] == name]
    return {"result": res, "errors": []}


def op_search(root, args):
    q = args.get("q")
    if not isinstance(q, str) or not q.strip():
        raise ValueError("q가 비었다")
    q = nfc(q).casefold()
    types, limit = want_types(args), int_arg(args, "limit", 20, 100)
    objs, errors = load_objects(root)
    head, tail = [], []
    for o in objs:
        if types is not None and o["type"] not in types:
            continue
        pv = []
        for v in o["props"].values():
            pv += v if isinstance(v, list) else [v] if v else []
        fields = [o["name"], o["title"]] + pv + [o["_body"]]
        for k, f in enumerate(fields):
            idx = nfc(f).casefold().find(q)
            if idx >= 0:
                break
        else:
            continue
        # ponytail: casefold로 길이가 변하는 글자(ß 등)는 발췌 위치가 어긋날 수 있다
        flat = " ".join(f.split())
        i2 = max(0, flat.casefold().find(q) - 40)
        item = dict(public(o), excerpt=flat[i2:i2 + 100])
        (head if k < 2 else tail).append(item)
    return {"result": {"objects": (head + tail)[:limit]}, "errors": errors}


def version_files(root, name):
    out = []
    for rel, path in walk(ont_roots(root), "versions").items():
        p = rel.split("/")
        if len(p) == 4 and p[2] == name:
            out.append((p[3][:-3], rel, path))
    return sorted(out)


def op_versions(root, args):
    name = need_name(args)
    rows = []
    for ver, rel, path in version_files(root, name):
        with open(path, "rb") as fh:
            sha = hashlib.sha256(fh.read()).hexdigest()
        at = datetime.datetime.fromtimestamp(os.stat(path).st_mtime).astimezone().isoformat(timespec="seconds")
        rows.append({"version": ver, "path": rel, "sha256": sha, "at": at})
    return {"result": {"versions": rows}, "errors": []}


def op_version(root, args):
    name, ver = need_name(args), need_name(args, "version")
    for v, _, path in version_files(root, name):
        if v == nfc(ver):
            with open(path, "rb") as fh:
                data = fh.read()
            return {"result": {"content": data.decode("utf-8", "replace"),
                               "sha256": hashlib.sha256(data).hexdigest()}, "errors": []}
    return {"result": {"content": None}, "errors": []}


def op_schema(root, args):
    ots, lts, errors = [], [], []
    for rel, path in walk(ont_roots(root), "_ontology").items():
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except (OSError, UnicodeDecodeError):
            continue
        fm, lines, end = read_fm(text)
        typ, name = strip_quotes(fm.get("type")), nfc(strip_quotes(fm.get("name")) or os.path.splitext(os.path.basename(rel))[0])
        if typ == "ObjectType":
            ots.append({"name": name, "props": block_list(lines, end, "properties"),
                        "body": strip_quotes(fm.get("body")) or None})
        elif typ == "LinkType":
            side = lambda k: [nfc(x.strip()) for x in re.split(r"\s+-\s+|,", strip_quotes(fm.get(k))) if x.strip()]
            lts.append({"name": name, "from": side("from"), "to": side("to")})
    return {"result": {"object_types": ots, "link_types": lts}, "errors": errors}


OPS = {"objects": op_objects, "object": op_object, "search": op_search,
       "versions": op_versions, "version": op_version, "schema": op_schema}


def run(root, op, args):
    if op not in OPS:
        raise ValueError("모르는 op: %s" % op)
    if args is None:
        args = {}
    if not isinstance(args, dict):
        raise ValueError("args는 객체여야 한다")
    return OPS[op](root, args)


if __name__ == "__main__":
    import json
    r = run(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]) if len(sys.argv) > 3 else {})
    print(json.dumps(r, ensure_ascii=False, indent=2))
