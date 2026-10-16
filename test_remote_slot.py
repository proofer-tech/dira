#!/usr/bin/env python3
"""`tick.sh remote <해시>` (docs/DESIGN.md P499-1).

① TICKET_NAME=remote1로 부르면 해시가 .wip이 되고 owner가 `remote1-`로 시작하며 락이
   `remote1-`로 시작하고, remote.py tick은 불리지 않으며 세션 cwd가 remote-cwd 아래다.
② 후보가 아니면(이미 .wip) 아무것도 안 띄우고 rc 0.
가짜 엔진(비스트리밍)만 쓴다. 실패하면 assert로 죽는다.
"""
__import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())  # 마이그레이션 게이트(P505)가 임시 루트를 막지 않게 빈 항목 폴더로
import datetime
import os
import re
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

ENGINE = """\
#!/bin/bash
pwd > "{tmp}/engine-cwd"
ls "{local}/run" > "{tmp}/engine-locks"
cp "{tmp}/dira/tickets/$HASH.wip.md" "{tmp}/engine-fm" 2>/dev/null
printf '{{"session_id":"%s","type":"result","is_error":false,"subtype":"success"}}\\n' "$2"
"""
WORKER = """\
#!/bin/bash
TICKET_CWD="{tmp}"
TICKET_ENGINE=("{tmp}/engine.sh" "{{prompt}}" "{{sid}}")
. "{tick}"
"""
# python3 래퍼: remote.py가 불리면 표시를 남기고, 그 밖에는 진짜 python3로 넘긴다.
PYWRAP = """\
#!/bin/bash
case "$*" in *remote.py*) echo "$*" >> "{tmp}/remote-called" ;; esac
exec "{real}" "$@"
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


tmp = os.path.realpath(tempfile.mkdtemp())
root = os.path.join(tmp, "dira")
local = os.path.join(tmp, "local")
os.makedirs(os.path.join(local, "run"))
real = subprocess.check_output(["which", "python3"], text=True).strip()
mkfile(os.path.join(tmp, "bin", "python3"), PYWRAP.format(tmp=tmp, real=real), 0o755)
mkfile(os.path.join(tmp, "engine.sh"), ENGINE.format(tmp=tmp, local=local), 0o755)
w1 = mkfile(os.path.join(root, "workers", "w1.sh"), WORKER.format(tmp=tmp, tick=TICK), 0o755)
mkfile(os.path.join(root, "remote.json"), "{}\n")
tdir = os.path.join(root, "tickets")
mkfile(os.path.join(tdir, "aaaa7001.md"),
       "---\nticket: aaaa7001\ntitle: t\npersona: dev\n---\n\n## Goal\ntest\n")
env = dict(os.environ, TICKET_LOCAL=local, TICKET_NAME="remote1", HASH="aaaa7001",
           PATH=os.path.join(tmp, "bin") + os.pathsep + os.environ["PATH"])
r = subprocess.run([w1, "remote", "aaaa7001"], capture_output=True, text=True, timeout=90, env=env)
assert r.returncode == 0, r.stdout + r.stderr
fm = open(os.path.join(tmp, "engine-fm"), encoding="utf-8").read()
m = re.search(r"^owner:\s*(.*)$", fm, re.M)
assert m and m.group(1).startswith("dev / remote1-"), "owner: " + (m.group(1) if m else fm)
locks = open(os.path.join(tmp, "engine-locks"), encoding="utf-8").read().split()
assert any(x.startswith("remote1-") for x in locks), "락 파일: %s" % locks
assert not os.path.exists(os.path.join(tmp, "remote-called")), "remote.py가 불렸다"
cwd = open(os.path.join(tmp, "engine-cwd"), encoding="utf-8").read().strip()
assert cwd.startswith(os.path.join(local, "run", "remote-cwd") + os.sep) and cwd.endswith("remote1"), cwd
print("OK ① owner=%s lock=%s cwd=...%s" % (m.group(1)[:14], [x for x in locks if x.startswith("remote1-")][0], cwd[-30:]))

# ② 이미 .wip인 해시 - 아무것도 안 띄우고 rc 0
now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
mkfile(os.path.join(tdir, "bbbb7002.wip.md"),
       "---\nticket: bbbb7002\ntitle: t\nsession_id: s1\nassigned_at: %s\n---\n\n## Goal\ntest\n" % now)
os.remove(os.path.join(tmp, "engine-cwd"))
r = subprocess.run([w1, "remote", "bbbb7002"], capture_output=True, text=True, timeout=90, env=env)
assert r.returncode == 0, r.stdout + r.stderr
assert not os.path.exists(os.path.join(tmp, "engine-cwd")), "엔진이 떴다"
assert os.path.exists(os.path.join(tdir, "bbbb7002.wip.md"))
print("OK ② 후보 아님 -> rc 0, 엔진 안 뜸")
