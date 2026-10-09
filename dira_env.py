#!/usr/bin/env python3
"""`dira env` - 프로젝트 환경변수를 세션에서 관리하고 자식 프로세스에서 쓴다 (요구 04daa929).

    dira env list
    dira env create NAME --stdin
    dira env replace NAME --revision REV --stdin
    dira env delete NAME --revision REV
    dira env run --keys NAME1,NAME2 -- COMMAND ARGS...

값은 stdin에서만 받고 인자나 출력으로 다루지 않는다. 앱 없는 엔진 사용자에게 Node를 요구하지
않도록 python3 표준 라이브러리만 쓴다. 저장과 복호화는 데스크톱 앱(브리지)이 하고 이 파일은
클라이언트다.

## 브리지 연결 계약 (정본 구현: apps/desktop/env-bridge.ts, env-connect.ts)

연결 파일: `$TICKET_LOCAL/env-bridge/<프로젝트 키>.json` (TICKET_LOCAL 기본 `~/.config/dira`),
0600, `{"port": 정수, "token": "문자열"}`. 데스크톱 앱이 떠 있는 동안 등록된 프로젝트마다 두고
닫으면 지운다. 프로젝트 키는 티켓 루트(realpath, NFC)의 UTF-8 sha256 앞 32자리 16진수이고,
토큰은 그 프로젝트 하나에 묶인 파생값이다(secret은 파일에 없다). 티켓 루트는 `$TICKET_ROOT`,
없으면 cwd에서 위로 올라가며 찾은 `.dira`다(워크트리의 `.dira`는 큐 심링크라 같은 키로 모인다).

요청: `http://127.0.0.1:<port>/env/v1/<op>`, `Authorization: Bearer <token>`.
    GET  list?project=<루트>                                  -> {"items":[{name,updatedAt,revision}]}
    POST create   {"project","name","value"}                  -> {name,updatedAt,revision}
    POST replace  {"project","name","value","expectedRevision"} -> 같은 모양
    POST delete   {"project","name","expectedRevision"}       -> 같은 모양
    POST resolve  {"project","names":[...]}  (run 전용)        -> {"values":{NAME:value}}
실패: HTTP 4xx/5xx + {"error":<코드>}. 값은 응답과 오류에 없다. resolve는 전부 있을 때만 값을 준다.
"""
import hashlib
import http.client
import json
import os
import re
import selectors
import shlex
import signal
import subprocess
import sys
import unicodedata
import urllib.parse

NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
RESERVED_EXACT = {"PATH", "HOME", "SHELL", "ENV", "BASH_ENV", "NODE_OPTIONS", "PYTHONPATH"}
RESERVED_PREFIX = ("LD_", "DYLD_", "TICKET_", "DIRA_")
MAX_VALUE = 64 * 1024
MASK = b"***"

# 종료 코드. 자식의 코드와 겹칠 수 있으나 우리 오류는 항상 stderr에 `dira env:`로 시작한다.
EX_USAGE, EX_DATA, EX_NOTFOUND, EX_UNAVAILABLE, EX_CONFLICT, EX_NOPERM = 64, 65, 66, 69, 75, 77
CODE_EXIT = {
    "invalid_name": EX_DATA, "reserved_name": EX_DATA, "invalid_value": EX_DATA, "too_large": EX_DATA,
    "duplicate": EX_CONFLICT, "conflict": EX_CONFLICT, "not_found": EX_NOTFOUND,
    "unauthorized": EX_NOPERM, "forbidden": EX_NOPERM, "bad_project": EX_NOPERM,
    "locked": EX_UNAVAILABLE, "corrupt": EX_UNAVAILABLE, "unavailable": EX_UNAVAILABLE,
}


class Fail(Exception):
    def __init__(self, msg, code=1):
        super().__init__(msg)
        self.code = code


def is_reserved(name):
    return name in RESERVED_EXACT or name.startswith(RESERVED_PREFIX)


