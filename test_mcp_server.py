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
# dispatch.py 없는 ENGINE_DIR(고정 경로 상황): 티켓은 생기고 why에 다음 틱 문장이 붙는다
import shutil
eng = os.path.join(tmp, "eng")
os.makedirs(eng)
for f in "mcp_server.py mcp_tools.py tickets.py graph.py learn.py remote.py ontology_read.py".split():
    shutil.copy(os.path.join(HERE, f), eng)
SERVER_SAVED, SERVER = SERVER, os.path.join(eng, "mcp_server.py")
res, err = call("ticket_create", hash="a4a4a4a4", fm={**mk, "kind": "request"}, body="## Goal\nx")
SERVER = SERVER_SAVED
assert not err and os.path.exists(os.path.join(root, "tickets", "a4a4a4a4.md")), (res, err)
assert res["dispatch"]["go"] is False and "다음 틱" in res["dispatch"]["why"], res

# 4c. 답변 대기 (P516): 같은 질문 절 하나로 awaiting_list와 ticket_answer를 돈다
Q = ("## 질문 1\n\n### 1. 무엇부터\n\n- (a) 엔진만\n- (a-1) 한 벌\n- (b) 화면까지\n\n"
     "### 1-1. 고정인가\n\n- (a) 고정\n- (b) 프로젝트마다\n")
call("ticket_create", hash="a0a0a0a0", fm={"title": "물음", "kind": "request", "persona": "pm",
                                         "awaiting": "b1b1b1b1", "deps": "[b1b1b1b1]"}, body="## Goal\nx\n\n" + Q)
call("ticket_create", hash="a0a0a0a1", fm={"title": "답 있음", "kind": "request", "awaiting": "abcd1234",
                                         "deps": "[abcd1234]"}, body=Q)  # abcd1234.done이 이미 있다
call("ticket_create", hash="a0a0a0a3", fm={"title": "이름 충돌", "kind": "request", "awaiting": "d1d1d1d1",
                                         "deps": "[d1d1d1d1]"}, body=Q)  # d1d1d1d1이 열려 있어 stem이 이미 있다
call("ticket_create", hash="a0a0a0a2", fm={"title": "진행", "kind": "request", "awaiting": "b2b2b2b2",
                                         "deps": "[b2b2b2b2]"}, body=Q)
call("engine_exec", program="tickets.py", args=["handclaim", os.path.join(root, "tickets", "a0a0a0a2.md")])
res, err = call("awaiting_list")  # root 없이: gui-projects.json 두 프로젝트
root2 = os.path.join(tmp, "p2", ".dira")
os.makedirs(os.path.join(root2, "tickets"))
json.dump({"projects": [{"id": "p1", "name": "one", "root": root}, {"id": "p2", "name": "two", "root": root2},
                        {"id": "px", "name": "x", "root": os.path.join(tmp, "nope")}]},
          open(os.path.join(tmp, "local", "gui-projects.json"), "w"))
open(os.path.join(root2, "tickets", "c0c0c0c0.md"), "w").write(
    "---\nticket: c0c0c0c0\ntitle: 둘째\nawaiting: c9c9c9c9\ndeps: [c9c9c9c9]\n---\n\n## 질문 2\n\n자유\n")
res, err = call("awaiting_list", root=None)
assert not err, res
got = {r["hash"]: r for r in res["awaiting"]}
assert set(got) == {"a0a0a0a0", "a0a0a0a3", "c0c0c0c0"}, got.keys()  # .wip와 답이 달린 티켓은 없다
assert [s["project"] for s in res["skipped"]] == ["px"], res
a0 = got["a0a0a0a0"]
assert a0["round"] == 1 and a0["awaiting"] == "b1b1b1b1" and a0["question"].startswith("## 질문 1"), a0
assert a0["items"] == [
    {"number": "1.", "title": "무엇부터", "options": [{"letter": "a", "label": "엔진만"},
                                                      {"letter": "a-1", "label": "한 벌"},
                                                      {"letter": "b", "label": "화면까지"}]},
    {"number": "1-1.", "title": "고정인가", "options": [{"letter": "a", "label": "고정"},
                                                        {"letter": "b", "label": "프로젝트마다"}]}], a0["items"]
assert got["c0c0c0c0"]["round"] == 2 and got["c0c0c0c0"]["items"] == [], got["c0c0c0c0"]
assert {r["hash"] for r in call("awaiting_list", root=root2)[0]["awaiting"]} == {"c0c0c0c0"}

before = sorted(os.listdir(os.path.join(root, "tickets")))
bad = [dict(picks=[{"number": "9.", "letters": ["a"]}]),
       dict(picks=[{"number": "1.", "letters": ["z"]}]),
       dict(picks=[{"number": "1.", "letters": ["a-1"]}]),  # 부모 없는 하위 글자
       dict(picks=[{"number": "1.", "letters": []}], text="  "),  # 빈 답
       dict(text="x", hash="a0a0a0a1"),  # 이미 답이 있다
       dict(text="x", hash="a0a0a0a3"),  # stem 파일이 열려 있다
       dict(text="x", hash="a0a0a0a2")]  # .wip
for kw in bad:
    kw.setdefault("hash", "a0a0a0a0")
    res, err = call("ticket_answer", **kw)
    assert err and "path" not in res, (kw, res)
assert sorted(os.listdir(os.path.join(root, "tickets"))) == before, "오류인데 파일이 생겼다"
res, err = call("ticket_answer", hash="a0a0a0a0", picks=[{"number": "1.", "letters": ["a-1", "a"], "note": "메모"}],
                text="덧붙임")
assert not err and res["round"] == 1 and "dispatch" in res, res
ans = open(os.path.join(root, "tickets", "b1b1b1b1.done.md"), encoding="utf-8").read()
assert ans == ("---\nticket: b1b1b1b1\ntitle: 답변 \u2014 a0a0a0a0 #1\nkind: answer\n---\n\n## 답변 1\n\n"
               "1.(a)(a-1) 메모\n\n덧붙임\n"), ans
assert call("ticket_answer", hash="a0a0a0a0", text="again")[1], "이미 답한 티켓"
lst = subprocess.run([sys.executable, os.path.join(HERE, "tickets.py"), "list", root], capture_output=True,
                     text=True, env=dict(env, TICKET_ROOT=root)).stdout
line = next(x for x in lst.splitlines() if "a0a0a0a0" in x)
assert "deps 대기" not in line, line

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
