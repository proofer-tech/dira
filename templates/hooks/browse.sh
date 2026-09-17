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
#   click <sel|@eN>           sel(또는 snapshot 참조)을 찾아 클릭한다(JS click())
#   fill <sel|@eN> <val>      sel(또는 참조)의 값을 val로 채우고 input/change를 쏜다
#   press <key>              키 하나를 누른다(Enter - Tab - Escape 등 - C 묶음 전에는 최소 표)
#   wait <sel|--load|--networkidle>  그 조건이 될 때까지 기다린다(상한 10초)
#   screenshot [path]        PNG를 그 경로에 쓴다. 생략하면 mktemp 경로에 쓰고 그 경로를 낸다
#   js <expr>                Runtime.evaluate로 표현식을 돌리고 값을 낸다
#   console [--clear]        지금까지 쌓인 콘솔 로그를 낸다. --clear면 비운다
#   release                  browser.sh release <해시>를 그대로 부른다
#
# B 묶음 - 셀렉터를 모르는 화면을 다루는 수단(결정 3):
#   snapshot [-i] [-s <sel>] [-d <N>]  접근성 트리를 역할 - 이름 - @e<n> 참조로 낸다.
#                            -i는 무시(ignored) 노드도 포함, -s는 그 서브트리로 좁힌다,
#                            -d는 깊이 상한이다. 참조 맵은 이 슬롯의 프로필 밑
#                            (/tmp/qa-<해시>/snapshot-refs.json)에 적어 release가 지운다.
#
# C 묶음 열아홉(있으면 편하고 없으면 A로 우회되는 것들 - §브라우저는 내장이 기본이다 결정 3):
#   back / forward           탐색 이력을 앞뒤로 옮긴다
#   reload                   지금 페이지를 새로고침한다
#   hover <sel|@eN>          sel(또는 참조) 위로 마우스를 옮긴다(실제 mouseMoved 이벤트)
#   select <sel> <val>       <select>의 값을 val로 고르고 change를 쏜다
#   scroll [sel]             sel이 있으면 그 요소로, 없으면 한 화면만큼 아래로 스크롤한다
#   type <text>              지금 포커스에 문자 하나씩 키 이벤트로 친다(fill과 달리 셀렉터가 없다)
#   viewport <WxH>           뷰포트 크기를 바꾼다
#   links                    문서의 <a href>를 "글자 -> href" 줄로 낸다
#   forms                    입력-버튼 요소를 태그-type-name-id 줄로 낸다
#   attrs <sel>              sel의 속성을 key=value 줄로 낸다
#   css <sel> <prop>         sel의 계산된 CSS 속성값을 낸다
#   is <prop> <sel>          visible/hidden/enabled/disabled/checked/editable/focused 판정 -
#                            참이면 종료코드 0, 거짓이면 1
#   network [--clear]        goto 뒤 fetch/XHR 왕복을 "메서드 상태 URL" 줄로 낸다. --clear면 비운다
#   dialog [--clear]         alert/confirm/prompt 호출 로그를 낸다. --clear면 비운다
#   dialog-accept [text]     다음 confirm/prompt를 승인으로 돌리게 한다(text는 prompt 반환값)
#   dialog-dismiss           다음 confirm/prompt를 거부로 돌리게 한다
#   cookies                  지금 쿠키를 "name=value; domain=..; path=.." 줄로 낸다
#   storage [set <k> <v>]    localStorage를 key=value 줄로 낸다. set이 있으면 그 키를 쓴다
#
# 셀렉터를 받는 C 묶음 명령(그리고 click - fill)은 전부 _resolve_sel() 한 곳을 거친다.
# `@e<n>` 참조(498ac41d B묶음)를 여기서 그 요소에 임시 data-dira-ref 속성을 달아 CSS
# 셀렉터로 바꾼다 - 참조가 없거나 페이지가 갈려 죽었으면 0이 아닌 종료 코드와 사유 한 줄로
# 끝난다. 참조 맵은 goto - back - forward - reload처럼 문서가 바뀌는 자리마다 지운다.
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
export DIRA_BROWSE_HASH="$_hash"
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

