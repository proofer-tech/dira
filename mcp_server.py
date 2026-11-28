#!/usr/bin/env python3
"""엔진 MCP 서버 프로토콜 층 (DESIGN.md P476). 도구는 mcp_tools.py.

    python3 mcp_server.py                       줄 단위 JSON-RPC (stdio)
    python3 mcp_server.py --http 127.0.0.1:PORT Streamable HTTP, POST /mcp, 응답은 application/json

HTTP는 127.0.0.1에만 묶는다(PORT 0 = 빈 포트). 토큰은 환경변수 DIRA_MCP_TOKEN, 없으면 새로 만든다.
뜨면 stdout 첫 줄에 {"url","port"}(만든 토큰이면 "token"도)를 JSON 한 줄로 낸다.
요청마다 Authorization: Bearer <token>이 맞아야 하고(401), Origin이 있으면 http://127.0.0.1-
http://localhost만 받는다(403).
"""
import hmac
import json
import os
import secrets
import sys
import threading
import time
import socketserver
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import mcp_tools

PROTOCOL = "2025-06-18"
OLD_VERSIONS = ("2025-06-18", "2025-11-25")  # initialize 협상 대상
STATELESS = "2026-07-28"
SUPPORTED = (STATELESS,) + OLD_VERSIONS
META_VERSION = "io.modelcontextprotocol/protocolVersion"
CAPS = {"tools": {}, "resources": {}}  # 이전 규격 HTTP. stdio는 CAPS_STDIO
CAPS_STDIO = {"tools": {"listChanged": True}, "resources": {"subscribe": True, "listChanged": True}}
CAPS_NEW = CAPS_STDIO  # 2026-07-28은 subscriptions/listen이 두 전송 모두에 있다
STDIO = False
SUBID = "io.modelcontextprotocol/subscriptionId"
WATCH_S = float(os.environ.get("DIRA_MCP_WATCH_S") or 2)
SERVER_INFO = {"name": "dira-engine", "version": "1"}
_out_lock = threading.Lock()  # stdio 쓰기는 write_line 하나로 모아 응답과 알림이 섞여도 줄이 깨지지 않게 한다
JSON_MIME = "application/json"
MAX_BODY = 8 * 1024 * 1024


def reply(i, result=None, error=None):
    m = {"jsonrpc": "2.0", "id": i}
    if error:
        m["error"] = error
    else:
        m["result"] = result
    return m


def write_line(obj):
    with _out_lock:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def handle(msg):
    """JSON-RPC 메시지 하나 -> 응답 dict 또는 None(알림)."""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
        return reply(None, error={"code": -32600, "message": "Invalid Request"})
    method, i, p = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if "id" not in msg:
        return None
    meta = p.get("_meta") if isinstance(p, dict) else None
    ver = meta.get(META_VERSION) if isinstance(meta, dict) else None
    if method == "initialize":
        want = p.get("protocolVersion") if isinstance(p, dict) else None
        return reply(i, {"protocolVersion": want if want in OLD_VERSIONS else PROTOCOL,
                         "capabilities": CAPS_STDIO if STDIO else CAPS, "serverInfo": SERVER_INFO})
    if ver is None and method != "server/discover":
        return handle_old(i, method, p)
    if ver is not None and ver != STATELESS:
        return reply(i, error={"code": -32022, "message": "Unsupported protocol version: %s" % ver,
                               "data": {"supported": list(SUPPORTED)}})
    r = handle_old(i, method, p) if method != "server/discover" else reply(i, {
        "supportedVersions": list(SUPPORTED), "capabilities": CAPS_NEW, "serverInfo": SERVER_INFO})
    if "result" in r:
        r["result"]["resultType"] = "complete"
        r["result"].setdefault("_meta", {})["serverInfo"] = SERVER_INFO
    return r


