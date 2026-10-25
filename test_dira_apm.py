#!/usr/bin/env python3
"""dira_apm.py 시험. 임시 디렉터리의 가짜 패키지와 가짜 apm(DIRA_APM_BIN)만 쓴다."""
import os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
APM = HERE / "dira_apm.py"


def w(p, text=""):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def pkg(d, name, deps=(), skills=()):
    w(Path(d) / "apm.yml", "name: %s\nversion: 1.0.0\n" % name +
      ("dependencies:\n  apm:\n" + "".join("    - %s\n" % x for x in deps) if deps else ""))
    for s in skills:
        w(Path(d) / ".apm/skills" / s / "SKILL.md", "# " + s)


def run(*args, env=None):
    e = dict(os.environ, DIRA_APM_BIN=str(FAKE), **(env or {}))
    r = subprocess.run([sys.executable, str(APM), *map(str, args)], capture_output=True, text=True, env=e)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


FAKE = Path(tempfile.mkdtemp()) / "apm"
FAKE.write_text("#!/bin/sh\nexit 0\n")
FAKE.chmod(0o755)


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(os.path.realpath(self.tmp.name)) / "proj"
        self.team = self.root / "dira-team"
        w(self.team / "apm.yml", "name: team\nversion: 1.0.0\n")

    def tearDown(self):
        self.tmp.cleanup()

    def _relative_lock(self):  # 실제 lock 처럼 local_path 가 전부 site 기준 상대경로다
        for n in ("pm", "qa"):
            pkg(self.team / "personas" / n, "persona-" + n)
            w(self.team / "personas" / n / "skills.md", "- `a` - x\n")
            pkg(self.team / "apm_modules/_local" / n, "persona-" + n)
            w(self.team / "apm_modules/_local" / n / "skills.md", "- `a` - x\n")
        w(self.team / "apm.lock.yaml", "dependencies:\n" + "".join(
            "- repo_url: _local/%s\n  name: persona-%s\n  source: local\n  local_path: ./personas/%s\n" % (n, n, n)
            for n in ("pm", "qa")))
        self.assertEqual(run("check", self.root)[0], 0)

    def test_drift_relative_modified(self):  # P506-11 (b)
        self._relative_lock()
        with open(self.team / "apm_modules/_local/pm/skills.md", "a") as f:
            f.write("- `b` - 추가\n")
        rc, out, _ = run("check", self.root)
        self.assertEqual(rc, 1)
        self.assertIn("persona-pm", out)

    def test_drift_relative_deleted(self):  # P506-11 (b)
        self._relative_lock()
        shutil.rmtree(self.team / "apm_modules/_local/qa")
        rc, out, _ = run("check", self.root)
        self.assertEqual(rc, 1)
        self.assertIn("persona-qa", out)

    def test_conflict(self):  # (1)
        pkg(self.team / "apm_modules/a/one", "pkg-one", skills=["dup"])
        pkg(self.team / "apm_modules/b/two", "pkg-two", skills=["dup"])
        rc, out, _ = run("check", self.root)
        self.assertEqual(rc, 1)
        self.assertIn("pkg-one", out)
        self.assertIn("pkg-two", out)

    def test_persona_closure(self):  # (2)
        pd = self.team / "personas/dev"
        pkg(pd, "persona-dev", deps=["../../skills/x"])
        pkg(self.team / "skills/x", "skill-x", skills=["x"])
        w(pd / "skills.md", "- `x` - ok\n")
        self.assertEqual(run("check", self.root)[0], 0)
        w(pd / "skills.md", "- `x` - ok\n- `ghost` - 없음\n")
        self.assertEqual(run("check", self.root)[0], 0)  # 어느 패키지에도 없는 이름은 텍스트로만 남는다
        pkg(self.team / "skills/ghost", "skill-ghost", skills=["ghost"])  # 깔려 있는데 폐포에 없으면 오류
        rc, out, _ = run("check", self.root)
        self.assertEqual(rc, 1)
        self.assertIn("ghost", out)

    def test_resolve(self):  # (3)
        pkg(self.team / "personas/pm", "persona-pm")
        pkg(self.team / "apm_modules/a/pm", "persona-pm")
        rc, out, _ = run("resolve", self.root, "persona", "pm")
        self.assertEqual((rc, out), (0, str(self.team / "personas/pm")))  # 로컬 우선
        pkg(self.team / "apm_modules/a/qa1", "persona-qa")
        w(self.team / "apm_modules/a/qa1/PROFILE.md", "1")
        pkg(self.team / "apm_modules/b/qa2", "persona-qa")
        w(self.team / "apm_modules/b/qa2/PROFILE.md", "2")
        self.assertEqual(run("resolve", self.root, "persona", "qa")[0], 1)
        pkg(self.team / "apm_modules/c/dw", "persona-writer")
        self.assertEqual(run("resolve", self.root, "persona", "writer")[0], 0)
        (self.team / "apm.yml").unlink()
        self.assertEqual(run("resolve", self.root, "persona", "pm")[0], 3)

    def test_materialize(self):  # (4)
        pkg(self.team / "apm_modules/a/p", "dira-protocols")
        w(self.team / "apm_modules/a/p/CORE.md", "공용 코어\n")
        w(self.team / "apm_modules/a/p/tickets.md", "공용 티켓\n")
        w(self.team / "protocols/apm.yml", "name: local-protocols\nversion: 1.0.0\n")
        w(self.team / "protocols/tickets.md", "로컬 티켓\n")
        w(self.team / "protocols/AGENTS.md", "에이전트\n")
        out = self.root / ".dira/protocols"
        w(out / "qa-scratch-1.md", "큐 전용")
        self.assertEqual(run("materialize", self.root)[0], 0)
        mark = (out / "CORE.md").read_text().splitlines()[0]
        self.assertTrue(mark.startswith("<!-- dira_apm materialize"))
        self.assertEqual((out / "tickets.md").read_text().splitlines()[1], "로컬 티켓")
        self.assertEqual((out / "CORE.md").read_text().splitlines()[1], "공용 코어")
        self.assertTrue((out / "AGENTS.md").exists())
        self.assertEqual((out / "qa-scratch-1.md").read_text(), "큐 전용")
        self.assertFalse((out / "apm.yml").exists())

    def test_team_dir(self):  # P509 결정 3
        q = self.root / ".dira/team"
        self.assertEqual(run("team", self.root), (0, str(self.team), ""))  # dira-team 만
        w(q / "apm.yml", "name: team\nversion: 1.0.0\n")
        self.assertEqual(run("team", self.root), (0, str(q), ""))  # 둘 다면 .dira/team 이 이긴다
        shutil.rmtree(self.team)
        self.assertEqual(run("team", self.root), (0, str(q), ""))  # .dira/team 만
        shutil.rmtree(q)
        self.assertEqual(run("team", self.root)[0], 3)  # 둘 다 없다

    def test_root_check_skips_queue_team(self):  # P509 결정 4
        shutil.rmtree(self.team)
        w(self.root / "apm.yml", "name: root\nversion: 1.0.0\n")
        pkg(self.root / ".dira/team", "team", skills=("dup",))
        pkg(self.root / "tool", "tool", skills=("dup",))
        self.assertEqual(run("check", self.root)[0], 0)  # .dira/team 의 dup 이 루트 패키지로 세어지면 충돌이다

    def test_skills(self):  # (5)
        pd = self.team / "personas/dev"
        pkg(pd, "persona-dev")
        w(pd / "skills.md", "- `has` - a\n- `empty` - b\n- `none` - c\n")
        w(self.team / ".claude/skills/has/SKILL.md", "x")
        (self.team / ".claude/skills/empty").mkdir(parents=True)
        rc, out, _ = run("skills", self.root, "dev")
        self.assertEqual((rc, out), (0, str(self.team / ".claude/skills/has")))


