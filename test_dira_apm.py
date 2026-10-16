#!/usr/bin/env python3
"""dira_apm.py 시험. 임시 디렉터리의 가짜 패키지와 가짜 apm(DIRA_APM_BIN)만 쓴다."""
import os, subprocess, sys, tempfile, unittest
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


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(os.path.realpath(self.tmp.name)) / "proj"
        self.team = self.root / "dira-team"
        w(self.team / "apm.yml", "name: team\nversion: 1.0.0\n")

    def tearDown(self):
        self.tmp.cleanup()

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

    def test_skills(self):  # (5)
        pd = self.team / "personas/dev"
        pkg(pd, "persona-dev")
        w(pd / "skills.md", "- `has` - a\n- `empty` - b\n- `none` - c\n")
        w(self.team / ".claude/skills/has/SKILL.md", "x")
        (self.team / ".claude/skills/empty").mkdir(parents=True)
        rc, out, _ = run("skills", self.root, "dev")
        self.assertEqual((rc, out), (0, str(self.team / ".claude/skills/has")))


if __name__ == "__main__":
    FAKE = Path(tempfile.mkdtemp()) / "apm"
    FAKE.write_text("#!/bin/sh\nexit 0\n")
    FAKE.chmod(0o755)
    unittest.main()
