"""session_digest.py 자체검증 (P572-1). 가짜 HOME의 claude 기록으로 수용조건 1-4를 단언한다."""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp()
home = os.path.join(tmp, "home")
root = os.path.join(tmp, "proj", ".dira")
wt = os.path.join(root, "worktrees", "w1")
for d in (os.path.join(root, "tickets"), wt):
    os.makedirs(d)
pdir = os.path.join(home, ".claude", "projects", "".join(c if c.isalnum() else "-" for c in os.path.abspath(wt)))
os.makedirs(pdir)
FMT = os.environ.get("TICKET_PROMPT_FMT") or ("%s 티켓을 확인해 주세요. (해당 티켓은 이미 진행중으로 잡아두었습니다. 수행을 마치면 "
                                              "완료 상태로 rename하고, 막히면 티켓 본문에 블록 이력을 남겨주세요.)")
H, OTHER = "aaaa1111", "bbbb2222"
n = [0]


def user(text):
    n[0] += 1
    return {"type": "user", "timestamp": "2026-11-28T10:%02d:00Z" % n[0], "message": {"role": "user", "content": text}}


def tool(name, inp, ok=True):
    n[0] += 1
    i = "t%d" % n[0]
    return [{"type": "assistant", "timestamp": "2026-11-28T10:%02d:00Z" % n[0],
             "message": {"role": "assistant", "content": [{"type": "tool_use", "id": i, "name": name, "input": inp}]}},
            {"type": "user", "timestamp": "2026-11-28T10:%02d:01Z" % n[0],
             "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": i, "is_error": not ok,
                                                      "content": "x"}]}}]


def reply(text):
    n[0] += 1
    return {"type": "assistant", "timestamp": "2026-11-28T10:%02d:00Z" % n[0],
            "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}


def write(name, recs, mtime=None):
    p = os.path.join(pdir, name + ".jsonl")
    with open(p, "w", encoding="utf-8") as f:
        f.write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in recs))
    if mtime:
        os.utime(p, (mtime, mtime))
    return p


def digest(h=H):
    r = subprocess.run([sys.executable, os.path.join(HERE, "session_digest.py"), root, h], capture_output=True,
                       text=True, env=dict(os.environ, HOME=home), timeout=60)
    assert r.returncode == 0, r
    return r.stdout


def ticket(extra=""):
    with open(os.path.join(root, "tickets", H + ".done.md"), "w") as f:
        f.write("---\nticket: %s\n%s---\n\n## 결과\nx\n" % (H, extra))


ticket()
# 1. 회차 둘, 구간 자르기, 실패 표시, 참견
rec1 = ([user(FMT % H)] + tool("Read", {"file_path": "/a/b.py"}) + tool("Bash", {"command": "ls\n-la"})
        + tool("Edit", {"file_path": "/a/c.py"}, ok=False) + [user("그건 하지 마세요"), user("## 진행 계획을 지금 세워 주세요."),
                                                                reply("첫 회차 끝"), user(FMT % OTHER)]
        + tool("Bash", {"command": "다른티켓1"}) + tool("Bash", {"command": "다른티켓2"}))
rec2 = [user(FMT % H), reply("둘째 회차 응답")]
p1 = write("s1", rec1)
p2 = write("s2", rec2)
out = digest()
assert out.count("## 회차 ") == 2, out
a, b = out.split("## 회차 2")
assert "session_id=s1" in a and "session_id=s2" in b, out
assert a.count("Read: /a/b.py") == 1 and "Bash: ls -la" in a and "Edit: /a/c.py (실패)" in a, a
assert "[참견] 그건 하지 마세요" in a and "[엔진] ## 진행 계획을" in a and "첫 회차 끝" in a, a
assert "다른티켓" not in out and "줄 1-" in a, out

# 2. fm session_id 없음 = 위와 같다. transcript가 워크트리 밖 파일이면 회차가 더해진다
assert "session_id:" not in open(os.path.join(root, "tickets", H + ".done.md")).read()
outside = os.path.join(tmp, "outside.jsonl")
with open(outside, "w") as f:
    f.write(json.dumps(user("손으로 잡은 세션")) + "\n" + json.dumps(reply("밖의 응답")) + "\n")
ticket("transcript: %s\n" % outside)
out = digest()
assert out.count("## 회차 ") == 3 and "밖의 응답" in out and "outside" in out, out
ticket()

# 3. 도구 호출 200개 압축, 상한, 비밀 가리기
tok = "ghp_" + "A1b2C3d4E5" * 3
big = [user(FMT % H)]
for i in range(200):
    big += tool("Bash", {"command": "echo %d %s" % (i, "x" * 150)})
big += [user("토큰 %s 와 Bearer abc.def-ghi" % tok), reply("끝")]
for f in (p1, p2):
    os.remove(f)
write("big", big)
out = digest()
lines = [l for l in out.split("### 도구 호출\n")[1].split("\n\n")[0].split("\n")]
assert len(lines) == 61 and lines[40].startswith("(가운데 140건 생략: Bash 140)"), (len(lines), lines[40])
assert len(out.encode()) <= 20000 and tok not in out and "Bearer ***" in out and "토큰 *** 와" in out, out[:500]
# 상한을 넘기는 여러 회차: 오래된 회차가 개수 한 줄로 줄어든다
for k in range(6):
    write("big%d" % k, big)
