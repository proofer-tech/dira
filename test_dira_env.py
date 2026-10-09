#!/usr/bin/env python3
"""`dira env` 클라이언트(dira_env.py) 자체검증: mock 브리지(계약은 dira_env.py 머리말)로 판정한다.

ENV-4(빈 값/여러 줄/동시 revision 교체)와 ENV-6(선택 주입/종료 코드/취소/예약어/없는 이름/
앱 종료/가림)을 본다. 실패하면 assert로 죽는다.
"""
import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(HERE, "dira_env.py")
TOKEN = "tok-" + "x" * 20
SECRET = "S3cr3t-unique-value"


class Store:
    def __init__(self):
        self.items = {}  # name -> [value, revision]
        self.lock = threading.Lock()
        self.log = []


def make_handler(store):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def reply(self, status, d):
            raw = json.dumps(d).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])) or b"{}")
            if self.headers.get("Authorization") != "Bearer " + TOKEN:
                return self.reply(401, {"ok": False, "code": "unauthorized", "message": "no"})
            op = self.path.rsplit("/", 1)[1]
            store.log.append((op, body))
            meta = lambda n: {"name": n, "updatedAt": "t", "revision": store.items[n][1]}
            with store.lock:
                if op == "list":
                    return self.reply(200, {"ok": True, "items": [meta(n) for n in store.items]})
                if op == "resolve":
                    miss = [n for n in body["names"] if n not in store.items]
                    if miss:
                        return self.reply(404, {"ok": False, "code": "not_found", "message": ",".join(miss)})
                    return self.reply(200, {"ok": True, "values": {n: store.items[n][0] for n in body["names"]}})
                n = body["name"]
                if op == "create":
                    if n in store.items:
                        # 일부러 값을 되돌려 보내는 나쁜 브리지: CLI가 가려야 한다
                        return self.reply(409, {"ok": False, "code": "duplicate", "message": "dup " + body["value"]})
                    store.items[n] = [body["value"], 1]
                elif n not in store.items:
                    return self.reply(404, {"ok": False, "code": "not_found", "message": n})
                elif store.items[n][1] != body["expectedRevision"]:
                    return self.reply(409, {"ok": False, "code": "conflict", "message": "revision"})
                elif op == "replace":
                    store.items[n] = [body["value"], store.items[n][1] + 1]
                elif op == "delete":
                    it = meta(n)
                    del store.items[n]
                    return self.reply(200, {"ok": True, "item": it})
                return self.reply(200, {"ok": True, "item": meta(n)})
    return H


tmp = tempfile.mkdtemp()
root = os.path.join(tmp, "proj", ".dira")
os.makedirs(root)
local = os.path.join(tmp, "local")
store = Store()
srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(store))
threading.Thread(target=srv.serve_forever, daemon=True).start()
h = hashlib.sha256(os.path.realpath(root).encode()).hexdigest()[:16]
os.makedirs(os.path.join(local, "env-bridge"))
conn = os.path.join(local, "env-bridge", h + ".json")
json.dump({"port": srv.server_address[1], "token": TOKEN}, open(conn, "w"))
ENV = dict(os.environ, TICKET_ROOT=root, TICKET_LOCAL=local)


def dira(*args, stdin=b"", env=ENV, **kw):
    return subprocess.run([sys.executable, CLI, *args], input=stdin, capture_output=True, env=env, **kw)


# --- 관리 (ENV-4)
r = dira("create", "EMPTY", "--stdin", stdin=b"")
assert r.returncode == 0 and store.items["EMPTY"][0] == "", r
r = dira("create", "MULTI", "--stdin", stdin="a\nb\r\n끝\n".encode())
assert r.returncode == 0 and store.items["MULTI"][0] == "a\nb\r\n끝\n", r
r = dira("list")
assert r.stdout.decode().split() == ["EMPTY", "t", "1", "MULTI", "t", "1"], r
r = dira("create", "MULTI", "--stdin", stdin=SECRET.encode())
assert r.returncode == 75 and SECRET not in (r.stdout + r.stderr).decode(), r
assert dira("create", "X", "--stdin", stdin=b"a\0b").returncode == 65
assert dira("create", "X", "--stdin", stdin=b"a" * 65537).returncode == 65
assert dira("create", "X", "--stdin", stdin=b"\xff").returncode == 65
assert dira("create", "X", stdin=b"v").returncode == 64          # 값 인자/--stdin 없음
assert dira("create", "X", SECRET, "--stdin").returncode == 64   # 값 인자 거부
assert dira("create", "1bad", "--stdin").returncode == 65
assert dira("create", "PATH", "--stdin").returncode == 65
assert dira("create", "DIRA_X", "--stdin").returncode == 65
assert not any(op == "create" and b["name"] in ("X", "1bad", "PATH") for op, b in store.log)

# 같은 revision을 두 세션이 동시에 교체: 하나만 성공
rs = [subprocess.Popen([sys.executable, CLI, "replace", "MULTI", "--revision", "1", "--stdin"],
                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV)
      for _ in range(2)]
outs = [p.communicate(("v%d" % i).encode()) for i, p in enumerate(rs)]
codes = sorted(p.returncode for p in rs)
assert codes == [0, 75], codes
assert store.items["MULTI"][1] == 2
assert dira("delete", "EMPTY", "--revision", "9").returncode == 75
assert dira("delete", "EMPTY", "--revision", "1").returncode == 0 and "EMPTY" not in store.items