def handle_old(i, method, p):
    if method == "ping":
        return reply(i, {})
    if method == "tools/list":
        return reply(i, {"tools": mcp_tools.list_tools()})
    if method == "tools/call":
        try:
            out = mcp_tools.call_tool(p.get("name"), p.get("arguments"))
            err = False
            links = out.pop("_links", None) if isinstance(out, dict) else None
        except mcp_tools.ToolError as e:
            out, err, links = {"error": str(e)}, True, None
        except Exception as e:  # 도구 하나의 실패가 서버를 죽이지 않는다
            out, err, links = {"error": "%s: %s" % (type(e).__name__, e)}, True, None
        content = [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}]
        content += [{"type": "resource_link", "uri": u, "name": u.split("?")[0].rsplit("/", 1)[-1]} for u in links or []]
        return reply(i, {"content": content, "isError": err})
    if method in ("resources/subscribe", "resources/unsubscribe") and STDIO:
        try:
            mcp_tools.parse_uri(p.get("uri"))
        except mcp_tools.ToolError as e:
            return reply(i, error={"code": -32602, "message": str(e)})
        old_subscribe(p["uri"], method == "resources/subscribe")
        return reply(i, {})
    if method == "resources/list":
        return reply(i, {"resources": resources_list()})
    if method == "resources/templates/list":
        return reply(i, {"resourceTemplates": [{"uriTemplate": "dira://ticket/{hash}{?root}", "name": "ticket",
                                                "mimeType": JSON_MIME}]})
    if method == "resources/read":
        try:
            return reply(i, {"contents": [resource_read(p.get("uri"))]})
        except ValueError as e:
            return reply(i, error={"code": -32602, "message": str(e)})
    return reply(i, error={"code": -32601, "message": "Method not found: %s" % method})


def resources_list():
    from urllib.parse import quote
    rs = [{"uri": "dira://awaiting", "name": "awaiting", "mimeType": JSON_MIME},
          {"uri": "dira://projects", "name": "projects", "mimeType": JSON_MIME}]
    for pr in mcp_tools.t_projects({})["projects"]:
        if pr.get("root"):
            rs.append({"uri": "dira://queue?root=" + quote(pr["root"], safe=""),
                       "name": "queue " + str(pr.get("name") or pr.get("id") or pr["root"]), "mimeType": JSON_MIME})
    return rs


def resource_read(uri):
    try:
        kind, h, root = mcp_tools.parse_uri(uri)
        if kind == "projects":
            out = mcp_tools.t_projects({})
        elif kind == "awaiting":
            out = mcp_tools.t_awaiting_list({"root": root} if root else {})
        elif kind == "queue":
            out = mcp_tools.t_queue_list({"root": root} if root else {})
        else:
            root = mcp_tools.get_root({"root": root})
            out = mcp_tools.ticket_task(root, h)
            fm = mcp_tools._tickets().read_fm(mcp_tools._ticket_state(root, h)[1])[0]
            for k in ("title", "kind", "persona", "owner"):
                out[k] = mcp_tools._unq(fm.get(k))
    except mcp_tools.ToolError as e:
        raise ValueError(str(e))
    return {"uri": uri, "mimeType": JSON_MIME, "text": json.dumps(out, ensure_ascii=False)}


# ---------------------------------------------------------------- 구독과 감시 스레드 (P571 결정 6)
# ponytail: 2초마다 전량 재서명(파일 mtime - 목록 JSON). 큐가 아주 커지면 inotify/FSEvents.
_subs, _subs_lock, _thread = {}, threading.Lock(), None
_memo = {}


def _stat_sig(path, whole=False):
    try:
        if whole:
            with open(path, "rb") as f:
                return f.read()
        st = os.stat(path)
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None


def signature(key):
    """key: 'ops' | 'projects' | dira:// URI -> 바뀌면 달라지는 값."""
    if key in _memo:
        return _memo[key]
    local = mcp_tools._local()
    try:
        if key == "ops":
            v = _stat_sig(os.path.join(local, "ops.json"), True)
        elif key == "projects" or key == "dira://projects":
            v = _stat_sig(os.path.join(local, "gui-projects.json"), True)
        else:
            kind, h, root = mcp_tools.parse_uri(key)
            if kind == "awaiting":
                a = mcp_tools.t_awaiting_list({"root": root} if root else {})
                v = json.dumps([(r["root"], r["hash"], r["awaiting"], r["round"]) for r in a["awaiting"]])
            else:
                tdir = os.path.join(mcp_tools.get_root({"root": root}), "tickets")
                names = sorted(os.listdir(tdir))
                if kind == "queue":
                    v = names
                else:
                    v = [(n, _stat_sig(os.path.join(tdir, n))) for n in names
                         if mcp_tools.nfc(n).startswith(mcp_tools.nfc(h))]
    except (mcp_tools.ToolError, OSError) as e:
        v = "err:%s" % e
    _memo[key] = v
    return v


