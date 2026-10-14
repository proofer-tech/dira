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
import socketserver
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import mcp_tools

PROTOCOL = "2025-06-18"
MAX_BODY = 8 * 1024 * 1024


def reply(i, result=None, error=None):
    m = {"jsonrpc": "2.0", "id": i}
    if error:
        m["error"] = error
    else:
        m["result"] = result
    return m


def handle(msg):
    """JSON-RPC 메시지 하나 -> 응답 dict 또는 None(알림)."""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
        return reply(None, error={"code": -32600, "message": "Invalid Request"})
    method, i, p = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if "id" not in msg:
        return None
    if method == "initialize":
        return reply(i, {"protocolVersion": PROTOCOL, "capabilities": {"tools": {}},
                         "serverInfo": {"name": "dira-engine", "version": "1"}})
    if method == "ping":
        return reply(i, {})
    if method == "tools/list":
        return reply(i, {"tools": mcp_tools.list_tools()})
    if method == "tools/call":
        try:
            out = mcp_tools.call_tool(p.get("name"), p.get("arguments"))
            err = False
        except mcp_tools.ToolError as e:
            out, err = {"error": str(e)}, True
        except Exception as e:  # 도구 하나의 실패가 서버를 죽이지 않는다
            out, err = {"error": "%s: %s" % (type(e).__name__, e)}, True
        return reply(i, {"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}],
                         "isError": err})
    return reply(i, error={"code": -32601, "message": "Method not found: %s" % method})


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
    for line in sys.stdin:
        if line.strip():
            r = handle_text(line)
            if r is not None:
                sys.stdout.write(json.dumps(r, ensure_ascii=False) + "\n")
                sys.stdout.flush()


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
            r = handle_text(self.rfile.read(n).decode("utf-8", "replace"))
            if r is None:
                return self.send(202)
            self.send(200, json.dumps(r, ensure_ascii=False).encode())

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
