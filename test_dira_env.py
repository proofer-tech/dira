#!/usr/bin/env python3
"""`dira env` 클라이언트(dira_env.py) 자체검증: 진짜 브리지(apps/desktop의 env-bridge.ts와
env-store.ts, 가짜 암호화기)를 node로 띄워 판정한다. node가 없으면 건너뛴다(엔진은 Node를 요구하지 않는다).

ENV-4(빈 값/여러 줄/동시 revision 교체)와 ENV-6(선택 주입/종료 코드/취소/예약어/없는 이름/
앱 종료/가림), 라우터(tick.sh가 굽는 dira)를 본다. 실패하면 assert로 죽는다.
"""
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(HERE, "dira_env.py")
DESK = os.path.join(HERE, "apps", "desktop")
SECRET = "S3cr3t-unique-value"

if not shutil.which("node"):
    print("SKIP - node 없음")
    sys.exit(0)

tmp = tempfile.mkdtemp()
projA, projB = [os.path.join(tmp, n, ".dira") for n in "AB"]
for p in (projA, projB):
    os.makedirs(p)
wt = os.path.join(tmp, "A", "wt")
os.makedirs(wt)
os.symlink(projA, os.path.join(wt, ".dira"))  # A의 워크트리: .dira는 큐를 가리키는 심링크
local = os.path.join(tmp, "local")
os.makedirs(local)
json.dump({"version": 1, "projects": [{"root": projA}, {"root": projB}]}, open(os.path.join(local, "gui-projects.json"), "w"))

SERVER = """
import { createEnvBridge } from %r;
import { createEnvStore } from %r;
import { publishConnections } from %r;
const [dir, local] = process.argv.slice(1);
const cipher = { isEncryptionAvailable: () => true,
  encryptString: (p) => Buffer.from("enc:" + p), decryptString: (c) => c.toString().slice(4) };
const { port } = await createEnvBridge({ store: createEnvStore({ dir, cipher }), secret: "k" }).listen();
await publishConnections({ local, port, secret: "k" });
console.log("ready");
process.stdin.resume();
""" % tuple("file://" + os.path.join(DESK, f) for f in ("env-bridge.ts", "env-store.ts", "env-connect.ts"))