def _note(sub, method, params=None):
    params = dict(params or {})
    if sub["id"] is not None:
        params["_meta"] = {SUBID: sub["id"]}
    return {"jsonrpc": "2.0", "method": method, "params": params}


def _push(sub, msg):
    try:
        sub["sink"](msg)
        return True
    except Exception:
        drop(sub)
        return False


def _tick():
    _memo.clear()
    with _subs_lock:
        subs = list(_subs.values())
    for sub in subs:
        if sub.get("sse"):
            try:
                sub["heartbeat"]()
            except Exception:
                drop(sub)
                continue
        for key in ["ops", "projects"] + list(sub["uris"]):
            now = signature(key)
            if sub["sig"].get(key, now) == now:
                sub["sig"][key] = now
                continue
            sub["sig"][key] = now
            if key == "ops":
                if sub["tools"]:
                    _push(sub, _note(sub, "notifications/tools/list_changed"))
            else:
                if key == "projects" and sub["list"]:
                    _push(sub, _note(sub, "notifications/resources/list_changed"))
                if key in sub["uris"]:
                    _push(sub, _note(sub, "notifications/resources/updated", {"uri": key}))


def _watch():
    global _thread
    while True:
        time.sleep(WATCH_S)
        with _subs_lock:
            if not _subs:
                _thread = None
                return
        try:
            _tick()
        except Exception:
            pass  # 감시 한 바퀴의 실패가 구독을 끊지 않는다


def add_sub(sub):
    global _thread
    _memo.clear()
    sub["sig"] = {k: signature(k) for k in ["ops", "projects"] + list(sub["uris"])}
    sub["done"] = threading.Event()
    with _subs_lock:
        _subs[id(sub)] = sub
        if _thread is None:
            _thread = threading.Thread(target=_watch, name="mcp-watch", daemon=True)
            _thread.start()
    return sub


def drop(sub):
    with _subs_lock:
        _subs.pop(id(sub), None)
    sub["done"].set()


_old = None  # 이전 규격 stdio 구독 하나(연결이 곧 세션)


def old_subscribe(uri, on):
    global _old
    if _old is None:
        if not on:
            return
        _old = add_sub({"id": None, "sink": write_line, "tools": True, "list": True, "uris": []})
    if on and uri not in _old["uris"]:
        _old["uris"].append(uri)
        _memo.clear()
        _old["sig"][uri] = signature(uri)
    elif not on and uri in _old["uris"]:
        _old["uris"].remove(uri)
        _old["sig"].pop(uri, None)


def listen(msg, sink):
    """2026-07-28 subscriptions/listen -> 구독 dict(등록됨) 또는 오류 응답 dict."""
    p = msg.get("params") or {}
    n = p.get("notifications") if isinstance(p.get("notifications"), dict) else {}
    uris = []
    for u in n.get("resourceSubscriptions") or []:
        try:
            mcp_tools.parse_uri(u)
            uris.append(u)
        except mcp_tools.ToolError:
            pass  # 지원하는 부분만 acknowledged에 돌려준다
    ack = {}
    if n.get("toolsListChanged"):
        ack["toolsListChanged"] = True
    if n.get("resourcesListChanged"):
        ack["resourcesListChanged"] = True
    if uris:
        ack["resourceSubscriptions"] = uris
    sub = {"id": str(msg["id"]), "rid": msg["id"], "sink": sink, "tools": bool(ack.get("toolsListChanged")),
           "list": bool(ack.get("resourcesListChanged")), "uris": uris}
    sink(_note(sub, "notifications/subscriptions/acknowledged", {"notifications": ack}))
    return add_sub(sub)