def check_name(name):
    if not NAME_RE.match(name):
        raise Fail("이름은 [A-Za-z_][A-Za-z0-9_]* 이어야 합니다", EX_DATA)
    if is_reserved(name):
        raise Fail("실행 제어값으로 예약된 이름입니다: " + name, EX_DATA)


def project_root():
    """프로젝트 키와 요청의 project 값이 되는 정규화한 티켓 루트."""
    root = os.environ.get("TICKET_ROOT")
    if not root:
        d = os.getcwd()
        while True:
            if os.path.isdir(os.path.join(d, ".dira")):
                root = os.path.join(d, ".dira")
                break
            if os.path.dirname(d) == d:
                raise Fail("티켓 루트를 찾지 못했습니다 (TICKET_ROOT 또는 .dira)", EX_USAGE)
            d = os.path.dirname(d)
    return unicodedata.normalize("NFC", os.path.realpath(root))


def connection():
    local = os.environ.get("TICKET_LOCAL") or os.path.expanduser("~/.config/dira")
    h = hashlib.sha256(project_root().encode("utf-8")).hexdigest()[:32]
    try:
        with open(os.path.join(local, "env-bridge", h + ".json"), encoding="utf-8") as f:
            c = json.load(f)
        return int(c["port"]), str(c["token"])
    except (OSError, ValueError, KeyError, TypeError):
        raise Fail("unavailable: 데스크톱 앱이 실행 중이어야 합니다 (연결 정보가 없습니다)", EX_UNAVAILABLE)


def call(op, body=None, scrub=(), timeout=15):
    """브리지 호출. 오류는 코드만 받으므로 값이 새지 않지만 메시지에서 우리가 쥔 값은 한 번 더 가린다."""
    port, token = connection()
    root = project_root()
    headers = {"Authorization": "Bearer " + token}
    try:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
        if body is None:
            c.request("GET", "/env/v1/%s?project=%s" % (op, urllib.parse.quote(root, safe="")), headers=headers)
        else:
            headers["Content-Type"] = "application/json"
            c.request("POST", "/env/v1/" + op, json.dumps(dict(body, project=root)).encode("utf-8"), headers)
        r = c.getresponse()
        raw = r.read()
        c.close()
    except (OSError, http.client.HTTPException):
        raise Fail("unavailable: 데스크톱 앱에 연결하지 못했습니다", EX_UNAVAILABLE)
    try:
        d = json.loads(raw)
        assert isinstance(d, dict)
    except (ValueError, AssertionError):
        raise Fail("unavailable: 브리지 응답을 읽지 못했습니다", EX_UNAVAILABLE)
    if r.status < 300 and "error" not in d:
        return d
    code = str(d.get("error") or "unavailable")
    if r.status == 401:
        code = "unauthorized"
    msg = {"not_found": "없는 이름이 있습니다", "conflict": "revision이 다릅니다", "duplicate": "이미 있는 이름입니다"}.get(code, "")
    for v in scrub:
        if v:
            msg = msg.replace(v, "***")
    raise Fail("%s: %s" % (code, msg) if msg else code, CODE_EXIT.get(code, 1))


def read_value():
    data = sys.stdin.buffer.read(MAX_VALUE + 1)
    if len(data) > MAX_VALUE:
        raise Fail("값은 항목당 64 KiB까지입니다", EX_DATA)
    if b"\0" in data:
        raise Fail("값에 NUL을 쓸 수 없습니다", EX_DATA)
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise Fail("값은 UTF-8이어야 합니다", EX_DATA)


def show(item):
    print("%s\t%s\t%s" % (item["name"], item["updatedAt"], item["revision"]))


def parse_rev(s):
    if not s:
        raise Fail("--revision이 비었습니다", EX_USAGE)
    return s


def flags(args, spec):
    """spec: {'--stdin': False, '--revision': True}. 알 수 없는 플래그와 값 인자를 거부한다."""
    out, pos, i = {}, [], 0
    while i < len(args):
        a = args[i]
        if a in spec:
            if spec[a]:
                i += 1
                if i >= len(args):
                    raise Fail(a + " 값이 없습니다", EX_USAGE)
                out[a] = args[i]
            else:
                out[a] = True
        elif a.startswith("-"):
            raise Fail("알 수 없는 옵션: " + a, EX_USAGE)
        else:
            pos.append(a)
        i += 1
    return out, pos


