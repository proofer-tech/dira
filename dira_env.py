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

## 브리지 연결 계약 (데스크톱 앱 쪽 구현이 이 계약을 따른다)

연결 파일: `$TICKET_LOCAL/env-bridge/<프로젝트 해시>.json` (TICKET_LOCAL 기본 `~/.config/dira`),
0600, `{"port": 정수, "token": "문자열"}`. 프로젝트 해시는 정규화한 티켓 루트(realpath, NFC)의
UTF-8 sha256 앞 16자리 16진수다. 토큰은 그 프로젝트에 결합되어 있어 다른 프로젝트 요청은 거부된다.
프로젝트 루트는 `$TICKET_ROOT`, 없으면 cwd에서 위로 올라가며 찾은 `.dira`(워크트리의 `.dira`는
큐를 가리키는 심링크라 realpath가 같은 큐로 모인다)다.

요청: `POST http://127.0.0.1:<port>/env/<op>`, `Authorization: Bearer <token>`, JSON 본문.
    list     {}                                        -> {"ok":true,"items":[{name,updatedAt,revision}]}
    create   {"name","value"}                          -> {"ok":true,"item":{name,updatedAt,revision}}
    replace  {"name","value","expectedRevision"}       -> {"ok":true,"item":{...}}
    delete   {"name","expectedRevision"}               -> {"ok":true,"item":{...}}
    resolve  {"names":[...]}  (run 전용 내부 경로)      -> {"ok":true,"values":{NAME:value}}
실패: HTTP 4xx/5xx + {"ok":false,"code":<아래>,"message":"..."}. code는 unauthorized, invalid,
reserved, duplicate, conflict, not_found, locked, corrupt, unavailable 중 하나다.
resolve는 전부 있거나 전부 실패(not_found에 누락 이름을 message로)다. 응답과 오류에 값은 없다.
"""
import hashlib
import http.client
import json
import os
import re
import selectors
import signal
import subprocess
import sys
import unicodedata

NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
RESERVED_EXACT = {"PATH", "HOME", "SHELL", "ENV", "BASH_ENV", "NODE_OPTIONS", "PYTHONPATH"}
RESERVED_PREFIX = ("LD_", "DYLD_", "TICKET_", "DIRA_")
MAX_VALUE = 64 * 1024
MASK = b"***"

# 종료 코드. 자식의 코드와 겹칠 수 있으나 우리 오류는 항상 stderr에 `dira env:`로 시작한다.
EX_USAGE, EX_DATA, EX_NOTFOUND, EX_UNAVAILABLE, EX_CONFLICT, EX_NOPERM = 64, 65, 66, 69, 75, 77
CODE_EXIT = {
    "invalid": EX_DATA, "reserved": EX_DATA, "duplicate": EX_CONFLICT, "conflict": EX_CONFLICT,
    "not_found": EX_NOTFOUND, "unauthorized": EX_NOPERM, "locked": EX_UNAVAILABLE,
    "corrupt": EX_UNAVAILABLE, "unavailable": EX_UNAVAILABLE,
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
    h = hashlib.sha256(project_root().encode("utf-8")).hexdigest()[:16]
    try:
        with open(os.path.join(local, "env-bridge", h + ".json"), encoding="utf-8") as f:
            c = json.load(f)
        return int(c["port"]), str(c["token"])
    except (OSError, ValueError, KeyError, TypeError):
        raise Fail("unavailable: 데스크톱 앱이 실행 중이어야 합니다 (연결 정보가 없습니다)", EX_UNAVAILABLE)


def call(op, body, scrub=()):
    """브리지 호출. 오류 메시지에서 우리가 쥔 값은 가린다."""
    port, token = connection()
    try:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
        c.request("POST", "/env/" + op, json.dumps(body).encode("utf-8"),
                  {"Authorization": "Bearer " + token, "Content-Type": "application/json"})
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
    if r.status < 300 and d.get("ok"):
        return d
    code = str(d.get("code") or "unavailable")
    msg = str(d.get("message") or "")
    for s in scrub:
        if s:
            msg = msg.replace(s, "***")
    raise Fail("%s: %s" % (code, msg), CODE_EXIT.get(code, 1))


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
    if not re.match(r"[0-9]+\Z", s or ""):
        raise Fail("--revision은 숫자여야 합니다", EX_USAGE)
    return int(s)


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


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.split("## 브리지")[0].strip())
        return 0 if argv else EX_USAGE
    cmd, args = argv[0], argv[1:]
    if cmd == "list":
        if args:
            raise Fail("list는 인자가 없습니다", EX_USAGE)
        for it in call("list", {})["items"]:
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
        show(call(cmd, body, scrub=(body["value"],))["item"])
    elif cmd == "delete":
        opts, pos = flags(args, {"--revision": True})
        if len(pos) != 1 or "--revision" not in opts:
            raise Fail("사용법: dira env delete NAME --revision REV", EX_USAGE)
        check_name(pos[0])
        show(call("delete", {"name": pos[0], "expectedRevision": parse_rev(opts["--revision"])})["item"])
    elif cmd == "run":
        return run(args)
    else:
        raise Fail("알 수 없는 명령: " + cmd, EX_USAGE)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Fail as e:
        print("dira env: " + str(e), file=sys.stderr)
        sys.exit(e.code)
