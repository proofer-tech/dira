#!/usr/bin/env python3
"""감시자 티켓 문구(P563, 티켓 3bf0260a): 내부 코드 없이 읽히는가. 실패하면 assert로 죽는다."""
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ALERT = os.path.join(HERE, "templates", "watchdog_alert.py")
sys.path.insert(0, os.path.join(HERE, "templates"))
import watchdog_alert as wa  # noqa: E402


def mkroot(dirty=None):
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "tickets"))
    os.makedirs(os.path.join(root, "workers"))
    if dirty is not None:
        with open(os.path.join(root, "workers", ".gate-dirty"), "w", encoding="utf-8") as f:
            f.write(dirty)
    return root


def only_ticket(root):
    names = os.listdir(os.path.join(root, "tickets"))
    assert len(names) == 1, names
    with open(os.path.join(root, "tickets", names[0]), encoding="utf-8") as f:
        return f.read()


def title_of(body):
    return re.search(r"^title: (.*)$", body, re.M).group(1)


# 1-2. 실제 CLI: G1 사람편집 한 줄. 진단은 tickets/에 열린 티켓이 있어야 돈다.
root = mkroot("1700000000 /tmp/recv-tree\n M apps/teams/lib/x.ts\t사람편집\n")
open(os.path.join(root, "tickets", "aaaaaaaa.md"), "w").write("---\nticket: aaaaaaaa\n---\n")
env = dict(os.environ, TICKET_LOCAL=tempfile.mkdtemp())
subprocess.run([sys.executable, ALERT, root], check=True, capture_output=True, env=env)
names = [n for n in os.listdir(os.path.join(root, "tickets")) if n != "aaaaaaaa.md"]
names = [n for n in names if "watchdog_code: G1" in open(os.path.join(root, "tickets", n), encoding="utf-8").read()]
assert len(names) == 1, names
body = open(os.path.join(root, "tickets", names[0]), encoding="utf-8").read()
t = title_of(body)
assert not any(w in t for w in ("감시자", "G1", "사람이 쳐야")), t
assert "/tmp/recv-tree" in t and "파일 1개" in t, t
heads = [body.index(h) for h in ("## 무슨 일인가요", "## 걸린 대상",
                                "## 왜 자동으로 고치지 않았나요", "## 하실 일")]
assert heads == sorted(heads), heads
target = body[heads[1]:heads[2]]
assert "/tmp/recv-tree/apps/teams/lib/x.ts" in target, target
assert "자동 복구가 이미 한 번 실패했다" not in body

# 3. G1-G8 사람 줄 제목 여덟 개
lines = {
    "G1": "G1 사람 받는 트리가 더러워 push가 막힌다(1건)",
    "G2": "G2 사람 워커 1개 전부 전용 워크트리가 없다",
    "G3": "G3 사람 엔진 쿨다운이 100초 더 남았다(계정 전부 소진)",
    "G4": "G4 사람 claude 인증 토큰이 없거나 비었다",
    "G5": "G5 사람 워커 w1 셸이 30벌(상한 25)",
    "G6": "G6 사람 살아 있는 워커 1개의 크론 줄이 0개다",
    "G7": "G7 사람 git --version이 죽는다: xcode license",
    "G8": "G8 사람 조각/중복 티켓 파일 - a.md, a.wip.md",
}
for code, line in lines.items():
    r = mkroot("1700000000 /tmp/recv-tree\n M f.ts\t사람편집\n")
    open(os.path.join(r, "workers", "w1.sh"), "w").write("")
    c, who, text = wa.parse_line(line)
    assert wa.alert(r, [line], notify_fn=lambda *a: None), code
    tt = title_of(only_ticket(r))
    assert not re.search(r"G[0-9]|감시자", tt), (code, tt)
src = open(ALERT, encoding="utf-8").read()
assert "DEFAULT_COMMAND" not in src

# 4. G1 자력 + 표식 -> 한 번 고쳤는데 다시 걸렸다
r = mkroot("1700000000 /tmp/recv-tree\n?? junk\t잔해\n")
open(os.path.join(r, "workers", ".watchdog-G1"), "w").write("x\ny\n")
assert wa.alert(r, ["G1 자력 받는 트리가 더러워 push가 막힌다(1건)"], notify_fn=lambda *a: None)
b = only_ticket(r)
why = b[b.index("## 왜 자동으로 고치지 않았나요"):b.index("## 하실 일")]
assert "한 번 고쳤는데 같은 문제가 다시 걸렸습니다" in why, why
# 표식 없는 자력 줄은 티켓이 없다
r = mkroot()
assert wa.alert(r, ["G1 자력 받는 트리가 더러워 push가 막힌다(1건)"], notify_fn=lambda *a: None) == []

# 5. 모서리 입력 (티켓 c062b0aa)
def g1_body(dirty):
    r = mkroot(dirty)
    assert wa.alert(r, ["G1 사람 받는 트리가 더러워 push가 막힌다(1건)"], notify_fn=lambda *a: None)
    return only_ticket(r)

b = g1_body("1700000000 /tmp/p\n R  old.md -> new.md\t사람편집\n")
assert "/tmp/p/new.md" in b and "old.md" not in b, b
assert "restore new.md`" in b, b
b = g1_body('1700000000 /tmp/p\n?? "sp ace.md"\t잔해\n')
assert "/tmp/p/sp ace.md" in b and '"sp ace.md"' not in b.split("## 하실 일")[0], b
assert "restore 'sp ace.md'`" in b, b
for dirty in (None, "", "1700000000 /tmp/p\n"):
    r = mkroot(dirty)
    assert wa.alert(r, ["G1 사람 받는 트리가 더러워 push가 막힌다(1건)"], notify_fn=lambda *a: None)
    b = only_ticket(r)
    t = title_of(b)
    assert "0개" not in t and "읽지 못했" in t, t
    assert "<" not in b.split("## 하실 일")[1].split("## 진단")[0], b

r = mkroot()
open(os.path.join(r, "workers", "w1.sh"), "w").write("")
for line in ("G5 사람 워커 w1 셸이 30벌(상한 25)", "G5 사람 이상한 줄"):
    r = mkroot()
    assert wa.alert(r, [line], notify_fn=lambda *a: None)
    b = only_ticket(r)
    todo = b.split("## 하실 일")[1].split("## 진단")[0]
    assert "?" not in title_of(b) and "(워커)" not in title_of(b), title_of(b)
    assert "<pid>" not in todo and "kill" not in todo and "watchdog_gates.py" in todo and " recover " in todo, todo
print("ok")