def start():
    p = subprocess.Popen(["node", "--input-type=module", "-e", SERVER, os.path.join(tmp, "store"), local],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert p.stdout.readline() == b"ready\n", p.stderr.read()
    return p


app = start()
ENV = dict(os.environ, TICKET_ROOT=projA, TICKET_LOCAL=local)
ENVB = dict(ENV, TICKET_ROOT=projB)
ENVW = dict(ENV, TICKET_ROOT=os.path.join(wt, ".dira"))


def dira(*args, stdin=b"", env=ENV):
    return subprocess.run([sys.executable, CLI, *args], input=stdin, capture_output=True, env=env, timeout=60)


def rev(name, env=ENV):
    for line in dira("list", env=env).stdout.decode().splitlines():
        f = line.split("\t")
        if f[0] == name:
            return f[2]


# --- 관리 (ENV-4)
assert dira("list").stdout == b""
for name, val in (("EMPTY", b""), ("MULTI", "a\nb\r\n끝\n".encode()), ("A", SECRET.encode())):
    r = dira("create", name, "--stdin", stdin=val)
    assert r.returncode == 0 and r.stdout.decode().split("\t")[0] == name, r
assert [l.split("\t")[0] for l in dira("list").stdout.decode().splitlines()] == ["A", "EMPTY", "MULTI"]
r = dira("create", "MULTI", "--stdin", stdin=SECRET.encode())
assert r.returncode == 75 and SECRET not in (r.stdout + r.stderr).decode(), r
assert dira("create", "X", "--stdin", stdin=b"a\0b").returncode == 65
assert dira("create", "X", "--stdin", stdin=b"a" * 65537).returncode == 65
assert dira("create", "X", "--stdin", stdin=b"\xff").returncode == 65
assert dira("create", "X", stdin=b"v").returncode == 64          # --stdin 없음
assert dira("create", "X", SECRET, "--stdin").returncode == 64   # 값 인자 거부
for bad in ("1bad", "PATH", "DIRA_X", "TICKET_X", "LD_PRELOAD", "DYLD_X", "NODE_OPTIONS"):
    assert dira("create", bad, "--stdin").returncode == 65, bad
assert rev("X") is None

# 같은 revision을 두 세션이 동시에 교체: 하나만 성공
r0 = rev("MULTI")
rs = [subprocess.Popen([sys.executable, CLI, "replace", "MULTI", "--revision", r0, "--stdin"],
                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV)
      for _ in range(2)]
outs = [p.communicate(("v%d" % i).encode()) for i, p in enumerate(rs)]
assert sorted(p.returncode for p in rs) == [0, 75], [(p.returncode, o) for p, o in zip(rs, outs)]
assert rev("MULTI") != r0
assert dira("delete", "EMPTY", "--revision", "999").returncode == 75
assert dira("delete", "EMPTY", "--revision", rev("EMPTY")).returncode == 0 and rev("EMPTY") is None

# 프로젝트 분리 (ENV-1 일부): A의 워크트리는 A, B는 다른 집합
assert [l.split("\t")[0] for l in dira("list", env=ENVW).stdout.decode().splitlines()] == ["A", "MULTI"]
assert dira("list", env=ENVB).stdout == b""
dira("create", "A", "--stdin", stdin=b"b-value", env=ENVB)
for env, want in ((ENV, SECRET), (ENVW, SECRET), (ENVB, "b-value")):
    r = dira("run", "--keys", "A", "--", sys.executable, "-c", "import os;print(os.environ['A'] and 1)", env=env)
    assert r.stdout == b"1\n"
    r = dira("run", "--keys", "A", "--", sys.executable, "-c",
             "import os,hashlib;print(hashlib.sha256(os.environ['A'].encode()).hexdigest())", env=env)
    assert r.stdout.decode().strip() == hashlib.sha256(want.encode()).hexdigest(), env["TICKET_ROOT"]

# 미인증/다른 프로젝트 토큰/연결 없음
bdir = os.path.join(local, "env-bridge")
fa = [f for f in os.listdir(bdir)]
assert len(fa) == 2
def conn(root):
    from_key = hashlib.sha256(os.path.realpath(root).encode()).hexdigest()[:32]
    return os.path.join(bdir, from_key + ".json")
ca, cb = conn(projA), conn(projB)
assert oct(os.stat(ca).st_mode & 0o777) == "0o600"
good = open(ca).read()
json.dump(dict(json.loads(good), token="bad"), open(ca, "w"))
assert dira("list").returncode == 77
json.dump(dict(json.loads(good), token=json.load(open(cb))["token"]), open(ca, "w"))  # B의 토큰으로 A
r = dira("list")
assert r.returncode == 77, r
open(ca, "w").write(good)
other = os.path.join(tmp, "other", ".dira")
os.makedirs(other)
r = dira("list", env=dict(ENV, TICKET_ROOT=other))
assert r.returncode == 69 and b"unavailable" in r.stderr

# --- run (ENV-6)
dira("create", "C", "--stdin", stdin=b"unselected")
dira("create", "EMPTYV", "--stdin", stdin=b"")
py = lambda code: [sys.executable, "-c", code]
before = dict(os.environ)
r = dira("run", "--keys", "A,MULTI,EMPTYV", "--", *py(
    "import os;print(sorted(k for k in('A','MULTI','C','EMPTYV') if k in os.environ), repr(os.environ['EMPTYV']))"))
assert r.returncode == 0 and r.stdout.decode().startswith("['A', 'EMPTYV', 'MULTI'] ''"), r  # 빈 값은 가림 대상 아님
assert "A" not in os.environ and dict(os.environ) == before
assert dira("run", "--keys", "A", "--", *py("raise SystemExit(7)")).returncode == 7
assert dira("run", "--keys", "A", "--", "echo", "$A;x").stdout == b"$A;x\n"       # 셸 평가 없음
r = dira("run", "--keys", "A", "--", *py("import os;print(len(os.environ['A']))"), env=dict(ENV, A="old"))
assert r.stdout.decode().strip() == str(len(SECRET))                               # 부모의 동명 변수보다 우선
dira("create", "ML", "--stdin", stdin=b"line1\nline2")
code = ("import sys,time,os\n"
        "s=os.environ['A']\n"
        "for i in range(len(s)): sys.stdout.write(s[i]); sys.stdout.flush(); time.sleep(0.005)\n"
        "sys.stdout.write('|S3cr3t-no|'+s+'\\n'+os.environ['ML']+'\\n'); sys.stderr.write('e:'+s[:5]); sys.stderr.flush();"
        "time.sleep(.05); sys.stderr.write(s[5:]+'\\n')")
r = dira("run", "--keys", "A,ML", "--", *py(code))
out, err = r.stdout.decode(), r.stderr.decode()
assert out == "***|S3cr3t-no|***\n***\n" and err == "e:***\n", (out, err)
# 검증 실패 시 자식을 시작하지 않는다
mark = os.path.join(tmp, "started")
touch = py("open(%r,'w')" % mark)
for keys, rc in (("A,NOPE", 66), ("PATH", 65), ("TICKET_X", 65), ("1x", 65), ("", 65)):
    assert dira("run", "--keys", keys, "--", *touch).returncode == rc, keys
assert dira("run", "--keys", "A", *touch).returncode == 64
dira("delete", "C", "--revision", rev("C"))
assert dira("run", "--keys", "C", "--", *touch).returncode == 66                    # 삭제된 이름
assert not os.path.exists(mark)

# 취소: SIGTERM이 자식에게 전달되고 128+n으로 끝난다
p = subprocess.Popen([sys.executable, CLI, "run", "--keys", "A", "--", *py(
    "import time;print('up',flush=True);time.sleep(30)")], stdout=subprocess.PIPE, env=ENV)
assert p.stdout.readline() == b"up\n"
t0 = time.time()
p.send_signal(signal.SIGTERM)
assert p.wait(timeout=10) == 128 + signal.SIGTERM and time.time() - t0 < 5

# 라우터: tick.sh가 굽는 dira가 `env`를 클라이언트로 보낸다(임시 HOME)
q = os.path.join(tmp, "q")
os.makedirs(os.path.join(q, "tickets")); os.makedirs(os.path.join(q, "workers"))
w = os.path.join(q, "workers", "w.sh")
open(w, "w").write('#!/bin/bash\nTICKET_NAME="w"\nTICKET_CWD="%s"\n. "%s"\n' % (tmp, os.path.join(HERE, "tick.sh")))
os.chmod(w, 0o755)
subprocess.run(["bash", w, "dryrun"], env=dict(os.environ, HOME=tmp, PATH="/usr/bin:/bin"), cwd=tmp, capture_output=True, timeout=60)
fixed = os.path.join(tmp, ".config", "dira", "bin", "dira")
assert os.path.isfile(os.path.join(os.path.dirname(fixed), "engines", "dira_env.py"))
r = subprocess.run([fixed, "env", "list"], capture_output=True, env=ENV)
assert r.returncode == 0 and r.stdout.decode().split()[0] == "A", r

# 앱 종료: 연결 파일이 남아 있어도 자식을 시작하지 않는다
app.kill(); app.wait()
assert dira("run", "--keys", "A", "--", *touch).returncode == 69 and not os.path.exists(mark)
assert dira("list").returncode == 69

# 저장 파일과 임시 디렉터리 어디에도 시험 값 평문이 없다(가짜 암호화기가 접두사만 붙이므로 값은 저장 파일에
# 보이는 것이 정상이다. 여기서는 연결 파일과 CLI가 만든 파일만 본다)
for d, _, fs in os.walk(local):
    for f in fs:
        assert SECRET.encode() not in open(os.path.join(d, f), "rb").read(), f
print("ok")
