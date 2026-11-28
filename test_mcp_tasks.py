"""티켓 작업 상태 함수와 ticket_status - ticket_wait (P571-2). 임시 큐에서 대응표를 단언한다."""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mcp_tools as M

tmp = tempfile.mkdtemp()
root = os.path.realpath(os.path.join(tmp, ".dira"))
os.makedirs(os.path.join(root, "tickets"))
os.environ["TICKET_LOCAL"] = os.path.join(tmp, "local")


def put(name, fm, body=""):
    with open(os.path.join(root, "tickets", name), "w", encoding="utf-8") as f:
        f.write("---\n" + "".join("%s: %s\n" % kv for kv in fm.items()) + "---\n\n" + body)


def st(h):
    return M.call_tool("ticket_status", {"root": root, "hash": h})


# 1. 대응표 네 줄
put("aaaa0001.md", {"ticket": "aaaa0001", "title": "t"}, "## Goal\nx\n")
t = st("aaaa0001")
assert t["status"] == "working" and t["statusMessage"].startswith("대기"), t
assert t["taskId"] == "dira://ticket/aaaa0001?root=" + M.quote(root, safe=""), t
assert t["ttlMs"] is None and t["pollIntervalMs"] == 5000 and t["createdAt"] and t["lastUpdatedAt"], t
assert M.parse_uri(t["taskId"]) == ("ticket", "aaaa0001", root)

os.rename(os.path.join(root, "tickets", "aaaa0001.md"), os.path.join(root, "tickets", "aaaa0001.wip.md"))
t = st("aaaa0001")
assert t["status"] == "working" and t["statusMessage"].startswith("진행 중"), t

with open(os.path.join(root, "tickets", "aaaa0001.wip.md"), "a") as f:
    f.write("\n## 블록\n\n막힌 이유 하나\n\n질문\n")
t = st("aaaa0001")
assert t["status"] == "working" and t["statusMessage"] == "막힘 - 막힌 이유 하나", t

Q = ("## 질문 1\n\n### 1. 무엇부터\n\n- (a) 엔진만\n- (b) 화면까지\n\n### 2. 고정인가\n\n- (a) 고정\n- (b) 마다\n")
put("bbbb0002.md", {"ticket": "bbbb0002", "awaiting": "cccc0003", "deps": "[cccc0003]"}, "## Goal\nx\n\n" + Q)
t = st("bbbb0002")
assert t["status"] == "input_required" and t["statusMessage"] == "질문 1", t
assert sorted(t["inputRequests"]) == ["q1", "q2"], t
q1 = t["inputRequests"]["q1"]
assert q1["method"] == "elicitation/create"
assert q1["params"]["requestedSchema"]["properties"]["letters"]["items"]["enum"] == ["a", "b"], q1
assert M.responses_to_picks({"q1": {"letters": ["a"]}, "q2": {"letters": ["b"], "note": "x"}}) == [
    {"number": "1.", "letters": ["a"], "note": ""}, {"number": "2.", "letters": ["b"], "note": "x"}]

put("dddd0004.done.md", {"ticket": "dddd0004"}, "## 결과\n\n바뀐 것 -> eeee0005 (pm) 후속\n\n## 다음\nz\n")
put("eeee0005.md", {"ticket": "eeee0005", "req": "dddd0004"})
put("ffff0006.md", {"ticket": "ffff0006", "req": "dddd0004"})
t = st("dddd0004")
r = t["result"]
assert t["status"] == "completed" and t["statusMessage"] == "완료", t
assert r["content"][0]["text"].startswith("바뀐 것") and "## 다음" not in r["content"][0]["text"], r
links = [c["uri"] for c in r["content"] if c["type"] == "resource_link"]
assert sorted(links) == sorted(M.ticket_uri(root, h) for h in ("eeee0005", "ffff0006")), links
assert r["structuredContent"]["followups"] == links and r["structuredContent"]["state"] == "done"

# 2. continued 두 단 추적
put("1111aaaa.done.md", {"ticket": "1111aaaa", "continued": "2222bbbb"}, "## 결과\n첫째\n")
put("2222bbbb.done.md", {"ticket": "2222bbbb", "continued": "3333cccc"}, "## 결과\n둘째\n")
put("3333cccc.wip.md", {"ticket": "3333cccc", "owner": "developer / w9"})
t = st("1111aaaa")
assert t["status"] == "working" and "w9" in t["statusMessage"] and "result" not in t, t
os.rename(os.path.join(root, "tickets", "3333cccc.wip.md"), os.path.join(root, "tickets", "3333cccc.done.md"))
with open(os.path.join(root, "tickets", "3333cccc.done.md"), "a") as f:
    f.write("\n## 결과\n셋째\n")
t = st("1111aaaa")
assert t["status"] == "completed" and t["result"]["content"][0]["text"] == "셋째", t
put("9999aaaa.done.md", {"ticket": "9999aaaa", "continued": "9999aaaa"}, "## 결과\n순환\n")  # 순환은 멈춘다
assert st("9999aaaa")["status"] == "completed"
try:
    st("00000000")
    raise AssertionError("없는 티켓은 오류여야 한다")
except M.ToolError:
    pass

# 3. ticket_wait: 시간 초과 - 도중 .done - hashes
t0 = time.monotonic()
w = M.call_tool("ticket_wait", {"root": root, "hash": "aaaa0001", "since": "working", "timeout_s": 2})
assert w["changed"] is False and w["status"] == "working" and time.monotonic() - t0 >= 1.9, w
put("5555dddd.wip.md", {"ticket": "5555dddd"}, "## 결과\n끝\n")
th = threading.Timer(1.0, os.rename, (os.path.join(root, "tickets", "5555dddd.wip.md"),
                                      os.path.join(root, "tickets", "5555dddd.done.md")))
th.start()
t0 = time.monotonic()
w = M.call_tool("ticket_wait", {"root": root, "hash": "5555dddd", "since": "working", "timeout_s": 20})
assert w["changed"] is True and w["status"] == "completed" and time.monotonic() - t0 < 10, w
two = M.call_tool("ticket_status", {"root": root, "hashes": ["aaaa0001", "dddd0004"]})
assert [x["status"] for x in two["tasks"]] == ["working", "completed"], two

# 4. ticket_create 결과 content에 resource_link (stdio 서버)
env = dict(os.environ, TICKET_LOCAL=os.path.join(tmp, "local"))
req = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "ticket_create", "arguments": {
    "root": root, "hash": "7777eeee", "fm": {"title": "t", "kind": "work"}, "body": "## Goal\nx"}}}
p = subprocess.run([sys.executable, os.path.join(HERE, "mcp_server.py")], input=json.dumps(req) + "\n",
                   capture_output=True, text=True, env=env, timeout=60)
res = json.loads(p.stdout)["result"]
rl = [c for c in res["content"] if c["type"] == "resource_link"]
assert rl and rl[0]["uri"] == M.ticket_uri(root, "7777eeee"), res
assert "_links" not in res["content"][0]["text"], res
print("OK")