# network 버퍼도 같은 이유로 페이지에 심는다 - 명령마다 새 연결이라 CDP Network 이벤트를 계속
# 못 듣는다. fetch/XHR을 감싸 왕복을 전역 배열에 쌓아 두고 읽기만 한다.
# ponytail: fetch와 XMLHttpRequest만 잡는다 - <img> - <link> - <script> 태그가 직접 무는
# 리소스나 버퍼 설치 이전에 뜬 요청은 안 잡힌다. 진짜 전체가 필요해지면 Network.enable +
# 이벤트 리스너를 물고 있는 별도 프로세스로 옮긴다(지금 구조는 명령마다 연결이 끊긴다).
_NETWORK_INSTALL_JS = """
(function(){
  if (window.__diraNetwork) return 'ok';
  window.__diraNetwork = [];
  var push = function(method, url, status){
    window.__diraNetwork.push(method + ' ' + status + ' ' + url);
  };
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(input, init){
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      return origFetch.apply(this, arguments).then(function(resp){
        push(method, url, resp.status);
        return resp;
      }, function(err){
        push(method, url, 'ERR');
        throw err;
      });
    };
  }
  var OrigXHR = window.XMLHttpRequest;
  var origOpen = OrigXHR.prototype.open;
  OrigXHR.prototype.open = function(method, url){
    this.__diraMethod = method;
    this.__diraUrl = url;
    this.addEventListener('loadend', function(){
      push(this.__diraMethod, this.__diraUrl, this.status);
    });
    return origOpen.apply(this, arguments);
  };
  return 'ok';
})()
"""