out = digest()
assert len(out.encode()) <= 20000 and "(전체 200건 생략" in out and tok not in out, len(out.encode())

# 4. 못 찾음: 종료 코드 0, 한 줄과 찾아본 디렉터리
out = digest("cccc3333")
assert out.startswith("세션 기록을 찾지 못했다") and pdir in out, out

# 5. grok updates.jsonl와 codex rollout (P572-2): 같은 머리 - 도중 입력 - 도구 호출 - 마지막 응답
import shutil
shutil.rmtree(pdir)
from urllib.parse import quote
gdir = os.path.join(home, ".grok", "sessions", quote(os.path.abspath(wt), safe="!~*'()"), "gsid-1")
os.makedirs(gdir)


def gk(ts, upd):
    return {"timestamp": ts, "params": {"update": upd}}


def chunk(kind, text):
    return {"sessionUpdate": kind, "content": {"type": "text", "text": text}}


G = [gk(1000, chunk("user_message_chunk", (FMT % H)[:20])), gk(1000, chunk("user_message_chunk", (FMT % H)[20:])),
     gk(1001, {"sessionUpdate": "tool_call", "toolCallId": "c1", "rawInput": {"file_path": "/g/a.py"},
               "_meta": {"x.ai/tool": {"label": "Write"}}}),
     gk(1002, {"sessionUpdate": "tool_call_update", "toolCallId": "c1", "status": "failed",
               "content": [{"type": "content", "content": {"type": "text", "text": "oops"}}]}),
     gk(1003, chunk("user_message_chunk", "grok 참견")),
     gk(1004, chunk("agent_message_chunk", "grok 마지막 ")), gk(1004, chunk("agent_message_chunk", "응답")),
     gk(1005, {"sessionUpdate": "hook_execution"}),
     gk(1006, chunk("user_message_chunk", FMT % OTHER)), gk(1007, chunk("agent_message_chunk", "남의 응답"))]
with open(os.path.join(gdir, "updates.jsonl"), "w") as f:
    f.write("".join(json.dumps(r) + "\n" for r in G))
out = digest()
assert out.count("## 회차 ") == 1 and "grok session_id=gsid-1" in out, out
assert "[참견] grok 참견" in out and "Write: /g/a.py (실패)" in out and "grok 마지막 응답" in out, out
assert "남의 응답" not in out and "1970-01-01T00:16:40Z" in out, out

shutil.rmtree(os.path.join(home, ".grok"))
cdir = os.path.join(tmp, "codexhome", "sessions", "2026", "11", "28")
os.makedirs(cdir)
os.environ["CODEX_HOME"] = os.path.join(tmp, "codexhome")


def cx(ts, payload, typ="response_item"):
    return {"timestamp": ts, "type": typ, "payload": payload}


def msg(role, text):
    return {"type": "message", "role": role, "content": [{"type": "input_text" if role == "user" else "output_text",
                                                          "text": text}]}


C = [cx("2026-11-28T11:00:00Z", {"cwd": wt, "id": "x"}, "session_meta"),
     cx("2026-11-28T11:00:01Z", msg("user", FMT % H)),
     cx("2026-11-28T11:00:02Z", {"type": "function_call", "name": "shell", "call_id": "k1",
                                  "arguments": json.dumps({"command": ["ls"]})}),
     cx("2026-11-28T11:00:03Z", {"type": "function_call_output", "call_id": "k1", "output": "ok"}),
     cx("2026-11-28T11:00:04Z", msg("user", "codex 참견")),
     cx("2026-11-28T11:00:05Z", {"type": "reasoning", "summary": []}),
     cx("2026-11-28T11:00:06Z", msg("assistant", "codex 마지막 응답")),
     cx("2026-11-28T11:00:07Z", msg("user", FMT % OTHER)), cx("2026-11-28T11:00:08Z", msg("assistant", "남의 응답"))]
with open(os.path.join(cdir, "rollout-2026-11-28T11-00-00-abc.jsonl"), "w") as f:
    f.write("".join(json.dumps(r) + "\n" for r in C))
out = digest()
assert out.count("## 회차 ") == 1 and "codex session_id=rollout-" in out, out
assert "[참견] codex 참견" in out and 'shell: {"command": ["ls"]}' in out and "codex 마지막 응답" in out, out
assert "남의 응답" not in out and "2026-11-28T11:00:01Z" in out, out

# 6. 회차 60개: 오래된 회차를 생략하고 최신 회차는 남긴다, 줄 중간에서 끊기지 않는다
shutil.rmtree(cdir)
os.makedirs(pdir, exist_ok=True)
for f in os.listdir(pdir):
    os.remove(os.path.join(pdir, f))
for k in range(60):
    write("m%02d" % k, [user(FMT % H), reply("응답%02d " % k + "가" * 1400 + " 끝%02d." % k)])
out = digest()
n = out.count("## 회차 ")
assert len(out.encode()) <= 20000 and 1 < n < 60, (len(out.encode()), n, out)
assert out.startswith("(회차 ") and "개 생략: 오래된" in out.split("\n")[0], out[:100]
assert "끝59." in out and "끝00." not in out and out.rstrip().endswith("끝59."), out[-200:]

print("OK")