# 미인증/연결 없음
json.dump({"port": srv.server_address[1], "token": "bad"}, open(conn, "w"))
assert dira("list").returncode == 77
json.dump({"port": srv.server_address[1], "token": TOKEN}, open(conn, "w"))
other = dict(ENV, TICKET_ROOT=os.path.join(tmp, "other"))
os.makedirs(other["TICKET_ROOT"])
r = dira("list", env=other)
assert r.returncode == 69 and b"unavailable" in r.stderr

# --- run (ENV-6)
store.items.update({"A": [SECRET, 1], "B": ["bee\nline2", 1], "C": ["unselected", 1], "EMPTYV": ["", 1]})
py = lambda code: [sys.executable, "-c", code]
before = dict(os.environ)
r = dira("run", "--keys", "A,B,EMPTYV", "--", *py(
    "import os;print(sorted(k for k in('A','B','C','EMPTYV') if k in os.environ), repr(os.environ['EMPTYV']))"))
assert r.returncode == 0 and r.stdout.decode().startswith("['A', 'B', 'EMPTYV'] ''"), r  # 빈 값은 가림 대상 아님
assert "A" not in os.environ and dict(os.environ) == before
# 종료 코드, 셸 평가 없음, 기존 변수 덮어쓰기
assert dira("run", "--keys", "A", "--", *py("raise SystemExit(7)")).returncode == 7
r = dira("run", "--keys", "A", "--", "echo", "$A;x")
assert r.stdout == b"$A;x\n"
r = dira("run", "--keys", "A", "--", *py("import os;print(len(os.environ['A']))"), env=dict(ENV, A="old"))
assert r.stdout.decode().strip() == str(len(SECRET))
# 가림: 한 번에, 청크로 쪼개, 여러 줄, stderr, 접두사 겹침
code = ("import sys,time,os\n"
        "s=os.environ['A']\n"
        "for i in range(len(s)): sys.stdout.write(s[i]); sys.stdout.flush(); time.sleep(0.005)\n"
        "sys.stdout.write('|S3cr3t-no|'+s+'\\n'+os.environ['B']+'\\n'); sys.stderr.write('e:'+s[:5]); sys.stderr.flush();"
        "time.sleep(.05); sys.stderr.write(s[5:]+'\\n')")
r = dira("run", "--keys", "A,B", "--", *py(code))
out, err = r.stdout.decode(), r.stderr.decode()
assert SECRET not in out + err and "bee\nline2" not in out
assert out == "***|S3cr3t-no|***\n***\n" and err == "e:***\n", (out, err)
# 검증 실패 시 자식을 시작하지 않는다
mark = os.path.join(tmp, "started")
touch = py("open(%r,'w')" % mark)
for keys, rc in (("A,NOPE", 66), ("PATH", 65), ("TICKET_X", 65), ("1x", 65), ("", 65)):
    assert dira("run", "--keys", keys, "--", *touch).returncode == rc, keys
assert dira("run", "--keys", "A", *touch).returncode == 64
assert not os.path.exists(mark)
store.items.pop("C")
assert dira("run", "--keys", "C", "--", *touch).returncode == 66 and not os.path.exists(mark)  # 삭제된 이름
srv.shutdown(); srv.server_close()
assert dira("run", "--keys", "A", "--", *touch).returncode == 69 and not os.path.exists(mark)  # 앱 종료
assert dira("list").returncode == 69

# 취소: SIGTERM이 자식에게 전달되고 128+n으로 끝난다
srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(store))
threading.Thread(target=srv.serve_forever, daemon=True).start()
json.dump({"port": srv.server_address[1], "token": TOKEN}, open(conn, "w"))
p = subprocess.Popen([sys.executable, CLI, "run", "--keys", "A", "--", *py(
    "import time,sys;print('up',flush=True);time.sleep(30)")], stdout=subprocess.PIPE, env=ENV)
assert p.stdout.readline() == b"up\n"
p.send_signal(signal.SIGTERM)
t0 = time.time()
assert p.wait(timeout=10) == 128 + signal.SIGTERM and time.time() - t0 < 5

# 값이 임시 파일/인자에 남지 않는다: 호출 뒤 tmp 아래에 SECRET이 든 파일이 없다
srv.shutdown()
for d, _, fs in os.walk(tmp):
    for f in fs:
        assert SECRET.encode() not in open(os.path.join(d, f), "rb").read(), f

# 라우터: tick.sh가 굽는 dira가 `env`를 클라이언트로 보낸다(임시 HOME)
srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(store))
threading.Thread(target=srv.serve_forever, daemon=True).start()
json.dump({"port": srv.server_address[1], "token": TOKEN}, open(conn, "w"))
q = os.path.join(tmp, "q")
os.makedirs(os.path.join(q, "tickets")); os.makedirs(os.path.join(q, "workers"))
w = os.path.join(q, "workers", "w.sh")
open(w, "w").write('#!/bin/bash\nTICKET_NAME="w"\nTICKET_CWD="%s"\n. "%s"\n' % (tmp, os.path.join(HERE, "tick.sh")))
os.chmod(w, 0o755)
subprocess.run(["bash", w, "dryrun"], env=dict(os.environ, HOME=tmp, PATH="/usr/bin:/bin"), cwd=tmp, capture_output=True, timeout=60)
fixed = os.path.join(tmp, ".config", "dira", "bin", "dira")
assert os.path.isfile(os.path.join(os.path.dirname(fixed), "engines", "dira_env.py"))
r = subprocess.run([fixed, "env", "list"], capture_output=True, env=ENV)
assert r.returncode == 0 and r.stdout.decode().split()[0] == "MULTI", r
srv.shutdown()
print("ok")
