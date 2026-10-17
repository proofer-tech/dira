#!/usr/bin/env python3
"""마이그레이션 항목 0002-apm-packages 검증 (DESIGN.md P506-8). `python3 test_migrate_0002.py` 로 돈다.
임시 프로젝트(git) + 가짜 apm(DIRA_APM_BIN) + 임시 TICKET_LOCAL 만 쓴다. 진짜 ~/.claude 와 레지스트리는 안 건드린다."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATE = os.path.join(HERE, "migrate.py")

FAKE_APM = r'''#!/usr/bin/env python3
import os, re, shutil, sys
from pathlib import Path
if sys.argv[1] == "audit":
    sys.exit(0)
site = Path.cwd()
def yml(d):
    t = (d / "apm.yml").read_text()
    n = re.search(r"^name:\s*(\S+)", t, re.M).group(1)
    deps = re.findall(r"^\s+-\s+(\S+)\s*$", t, re.M)
    return n, [x for x in deps if x.startswith(".")]
seen, locks = {}, []
def walk(d):
    d = d.resolve()
    if d in seen:
        return
    n, deps = yml(d)
    seen[d] = n
    for x in deps:
        walk(d / x)
walk(site)
for d, n in seen.items():
    if d != site.resolve():
        dst = site / "apm_modules/_local" / n
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(d, dst, ignore=shutil.ignore_patterns("apm_modules"))
        locks.append("- repo_url: _local/%s\n  name: %s\n  source: local\n  local_path: %s\n" % (n, n, d))
    sk = d / ".apm/skills"
    if sk.is_dir():
        for s in sk.iterdir():
            tgt = site / ".claude/skills" / s.name
            shutil.rmtree(tgt, ignore_errors=True)
            shutil.copytree(s, tgt)
(site / "apm.lock.yaml").write_text("dependencies:\n" + "".join(locks))
'''


def w(p, text):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def git(proj, *a):
    return subprocess.run(["git", "-C", proj, *a], capture_output=True, text=True,
                          env=dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                                   GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t"))


class Proj:
    def __init__(self, bad_skill=False):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        self.proj = os.path.join(self.tmp, "proj")
        self.root = os.path.join(self.proj, ".dira")
        self.local = os.path.join(self.tmp, "local")
        self.skills = os.path.join(self.tmp, "skills")
        self.mig = os.path.join(self.tmp, "mig")
        os.makedirs(self.mig)
        os.symlink(os.path.join(HERE, "migrations", "0002_apm_packages.py"), os.path.join(self.mig, "0002_apm_packages.py"))
        fake = os.path.join(self.tmp, "apm")
        w(fake, FAKE_APM)
        os.chmod(fake, 0o755)
        w(os.path.join(self.local, "oauth-token"), "tok")
        w(os.path.join(self.skills, "x/SKILL.md"), "# x\n")
        w(os.path.join(self.skills, "x/ref/a.md"), "a\n")
        P = os.path.join(self.root, "personas")
        w(P + "/dev/PROFILE.md", "# dev\n개발자 프로필\n")
        w(P + "/dev/skills.md", "## 스킬\n\n- `x` - 로컬 스킬\n- `ghost` - 없는 스킬\n")
        w(P + "/dev/memory/note.md", "메모\n")
        w(P + "/dev/engine", "claude\n")
        w(P + "/writer/PROFILE.md", "# writer\n마켓에서 받은 뒤 고친 프로필\n")
        w(P + "/writer/skills.md", "- `x` - 같은 스킬\n")
        w(self.root + "/squads/default/members", "dev\nwriter\n")
        w(self.root + "/squads/default/rules", "# 규칙\n")
        w(self.root + "/protocols/AGENTS.md", "# 협업 프로토콜\n프로젝트 고유\n")
        w(self.root + "/protocols/only-here.md", "이 프로젝트만의 문서\n")
        w(self.root + "/tickets/.keep", "")
        pub = os.path.join(HERE, "packages", "dira-protocols")
        shutil.copytree(pub, os.path.join(self.proj, "packages", "dira-protocols"))
        shutil.copy(os.path.join(pub, "CORE.md"), self.root + "/protocols/CORE.md")  # 변환 전 큐도 코어가 있는 경우
        w(self.proj + "/.claude/skills/devskill/SKILL.md", "# devskill\n")
        w(self.proj + "/.claude/settings.json", "{}\n")
        w(self.proj + "/.gitignore", ".dira\n")
        w(self.proj + "/apm.yml", "name: proj\nversion: 1.0.0\ntargets: [claude]\n")
        git(self.proj, "init", "-q")
        git(self.proj, "add", "-A")
        git(self.proj, "commit", "-q", "-m", "init")
        w(os.path.join(self.local, "gui-projects.json"), json.dumps({"projects": [
            {"id": "dira", "name": "p", "root": self.root,
             "market": {"personas": {"writer": {"owner": "dira", "name": "writer", "v": 3}}, "squads": {}}},
            {"id": "other", "name": "o", "root": os.path.join(self.tmp, "other/.dira")}]}))
        self.env = dict(os.environ, TICKET_LOCAL=self.local, DIRA_MIGRATIONS_DIR=self.mig, DIRA_APM_BIN=fake,
                        TICKET_SKILLS_HOME=self.skills, DIRA_MIGRATE_POLL_S="0.2",
                        GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")

    def migrate(self, *a):
        return subprocess.run([sys.executable, MIGRATE, *a, "--root", self.root] if a[0] != "revert" else
                              [sys.executable, MIGRATE, *a, "--root", self.root],
                              env=self.env, capture_output=True, text=True)

    def tree(self):
        out = {}
        for base in (self.proj, ):
            for dp, dn, fn in os.walk(base):
                dn[:] = [d for d in dn if d not in (".git", "apm_modules", ".claude", "worktrees") or (d == ".claude" and dp == self.proj)]
                for f in fn:
                    p = os.path.join(dp, f)
                    rel = os.path.relpath(p, self.proj)
                    if not rel.startswith(".dira/migrations/"):  # 러너 기록과 백업은 적용마다 는다
                        out[rel] = open(p, "rb").read()
        return out

    def done(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def test_apply_idempotent_and_layout():
    t = Proj()
    try:
        mem = os.path.join(t.root, "personas/dev/memory/note.md")
        os.utime(mem, (1000000000, 1000000000))
        r = t.migrate("apply")
        assert r.returncode == 0, r.stdout + r.stderr
        lst = t.migrate("list").stdout
        assert "0002-apm-packages" in lst and "적용됨" in lst, lst
        team = os.path.join(t.proj, "dira-team")
        assert read(team + "/personas/dev/PROFILE.md") == "# dev\n개발자 프로필\n"
        assert read(team + "/personas/dev/skills.md").endswith("없는 스킬\n")
        assert "../../skills/x" in read(team + "/personas/dev/apm.yml") and "ghost" not in read(team + "/personas/dev/apm.yml")
        assert read(team + "/skills/x/.apm/skills/x/ref/a.md") == "a\n"
        assert read(team + "/squads/default/rules") == "# 규칙\n"
        assert read(team + "/protocols/AGENTS.md") == "# 협업 프로토콜\n프로젝트 고유\n"
        assert os.path.isfile(team + "/protocols/only-here.md")
        assert not os.path.exists(team + "/protocols/CORE.md"), "공용과 같은 문서는 로컬에 안 둔다"
        ty = read(team + "/apm.yml")
        assert "../packages/dira-protocols" in ty and "./protocols" in ty and "./personas/dev" in ty and "./squads/default" in ty, ty
        # 마켓 기록 -> 사본 + 의존성, 레지스트리 키 삭제
        assert "version: 3.0.0" in read(team + "/market/persona/dira/writer/apm.yml")
        assert "./market/persona/dira/writer" in ty and not os.path.exists(team + "/personas/writer")
        reg = json.load(open(os.path.join(t.local, "gui-projects.json")))
        assert "market" not in reg["projects"][0], reg
        assert json.load(open(t.root + "/migrations/backup/0002-apm-packages-market.json"))["personas"]["writer"]["v"] == 3
        # 개발 환경: 커밋된 .claude/skills 는 .apm/skills 로 옮기고 install 이 같은 자리로 다시 낸다
        assert read(t.proj + "/.apm/skills/devskill/SKILL.md") == "# devskill\n"
        assert read(t.proj + "/.claude/skills/devskill/SKILL.md") == "# devskill\n"
        assert read(t.proj + "/.claude/settings.json") == "{}\n"
        assert "dira-team/apm_modules/" in read(t.proj + "/.gitignore")
        # 정본 하나: 큐의 PROFILE/skills.md/squads 는 지워졌고 materialize 가 코어를 낸다
        assert not os.path.exists(t.root + "/personas/dev/PROFILE.md") and not os.path.exists(t.root + "/squads")
        assert "dira_apm materialize" in read(t.root + "/protocols/CORE.md")
        # memory/ 와 engine 은 그대로, mtime 불변
        assert os.path.getmtime(mem) == 1000000000 and read(mem) == "메모\n"
        assert read(t.root + "/personas/dev/engine") == "claude\n"
        # 커밋 하나
        log = git(t.proj, "log", "--format=%s").stdout.split("\n")
        assert log[0] == "dira - APM 전환 (P506)", log
        assert ".dira" not in git(t.proj, "show", "--stat", "--format=", "HEAD").stdout.replace("dira-team", "")
        # 멱등: 항목을 다시 돌려도(기록 지우고) 파일이 같고 커밋이 안 늘어난다
        before, n = t.tree(), len(log)
        applied = t.root + "/migrations/applied.json"
        os.remove(applied)
        r = t.migrate("apply")
        assert r.returncode == 0, r.stdout + r.stderr
        assert t.tree() == before, "두 번째 적용이 파일을 바꿨다"
        assert len(git(t.proj, "log", "--format=%s").stdout.split("\n")) == n, "두 번째 적용이 커밋을 냈다"
        # 다른 프로젝트 id(canary)는 건드리지 않는다는 것은 test_migrate.py 가 본다
    finally:
        t.done()


def test_dryrun_mismatch_fails_and_restores():
    t = Proj()
    try:
        # install 뒤 페르소나 하나의 프롬프트를 몰래 바꾸는 가짜 apm: 두 번째 PROFILE 이 다르게 나오게 한다
        before = t.tree()
        evil = os.path.join(t.tmp, "evil")
        w(evil, "#!/bin/sh\n[ \"$1\" = install ] && echo 바뀜 >> \"$PWD/personas/dev/PROFILE.md\" 2>/dev/null\n"
                "exec %s \"$@\"\n" % t.env["DIRA_APM_BIN"])
        os.chmod(evil, 0o755)
        t.env["DIRA_APM_BIN"] = evil
        r = t.migrate("apply")
        assert r.returncode != 0 or "실패" in r.stdout + r.stderr, r.stdout + r.stderr
        applied = json.load(open(t.root + "/migrations/applied.json"))
        assert applied["0002-apm-packages"]["state"] == "failed", applied
        assert "dryrun 이 달라졌다: dev" in applied["0002-apm-packages"]["error"], applied
        assert t.tree().keys() >= before.keys()
        for k, v in before.items():
            assert t.tree().get(k) == v, "복원이 안 됐다: " + k
        assert not os.path.exists(os.path.join(t.proj, "dira-team/apm.yml"))
        assert len(git(t.proj, "log", "--format=%s").stdout.split("\n")) == 2, "실패했는데 커밋이 났다"
    finally:
        t.done()


def test_commit_skips_project_hooks():
    t = Proj()
    try:
        hook = os.path.join(t.proj, ".git", "hooks", "pre-commit")
        w(hook, "#!/bin/sh\necho 훅이 고침 >> \"$PWD/dira-team/apm.yml\"\ngit add -A dira-team\n")
        os.chmod(hook, 0o755)
        assert t.migrate("apply").returncode == 0
        assert "훅이 고침" not in read(os.path.join(t.proj, "dira-team/apm.yml"))
        assert "APM" in git(t.proj, "log", "-1", "--format=%s").stdout
    finally:
        t.done()


def test_revert_restores_files():
    t = Proj()
    try:
        before = t.tree()
        assert t.migrate("apply").returncode == 0
        r = t.migrate("revert", "--id", "0002-apm-packages")
        assert r.returncode == 0, r.stdout + r.stderr
        for k, v in before.items():
            if k.startswith(".claude/") or k == ".gitignore" and False:
                continue
            assert t.tree().get(k) == v, "되돌림이 안 됐다: " + k
        assert not os.path.exists(os.path.join(t.proj, "dira-team/apm.yml"))
    finally:
        t.done()


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            t0 = time.time()
            fn()
            print("PASS %s (%.1fs)" % (name, time.time() - t0))
    print("OK")
