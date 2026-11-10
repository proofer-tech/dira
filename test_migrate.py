#!/usr/bin/env python3
"""migrate.py 검증 (DESIGN.md P505). `python3 test_migrate.py` 로 돈다. 임시 루트와 TICKET_LOCAL 을 쓴다."""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATE = os.path.join(HERE, "migrate.py")

ITEM_OK = '''
import os
ID = "0001-touch"; DESC = "d"; DESC_EN = "e"; SCOPE = "project"; REVERSIBLE = True
def targets(ctx): return [os.path.join(ctx.project_dir, "out.txt")]
def apply(ctx):
    with open(targets(ctx)[0], "w") as f: f.write("v1")
def verify(ctx): assert open(targets(ctx)[0]).read() == "v1"
'''
# 프로젝트 폴더 이름에 FAIL 이 들어 있으면 실패하는 항목
ITEM_BAD = '''
import os
ID = "0002-bad"; DESC = "d"; DESC_EN = "e"; SCOPE = "project"; REVERSIBLE = False
def targets(ctx): return [os.path.join(ctx.project_dir, "bad.txt")]
def apply(ctx):
    with open(targets(ctx)[0], "w") as f: f.write("half")
    if "FAIL" in ctx.project_dir: raise RuntimeError("boom")
def verify(ctx): pass
'''
ITEM_CANARY = ITEM_OK.replace("0001-touch", "0003-canary").replace("out.txt", "can.txt") \
    .replace("SCOPE = \"project\"", "SCOPE = \"project\"; ROLLOUT = \"canary\"")
# 시작하면 표식 파일을 쓰고, hang 파일이 있으면 멈춘다 (kill -9 시험용)
ITEM_HANG = '''
import os, time
ID = "0004-hang"; DESC = "d"; DESC_EN = "e"; SCOPE = "project"; REVERSIBLE = True
def targets(ctx): return [os.path.join(ctx.project_dir, "hang.txt")]
def apply(ctx):
    with open(targets(ctx)[0], "w") as f: f.write("new")
    if os.path.exists(os.path.join(ctx.local, "hang")):
        while True: time.sleep(1)
def verify(ctx): pass
'''


