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
