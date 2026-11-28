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
print("OK")
