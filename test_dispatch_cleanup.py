#!/usr/bin/env python3
"""엔진 수정 마흔 번째 승인 §판정 2 자체검증(docs/DESIGN.md, 지적 `50ce9b91` - 답 `d4543693`
= `1.(b)`) - 수용조건 7~13. `tick.sh`의 `cleanup_stray_wip`이 디스패치 직전에 워크트리를
훑어 `워크트리.md` 3항(주인 티켓이 `.wip`이거나 미배정 -> 버린다)만 대신 집행하는지 잰다.

주인 찾기는 dirty 경로 문자열로 `<큐>/tickets/*.md`를 grep하는 방식이라, 각 시나리오의
"주인" 티켓은 그 경로 문자열을 본문에 담은 실제 큐 파일이다. 열림(미배정) 티켓 하나만 두고
그것이 디스패치 대상이자 동시에 "미배정 주인" 시나리오를 겸한다 - 다른 주인들은 이미
`.wip`/`.done`이라 선정 후보가 아니다. 실패하면 assert로 죽는다."""
import os
import shutil
import subprocess
import sys
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
# cleanup_stray_wip은 이 엔진이 뜨기 전에 이미 돈 뒤라 흉내낼 필요가 없다.
ENGINE = """\
#!/bin/bash
wip=$(ls "{tickets}"/*.wip.md 2>/dev/null | head -1)
[ -n "$wip" ] && mv "$wip" "${{wip%.wip.md}}.done.md"
echo '{{"is_error":false,"type":"result","session_id":"sess-x","subtype":"success"}}'
exit 0
"""

TICKET_OPEN = "---\nticket: {h}\ntitle: t\nkind: work\n---\n\n## Goal\n주인 경로: {path}\n"
TICKET_WIP = "---\nticket: {h}\ntitle: t\nsession_id: dead\n---\n\n## Goal\n주인 경로: {path}\n"
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


def git_status(repo):
    r = subprocess.run(["git", "-C", repo, "status", "--porcelain"],
                        capture_output=True, text=True, timeout=30)
    return r.stdout