class Env:
    def __init__(self, items, projects):
        self.tmp = tempfile.mkdtemp()
        self.local = os.path.join(self.tmp, "local")
        self.mig = os.path.join(self.tmp, "mig")
        os.makedirs(self.mig)
        for name, src in items.items():
            with open(os.path.join(self.mig, name), "w") as f:
                f.write(src)
        self.roots = {}
        reg = []
        for pid in projects:
            root = os.path.join(self.tmp, pid, ".dira")
            os.makedirs(os.path.join(root, "tickets"))
            self.roots[pid] = root
            reg.append({"id": pid, "name": pid, "root": root})
        os.makedirs(self.local)
        with open(os.path.join(self.local, "gui-projects.json"), "w") as f:
            json.dump({"projects": reg}, f)
        self.env = dict(os.environ, TICKET_LOCAL=self.local, DIRA_MIGRATIONS_DIR=self.mig,
                        DIRA_MIGRATE_POLL_S="0.2")

    def run(self, *a):
        return subprocess.run([sys.executable, MIGRATE, *a], env=self.env,
                              capture_output=True, text=True)

    def popen(self, *a):
        return subprocess.Popen([sys.executable, MIGRATE, *a], env=self.env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def applied(self, pid):
        with open(os.path.join(self.roots[pid], "migrations", "applied.json")) as f:
            return json.load(f)

    def done(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def read(p):
    with open(p) as f:
        return f.read()


def wait_for(cond, secs=10):
    end = time.time() + secs
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.1)
    return False


def test_example_item_idempotent_and_dry_run():
    e = Env({"0001_migrations_readme.py": read(os.path.join(HERE, "migrations", "0001_migrations_readme.py"))}, ["p"])
    e.env.pop("DIRA_MIGRATIONS_DIR")
    e.env["DIRA_MIGRATIONS_DIR"] = os.path.join(HERE, "migrations")
    readme = os.path.join(e.roots["p"], "migrations", "README.md")
    # (e) dry-run 은 아무것도 안 바꾼다
    r = e.run("dry-run", "--root", e.roots["p"])
    assert r.returncode == 0 and "없음" in r.stdout and "0001-migrations-readme" in r.stdout, r.stdout
    assert not os.path.exists(os.path.join(e.roots["p"], "migrations")), "dry-run 이 폴더를 만들었다"
    assert e.run("check", "--root", e.roots["p"]).returncode == 1
    # (b) 멱등
    assert e.run("apply", "--root", e.roots["p"]).returncode == 0
    first = read(readme)
    mt = os.stat(readme).st_mtime_ns
    assert e.run("apply", "--root", e.roots["p"]).returncode == 0
    assert read(readme) == first and os.stat(readme).st_mtime_ns == mt
    # 항목을 직접 두 번 불러도 같은 결과
    sys.path.insert(0, os.path.join(HERE, "migrations"))
    import importlib
    m = importlib.import_module("0001_migrations_readme")

    class C:
        root = e.roots["p"]
    m.apply(C); m.apply(C)
    assert read(readme) == first
    assert e.run("check", "--root", e.roots["p"]).returncode == 0
    e.done()


def test_failure_isolated_and_backup_raw():
    e = Env({"0001_touch.py": ITEM_OK, "0002_bad.py": ITEM_BAD}, ["good", "FAIL"])
    for pid in e.roots:
        with open(os.path.join(os.path.dirname(e.roots[pid]), "bad.txt"), "w") as f:
            f.write("orig-" + pid)
    r = e.run("apply", "--all")
    assert r.returncode == 1, r.stderr
    # (c) 한 프로젝트만 복원
    good = os.path.dirname(e.roots["good"]); bad = os.path.dirname(e.roots["FAIL"])
    assert read(os.path.join(good, "bad.txt")) == "half" and e.applied("good")["0002-bad"]["state"] == "ok"
    assert read(os.path.join(bad, "bad.txt")) == "orig-FAIL", "실패 프로젝트가 복원되지 않았다"
    rec = e.applied("FAIL")["0002-bad"]
    assert rec["state"] == "failed" and rec["error"] == "boom"
    assert e.applied("FAIL")["0001-touch"]["state"] == "ok"
    # (f) zip 이 아닌 원본 백업과 manifest.json
    b = rec["backup"]
    assert os.path.isfile(os.path.join(b, "bad.txt")) and read(os.path.join(b, "bad.txt")) == "orig-FAIL"
    man = json.load(open(os.path.join(b, "manifest.json")))
    assert man == {"existed": [os.path.join(bad, "bad.txt")], "absent": []}, man
    for _, _, fs in os.walk(os.path.join(e.roots["FAIL"], "migrations", "backup")):
        assert not any(f.endswith((".zip", ".tar", ".gz")) for f in fs)
    log = read(os.path.join(e.roots["FAIL"], "migrations", "migrate.log"))
    assert "START 0002-bad" in log and "result=restored" in log
    # 게이트: 실패한 쪽은 막고 성공한 쪽은 통과
    r = e.run("gate", e.roots["FAIL"])
    assert r.returncode == 1 and r.stdout.strip() == "마이그레이션 미적용 0002-bad", r.stdout
    assert e.run("gate", e.roots["good"]).returncode == 0
    # REVERSIBLE 거짓은 revert 거절
    assert e.run("revert", "--root", e.roots["good"], "--id", "0002-bad").returncode == 1
    # revert 가능한 항목은 되돌린다
    assert e.run("revert", "--root", e.roots["good"], "--id", "0001-touch").returncode == 0
    assert not os.path.exists(os.path.join(good, "out.txt"))
    assert "0001-touch" not in e.applied("good")
    e.done()


def test_skip_blocks_gate_but_not_check():
    e = Env({"0002_bad.py": ITEM_BAD}, ["FAIL"])
    assert e.run("apply", "--root", e.roots["FAIL"]).returncode == 1
    assert e.run("skip", "--root", e.roots["FAIL"]).returncode == 0
    assert e.run("check", "--root", e.roots["FAIL"]).returncode == 0
    assert e.run("gate", e.roots["FAIL"]).returncode == 1
    assert e.run("apply", "--root", e.roots["FAIL"]).returncode == 1  # 건너뜀은 다시 안 돈다
    assert e.applied("FAIL")["0002-bad"]["state"] == "skipped"
    e.done()


def test_canary_and_promote():
    e = Env({"0003_canary.py": ITEM_CANARY}, ["dira", "other"])
    assert e.run("apply", "--all").returncode == 0
    assert os.path.exists(os.path.join(os.path.dirname(e.roots["dira"]), "can.txt"))
    assert not os.path.exists(os.path.join(os.path.dirname(e.roots["other"]), "can.txt"))
    assert e.run("gate", e.roots["other"]).returncode == 0, "보류는 막지 않는다"
    assert e.run("check", "--all").returncode == 0
    assert "보류" in e.run("list", "--root", e.roots["other"]).stdout
    assert e.run("promote", "0003-canary").returncode == 0
    assert e.run("gate", e.roots["other"]).returncode == 1
    assert e.run("apply", "--all").returncode == 0
    assert os.path.exists(os.path.join(os.path.dirname(e.roots["other"]), "can.txt"))
    e.done()


def test_number_clash_rc2():
    e = Env({"0001_a.py": ITEM_OK.replace("0001-touch", "0001-a"),
             "0001_b.py": ITEM_OK.replace("0001-touch", "0001-b")}, ["p"])
    assert e.run("list", "--all").returncode == 2
    assert e.run("gate", e.roots["p"]).returncode == 2
    e.done()
    e = Env({"0001_a.py": ITEM_OK}, ["p"])  # ID 와 파일 이름이 다르면 rc 2
    assert e.run("check", "--all").returncode == 2
    e.done()


def test_kill9_recovery():
    e = Env({"0004_hang.py": ITEM_HANG}, ["p"])
    pdir = os.path.dirname(e.roots["p"])
    with open(os.path.join(pdir, "hang.txt"), "w") as f:
        f.write("old")
    open(os.path.join(e.local, "hang"), "w").close()
    p = e.popen("apply", "--root", e.roots["p"])
    inflight = os.path.join(e.roots["p"], "migrations", "inflight.json")
    assert wait_for(lambda: os.path.exists(inflight) and read(os.path.join(pdir, "hang.txt")) == "new")
    assert e.run("gate", e.roots["p"]).stdout.strip() == "마이그레이션 진행 중"  # 러너 락이 살아 있다
    assert e.run("apply", "--root", e.roots["p"]).returncode == 3
    os.kill(p.pid, signal.SIGKILL); p.wait()
    assert e.run("gate", e.roots["p"]).returncode == 1  # 락은 죽은 pid, 기록은 ok 아님
    os.remove(os.path.join(e.local, "hang"))
    # 다음 러너가 먼저 복원하고 다시 적용한다
    assert e.run("apply", "--root", e.roots["p"]).returncode == 0
    log = read(os.path.join(e.roots["p"], "migrations", "migrate.log"))
    assert "result=restored" in log and "result=ok" in log, log
    assert not os.path.exists(inflight)
    assert read(os.path.join(pdir, "hang.txt")) == "new"
    e.done()


def test_waits_for_live_wip_and_status_file():
    e = Env({"0001_touch.py": ITEM_OK}, ["p"])
    wip = os.path.join(e.roots["p"], "tickets", "aaaaaaaa.wip.md")
    with open(wip, "w") as f:
        f.write("---\nticket: aaaaaaaa\npid: %d\n---\n" % os.getpid())  # 이 테스트 프로세스 = 산 pid
    status = os.path.join(e.tmp, "status.json")
    p = e.popen("apply", "--all", "--status", status)
    def row():
        try:
            return json.load(open(status))["rows"][-1]
        except (OSError, ValueError):
            return {}
    assert wait_for(lambda: row().get("state") == "세션 대기"), row()
    r = row()
    assert r["sessions"] == 1 and not os.path.exists(os.path.join(os.path.dirname(e.roots["p"]), "out.txt"))
    # 상태 파일 키가 스펙과 같다
    st = json.load(open(status))
    assert set(st) == {"pid", "started_at", "finished_at", "rows"} and st["finished_at"] is None
    assert set(r) == {"key", "name", "root", "state", "item", "desc", "desc_en", "sessions",
                      "waited_s", "error", "log", "backup"}, set(r)
    assert st["rows"][0]["key"] == "machine" and r["key"] == "p"
    os.rename(wip, wip.replace(".wip.md", ".done.md"))
    assert p.wait(timeout=15) == 0
    st = json.load(open(status))
    assert st["finished_at"] and st["rows"][-1]["state"] == "완료" and st["pid"] == p.pid
    # 죽은 pid 의 .wip 는 기다리지 않는다
    e2 = Env({"0001_touch.py": ITEM_OK}, ["p"])
    with open(os.path.join(e2.roots["p"], "tickets", "bbbbbbbb.wip.md"), "w") as f:
        f.write("---\npid: 999999\n---\n")
    assert e2.run("apply", "--all").returncode == 0
    e.done(); e2.done()


def test_skip_while_waiting_moves_on():
    e = Env({"0001_touch.py": ITEM_OK}, ["p"])
    with open(os.path.join(e.roots["p"], "tickets", "aaaaaaaa.wip.md"), "w") as f:
        f.write("---\npid: %d\n---\n" % os.getpid())
    p = e.popen("apply", "--root", e.roots["p"])
    time.sleep(1)
    assert e.run("skip", "--root", e.roots["p"]).returncode == 0
    assert p.wait(timeout=15) == 1
    e.done()


# ---- 0002-apm-packages (구 test_migrate_0002.py) ----

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


def readu(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def git(proj, *a):
    return subprocess.run(["git", "-C", proj, *a], capture_output=True, text=True,
                          env=dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                                   GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t"))


class Proj02:
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
    t = Proj02()
    try:
        mem = os.path.join(t.root, "personas/dev/memory/note.md")
        os.utime(mem, (1000000000, 1000000000))
        r = t.migrate("apply")
        assert r.returncode == 0, r.stdout + r.stderr
        lst = t.migrate("list").stdout
        assert "0002-apm-packages" in lst and "적용됨" in lst, lst
        team = os.path.join(t.proj, "dira-team")
        assert readu(team + "/personas/dev/PROFILE.md") == "# dev\n개발자 프로필\n"
        assert readu(team + "/personas/dev/skills.md").endswith("없는 스킬\n")
        assert "../../skills/x" in readu(team + "/personas/dev/apm.yml") and "ghost" not in readu(team + "/personas/dev/apm.yml")
        assert readu(team + "/skills/x/.apm/skills/x/ref/a.md") == "a\n"
        assert readu(team + "/squads/default/rules") == "# 규칙\n"
        assert readu(team + "/protocols/AGENTS.md") == "# 협업 프로토콜\n프로젝트 고유\n"
        assert os.path.isfile(team + "/protocols/only-here.md")
        assert not os.path.exists(team + "/protocols/CORE.md"), "공용과 같은 문서는 로컬에 안 둔다"
        ty = readu(team + "/apm.yml")
        assert "../packages/dira-protocols" in ty and "./protocols" in ty and "./personas/dev" in ty and "./squads/default" in ty, ty
        # 마켓 기록 -> 사본 + 의존성, 레지스트리 키 삭제
        assert "version: 3.0.0" in readu(team + "/market/persona/dira/writer/apm.yml")
        assert "./market/persona/dira/writer" in ty and not os.path.exists(team + "/personas/writer")
        reg = json.load(open(os.path.join(t.local, "gui-projects.json")))
        assert "market" not in reg["projects"][0], reg
        assert json.load(open(t.root + "/migrations/backup/0002-apm-packages-market.json"))["personas"]["writer"]["v"] == 3
        # 개발 환경: 커밋된 .claude/skills 는 .apm/skills 로 옮기고 install 이 같은 자리로 다시 낸다
        assert readu(t.proj + "/.apm/skills/devskill/SKILL.md") == "# devskill\n"
        assert readu(t.proj + "/.claude/skills/devskill/SKILL.md") == "# devskill\n"
        assert readu(t.proj + "/.claude/settings.json") == "{}\n"
        assert "dira-team/apm_modules/" in readu(t.proj + "/.gitignore")
        # 정본 하나: 큐의 PROFILE/skills.md/squads 는 지워졌고 materialize 가 코어를 낸다
        assert not os.path.exists(t.root + "/personas/dev/PROFILE.md") and not os.path.exists(t.root + "/squads")
        assert "dira_apm materialize" in readu(t.root + "/protocols/CORE.md")
        # memory/ 와 engine 은 그대로, mtime 불변
        assert os.path.getmtime(mem) == 1000000000 and readu(mem) == "메모\n"
        assert readu(t.root + "/personas/dev/engine") == "claude\n"
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
    t = Proj02()
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
    t = Proj02()
    try:
        hook = os.path.join(t.proj, ".git", "hooks", "pre-commit")
        w(hook, "#!/bin/sh\necho 훅이 고침 >> \"$PWD/dira-team/apm.yml\"\ngit add -A dira-team\n")
        os.chmod(hook, 0o755)
        assert t.migrate("apply").returncode == 0
        assert "훅이 고침" not in readu(os.path.join(t.proj, "dira-team/apm.yml"))
        assert "APM" in git(t.proj, "log", "-1", "--format=%s").stdout
    finally:
        t.done()


def test_revert_restores_files():
    t = Proj02()
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


# ---- 0003-team-into-queue (구 test_migrate_0003.py) ----

ID03 = "0003-team-into-queue"
MSG03 = "dira - 운영 정보를 .dira로 옮긴다 (P509)"


class Proj03:
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
        w(fake, FAKE_APM)
        os.chmod(fake, 0o755)
        w(os.path.join(self.local, "oauth-token"), "tok")
        T = self.proj + "/dira-team"
        w(T + "/apm.yml", "name: dira-team\nversion: 1.0.0\ntargets: [claude]\ndependencies:\n  apm:\n"
          "    - ../packages/dira-protocols\n    - ./protocols\n    - ./personas/dev\n")
        w(T + "/personas/dev/apm.yml", "name: persona-dev\nversion: 1.0.0\n")
        w(T + "/personas/dev/PROFILE.md", "# dev\n개발자 프로필\n")
        w(T + "/personas/dev/skills.md", "- `x` - 스킬\n")
        w(T + "/protocols/회고-예산.md", "한글 이름 파일\n")
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
    t = Proj03()
    try:
        before = {p: readu(os.path.join(t.proj, "dira-team", p)) for p in ("apm.yml", "personas/dev/PROFILE.md", "protocols/AGENTS.md")}
        assert len(git(t.proj, "ls-files", "dira-team").stdout.split()) == 8
        r = t.migrate("apply")
        assert r.returncode == 0, r.stdout + r.stderr
        applied = json.load(open(t.root + "/migrations/applied.json"))
        assert applied[ID03]["state"] == "ok", applied
        team = t.root + "/team"
        for p in ("personas/dev/PROFILE.md", "protocols/AGENTS.md"):
            assert readu(team + "/" + p) == before[p]
        assert "    - ../../packages/dira-protocols\n" in readu(team + "/apm.yml")
        assert "./personas/dev" in readu(team + "/apm.yml")
        assert not os.path.exists(t.proj + "/dira-team")
        assert git(t.proj, "ls-files", "dira-team").stdout == ""
        assert "dira-team" not in readu(t.proj + "/.gitignore")
        assert readu(t.root + "/personas/dev/memory/note.md") == "메모\n"
        assert "고치지 말고 .dira/team/protocols" in readu(t.root + "/protocols/CORE.md")
        subj = t.subjects()
        assert subj[0] == MSG03 and len(subj) == 3, subj
        dirty = [l for l in git(t.proj, "status", "--porcelain").stdout.splitlines() if "apm.lock.yaml" not in l]  # 루트 lock 은 가짜 apm 이 낸다
        assert not dirty, dirty
        # revert: 파일과 되돌림 커밋
        r = t.migrate("revert", "--id", ID03)
        assert r.returncode == 0, r.stdout + r.stderr
        assert not os.path.exists(team)
        for p, v in before.items():
            assert readu(os.path.join(t.proj, "dira-team", p)) == v, p
        assert "dira-team/apm_modules/" in readu(t.proj + "/.gitignore")
        s2 = t.subjects()
        assert "revert" in s2[0] and len(s2) == 4, s2
        assert len(git(t.proj, "ls-files", "dira-team").stdout.split()) == 8, git(t.proj, "ls-files", "dira-team").stdout
        # 다시 적용(revert 가 지운 기록 뒤): 같은 결과
        assert t.migrate("apply").returncode == 0
        assert git(t.proj, "ls-files", "dira-team").stdout == "" and os.path.isfile(team + "/apm.yml")
        subj = t.subjects()
        # 멱등: 기록을 지우고 다시 돌려도 커밋이 안 는다
        os.remove(t.root + "/migrations/applied.json")
        assert t.migrate("apply").returncode == 0
        assert t.subjects() == subj, "두 번째 적용이 커밋을 냈다"
        assert readu(team + "/personas/dev/PROFILE.md") == before["personas/dev/PROFILE.md"]
    finally:
        t.done()


def test_untracked_no_commit():
    t = Proj03(tracked=False, ignore_lines=False)
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
    t = Proj03()
    try:
        shutil.rmtree(t.proj + "/dira-team")
        assert t.migrate("apply").returncode == 0
        assert not os.path.exists(t.root + "/team")
    finally:
        t.done()


# ---- 0004-refresh-push-sh (구 test_migrate_0004.py) ----

def test_migration_0004_refresh_push_sh():
    """migrations/0004_refresh_push_sh.py - 옛 사본을 정본으로 굽고, 없는 사본은 만들지 않는다."""
    import importlib.util
    import types
    spec = importlib.util.spec_from_file_location("m4", os.path.join(HERE, "migrations", "0004_refresh_push_sh.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    with tempfile.TemporaryDirectory() as root:
        ctx = types.SimpleNamespace(root=root, engine=HERE)
        p = os.path.join(root, "push.sh")
        m.apply(ctx)
        assert not os.path.exists(p), "사본이 없는데 만들었다"
        m.verify(ctx)

        open(os.path.join(root, "integration-branch"), "w").write("main\n")
        open(p, "w").write("#!/bin/bash\n# 옛 사본\n")
        m.apply(ctx)
        body = open(p).read()
        assert "run_verify_changed_hook" in body and "<통합 브랜치>" not in body and '"main"' in body
        assert os.stat(p).st_mode & 0o111
        m.verify(ctx)
        m.apply(ctx)  # 두 번째는 그대로
        assert open(p).read() == body


if __name__ == "__main__":
    bad = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok  ", name)
            except Exception as ex:  # noqa
                import traceback
                traceback.print_exc()
                print("FAIL", name, ex)
                bad += 1
    sys.exit(1 if bad else 0)
