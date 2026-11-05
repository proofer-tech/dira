#!/usr/bin/env python3
"""P547-2 자체검증(docs/DESIGN.md P547 결정 2-3) - `.wip`을 남기고 끝난 회차의 작업물을 git ref로 보관하고
같은 해시의 다음 회차가 복원하는지 잰다. 워크트리 둘(A, B)이 한 저장소를 공유한다. 가짜 엔진은 `mode` 파일에 따라
워크트리를 더럽히거나(dirty) 받은 프롬프트와 `git status`를 남긴다(look). 실패하면 assert로 죽는다."""
__import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
H = "bbbb0547"
REF = "refs/dira/wip/" + H

WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{cwd}"
TICKET_ENGINE=("{engine}" "{{prompt}}")
. "{tick}"
"""

# dirty: 추적 파일 수정 + 미추적 파일 하나를 남기고 ok로 끝난다(.wip 유지 -> FAIL 경로).
# look: 받은 프롬프트와 status를 파일에 남기고 .done으로 닫는다.
ENGINE = """\
#!/bin/bash
case "$(cat "{modef}")" in
  dirty) echo mine > tracked.txt; echo new > untracked.txt ;;
  look)  printf '%s' "$1" > "{tmp}/prompt.txt"; git status --porcelain > "{tmp}/status.txt"
         wip=$(ls "{tickets}"/*.wip.md | head -1); mv "$wip" "${{wip%.wip.md}}.done.md" ;;
esac
echo '{{"is_error":false,"type":"result","session_id":"sess-x","subtype":"success"}}'
exit 0
"""


def sh(*a, cwd=None):
    r = subprocess.run(a, capture_output=True, text=True, timeout=60, cwd=cwd)
    assert r.returncode == 0, "{}: {}".format(a, r.stderr)
    return r.stdout


def write(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)


class Env:
    def __init__(self):
        self.tmp = tempfile.mkdtemp(prefix="wipref-")
        self.root = os.path.join(self.tmp, "dira")
        self.tickets = os.path.join(self.root, "tickets")
        self.local = os.path.join(self.tmp, "local")
        os.makedirs(self.local)
        self.a = os.path.join(self.tmp, "A")
        self.b = os.path.join(self.tmp, "B")
        os.makedirs(self.a)
        sh("git", "init", "-q", cwd=self.a)
        sh("git", "config", "user.email", "t@t.t", cwd=self.a)
        sh("git", "config", "user.name", "t", cwd=self.a)
        write(os.path.join(self.a, "tracked.txt"), "base\n")
        sh("git", "add", "-A", cwd=self.a)
        sh("git", "commit", "-q", "-m", "init", cwd=self.a)
        sh("git", "worktree", "add", "-q", "-b", "wt-b", self.b, cwd=self.a)
        self.modef = os.path.join(self.tmp, "mode")
        write(self.modef, "dirty\n")
        engine = os.path.join(self.tmp, "engine.sh")
        write(engine, ENGINE.format(modef=self.modef, tmp=self.tmp, tickets=self.tickets), 0o755)
        for n, cwd in (("wa", self.a), ("wb", self.b)):
            write(os.path.join(self.root, "workers", n + ".sh"),
                  WORKER.format(name=n, cwd=cwd, engine=engine, tick=TICK), 0o755)
        write(os.path.join(self.tickets, H + ".md"),
              "---\nticket: {}\ntitle: t\nkind: work\n---\n\n## Goal\nx\n".format(H))
        self.env = dict(os.environ, TICKET_LOCAL=self.local)

    def mode(self, m):
        write(self.modef, m + "\n")

    def tick(self, w):
        return subprocess.run([os.path.join(self.root, "workers", w + ".sh"), "tick"],
                              capture_output=True, encoding="utf-8", errors="replace", env=self.env, timeout=300)

    def log(self):
        try:
            return open(os.path.join(self.root, "workers", "runner.log"), encoding="utf-8").read()
        except OSError:
            return ""

    def status(self, wt):
        return sh("git", "status", "--porcelain", cwd=wt)

    def reopen(self):
        """FAIL 뒤 티켓을 다시 열린 상태로 둔다(리퍼가 하는 일) - .wip이 남았으면 이름을 되돌린다."""
        for n in os.listdir(self.tickets):
            if n.endswith(".wip.md"):
                os.rename(os.path.join(self.tickets, n), os.path.join(self.tickets, n[:-7] + ".md"))
                p = os.path.join(self.tickets, n[:-7] + ".md")
                body = [l for l in open(p, encoding="utf-8").read().splitlines()
                        if not l.startswith(("session_id:", "pid:", "assigned_at:", "owner:", "inbox:"))]
                write(p, "\n".join(body) + "\n")


tmps = []
try:
    # ---- 1 - A가 .wip을 남기고 끝나면 보관된다 ---------------------------------------------
    e = Env(); tmps.append(e.tmp)
    stash_before = sh("git", "stash", "list", cwd=e.a)
    r = e.tick("wa")
    assert r.returncode == 0, r.stderr
    log = e.log()
    assert "NOTE %s 작업물 보관 ref=%s paths=2" % (H, REF) in log, log
    st_a = e.status(e.a)
    assert " M tracked.txt" in st_a and "?? untracked.txt" in st_a, st_a   # 작업 트리는 그대로
    assert sh("git", "stash", "list", cwd=e.a) == stash_before
    assert sh("git", "diff", "--cached", "--name-only", cwd=e.a) == ""     # 인덱스도 그대로
    sh("git", "rev-parse", "--verify", REF, cwd=e.a)
    print("1 ok")

    # ---- 2 - 같은 해시를 B에 디스패치하면 복원된다 ----------------------------------------
    e.reopen()
    e.mode("look")
    head_b = sh("git", "rev-parse", "HEAD", cwd=e.b)
    r = e.tick("wb")
    assert r.returncode == 0, r.stderr
    log = e.log()
    assert "NOTE %s 작업물 복원 paths=2" % H in log, log
    st = open(os.path.join(e.tmp, "status.txt"), encoding="utf-8").read()
    assert " M tracked.txt" in st and "?? untracked.txt" in st, st
    assert sh("git", "rev-parse", "HEAD", cwd=e.b) == head_b
    assert subprocess.run(["git", "rev-parse", "--verify", "-q", REF], cwd=e.b, capture_output=True).returncode != 0
    prompt = open(os.path.join(e.tmp, "prompt.txt"), encoding="utf-8").read()
    assert "앞 회차의 커밋 안 된 변경 2건을 이 워크트리에 복원했습니다. git status로 확인하고 이어서 하세요." in prompt, prompt
    print("2 ok")

    # ---- 3 - B 기준이 같은 파일을 다르게 고쳐 충돌하면 그대로 두고 ref를 남긴다 ---------------
    e3 = Env(); tmps.append(e3.tmp)
    e3.tick("wa"); e3.reopen()
    write(os.path.join(e3.b, "tracked.txt"), "other\n")
    sh("git", "commit", "-qam", "b edit", cwd=e3.b)
    e3.mode("look")
    before = e3.status(e3.b)
    head_b = sh("git", "rev-parse", "HEAD", cwd=e3.b)
    r = e3.tick("wb")
    assert r.returncode == 0, r.stderr
    log = e3.log()
    assert "WARN %s 작업물 복원 충돌 ref=%s" % (H, REF) in log, log
    st = open(os.path.join(e3.tmp, "status.txt"), encoding="utf-8").read()
    assert st == before == "", (st, before)
    assert sh("git", "rev-parse", "HEAD", cwd=e3.b) == head_b
    sh("git", "rev-parse", "--verify", REF, cwd=e3.b)
    prompt = open(os.path.join(e3.tmp, "prompt.txt"), encoding="utf-8").read()
    assert "앞 회차의 작업물이 %s에 있습니다. git show로 보고 필요한 것만 가져오세요." % REF in prompt, prompt
    print("3 ok")

    # ---- 4 - cleanup_stray_wip: .done이면 ref 삭제, 버리기 전 보관 ------------------------------
    e4 = Env(); tmps.append(e4.tmp)
    sh("git", "update-ref", "refs/dira/wip/cccc0001", "HEAD", cwd=e4.a)
    write(os.path.join(e4.tickets, "cccc0001.done.md"), "---\nticket: cccc0001\n---\n\nx\n")
    # 다른 .wip 티켓 소유의 더러운 경로 둘(추적 수정 + 미추적) -> 버려지되 먼저 보관된다
    write(os.path.join(e4.tickets, "dddd0002.wip.md"),
          "---\nticket: dddd0002\nsession_id: dead\npid: %d\n---\n\ntracked.txt untracked.txt\n" % os.getpid())
    write(os.path.join(e4.a, "tracked.txt"), "dirty\n")
    write(os.path.join(e4.a, "untracked.txt"), "u\n")
    e4.mode("look")
    r = e4.tick("wa")
    assert r.returncode == 0, r.stderr
    log = e4.log()
    assert subprocess.run(["git", "rev-parse", "--verify", "-q", "refs/dira/wip/cccc0001"],
                          cwd=e4.a, capture_output=True).returncode != 0, log
    assert "NOTE dddd0002 작업물 보관 ref=refs/dira/wip/dddd0002 paths=2" in log, log
    assert "cleanup_stray_wip 버림 path=tracked.txt owner=dddd0002" in log, log
    assert "dirty" in sh("git", "show", "refs/dira/wip/dddd0002:tracked.txt", cwd=e4.a)
    print("4 ok")
finally:
    for t in tmps:
        shutil.rmtree(t, ignore_errors=True)
print("ALL PASS")
