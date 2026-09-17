#!/bin/bash
# browse.sh - browse(gstack)의 명령 표면을 이식한 CDP 클라이언트.
# DESIGN.md §브라우저는 내장이 기본이다 결정 3 (요구 b62588c9, 답 3186dfa7) - A 묶음 열둘.
#
# 정본은 여기(templates/hooks/browse.sh)다. .dira는 gitignore라 추적이 안 되므로 큐마다
# .dira/browse.sh로 복사해 쓴다(browser.sh - push.sh - cold-boot.sh와 같은 자리).
#
# 안에서 <큐 루트>/browser.sh acquire <해시>를 불러 풀 슬롯 포트를 쥔다 - 슬롯을 새로
# 만들지 않는다(§CDP 결정 1의 접미사 규칙이 그대로 적용된다). CDP 웹소켓 핸드셰이크와
# 프레이밍은 python3 표준 라이브러리(socket - struct - urllib)로 직접 문다 - 의존성 0.
#
# 호출 모양: bash .dira/browse.sh <해시> <명령> [인자...]
#
# A 묶음 열둘:
#   goto <url>              url로 이동하고 완전히 뜰 때까지 기다린다
#   url                      지금 주소를 낸다
#   text                     document.body.innerText를 낸다
#   html [sel]               sel의 outerHTML, 없으면 문서 전체
#   click <sel>               sel을 찾아 클릭한다(JS click() - 실제 마우스 이벤트는 C 묶음)
#   fill <sel> <val>          sel의 값을 val로 채우고 input/change를 쏜다
#   press <key>              키 하나를 누른다(Enter - Tab - Escape 등 - C 묶음 전에는 최소 표)
#   wait <sel|--load|--networkidle>  그 조건이 될 때까지 기다린다(상한 10초)
#   screenshot [path]        PNG를 그 경로에 쓴다. 생략하면 mktemp 경로에 쓰고 그 경로를 낸다
#   js <expr>                Runtime.evaluate로 표현식을 돌리고 값을 낸다
#   console [--clear]        지금까지 쌓인 콘솔 로그를 낸다. --clear면 비운다
#   release                  browser.sh release <해시>를 그대로 부른다
set -u

_root="$(cd "$(dirname "$0")" && pwd -P)"

_hash="${1:-}"
_cmd="${2:-}"
if [ -z "$_hash" ] || [ -z "$_cmd" ]; then
  echo "browse.sh: 사용법 - browse.sh <해시> <명령> [인자...]" >&2
  exit 2
fi
shift 2

if [ "$_cmd" = release ]; then
  exec bash "$_root/browser.sh" release "$_hash"
fi

_port="$(bash "$_root/browser.sh" acquire "$_hash")" || exit $?
if [ -z "$_port" ]; then
  echo "browse.sh: browser.sh acquire가 포트를 안 냈다 - $_hash" >&2
  exit 1
fi

export DIRA_BROWSE_PORT="$_port"
exec python3 - "$_cmd" "$@" <<'PYEOF'
import base64
import json
import os
import re
import socket
import struct
import sys
import tempfile
import time

PORT = int(os.environ["DIRA_BROWSE_PORT"])

# 콘솔 버퍼는 페이지에 주입한 전역 배열이다(실제 CDP Log/Runtime 이벤트를 계속 듣는 대신
# 이 방식을 골랐다) - 명령마다 새 프로세스가 새 웹소켓으로 붙었다 끊기므로, 연결이 끊긴 사이에
# 일어난 이벤트는 연결로는 못 받는다. 페이지 쪽에 로그를 쌓아 두면 다음 명령이 그 배열을 읽기만
# 하면 되므로 연결을 계속 물고 있을 필요가 없다.
# ponytail: console.log/warn/error/info/debug와 window.onerror만 잡는다. Log 도메인의
# 브라우저 자체 경고(예: CORS)는 안 잡힌다 - 필요해지면 Log.enable + 이벤트 리스너로 옮긴다.
_CONSOLE_INSTALL_JS = """
(function(){
  if (window.__diraConsole) return 'ok';
  window.__diraConsole = [];
  ['log','warn','error','info','debug'].forEach(function(m){
    var orig = console[m];
    console[m] = function(){
      try {
        var parts = Array.prototype.slice.call(arguments).map(function(a){
          try { return typeof a === 'string' ? a : JSON.stringify(a); }
          catch (e) { return String(a); }
        });
        window.__diraConsole.push(m + ': ' + parts.join(' '));
      } catch (e) {}
      return orig.apply(console, arguments);
    };
  });
  window.addEventListener('error', function(e){
    window.__diraConsole.push('error: ' + e.message);
  });
  return 'ok';
})()
"""