class Masker:
    """바이트 스트림에서 비밀의 정확한 일치를 가린다. 청크 경계에 걸친 일치는 꼬리를 쥐고 있다가 잇는다."""

    def __init__(self, secrets):
        self.secrets = sorted({s for s in secrets if s}, key=len, reverse=True)
        self.rx = re.compile(b"|".join(re.escape(s) for s in self.secrets)) if self.secrets else None
        self.buf = b""

    def _hold(self, b):
        # b의 접미사 중 어떤 비밀의 진짜 접두사인 가장 긴 길이
        for n in range(min(len(b), max(map(len, self.secrets)) - 1), 0, -1):
            tail = b[-n:]
            if any(s.startswith(tail) for s in self.secrets):
                return n
        return 0

    def feed(self, chunk):
        if not self.rx:
            return chunk
        b = self.rx.sub(MASK, self.buf + chunk)
        n = self._hold(b)
        self.buf = b[len(b) - n:] if n else b""
        return b[:len(b) - n]

    def flush(self):
        b, self.buf = self.buf, b""
        return self.rx.sub(MASK, b) if self.rx else b


def run(args):
    opts, rest = None, None
    if "--" not in args:
        raise Fail("사용법: dira env run --keys NAME1,NAME2 -- COMMAND ARGS...", EX_USAGE)
    k = args.index("--")
    opts, pos = flags(args[:k], {"--keys": True})
    cmd = args[k + 1:]
    if pos or "--keys" not in opts or not cmd:
        raise Fail("사용법: dira env run --keys NAME1,NAME2 -- COMMAND ARGS...", EX_USAGE)
    names = []
    for n in opts["--keys"].split(","):
        check_name(n)
        if n not in names:
            names.append(n)
    values = call("resolve", {"names": names})["values"]
    missing = [n for n in names if not isinstance(values.get(n), str)]
    if missing:
        raise Fail("not_found: 없는 이름: " + ",".join(missing), EX_NOTFOUND)
    env = dict(os.environ)
    env.update({n: values[n] for n in names})
    masker = {1: Masker(v.encode("utf-8") for v in values.values()),
              2: Masker(v.encode("utf-8") for v in values.values())}
    try:
        p = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as e:
        raise Fail("실행하지 못했습니다: %s (%s)" % (cmd[0], e.strerror), 127 if e.errno == 2 else 126)
    env = values = None

    def forward(sig, _frame):
        try:
            p.send_signal(sig)
        except OSError:
            pass
    for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(s, forward)
    sel = selectors.DefaultSelector()
    sel.register(p.stdout, selectors.EVENT_READ, (1, sys.stdout.buffer))
    sel.register(p.stderr, selectors.EVENT_READ, (2, sys.stderr.buffer))
    while sel.get_map():
        try:
            events = sel.select()
        except InterruptedError:
            continue
        for key, _ in events:
            fd_no, out = key.data
            chunk = os.read(key.fileobj.fileno(), 65536)
            if chunk:
                out.write(masker[fd_no].feed(chunk))
            else:
                out.write(masker[fd_no].flush())
                sel.unregister(key.fileobj)
            out.flush()
    rc = p.wait()
    return 128 - rc if rc < 0 else rc