# dialog도 같은 방식이다 - CDP Page.javascriptDialogOpening은 그 순간 붙어 있는 연결이 있어야
# 받는데, 이 구조는 명령마다 연결이 끊긴다. 대신 alert/confirm/prompt 자체를 감싸 로그를 쌓고,
# dialog-accept/dialog-dismiss가 다음 호출의 반환값을 미리 정해 둔다.
# ponytail: window.print()나 beforeunload 다이얼로그는 안 잡힌다 - alert/confirm/prompt 셋뿐이다.
_DIALOG_INSTALL_JS = """
(function(){
  if (window.__diraDialog) return 'ok';
  window.__diraDialog = [];
  window.__diraDialogMode = 'accept';
  window.__diraDialogText = '';
  window.alert = function(msg){ window.__diraDialog.push('alert: ' + msg); };
  window.confirm = function(msg){
    window.__diraDialog.push('confirm: ' + msg);
    return window.__diraDialogMode === 'accept';
  };
  window.prompt = function(msg, def){
    window.__diraDialog.push('prompt: ' + msg);
    return window.__diraDialogMode === 'accept' ? (window.__diraDialogText || def || '') : null;
  };
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

    def call(self, method, params=None, timeout=15, die_on_error=True):
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
                    if die_on_error:
                        die("%s: %s" % (method, msg["error"].get("message", msg["error"])))
                    return {"__error__": msg["error"]}
                return msg.get("result", {})
            # 다른 메시지(이벤트, 다른 id의 응답)는 버린다 - 명령당 새 연결이라 쌓일 일이 적다
        if die_on_error:
            die("%s 응답 시간초과" % method)
        return {"__error__": {"message": "시간초과"}}

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

    def ensure_network_buffer(self):
        self.eval_js(_NETWORK_INSTALL_JS)

    def ensure_dialog_buffer(self):
        self.eval_js(_DIALOG_INSTALL_JS)


def connect():
    target = find_page_target()
    return CDP(target["webSocketDebuggerUrl"])


def _install_buffers(cdp):
    cdp.call("Page.addScriptToEvaluateOnNewDocument", {"source": _CONSOLE_INSTALL_JS})
    cdp.call("Page.addScriptToEvaluateOnNewDocument", {"source": _NETWORK_INSTALL_JS})
    cdp.call("Page.addScriptToEvaluateOnNewDocument", {"source": _DIALOG_INSTALL_JS})


def _ensure_buffers(cdp):
    cdp.ensure_console_buffer()
    cdp.ensure_network_buffer()
    cdp.ensure_dialog_buffer()


# snapshot의 @e<n> 참조 맵 - 슬롯 프로필 밑(/tmp/qa-<해시>)에 산다. browser.sh release가
# 그 디렉터리 전체를 지우므로 여기서 따로 청소할 필요가 없다(워크트리 안에는 안 만든다).
def _profile_dir():
    h = os.environ.get("DIRA_BROWSE_HASH", "")
    if not h:
        die("내부 오류 - DIRA_BROWSE_HASH가 없다")
    return "/tmp/qa-%s" % h


def _refs_path():
    return os.path.join(_profile_dir(), "snapshot-refs.json")


def _load_refs():
    try:
        with open(_refs_path()) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_refs(refs):
    path = _refs_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(refs, f)
    os.replace(tmp, path)


def _clear_refs():
    try:
        os.remove(_refs_path())
    except OSError:
        pass


def call_on(cdp, object_id, func_decl, arg_values=None):
    args = [{"value": v} for v in (arg_values or [])]
    result = cdp.call(
        "Runtime.callFunctionOn",
        {
            "objectId": object_id,
            "functionDeclaration": func_decl,
            "arguments": args,
            "returnByValue": True,
        },
    )
    if result.get("exceptionDetails"):
        ex = result["exceptionDetails"]
        die("js 오류 - " + json.dumps(ex.get("text", ex), ensure_ascii=False))
    return result.get("result", {}).get("value")


def _resolve_ref_object_id(cdp, n):
    refs = _load_refs()
    entry = refs.get(n)
    if entry is None:
        die("참조를 모른다 - @e" + n + " (snapshot을 먼저 부른다, 또는 페이지가 바뀌었다)")
    result = cdp.call(
        "DOM.resolveNode", {"backendNodeId": entry["backendNodeId"]}, die_on_error=False
    )
    obj_id = result.get("object", {}).get("objectId") if "__error__" not in result else None
    if not obj_id:
        die("참조가 오래됐다(페이지가 바뀌었다) - @e" + n)
    return obj_id


def _resolve_selector_backend_id(cdp, sel):
    expr = "document.querySelector(%s)" % json.dumps(sel)
    result = cdp.call("Runtime.evaluate", {"expression": expr, "returnByValue": False})
    if result.get("exceptionDetails") or "objectId" not in result.get("result", {}):
        return None
    node = cdp.call("DOM.describeNode", {"objectId": result["result"]["objectId"]})
    return node.get("node", {}).get("backendNodeId")


# 셀렉터를 받는 명령(click - fill - C 묶음 전부)이 거치는 단일 진입점. @e<n>이면 그 요소에
# 임시 data-dira-ref 속성을 달아 CSS 셀렉터로 바꿔 돌려준다 - 아니면 그대로 돌려준다.
# ponytail: 속성이 지워지지 않고 남는다. attrs가 그 한 줄을 더 보여줄 뿐 동작에는 해가
# 없다 - 신경 쓰이면 release가 프로필째로 지운다(페이지 자체가 죽으므로).
def _resolve_sel(cdp, sel):
    m = re.match(r"^@e(\d+)$", sel)
    if not m:
        return sel
    n = m.group(1)
    obj_id = _resolve_ref_object_id(cdp, n)
    marker = "e" + n
    call_on(
        cdp,
        obj_id,
        "function(m){ this.setAttribute('data-dira-ref', m); return 'OK'; }",
        [marker],
    )
    return '[data-dira-ref="%s"]' % marker


def cmd_goto(cdp, args):
    if not args:
        die("goto <url>가 필요하다")
    url = args[0]
    # 다음 문서에도 버퍼들이 심기도록 addScriptToEvaluateOnNewDocument로 등록해 둔다.
    _install_buffers(cdp)
    cdp.call("Page.navigate", {"url": url})
    _poll_ready(cdp, timeout=15)
    _ensure_buffers(cdp)
    # 새 문서로 넘어가면 옛 @e 참조는 무효다 - 맵을 지워 확실히 실패하게 한다(backendNodeId
    # 자체도 새 문서에서 무효가 되므로 이중 안전망이다).
    _clear_refs()


def _history_nav(cdp, delta):
    hist = cdp.call("Page.getNavigationHistory")
    idx = hist.get("currentIndex", 0)
    entries = hist.get("entries", [])
    target_idx = idx + delta
    if target_idx < 0 or target_idx >= len(entries):
        die("이동할 이력이 없다")
    cdp.call("Page.navigateToHistoryEntry", {"entryId": entries[target_idx]["id"]})
    _poll_ready(cdp, timeout=15)
    _ensure_buffers(cdp)
    _clear_refs()


def cmd_back(cdp, args):
    _history_nav(cdp, -1)


def cmd_forward(cdp, args):
    _history_nav(cdp, 1)


def cmd_reload(cdp, args):
    cdp.call("Page.reload", {})
    _poll_ready(cdp, timeout=15)
    _ensure_buffers(cdp)
    _clear_refs()


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
        die("click <sel|@eN>이 필요하다")
    sel = json.dumps(_resolve_sel(cdp, args[0]))
    expr = (
        "(function(){var e=document.querySelector(%s); "
        "if(!e) return 'NOTFOUND'; e.click(); return 'OK';})()" % sel
    )
    result = cdp.eval_js(expr)
    if result == "NOTFOUND":
        die("click - 셀렉터를 못 찾았다 - " + args[0])


def cmd_fill(cdp, args):
    if len(args) < 2:
        die("fill <sel|@eN> <val>이 필요하다")
    sel, val = json.dumps(_resolve_sel(cdp, args[0])), json.dumps(args[1])
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


# ponytail: 접근성 트리를 얕게 담는다 - AXNode.role/name만 읽고 CSS 겉모습 속성은 안 본다.
# 노드마다 @e<n>을 매겨 backendNodeId를 참조 맵에 저장한다 - _resolve_sel이 그 맵으로
# 되짚어 DOM.resolveNode -> objectId를 얻는다.
def cmd_snapshot(cdp, args):
    include_ignored = False
    scope_sel = None
    max_depth = None
    i = 0
    while i < len(args):
        a = args[i]
        if a == "-i":
            include_ignored = True
        elif a == "-s":
            i += 1
            if i >= len(args):
                die("snapshot -s는 셀렉터가 필요하다")
            scope_sel = args[i]
        elif a == "-d":
            i += 1
            if i >= len(args):
                die("snapshot -d는 정수가 필요하다")
            try:
                max_depth = int(args[i])
            except ValueError:
                die("snapshot -d 값이 정수가 아니다 - " + args[i])
        else:
            die("snapshot - 모르는 인자 - " + a)
        i += 1

    if scope_sel:
        backend_id = _resolve_selector_backend_id(cdp, scope_sel)
        if backend_id is None:
            die("snapshot -s - 셀렉터를 못 찾았다 - " + scope_sel)
    else:
        # queryAXTree는 root를 반드시 받는다(빈 params로는 "no node" 오류) - 문서 루트를 쓴다.
        doc = cdp.call("DOM.getDocument", {"depth": 0})
        backend_id = doc.get("root", {}).get("backendNodeId")
        if backend_id is None:
            die("snapshot - 문서 루트를 못 얻었다")
    params = {"backendNodeId": backend_id}

    cdp.call("Accessibility.enable", {})
    result = cdp.call("Accessibility.queryAXTree", params)
    cdp.call("Accessibility.disable", {})
    nodes = result.get("nodes", [])

    by_id = {n["nodeId"]: n for n in nodes}
    child_ref = set()
    for n in nodes:
        child_ref.update(n.get("childIds", []))
    roots = [n for n in nodes if n["nodeId"] not in child_ref]

    refs = {}
    lines = []
    counter = [0]

    def visit(node, depth):
        if max_depth is not None and depth > max_depth:
            return
        if node.get("ignored", False) and not include_ignored:
            for cid in node.get("childIds", []):
                child = by_id.get(cid)
                if child is not None:
                    visit(child, depth)
            return
        role = (node.get("role") or {}).get("value") or "generic"
        name = (node.get("name") or {}).get("value") or ""
        backend_id = node.get("backendDOMNodeId")
        counter[0] += 1
        n_idx = counter[0]
        if backend_id is not None:
            refs[str(n_idx)] = {"backendNodeId": backend_id}
        indent = "  " * depth
        if name:
            lines.append('%s%s "%s" @e%d' % (indent, role, name, n_idx))
        else:
            lines.append("%s%s @e%d" % (indent, role, n_idx))
        for cid in node.get("childIds", []):
            child = by_id.get(cid)
            if child is not None:
                visit(child, depth + 1)

    for r in roots:
        visit(r, 0)

    _save_refs(refs)
    print("\n".join(lines))


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


def cmd_hover(cdp, args):
    if not args:
        die("hover <sel|@eN>가 필요하다")
    sel = json.dumps(_resolve_sel(cdp, args[0]))
    rect = cdp.eval_js(
        "(function(){var e=document.querySelector(%s); if(!e) return null; "
        "var r=e.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2};})()"
        % sel
    )
    if rect is None:
        die("hover - 셀렉터를 못 찾았다 - " + args[0])
    cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": rect["x"], "y": rect["y"]})


def cmd_select(cdp, args):
    if len(args) < 2:
        die("select <sel> <val>이 필요하다")
    sel, val = json.dumps(_resolve_sel(cdp, args[0])), json.dumps(args[1])
    expr = (
        "(function(){var e=document.querySelector(%s); if(!e) return 'NOTFOUND'; "
        "e.value=%s; e.dispatchEvent(new Event('input',{bubbles:true})); "
        "e.dispatchEvent(new Event('change',{bubbles:true})); return 'OK';})()" % (sel, val)
    )
    result = cdp.eval_js(expr)
    if result == "NOTFOUND":
        die("select - 셀렉터를 못 찾았다 - " + args[0])


def cmd_scroll(cdp, args):
    if args:
        sel = json.dumps(_resolve_sel(cdp, args[0]))
        expr = (
            "(function(){var e=document.querySelector(%s); if(!e) return 'NOTFOUND'; "
            "e.scrollIntoView({block:'center'}); return 'OK';})()" % sel
        )
        result = cdp.eval_js(expr)
        if result == "NOTFOUND":
            die("scroll - 셀렉터를 못 찾았다 - " + args[0])
    else:
        cdp.eval_js("window.scrollBy(0, window.innerHeight); 'OK'")


def cmd_type(cdp, args):
    # press와 달리 셀렉터가 없다 - 지금 포커스에 문자 하나씩 진짜 키 이벤트로 친다(fill의
    # 값 대입과 달리 keydown을 듣는 React 등 컨트롤드 인풋에도 먹힌다).
    if not args:
        die("type <text>가 필요하다")
    for ch in args[0]:
        base = {"key": ch, "text": ch}
        cdp.call("Input.dispatchKeyEvent", dict(base, type="rawKeyDown"))
        cdp.call("Input.dispatchKeyEvent", dict(base, type="char"))
        cdp.call("Input.dispatchKeyEvent", dict(base, type="keyUp"))


def cmd_viewport(cdp, args):
    if not args:
        die("viewport <WxH>가 필요하다")
    m = re.match(r"^(\d+)x(\d+)$", args[0])
    if not m:
        die("viewport - WxH 형식이 아니다 - " + args[0])
    w, h = int(m.group(1)), int(m.group(2))
    cdp.call(
        "Emulation.setDeviceMetricsOverride",
        {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False},
    )


def cmd_links(cdp, args):
    items = cdp.eval_js(
        "Array.prototype.map.call(document.querySelectorAll('a[href]'), function(a){"
        "return (a.textContent||'').trim().replace(/\\s+/g,' ') + ' -> ' + a.href;})"
    ) or []
    for line in items:
        print(line)


def cmd_forms(cdp, args):
    items = cdp.eval_js(
        "Array.prototype.map.call(document.querySelectorAll('input,select,textarea,button'), "
        "function(e){return e.tagName.toLowerCase()+' type='+(e.type||'')+' name='+(e.name||'')"
        "+' id='+(e.id||'');})"
    ) or []
    for line in items:
        print(line)


def cmd_attrs(cdp, args):
    if not args:
        die("attrs <sel>이 필요하다")
    sel = json.dumps(_resolve_sel(cdp, args[0]))
    result = cdp.eval_js(
        "(function(){var e=document.querySelector(%s); if(!e) return null; var o={}; "
        "for (var i=0;i<e.attributes.length;i++){var a=e.attributes[i]; o[a.name]=a.value;} "
        "return o;})()" % sel
    )
    if result is None:
        die("attrs - 셀렉터를 못 찾았다 - " + args[0])
    for k, v in result.items():
        print("%s=%s" % (k, v))


def cmd_css(cdp, args):
    if len(args) < 2:
        die("css <sel> <prop>가 필요하다")
    sel, prop = json.dumps(_resolve_sel(cdp, args[0])), json.dumps(args[1])
    result = cdp.eval_js(
        "(function(){var e=document.querySelector(%s); if(!e) return null; "
        "return getComputedStyle(e).getPropertyValue(%s);})()" % (sel, prop)
    )
    if result is None:
        die("css - 셀렉터를 못 찾았다 - " + args[0])
    print(result)


_IS_PROPS = {
    "visible": (
        "!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length) && "
        "getComputedStyle(e).visibility!=='hidden'"
    ),
    "hidden": (
        "!(!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length) && "
        "getComputedStyle(e).visibility!=='hidden')"
    ),
    "enabled": "!e.disabled",
    "disabled": "!!e.disabled",
    "checked": "!!e.checked",
    "editable": "!e.disabled && !e.readOnly",
    "focused": "document.activeElement === e",
}


def cmd_is(cdp, args):
    if len(args) < 2:
        die("is <prop> <sel>이 필요하다")
    prop, sel = args[0], args[1]
    if prop not in _IS_PROPS:
        die("is - 모르는 판정 - " + prop)
    sel_json = json.dumps(_resolve_sel(cdp, sel))
    expr = "(function(){var e=document.querySelector(%s); if(!e) return null; return %s;})()" % (
        sel_json,
        _IS_PROPS[prop],
    )
    result = cdp.eval_js(expr)
    if result is None:
        die("is - 셀렉터를 못 찾았다 - " + sel)
    print("true" if result else "false")
    sys.exit(0 if result else 1)


def cmd_network(cdp, args):
    clear = "--clear" in args
    cdp.ensure_network_buffer()
    lines = cdp.eval_js("window.__diraNetwork || []") or []
    for line in lines:
        print(line)
    if clear:
        cdp.eval_js("window.__diraNetwork = []")


def cmd_dialog(cdp, args):
    clear = "--clear" in args
    cdp.ensure_dialog_buffer()
    lines = cdp.eval_js("window.__diraDialog || []") or []
    for line in lines:
        print(line)
    if clear:
        cdp.eval_js("window.__diraDialog = []")


def cmd_dialog_accept(cdp, args):
    cdp.ensure_dialog_buffer()
    text = args[0] if args else ""
    cdp.eval_js(
        "window.__diraDialogMode='accept'; window.__diraDialogText=%s;" % json.dumps(text)
    )


def cmd_dialog_dismiss(cdp, args):
    cdp.ensure_dialog_buffer()
    cdp.eval_js("window.__diraDialogMode='dismiss';")


def cmd_cookies(cdp, args):
    result = cdp.call("Network.getCookies", {})
    for c in result.get("cookies", []):
        print(
            "%s=%s; domain=%s; path=%s"
            % (c.get("name"), c.get("value"), c.get("domain"), c.get("path"))
        )


def cmd_storage(cdp, args):
    if args and args[0] == "set":
        if len(args) < 3:
            die("storage set <k> <v>가 필요하다")
        k, v = json.dumps(args[1]), json.dumps(args[2])
        cdp.eval_js("localStorage.setItem(%s, %s)" % (k, v))
        return
    items = cdp.eval_js(
        "(function(){var o={}; for (var i=0;i<localStorage.length;i++){"
        "var k=localStorage.key(i); o[k]=localStorage.getItem(k);} return o;})()"
    ) or {}
    for k, v in items.items():
        print("%s=%s" % (k, v))


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
    "snapshot": cmd_snapshot,
    "back": cmd_back,
    "forward": cmd_forward,
    "reload": cmd_reload,
    "hover": cmd_hover,
    "select": cmd_select,
    "scroll": cmd_scroll,
    "type": cmd_type,
    "viewport": cmd_viewport,
    "links": cmd_links,
    "forms": cmd_forms,
    "attrs": cmd_attrs,
    "css": cmd_css,
    "is": cmd_is,
    "network": cmd_network,
    "dialog": cmd_dialog,
    "dialog-accept": cmd_dialog_accept,
    "dialog-dismiss": cmd_dialog_dismiss,
    "cookies": cmd_cookies,
    "storage": cmd_storage,
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