# press가 받는 특수키 최소 표 - 문자 하나짜리 키(예: "a")는 표에 없어도 char 이벤트로 보낸다.
# ponytail: 자주 쓰는 것만 담았다. 빠진 키가 나오면 여기 한 줄 추가한다.
_KEYMAP = {
    "Enter": (13, "Enter"),
    "Tab": (9, "Tab"),
    "Escape": (27, "Escape"),
    "Backspace": (8, "Backspace"),
    "Delete": (46, "Delete"),
    "ArrowUp": (38, "ArrowUp"),
    "ArrowDown": (40, "ArrowDown"),
    "ArrowLeft": (37, "ArrowLeft"),
    "ArrowRight": (39, "ArrowRight"),
    "Space": (32, " "),
}


def die(msg):
    sys.stderr.write("browse.sh: " + msg + "\n")
    sys.exit(1)


def http_get_json(path):
    import urllib.request

    url = "http://127.0.0.1:%d%s" % (PORT, path)
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read().decode())


def find_page_target():
    targets = http_get_json("/json/list")
    for t in targets:
        if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
            return t
    return http_get_json("/json/new")


class CDP:
    """CDP 웹소켓 클라이언트 - RFC 6455 핸드셰이크와 프레이밍을 표준 라이브러리로 직접 문다."""

    def __init__(self, ws_url):
        m = re.match(r"ws://([^:/]+):(\d+)(/.*)", ws_url)
        if not m:
            die("웹소켓 URL을 못 읽는다 - " + ws_url)
        host, port, path = m.group(1), int(m.group(2)), m.group(3)
        self.sock = socket.create_connection((host, port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            "GET %s HTTP/1.1\r\n"
            "Host: %s:%d\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ) % (path, host, port, key)
        self.sock.sendall(req.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                die("웹소켓 핸드셰이크가 연결을 끊었다")
            resp += chunk
        status_line = resp.split(b"\r\n", 1)[0]
        if b"101" not in status_line:
            die("웹소켓 핸드셰이크 실패 - " + status_line.decode(errors="replace"))
        self._buf = resp.split(b"\r\n\r\n", 1)[1]
        self._id = 0

    def _recv_exact(self, n):
        while len(self._buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                die("웹소켓 연결이 끊겼다")
            self._buf += chunk
        data, self._buf = self._buf[:n], self._buf[n:]
        return data

    def _send_frame(self, payload, opcode=0x1):
        header = bytearray()
        header.append(0x80 | opcode)
        length = len(payload)
        if length <= 125:
            header.append(0x80 | length)
        elif length <= 0xFFFF:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        mask = os.urandom(4)
        header += mask
        masked = bytearray(payload)
        for i in range(len(masked)):
            masked[i] ^= mask[i % 4]
        self.sock.sendall(bytes(header) + bytes(masked))

    def _recv_frame(self):
        b0, b1 = self._recv_exact(2)
        opcode = b0 & 0x0F
        masked = b1 & 0x80
        length = b1 & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else None
        payload = self._recv_exact(length)
        if mask:
            payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        return opcode, payload

    def call(self, method, params=None, timeout=15):
        self._id += 1
        mid = self._id
        self._send_frame(
            json.dumps({"id": mid, "method": method, "params": params or {}}).encode()
        )
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.sock.settimeout(max(0.05, deadline - time.time()))
            try:
                opcode, payload = self._recv_frame()
            except socket.timeout:
                break
            if opcode == 0x9:  # ping -> pong
                self._send_frame(payload, opcode=0xA)
                continue
            if opcode == 0x8:  # close
                die("브라우저가 웹소켓을 닫았다")
            msg = json.loads(payload.decode())
            if msg.get("id") == mid:
                if "error" in msg:
                    die("%s: %s" % (method, msg["error"].get("message", msg["error"])))
                return msg.get("result", {})
            # 다른 메시지(이벤트, 다른 id의 응답)는 버린다 - 명령당 새 연결이라 쌓일 일이 적다
        die("%s 응답 시간초과" % method)

    def eval_js(self, expr, timeout=15):
        result = self.call(
            "Runtime.evaluate",
            {"expression": expr, "returnByValue": True, "awaitPromise": True},
            timeout=timeout,
        )
        if result.get("exceptionDetails"):
            ex = result["exceptionDetails"]
            die("js 오류 - " + json.dumps(ex.get("text", ex), ensure_ascii=False))
        return result.get("result", {}).get("value")

    def ensure_console_buffer(self):
        self.eval_js(_CONSOLE_INSTALL_JS)


def connect():
    target = find_page_target()
    return CDP(target["webSocketDebuggerUrl"])


def cmd_goto(cdp, args):
    if not args:
        die("goto <url>가 필요하다")
    url = args[0]
    # 다음 문서에도 콘솔 버퍼가 심기도록 addScriptToEvaluateOnNewDocument로 등록해 둔다.
    cdp.call("Page.addScriptToEvaluateOnNewDocument", {"source": _CONSOLE_INSTALL_JS})
    cdp.call("Page.navigate", {"url": url})
    _poll_ready(cdp, timeout=15)
    cdp.ensure_console_buffer()


def _poll_ready(cdp, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            state = cdp.eval_js("document.readyState")
        except SystemExit:
            raise
        if state == "complete":
            return
        time.sleep(0.2)


def cmd_url(cdp, args):
    print(cdp.eval_js("location.href") or "")


def cmd_text(cdp, args):
    cdp.ensure_console_buffer()
    print(cdp.eval_js("document.body ? document.body.innerText : ''") or "")


def cmd_html(cdp, args):
    if args:
        sel = json.dumps(args[0])
        expr = "(function(){var e=document.querySelector(%s); return e?e.outerHTML:'';})()" % sel
    else:
        expr = "document.documentElement.outerHTML"
    print(cdp.eval_js(expr) or "")


def cmd_click(cdp, args):
    if not args:
        die("click <sel>이 필요하다")
    sel = json.dumps(args[0])
    expr = (
        "(function(){var e=document.querySelector(%s); "
        "if(!e) return 'NOTFOUND'; e.click(); return 'OK';})()" % sel
    )
    result = cdp.eval_js(expr)
    if result == "NOTFOUND":
        die("click - 셀렉터를 못 찾았다 - " + args[0])


def cmd_fill(cdp, args):
    if len(args) < 2:
        die("fill <sel> <val>이 필요하다")
    sel, val = json.dumps(args[0]), json.dumps(args[1])
    expr = (
        "(function(){var e=document.querySelector(%s); if(!e) return 'NOTFOUND'; "
        "e.focus(); e.value=%s; "
        "e.dispatchEvent(new Event('input',{bubbles:true})); "
        "e.dispatchEvent(new Event('change',{bubbles:true})); return 'OK';})()"
        % (sel, val)
    )
    result = cdp.eval_js(expr)
    if result == "NOTFOUND":
        die("fill - 셀렉터를 못 찾았다 - " + args[0])


def cmd_press(cdp, args):
    if not args:
        die("press <key>가 필요하다")
    key = args[0]
    if key in _KEYMAP:
        code, name = _KEYMAP[key]
        base = {"key": name, "windowsVirtualKeyCode": code, "nativeVirtualKeyCode": code}
    elif len(key) == 1:
        base = {"key": key, "text": key}
    else:
        base = {"key": key}
    cdp.call("Input.dispatchKeyEvent", dict(base, type="rawKeyDown"))
    if "text" in base:
        cdp.call("Input.dispatchKeyEvent", dict(base, type="char"))
    cdp.call("Input.dispatchKeyEvent", dict(base, type="keyUp"))


def cmd_wait(cdp, args):
    if not args:
        die("wait <sel|--load|--networkidle>가 필요하다")
    target = args[0]
    timeout = 10
    deadline = time.time() + timeout
    if target == "--load":
        _poll_ready(cdp, timeout=timeout)
        return
    if target == "--networkidle":
        # ponytail: 진짜 네트워크 이벤트를 안 듣는다. readyState complete 뒤 0.5초를
        # 조용히 흘려보내는 것으로 근사한다 - 오래 걸리는 폴링 요청이 있으면 틀릴 수 있다.
        # 진짜 판정이 필요해지면 Network.enable + 요청 카운트로 옮긴다.
        _poll_ready(cdp, timeout=timeout)
        time.sleep(0.5)
        return
    sel = json.dumps(target)
    expr = "!!document.querySelector(%s)" % sel
    while time.time() < deadline:
        if cdp.eval_js(expr):
            return
        time.sleep(0.2)
    die("wait - 시간초과 - " + target)


def cmd_screenshot(cdp, args):
    path = args[0] if args else tempfile.mkstemp(prefix="browse-", suffix=".png")[1]
    result = cdp.call("Page.captureScreenshot", {"format": "png"})
    data = base64.b64decode(result["data"])
    with open(path, "wb") as f:
        f.write(data)
    print(path)


def cmd_js(cdp, args):
    if not args:
        die("js <expr>가 필요하다")
    value = cdp.eval_js(args[0])
    if isinstance(value, str):
        print(value)
    elif value is None:
        print("")
    else:
        print(json.dumps(value, ensure_ascii=False))


def cmd_console(cdp, args):
    clear = "--clear" in args
    cdp.ensure_console_buffer()
    lines = cdp.eval_js("window.__diraConsole || []") or []
    for line in lines:
        print(line)
    if clear:
        cdp.eval_js("window.__diraConsole = []")


_COMMANDS = {
    "goto": cmd_goto,
    "url": cmd_url,
    "text": cmd_text,
    "html": cmd_html,
    "click": cmd_click,
    "fill": cmd_fill,
    "press": cmd_press,
    "wait": cmd_wait,
    "screenshot": cmd_screenshot,
    "js": cmd_js,
    "console": cmd_console,
}


def main():
    argv = sys.argv[1:]
    if not argv:
        die("명령이 없다")
    cmd, args = argv[0], argv[1:]
    handler = _COMMANDS.get(cmd)
    if handler is None:
        die("모르는 명령 - " + cmd)
    cdp = connect()
    handler(cdp, args)


main()
PYEOF
