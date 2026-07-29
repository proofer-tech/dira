#!/usr/bin/env python3
"""파라미터화 자체검증: 스트림 전제(역할 3종·한국어 접미사·구글드라이브·레포 경로) 없이도 도는가.

config -> tick.sh -> tickets.py 전 구간을 실제로 태운다. 실패하면 assert로 죽는다.
"""
import os
import sys
import shutil
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

CONFIG = """\
TICKET_NAME="acme"
TICKET_ROOT="{root}"
TICKET_CWD="{cwd}"
TICKET_ROLES="lead builder"
TICKET_INPROGRESS="-wip"
TICKET_DONE="-done"
TICKET_LABEL_builder="Builder"
TICKET_PROMPT_FMT="hey %s, please pick up %s"
"""


def mk(root, role, kind, name, fm=""):
    d = os.path.join(root, "to-" + role, kind)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\ntitle: t\n{}---\n\n## Goal\ntest\n".format(name, fm))
    return p


def run(cmd, conf, state):
    env = dict(os.environ, TICKET_CONFIG=conf, TICKET_STATE=state)
    r = subprocess.run(["bash", TICK, cmd], capture_output=True, text=True, env=env, timeout=60)
    return r.returncode, r.stdout + r.stderr


tmp = tempfile.mkdtemp()
try:
    root = os.path.join(tmp, "tickets")
    state = os.path.join(tmp, "state")
    os.makedirs(state)
    conf = os.path.join(tmp, "acme.config.sh")
    with open(conf, "w", encoding="utf-8") as f:
        f.write(CONFIG.format(root=root, cwd=tmp))

    # 커스텀 역할 수신함의 티켓 1건 + 선행 미충족 티켓 1건
    mk(root, "builder", "work", "cafe0001")
    mk(root, "lead", "request", "cafe0002", fm="deps:\n  - cafe9999\n")

    rc, out = run("list", conf, state)
    assert rc == 0, "list rc={}\n{}".format(rc, out)
    assert "cafe0001" in out and "builder" in out, "커스텀 역할 수신함을 못 읽었다\n" + out
    assert "deps 대기 cafe9999" in out, "deps 미충족 표시가 없다\n" + out

    rc, out = run("dryrun", conf, state)
    assert rc == 0, "dryrun rc={}\n{}".format(rc, out)
    assert "선정: cafe0001 (builder)" in out, "커스텀 역할 티켓 선정 실패\n" + out
    assert "hey Builder, please pick up cafe0001" in out, "프롬프트 템플릿·라벨 미적용\n" + out
    assert "cafe0002" not in out, "deps 미충족 티켓이 선정됐다\n" + out

    # 커스텀 DONE 접미사로 선행을 채우면 대기가 풀린다(-완료가 아니라 -done을 봐야 통과)
    mk(root, "lead", "work", "cafe9999-done")
    rc, out = run("list", conf, state)
    assert "deps 대기" not in out, "커스텀 완료 접미사(-done)를 못 알아봤다\n" + out

    # 커스텀 진행중 접미사로 claim/release 왕복
    env = dict(os.environ, TICKET_INPROGRESS="-wip", TICKET_ROLES="lead builder")
    py = os.path.join(HERE, "tickets.py")
    src = os.path.join(root, "to-builder", "work", "cafe0001.md")
    got = subprocess.run([sys.executable, py, "claim", src], capture_output=True, text=True,
                         env=env, timeout=30)
    assert got.returncode == 0, got.stderr
    wip = got.stdout.strip()
    assert wip.endswith("cafe0001-wip.md"), "커스텀 진행중 접미사로 안 잡혔다: " + wip
    dup = subprocess.run([sys.executable, py, "claim", src], capture_output=True, text=True,
                         env=env, timeout=30)
    assert dup.returncode != 0, "이미 잡힌 티켓을 또 잡았다(락 깨짐)"
    back = subprocess.run([sys.executable, py, "release", wip], capture_output=True, text=True,
                          env=env, timeout=30)
    assert back.stdout.strip().endswith("cafe0001.md"), "release 복귀 실패: " + back.stdout

    # 기본값 회귀: config가 역할·접미사를 안 주면 스트림에서 쓰던 값이 그대로 기본이어야 한다
    sys.path.insert(0, HERE)
    import tickets as T
    assert T.ROLES == ("pm", "designer", "developer"), T.ROLES
    assert T.CLOSED_SUFFIXES == ("-진행중", "-완료"), T.CLOSED_SUFFIXES

    print("PASS 커스텀 역할·접미사·프롬프트·deps + 기본값 회귀")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