TICK = HERE / "tick.sh"


class TickT(unittest.TestCase):
    """tick.sh 주입(P506-3): 임시 큐 + 가짜 claude + 가짜 apm."""

    def setUp(self):
        self.tmp = Path(os.path.realpath(tempfile.mkdtemp()))
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        self.proj = self.tmp / "proj"
        self.root = self.proj / ".dira"
        self.local = self.tmp / "local"
        (self.local).mkdir()
        (self.tmp / "home").mkdir()
        w(self.tmp / "claude", '#!/bin/bash\nprintf \'{"session_id":"%s","type":"result","is_error":false,"subtype":"success"}\\n\' "$1"\n')
        (self.tmp / "claude").chmod(0o755)
        w(self.root / "workers/w1.sh", '#!/bin/bash\nTICKET_NAME="w1"\nTICKET_CWD="%s"\nTICKET_PROMPT_FMT="pick %%s"\n'
          'TICKET_ENGINE=("%s/claude" "{sid}")\n. "%s"\n' % (self.proj, self.tmp, TICK))
        (self.root / "workers/w1.sh").chmod(0o755)
        w(self.local / "oauth-token", "tok")
        w(self.root / "tickets/7a1b2c3d.md", "---\nticket: 7a1b2c3d\ntitle: t\nkind: work\npersona: dev\n---\n\n## Goal\nx\n")
        w(self.root / "protocols/CORE.md", "core\n")
        w(self.root / "personas/dev/PROFILE.md", "# Dev\nold\n")

    def tick(self, cmd, **env):
        e = dict(os.environ, TICKET_LOCAL=str(self.local), HOME=str(self.tmp / "home"),
                 DIRA_APM_BIN=str(FAKE), DIRA_APM_NO_INSTALL="1", DIRA_MIGRATIONS_DIR="/nonexistent-migrations", **env)
        return subprocess.run([str(self.root / "workers/w1.sh"), cmd], capture_output=True, text=True, env=e, timeout=120)

    def test_dryrun_apm_layout(self):
        t = self.proj / "dira-team"
        w(t / "apm.yml", "name: t\nversion: 1.0.0\n")
        pkg(t / "personas/dev", "persona-dev")
        w(t / "personas/dev/PROFILE.md", "# Dev\nnew\n")
        w(t / "personas/dev/skills.md", "- `loc` - 로컬\n")
        w(t / ".claude/skills/loc/SKILL.md", "x")
        out = self.tick("dryrun").stdout
        self.assertIn("PROFILE (%s)" % (t / "personas/dev/PROFILE.md"), out)
        self.assertIn("\n스킬: loc\n", out)

    def test_dryrun_old_layout(self):  # rc 3 경로: 큐 사본을 읽는다
        out = self.tick("dryrun").stdout
        self.assertIn("PROFILE (%s)" % (self.root / "personas/dev/PROFILE.md"), out)
        self.assertNotIn("\n스킬:", out)  # 종전 바이트 유지: 스킬이 없으면 줄도 없다

    def test_gate_skip_on_drift(self):
        t = self.proj / "dira-team"
        src = self.tmp / "src/persona-dev"
        pkg(src, "persona-dev")
        w(src / "PROFILE.md", "a")
        w(t / "apm.yml", "name: t\nversion: 1.0.0\n")
        w(t / "apm.lock.yaml", "dependencies:\n- repo_url: _local/persona-dev\n  name: persona-dev\n  source: local\n  local_path: %s\n" % src)
        pkg(t / "apm_modules/_local/persona-dev", "persona-dev")
        w(t / "apm_modules/_local/persona-dev/PROFILE.md", "a")
        self.tick("tick")
        log = (self.root / "workers/runner.log").read_text() if (self.root / "workers/runner.log").exists() else ""
        self.assertNotIn("SKIP apm", log)
        w(t / "apm_modules/_local/persona-dev/PROFILE.md", "changed")
        (self.root / "tickets/7a1b2c3d.done.md").unlink(missing_ok=True) if False else None
        for f in (self.root / "tickets").iterdir():  # 앞 tick이 티켓을 소비했을 수 있다: 새로 둔다
            f.unlink()
        w(self.root / "tickets/8a1b2c3d.md", "---\nticket: 8a1b2c3d\ntitle: t\nkind: work\npersona: dev\n---\n\n## Goal\nx\n")
        self.tick("tick")
        log = (self.root / "workers/runner.log").read_text()
        self.assertIn("SKIP apm 설치 상태가 lock과 다르다", log)
        self.assertEqual([f.name for f in (self.root / "tickets").iterdir()], ["8a1b2c3d.md"])  # .wip 없음