def is_listen(msg):
    p = msg.get("params") if isinstance(msg, dict) else None
    meta = p.get("_meta") if isinstance(p, dict) else None
    return (isinstance(msg, dict) and msg.get("method") == "subscriptions/listen" and "id" in msg
            and isinstance(meta, dict) and meta.get(META_VERSION) == STATELESS)


def handle_text(text):
    try:
        data = json.loads(text)
    except ValueError:
        return reply(None, error={"code": -32700, "message": "Parse error"})
    if isinstance(data, list):
        out = [r for r in map(handle, data) if r]
        return out or None
    return handle(data)


def serve_stdio():
    global STDIO
    STDIO = True
    listens = {}
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            msg = None
        if is_listen(msg):
            listens[msg["id"]] = listen(msg, write_line)
            continue
        if isinstance(msg, dict) and msg.get("method") == "notifications/cancelled":
            sub = listens.pop((msg.get("params") or {}).get("requestId"), None)
            if sub:
                drop(sub)
            continue
        r = handle_text(line)
        if r is not None:
            write_line(r)
    for rid, sub in listens.items():  # 서버가 끝낼 때는 원래 요청에 complete로 답한다
        drop(sub)
        write_line(reply(rid, {"resultType": "complete"}))


def origin_ok(origin):
    u = urlparse(origin)
    return u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost")


def make_handler(token):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body=b""):
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            auth = self.headers.get("Authorization", "")
            if not hmac.compare_digest(auth.encode(), ("Bearer " + token).encode()):
                return self.send(401, b'{"error":"unauthorized"}')
            origin = self.headers.get("Origin")
            if origin is not None and not origin_ok(origin):
                return self.send(403, b'{"error":"forbidden origin"}')
            if self.path != "/mcp":
                return self.send(404, b'{"error":"not found"}')
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                return self.send(413, b'{"error":"too large"}')
            body = self.rfile.read(n).decode("utf-8", "replace")
            try:
                msg = json.loads(body)
            except ValueError:
                msg = None
            if is_listen(msg):
                return self.stream(msg)
            r = handle_text(body)
            if r is None:
                return self.send(202)
            self.send(200, json.dumps(r, ensure_ascii=False).encode())

        def stream(self, msg):
            """subscriptions/listen: 이 POST의 응답을 SSE로 열어 둔다. 연결이 닫히면(쓰기 실패) 구독도 끝난다."""
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True

            def out(data):
                self.wfile.write(data)
                self.wfile.flush()
            sub = listen(msg, lambda m: out(b"data: " + json.dumps(m, ensure_ascii=False).encode() + b"\n\n"))
            sub["sse"], sub["heartbeat"] = True, lambda: out(b": ping\n\n")
            sub["done"].wait()

        do_GET = do_DELETE = lambda self: self.send(405, b'{"error":"method not allowed"}')

    return H


class Server(ThreadingHTTPServer):
    # HTTPServer.server_bind는 socket.getfqdn(host)로 역방향 DNS를 조회한다. macOS 러너에서 35초가
    # 걸려 keepalive.sh의 10초 대기를 넘겼다(CI 2026-10-11~14). 이름은 안 쓰니 조회하지 않는다.
    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def serve_http(addr):
    host, _, port = addr.rpartition(":")
    if host != "127.0.0.1" or not port.isdigit():
        raise SystemExit("--http 는 127.0.0.1:<port> 만 받습니다")
    token = os.environ.get("DIRA_MCP_TOKEN")
    made = not token
    token = token or secrets.token_hex(32)
    srv = Server((host, int(port)), make_handler(token))
    ready = {"url": "http://127.0.0.1:%d/mcp" % srv.server_port, "port": srv.server_port}
    if made:
        ready["token"] = token
    print(json.dumps(ready), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--http":
        serve_http(sys.argv[2])
    elif len(sys.argv) == 1:
        serve_stdio()
    else:
        raise SystemExit(__doc__)
