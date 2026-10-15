"""mcp_server.py / mcp_tools.py 검증 (P476-1). 임시 큐에서 도구만으로 티켓 한 바퀴를 돈다."""
import glob
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "mcp_server.py")
SECRET = "s3cr3t-value-zq9"

tmp = tempfile.mkdtemp()
root = os.path.join(tmp, ".dira")
os.makedirs(os.path.join(root, "tickets"))
os.makedirs(os.path.join(root, "workers"))
env = dict(os.environ, TICKET_LOCAL=os.path.join(tmp, "local"))
env.pop("TICKET_ROOT", None)


def rpc(lines):
    p = subprocess.run([sys.executable, SERVER], input="\n".join(json.dumps(x) for x in lines) + "\n",
                       capture_output=True, text=True, env=env, timeout=120)
    return [json.loads(x) for x in p.stdout.splitlines()]


INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}}
LIST = {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}

# 1. 첫 줄 수용조건
out = rpc([INIT, LIST])
assert len(out) == 2, out
names = {t["name"] for t in out[1]["result"]["tools"]}
NEED = {"projects", "queue_list", "dispatch", "dryrun", "reap", "unassign", "ticket_find", "ticket_read",
        "ticket_create", "ticket_append", "ticket_done", "interject", "graph_query", "env_list", "env_create",
        "env_replace", "env_delete", "engine_exec", "dispatch_now"}
assert NEED <= names, NEED - names
assert rpc([{"jsonrpc": "2.0", "id": 3, "method": "zzz"}])[0]["error"]["code"] == -32601


def call(tool, **args):
    args.setdefault("root", root)
    r = rpc([{"jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": {"name": tool, "arguments": args}}])[0]
    return json.loads(r["result"]["content"][0]["text"]), r["result"]["isError"]


def files(h):
    return [os.path.basename(p) for p in glob.glob(os.path.join(root, "tickets", h + "*"))]


# 2. 티켓 한 바퀴
res, err = call("ticket_create", hash="abcd1234", fm={"title": "t", "kind": "work", "persona": "developer"},
                body="## Goal\nx")
assert not err, res
assert files("abcd1234") == ["abcd1234.md"], files("abcd1234")
assert call("ticket_create", hash="abcd1234")[1], "중복 생성은 실패해야 한다"
res, _ = call("queue_list")
assert "abcd1234" in res["stdout"], res
res, err = call("engine_exec", program="tickets.py", args=["handclaim", os.path.join(root, "tickets", "abcd1234.md")])
assert res["rc"] == 0, res
assert files("abcd1234") == ["abcd1234.wip.md"], files("abcd1234")
res, err = call("ticket_append", hash="abcd1234", text="## 결과\n끝")
assert not err, res
assert "## 결과" in call("ticket_read", hash="abcd1234")[0]["content"]
assert files("abcd1234") == ["abcd1234.wip.md"]
res, err = call("ticket_done", hash="abcd1234")
assert not err, res
assert files("abcd1234") == ["abcd1234.done.md"], files("abcd1234")

# 2b. 온톨로지 도구 여섯 (P496)
ONT = {"ontology_objects", "ontology_object", "ontology_search", "ontology_versions", "ontology_version",
       "ontology_schema"}
assert ONT <= names, ONT - names
os.makedirs(os.path.join(root, "ontology", "objects", "t"))
open(os.path.join(root, "ontology", "objects", "t", "o.md"), "w").write("---\nname: o\ntype: t\n---\n\n본문 zq\n")
sys.path.insert(0, HERE)
import ontology_read  # noqa: E402
res, err = call("ontology_object", name="o")
assert not err and res["result"]["object"]["name"] == "o", res
assert res == ontology_read.run(root, "object", {"name": "o"}), res
assert call("ontology_search", q="zq")[0] == ontology_read.run(root, "search", {"q": "zq"})
assert call("ontology_objects")[0] == ontology_read.run(root, "objects", {})
assert call("ontology_schema")[0] == ontology_read.run(root, "schema", {})
res, err = call("ontology_search", q="")
assert err and "rc" not in res, res  # ValueError -> 도구 오류

# 3. 허용목록
marker = os.path.join(tmp, "ran")
open(os.path.join(tmp, "x.sh"), "w").write("touch %s\n" % marker)
for prog in ("/bin/sh", "workers/../x.sh", "sh", "../x.sh"):
    res, err = call("engine_exec", program=prog, args=[])
    assert err and "rc" not in res, (prog, res)
assert not os.path.exists(marker)

# 4. env: 응답에 값이 없다(브리지가 없어 실패해도 값은 안 실린다)
for r in (call("env_create", name="FOO", value=SECRET), call("env_list"),
          call("env_replace", name="FOO", value=SECRET, revision=1)):
    assert SECRET not in json.dumps(r, ensure_ascii=False), r

# 4b. dispatch_now와 요구 즉시 디스패치: 가짜 crontab + 워커 파일, 부하 상한은 크게
os.makedirs(os.path.join(tmp, "local"), exist_ok=True)
json.dump({"load_max": 1e9}, open(os.path.join(tmp, "local", "dispatch.json"), "w"))
worker = os.path.join(os.path.realpath(root), "workers", "w1.sh")
open(worker, "w").write('echo "$@" > "%s/ran"\n' % tmp)
os.makedirs(os.path.join(tmp, "bin"))
cron = os.path.join(tmp, "bin", "crontab")
open(cron, "w").write("#!/bin/sh\necho '* * * * * %s'\n" % worker)
os.chmod(cron, 0o755)
env["PATH"] = os.path.join(tmp, "bin") + os.pathsep + env["PATH"]
mk = {"title": "t", "kind": "work", "persona": "developer"}
call("ticket_create", hash="d1d1d1d1", fm=mk, body="## Goal\nx")
res, err = call("dispatch_now", hash="d1d1d1d1")
assert not err and res["go"] is True and res["worker"] == "w1", res
res, err = call("ticket_create", hash="e2e2e2e2", fm=mk, body="## Goal\nx")
assert not err and "dispatch" not in res, res
res, err = call("ticket_create", hash="f3f3f3f3", fm={**mk, "kind": "request"}, body="## Goal\nx")
assert not err and "dispatch" in res and res["dispatch"]["reason"] == "request", res
assert call("dispatch_now", worker="../x")[1], "worker 이름 검증"

# 5. HTTP
srv = subprocess.Popen([sys.executable, SERVER, "--http", "127.0.0.1:0"], stdout=subprocess.PIPE, text=True,
                       env=env)
try:
    ready = json.loads(srv.stdout.readline())
    url, token = ready["url"], ready["token"]

    def post(headers):
        req = urllib.request.Request(url, json.dumps(LIST).encode(), headers=dict(headers), method="POST")
        try:
            return urllib.request.urlopen(req, timeout=30).status
        except urllib.error.HTTPError as e:
            return e.code

    good = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    assert post(good) == 200
    assert post({"Content-Type": "application/json"}) == 401
    assert post({"Authorization": "Bearer nope"}) == 401
    assert post({**good, "Origin": "http://evil.example"}) == 403
    assert post({**good, "Origin": "http://localhost:3000"}) == 200
finally:
    srv.kill()

diff = subprocess.run(["git", "diff", "master", "--", "tickets.py"], cwd=HERE, capture_output=True,
                      text=True).stdout
assert diff == "", "tickets.py가 바뀌었다"
print("OK")