class Sync(unittest.TestCase):
    PIN = "    - github.com/proofer-tech/dira/packages/dira-protocols#dira-protocols-v%s\n"
    LOCAL = "    - ../packages/dira-protocols\n"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        b = Path(os.path.realpath(self.tmp.name))
        self.root, self.eng, self.calls = b / "proj", b / "packages", b / "calls"
        self.team = self.root / ".dira/team"
        self.fake = b / "apm"
        self.fake.write_text('#!/bin/sh\necho "$@" >> %s\n[ "$1" = install ] && [ -e %s ] && { echo x >> apm.lock.yaml; exit 1; }\nexit 0\n'
                             % (self.calls, b / "failflag"))
        self.fake.chmod(0o755)
        self.failflag = b / "failflag"
        self.lock0 = b"lock0\n"
        self.set_pin("1.0.1")
        w(self.team / "apm.lock.yaml", self.lock0.decode())
        self.engine("1.0.2")

    def tearDown(self):
        self.tmp.cleanup()

    def set_pin(self, v):
        w(self.team / "apm.yml", "name: team\nversion: 1.0.0\ndependencies:\n  apm:\n" + self.PIN % v + self.LOCAL)

    def engine(self, v):
        w(self.eng / "dira-protocols/apm.yml", "name: dira-protocols\nversion: %s\n" % v)

    def sync(self):
        e = dict(os.environ, DIRA_APM_BIN=str(self.fake), DIRA_APM_PACKAGES=str(self.eng))
        r = subprocess.run([sys.executable, str(APM), "sync", str(self.root)], capture_output=True, text=True, env=e)
        return r.returncode, r.stdout.strip()

    def installs(self):
        return [l for l in (self.calls.read_text().splitlines() if self.calls.exists() else []) if l.startswith("install")]

    def test_bump(self):
        rc, out = self.sync()
        self.assertEqual(rc, 0)
        self.assertIn("APM-SYNC dira-protocols v1.0.1 -> v1.0.2", out)
        txt = (self.team / "apm.yml").read_text()
        self.assertIn("dira-protocols-v1.0.2\n", txt)
        self.assertIn(self.LOCAL, txt)  # 로컬 경로 줄은 그대로
        self.assertEqual(self.installs(), ["install"])  # --frozen 없음

    def test_not_higher(self):
        for v in ("1.0.2", "1.0.1"):
            self.engine(v)
            self.set_pin("1.0.2")
            before = (self.team / "apm.yml").read_bytes()
            self.assertEqual(self.sync(), (0, ""))
            self.assertEqual((self.team / "apm.yml").read_bytes(), before)
        self.assertEqual(self.installs(), [])

    def test_fail_restores_and_backs_off(self):
        self.failflag.write_text("")
        yml0 = (self.team / "apm.yml").read_bytes()
        rc, out = self.sync()
        self.assertEqual(rc, 0)
        self.assertIn("SKIP apm-sync", out)
        self.assertEqual((self.team / "apm.yml").read_bytes(), yml0)
        self.assertEqual((self.team / "apm.lock.yaml").read_bytes(), self.lock0)
        self.assertTrue((self.team / ".apm-sync-fail").exists())
        self.assertEqual(len(self.installs()), 1)
        self.assertEqual(self.sync(), (0, ""))
        self.assertEqual(len(self.installs()), 1)  # 30분 안에는 다시 안 부른다

    def test_live_lock(self):
        (self.team / ".apm-sync.lock").mkdir()
        w(self.team / ".apm-sync.lock/pid", str(os.getppid()))
        yml0 = (self.team / "apm.yml").read_bytes()
        self.assertEqual(self.sync(), (0, ""))
        self.assertEqual((self.team / "apm.yml").read_bytes(), yml0)
        self.assertEqual(self.installs(), [])


if __name__ == "__main__":
    unittest.main()