def context():
    """워커 디스패치와 홈 세션 프롬프트에 싣는 블록(내부용). 이름과 명령만 있고 값, revision, 토큰은 없다.
    연결 파일이 없으면(연결 설정이 없는 엔진) 아무것도 안 낸다. 있는데 목록을 못 읽으면 빈 목록이 아니라
    사용 불가로 알린다."""
    root = project_root()
    local = os.environ.get("TICKET_LOCAL") or os.path.expanduser("~/.config/dira")
    h = hashlib.sha256(root.encode("utf-8")).hexdigest()[:32]
    if not os.path.exists(os.path.join(local, "env-bridge", h + ".json")):
        return
    try:
        names = [it["name"] for it in call("list", timeout=3)["items"]]
        state = "등록된 이름: " + (", ".join(names) if names else "(없음)")
    except Fail as e:
        state = "지금은 사용할 수 없습니다 (%s). 목록이 비었다는 뜻이 아닙니다. 데스크톱 앱이 실행 중인지 확인하고 다시 시도하세요." % str(e).split(":")[0]
    # 라우터(~/.config/dira/bin/dira)는 env 분기 없는 옛 tick.sh가 되덮을 수 있다. 라우터와 무관한 고정
    # 경로의 클라이언트 사본을 안내하고, 그 사본이 없으면 돌지 않을 명령 대신 사용 불가를 알린다.
    client = os.path.expanduser("~/.config/dira/bin/engines/dira_env.py")
    if not os.path.isfile(client):
        print("프로젝트 환경변수 명령(%s)이 설치되어 있지 않아 지금은 사용할 수 없습니다. 목록이 비었다는 뜻이 아닙니다." % client)
        return
    pre = "TICKET_ROOT=%s " % shlex.quote(root)
    if os.environ.get("TICKET_LOCAL"):
        pre += "TICKET_LOCAL=%s " % shlex.quote(local)
    print("""아래는 이 프로젝트의 환경변수입니다. 값은 보이지 않고 다시 조회할 수도 없습니다.

===== 프로젝트 환경변수 =====
%s
명령은 모두 `%spython3 ~/.config/dira/bin/engines/dira_env.py` 로 시작한다(이하 DIRA_ENV).
- 목록: `DIRA_ENV list`
- 추가: `DIRA_ENV create NAME --stdin` (값은 stdin으로만 넣는다)
- 교체: `DIRA_ENV replace NAME --revision REV --stdin` (REV는 list가 알려 준 값)
- 삭제: `DIRA_ENV delete NAME --revision REV`
- 사용: `DIRA_ENV run --keys NAME1,NAME2 -- COMMAND ARGS...` (선택한 변수만 그 자식 프로세스에 들어간다)
변경한 뒤에는 list를 다시 읽어 최신 상태를 확인한다. 사람만 가진 값이 필요하면 프로젝트 설정 화면에 입력하도록 요청한다.
===== 프로젝트 환경변수 끝 =====
""" % (state, pre))


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.split("## 브리지")[0].strip())
        return 0 if argv else EX_USAGE
    cmd, args = argv[0], argv[1:]
    if cmd == "list":
        if args:
            raise Fail("list는 인자가 없습니다", EX_USAGE)
        for it in call("list")["items"]:
            show(it)
    elif cmd in ("create", "replace"):
        opts, pos = flags(args, {"--stdin": False, "--revision": cmd == "replace"})
        if len(pos) != 1 or "--stdin" not in opts or (cmd == "replace" and "--revision" not in opts):
            raise Fail("사용법: dira env %s NAME %s--stdin" % (cmd, "--revision REV " if cmd == "replace" else ""), EX_USAGE)
        check_name(pos[0])
        body = {"name": pos[0]}
        if cmd == "replace":
            body["expectedRevision"] = parse_rev(opts["--revision"])
        body["value"] = read_value()
        show(call(cmd, body, scrub=(body["value"],)))
    elif cmd == "delete":
        opts, pos = flags(args, {"--revision": True})
        if len(pos) != 1 or "--revision" not in opts:
            raise Fail("사용법: dira env delete NAME --revision REV", EX_USAGE)
        check_name(pos[0])
        show(call("delete", {"name": pos[0], "expectedRevision": parse_rev(opts["--revision"])}))
    elif cmd == "run":
        return run(args)
    elif cmd == "context":
        context()
    else:
        raise Fail("알 수 없는 명령: " + cmd, EX_USAGE)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Fail as e:
        print("dira env: " + str(e), file=sys.stderr)
        sys.exit(e.code)
