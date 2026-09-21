#!/usr/bin/env python3
"""엔진 수정 마흔 번째 승인 §판정 1 자체검증(docs/DESIGN.md, 지적 `50ce9b91` - 답 `d4543693`
= `1.(a)`) - 수용조건 1~2. `tick.sh`가 디스패치 직전(`cleanup_stray_wip` 뒤, `cd
"$TICKET_CWD"` 전)에 워커 워크트리의 `git status --porcelain` 경로를
`$LOCAL/run/dirty-<티켓 해시>`에 한 줄씩 적고, 깨끗하면 그 파일을 안 만들거나 지우는지 잰다.
`test_dispatch_cleanup.py`의 harness를 그대로 이식했다. 실패하면 assert로 죽는다."""
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER_TMPL = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{cwd}"
TICKET_ENGINE=("{engine}" "{{prompt}}")
. "{tick}"
"""

# 비스트리밍 가짜 엔진 - 디스패치된 `.wip.md`를 바로 `.done.md`로 닫고 ok로 끝난다.
ENGINE = """\
#!/bin/bash
wip=$(ls "{tickets}"/*.wip.md 2>/dev/null | head -1)
[ -n "$wip" ] && mv "$wip" "${{wip%.wip.md}}.done.md"
echo '{{"is_error":false,"type":"result","session_id":"sess-x","subtype":"success"}}'
exit 0
"""

TICKET_OPEN = "---\nticket: {h}\ntitle: t\nkind: work\n---\n\n## Goal\n주인 경로: {path}\n"
TICKET_DONE = "---\nticket: {h}\ntitle: t\n---\n\n## Goal\n주인 경로: {path}\n"


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


def sh(*argv, **kw):
    r = subprocess.run(argv, capture_output=True, text=True, timeout=30, **kw)
    assert r.returncode == 0, "{}: {}\n{}".format(argv, r.returncode, r.stderr)
    return r


class Env:
    def __init__(self, tag):
        self.tmp = tempfile.mkdtemp(prefix="dirtydispatch-" + tag + "-")
        self.root = os.path.join(self.tmp, "dira")
        self.tickets = os.path.join(self.root, "tickets")
        self.repo = os.path.join(self.tmp, "repo")
        self.local = os.path.join(self.tmp, "local")
        os.makedirs(self.local)
        os.makedirs(self.repo)
        sh("git", "-C", self.repo, "init", "-q")
        sh("git", "-C", self.repo, "config", "user.email", "t@t.t")
        sh("git", "-C", self.repo, "config", "user.name", "t")
        engine = mkfile(os.path.join(self.tmp, "fake-engine.sh"),
                         ENGINE.format(tickets=self.tickets), 0o755)
        self.w1 = mkfile(os.path.join(self.root, "workers", "w1.sh"),
                          WORKER_TMPL.format(cwd=self.repo, engine=engine, tick=TICK), 0o755)
        self.env = dict(os.environ, TICKET_LOCAL=self.local)

    def owner(self, h, status, path):
        body = {"open": TICKET_OPEN, "done": TICKET_DONE}[status]
        name = h + {"open": ".md", "done": ".done.md"}[status]
        mkfile(os.path.join(self.tickets, name), body.format(h=h, path=path))

    def dirty_tracked(self, name):
        p = os.path.join(self.repo, name)
        mkfile(p, "v1\n")
        sh("git", "-C", self.repo, "add", name)
        sh("git", "-C", self.repo, "commit", "-q", "-m", "init " + name)
        mkfile(p, "v2\n")

    def dirty_untracked(self, name):
        mkfile(os.path.join(self.repo, name), "u\n")

    def tick(self):
        return subprocess.run([self.w1, "tick"], capture_output=True, text=True,
                               env=self.env, timeout=480)

    def dirty_fp(self, h):
        return os.path.join(self.local, "run", "dirty-" + h)

    def cleanup(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


envs = []


def newenv(tag):
    e = Env(tag)
    envs.append(e)
    return e


passed = 0
try:
    # ---- 1 - 트리가 더러운 채로 tick 돌리면 dirty-<해시>에 추적·미추적 경로가 다 찍힌다 -------
    e1 = newenv("dirty")
    h1 = "aaaa1001"
    # 주인을 .done으로 둬서 판정 2(cleanup_stray_wip)가 안 버리게 한다.
    e1.owner(h1, "done", "dirty_tracked.txt")
    e1.dirty_tracked("dirty_tracked.txt")
    e1.dirty_untracked("dirty_untracked.txt")
    e1.owner("aaaa1002", "open", "unrelated.txt")
    r = e1.tick()
    assert r.returncode == 0, "1: tick 실패\n" + r.stderr
    fp = e1.dirty_fp("aaaa1002")
    assert os.path.exists(fp), "1: dirty 기록 파일이 안 생겼다"
    with open(fp, encoding="utf-8") as f:
        lines = set(f.read().splitlines())
    assert "dirty_tracked.txt" in lines, lines
    assert "dirty_untracked.txt" in lines, lines
    passed += 1

    # ---- 2 - 트리가 깨끗하면 안 생기고, 앞 회차가 남긴 같은 이름의 파일도 지운다 -------------
    e2 = newenv("clean")
    h2 = "bbbb2002"
    e2.owner(h2, "open", "unrelated.txt")
    os.makedirs(os.path.join(e2.local, "run"), exist_ok=True)
    stale = e2.dirty_fp(h2)
    mkfile(stale, "stale_from_prev_run.txt\n")
    r = e2.tick()
    assert r.returncode == 0, "2: tick 실패\n" + r.stderr
    assert not os.path.exists(stale), "2: 깨끗한 트리인데 앞 회차 기록이 남았다"
    passed += 1

    print("test_dirty_dispatch_record: {} passed".format(passed))
finally:
    for e in envs:
        e.cleanup()