class Env:
    def __init__(self, tag):
        self.tmp = tempfile.mkdtemp(prefix="dispatchcleanup-" + tag + "-")
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
        body = {"wip": TICKET_WIP, "done": TICKET_DONE, "open": TICKET_OPEN}[status]
        name = h + {"wip": ".wip.md", "done": ".done.md", "open": ".md"}[status]
        mkfile(os.path.join(self.tickets, name), body.format(h=h, path=path))

    def dirty_tracked(self, name):
        p = os.path.join(self.repo, name)
        mkfile(p, "v1\n")
        sh("git", "-C", self.repo, "add", name)
        sh("git", "-C", self.repo, "commit", "-q", "-m", "init " + name)
        mkfile(p, "v2\n")  # 커밋 뒤 수정 -> git status에 " M name"으로 잡힌다

    def dirty_untracked(self, name):
        mkfile(os.path.join(self.repo, name), "u\n")

    def tick(self):
        return subprocess.run([self.w1, "tick"], capture_output=True, text=True,
                               env=self.env, timeout=480)

    def runner_log(self):
        try:
            with open(os.path.join(self.root, "workers", "runner.log"), encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def status(self):
        return git_status(self.repo)

    def cleanup(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


envs = []


def newenv(tag):
    e = Env(tag)
    envs.append(e)
    return e


passed = 0
try:
    # ---- 7·11 - 주인이 .wip -> 추적·미추적 둘 다 버려지고 NOTE가 남는다 -------------------
    e7 = newenv("wip")
    e7.owner("aaaa0007", "wip", "wip_tracked.txt")
    e7.owner("aaaa0008", "wip", "wip_untracked.txt")
    e7.dirty_tracked("wip_tracked.txt")
    e7.dirty_untracked("wip_untracked.txt")
    # 디스패치될 열린 티켓 하나(무관한 경로) - 없으면 선정 후보가 0이라 DISPATCH 자체가 안 난다
    e7.owner("aaaa0009", "open", "unrelated.txt")
    r = e7.tick()
    assert r.returncode == 0, "7: tick 실패\n" + r.stderr
    log7 = e7.runner_log()
    assert "cleanup_stray_wip 버림 path=wip_tracked.txt owner=aaaa0007" in log7, log7
    assert "cleanup_stray_wip 버림(미추적) path=wip_untracked.txt owner=aaaa0008" in log7, log7
    st7 = e7.status()
    assert "wip_tracked.txt" not in st7, "7: 추적 파일이 안 버려졌다: " + st7
    assert not os.path.exists(os.path.join(e7.repo, "wip_untracked.txt")), "7: 미추적 파일이 안 지워졌다"
    passed += 1

    # ---- 8 - 주인이 미배정(<해시>.md) -> 같은 갈래(버림). 그 자신이 디스패치 대상이다 --------
    e8 = newenv("unassigned")
    e8.owner("bbbb0010", "open", "unassigned_tracked.txt")
    e8.dirty_tracked("unassigned_tracked.txt")
    r = e8.tick()
    assert r.returncode == 0, "8: tick 실패\n" + r.stderr
    log8 = e8.runner_log()
    assert "cleanup_stray_wip 버림 path=unassigned_tracked.txt owner=bbbb0010" in log8, log8
    assert "unassigned_tracked.txt" not in e8.status(), "8: 미배정 주인 경로가 안 버려졌다"
    passed += 1

    # ---- 9 - 주인이 .done -> 안 건드린다. 주인을 못 찾아도 안 건드린다 ----------------------
    e9 = newenv("done")
    e9.owner("cccc0011", "done", "done_tracked.txt")
    e9.dirty_tracked("done_tracked.txt")
    e9.dirty_untracked("nobody_owns_this.txt")
    e9.owner("cccc0012", "open", "unrelated.txt")
    r = e9.tick()
    assert r.returncode == 0, "9: tick 실패\n" + r.stderr
    log9 = e9.runner_log()
    assert "path=done_tracked.txt" not in log9, "9: .done 주인 경로를 건드렸다\n" + log9
    assert "path=nobody_owns_this.txt" not in log9, "9: 무주인 경로를 건드렸다\n" + log9
    st9 = e9.status()
    assert "done_tracked.txt" in st9, "9: .done 주인 경로가 사라졌다: " + st9
    assert os.path.exists(os.path.join(e9.repo, "nobody_owns_this.txt")), "9: 무주인 파일이 지워졌다"
    passed += 1

    # ---- 10 - 같은 경로 문자열을 주인 둘이 물면 안 건드린다 --------------------------------
    e10 = newenv("ambiguous")
    e10.owner("dddd0013", "done", "ambig.txt")
    e10.owner("dddd0014", "wip", "ambig.txt")
    e10.dirty_untracked("ambig.txt")
    e10.owner("dddd0015", "open", "unrelated.txt")
    r = e10.tick()
    assert r.returncode == 0, "10: tick 실패\n" + r.stderr
    assert "path=ambig.txt" not in e10.runner_log(), "10: 주인 2건인데 건드렸다\n" + e10.runner_log()
    assert os.path.exists(os.path.join(e10.repo, "ambig.txt")), "10: 주인 2건 경로가 지워졌다"
    passed += 1

    # ---- 12 - 정리가 실패해도(git 저장소가 아님) 디스패치는 종전대로 간다 ------------------
    e12 = newenv("gitfail")
    shutil.rmtree(os.path.join(e12.repo, ".git"))  # git status가 실패하는 트리로 만든다
    e12.owner("eeee0016", "open", "unrelated.txt")
    r = e12.tick()
    assert r.returncode == 0, "12: git repo가 아닌데도 tick이 실패했다\n" + r.stderr
    assert "DONE eeee0016" in e12.runner_log(), "12: 정리 실패가 디스패치를 막았다\n" + e12.runner_log()
    passed += 1

    print("test_dispatch_cleanup: {} passed".format(passed))
finally:
    for e in envs:
        e.cleanup()
