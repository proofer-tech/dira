#!/usr/bin/env python3
"""마이그레이션 항목 0003-team-into-queue 검증 (DESIGN.md P509-3). `python3 test_migrate_0003.py` 로 돈다.
임시 프로젝트(git) + 가짜 apm(DIRA_APM_BIN) + 임시 TICKET_LOCAL 만 쓴다."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

import test_migrate_0002 as t2
from test_migrate_0002 import w, read, git, HERE, MIGRATE

ID = "0003-team-into-queue"
MSG = "dira - 운영 정보를 .dira로 옮긴다 (P509)"


class Proj:
    def __init__(self, tracked=True, ignore_lines=True):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        self.proj = os.path.join(self.tmp, "proj")
        self.root = os.path.join(self.proj, ".dira")
        self.local = os.path.join(self.tmp, "local")
        self.mig = os.path.join(self.tmp, "mig")
        os.makedirs(self.mig)
        for n in ("0003_team_into_queue.py",):
            os.symlink(os.path.join(HERE, "migrations", n), os.path.join(self.mig, n))
        fake = os.path.join(self.tmp, "apm")
        w(fake, t2.FAKE_APM)
        os.chmod(fake, 0o755)
        w(os.path.join(self.local, "oauth-token"), "tok")
        T = self.proj + "/dira-team"
        w(T + "/apm.yml", "name: dira-team\nversion: 1.0.0\ntargets: [claude]\ndependencies:\n  apm:\n"
          "    - ../packages/dira-protocols\n    - ./protocols\n    - ./personas/dev\n")
        w(T + "/personas/dev/apm.yml", "name: persona-dev\nversion: 1.0.0\n")
        w(T + "/personas/dev/PROFILE.md", "# dev\n개발자 프로필\n")
        w(T + "/personas/dev/skills.md", "- `x` - 스킬\n")
        w(T + "/protocols/apm.yml", "name: project-protocols\nversion: 1.0.0\n")
        w(T + "/protocols/AGENTS.md", "# 협업 프로토콜\n프로젝트 고유\n")
        w(self.root + "/personas/dev/memory/note.md", "메모\n")
        w(self.root + "/tickets/.keep", "")
        shutil.copytree(os.path.join(HERE, "packages", "dira-protocols"), os.path.join(self.proj, "packages", "dira-protocols"))
        w(self.proj + "/.gitignore", ".dira\n" + ("dira-team/apm_modules/\ndira-team/.claude/\ndira-team/.agents/\n" if ignore_lines else ""))
        w(self.proj + "/apm.yml", "name: proj\nversion: 1.0.0\ntargets: [claude]\n")
        git(self.proj, "init", "-q")
        git(self.proj, "add", "-A", "--", *(["."] if tracked else [".gitignore", "apm.yml", "packages"]))
        git(self.proj, "commit", "-q", "-m", "init")
        w(os.path.join(self.local, "gui-projects.json"), json.dumps({"projects": [
            {"id": "dira", "name": "p", "root": self.root}]}))
        self.env = dict(os.environ, TICKET_LOCAL=self.local, DIRA_MIGRATIONS_DIR=self.mig, DIRA_APM_BIN=fake,
                        DIRA_MIGRATE_POLL_S="0.2",
                        GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")

        # 옛 배치의 큐도 이미 materialize 돼 있다(기준 프롬프트가 프로토콜을 담도록)
        subprocess.run([sys.executable, os.path.join(HERE, "dira_apm.py"), "install", self.proj, "--no-frozen"],
                       env=dict(self.env, TICKET_ROOT=self.root), capture_output=True, check=True)
        if tracked:  # 실제 프로젝트처럼 lock 도 커밋돼 있다
            git(self.proj, "add", "-A", "--", "dira-team")
            git(self.proj, "commit", "-q", "-m", "lock")

    def migrate(self, *a):
        return subprocess.run([sys.executable, MIGRATE, *a, "--root", self.root], env=self.env, capture_output=True, text=True)

    def subjects(self):
        return git(self.proj, "log", "--format=%s").stdout.split("\n")[:-1]

    def done(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def test_apply_idempotent_revert():
    t = Proj()
    try:
        before = {p: read(os.path.join(t.proj, "dira-team", p)) for p in ("apm.yml", "personas/dev/PROFILE.md", "protocols/AGENTS.md")}
        assert len(git(t.proj, "ls-files", "dira-team").stdout.split()) == 7
        r = t.migrate("apply")
        assert r.returncode == 0, r.stdout + r.stderr
        applied = json.load(open(t.root + "/migrations/applied.json"))
        assert applied[ID]["state"] == "ok", applied
        team = t.root + "/team"
        for p in ("personas/dev/PROFILE.md", "protocols/AGENTS.md"):
            assert read(team + "/" + p) == before[p]
        assert "    - ../../packages/dira-protocols\n" in read(team + "/apm.yml")
        assert "./personas/dev" in read(team + "/apm.yml")
        assert not os.path.exists(t.proj + "/dira-team")
        assert git(t.proj, "ls-files", "dira-team").stdout == ""
        assert "dira-team" not in read(t.proj + "/.gitignore")
        assert read(t.root + "/personas/dev/memory/note.md") == "메모\n"
        assert "고치지 말고 .dira/team/protocols" in read(t.root + "/protocols/CORE.md")
        subj = t.subjects()
        assert subj[0] == MSG and len(subj) == 3, subj
        dirty = [l for l in git(t.proj, "status", "--porcelain").stdout.splitlines() if "apm.lock.yaml" not in l]  # 루트 lock 은 가짜 apm 이 낸다
        assert not dirty, dirty
        # revert: 파일과 되돌림 커밋
        r = t.migrate("revert", "--id", ID)
        assert r.returncode == 0, r.stdout + r.stderr
        assert not os.path.exists(team)
        for p, v in before.items():
            assert read(os.path.join(t.proj, "dira-team", p)) == v, p
        assert "dira-team/apm_modules/" in read(t.proj + "/.gitignore")
        s2 = t.subjects()
        assert "revert" in s2[0] and len(s2) == 4, s2
        assert len(git(t.proj, "ls-files", "dira-team").stdout.split()) == 7, git(t.proj, "ls-files", "dira-team").stdout
        # 다시 적용(revert 가 지운 기록 뒤): 같은 결과
        assert t.migrate("apply").returncode == 0
        assert git(t.proj, "ls-files", "dira-team").stdout == "" and os.path.isfile(team + "/apm.yml")
        subj = t.subjects()
        # 멱등: 기록을 지우고 다시 돌려도 커밋이 안 는다
        os.remove(t.root + "/migrations/applied.json")
        assert t.migrate("apply").returncode == 0
        assert t.subjects() == subj, "두 번째 적용이 커밋을 냈다"
        assert read(team + "/personas/dev/PROFILE.md") == before["personas/dev/PROFILE.md"]
    finally:
        t.done()


def test_untracked_no_commit():
    t = Proj(tracked=False, ignore_lines=False)
    try:
        n = len(t.subjects())
        assert git(t.proj, "ls-files", "dira-team").stdout == ""
        r = t.migrate("apply")
        assert r.returncode == 0, r.stdout + r.stderr
        assert os.path.isfile(t.root + "/team/apm.yml") and not os.path.exists(t.proj + "/dira-team")
        assert len(t.subjects()) == n, t.subjects()
    finally:
        t.done()


def test_nothing_to_do():
    t = Proj()
    try:
        shutil.rmtree(t.proj + "/dira-team")
        assert t.migrate("apply").returncode == 0
        assert not os.path.exists(t.root + "/team")
    finally:
        t.done()


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            t0 = time.time()
            fn()
            print("PASS %s (%.1fs)" % (name, time.time() - t0))
    print("OK")
