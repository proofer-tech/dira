#!/usr/bin/env python3
"""파라미터화 자체검증: 스트림 전제(한국어 접미사·구글드라이브·레포 경로) 없이도 도는가.

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
TICKET_INPROGRESS=".wip"
TICKET_DONE=".done"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_CONTEXT=(
  "{ctxdir}|스펙 원본"
  "{tmp}/no-such-dir|안 붙은 마운트"
  "{ctxdir}"
)
TICKET_ENGINE=("{tmp}/fake-engine.sh" "{{prompt}}" "{{sid}}")
TICKET_ENGINE_PS="[f]ake-engine-never-running"
"""

# 커스텀 엔진: 받은 인자를 파일로 떨어뜨리고 claude 형식 JSON을 흉내낸다
ENGINE = """\
#!/bin/bash
printf '%s' "$1" > "{tmp}/engine-prompt.txt"
printf '%s' "$2" > "{tmp}/engine-sid.txt"
printf '{{"session_id":"%s"}}\\n' "$2"
"""


def mk(root, name, fm=""):
    """큐는 <루트>/tickets/ 평면. 성격·수행자는 디렉터리가 아니라 frontmatter다."""
    d = os.path.join(root, "tickets")
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
    root = os.path.join(tmp, "fs-tickets")
    state = os.path.join(tmp, "state")
    os.makedirs(state)
    ctxdir = os.path.join(tmp, "docs")
    os.makedirs(ctxdir)
    # 페르소나 디렉터리 기본값($TICKET_ROOT/personas)에 builder 프로필만 둔다
    os.makedirs(os.path.join(root, "personas", "builder"))
    with open(os.path.join(root, "personas", "builder", "PROFILE.md"), "w",
              encoding="utf-8") as f:
        f.write("# Builder\n빌더-프로필-마커\n")
    conf = os.path.join(tmp, "acme.config.sh")
    with open(conf, "w", encoding="utf-8") as f:
        f.write(CONFIG.format(root=root, cwd=tmp, ctxdir=ctxdir, tmp=tmp))
    eng = os.path.join(tmp, "fake-engine.sh")
    with open(eng, "w", encoding="utf-8") as f:
        f.write(ENGINE.format(tmp=tmp))
    os.chmod(eng, 0o755)

    # 페르소나 지정 티켓 1건 + 선행 미충족 티켓 1건
    mk(root, "cafe0001", fm="kind: work\npersona: builder\n")
    mk(root, "cafe0002", fm="kind: request\ndeps:\n  - cafe9999\n")

    rc, out = run("list", conf, state)
    assert rc == 0, "list rc={}\n{}".format(rc, out)
    assert "cafe0001" in out and "builder" in out, "평면 큐를 못 읽었다\n" + out
    assert "deps 대기 cafe9999" in out, "deps 미충족 표시가 없다\n" + out

    rc, out = run("dryrun", conf, state)
    assert rc == 0, "dryrun rc={}\n{}".format(rc, out)
    assert "선정: cafe0001 (kind work" in out, "frontmatter kind를 못 읽었다\n" + out
    assert "please pick up cafe0001" in out, "프롬프트 템플릿 미적용\n" + out
    assert "cafe0002" not in out, "deps 미충족 티켓이 선정됐다\n" + out
    assert "- {} — 스펙 원본".format(ctxdir) in out, "컨텍스트가 프롬프트에 안 붙었다\n" + out
    assert "no-such-dir" not in out, "없는 컨텍스트 경로가 프롬프트에 붙었다\n" + out
    assert out.count("- " + ctxdir + "\n") == 1, "설명 없는 컨텍스트 항목 처리 실패\n" + out
    assert "페르소나 builder" in out, "persona를 못 읽었다\n" + out
    assert "빌더-프로필-마커" in out, "PROFILE.md가 프롬프트에 안 실렸다\n" + out

    # 커스텀 DONE 접미사로 선행을 채우면 대기가 풀린다(-완료가 아니라 .done을 봐야 통과)
    mk(root, "cafe9999.done")
    rc, out = run("list", conf, state)
    assert "deps 대기" not in out, "커스텀 완료 접미사(.done)를 못 알아봤다\n" + out

    # 커스텀 진행중 접미사로 claim/release 왕복
    env = dict(os.environ, TICKET_INPROGRESS=".wip")
    py = os.path.join(HERE, "tickets.py")
    src = os.path.join(root, "tickets", "cafe0001.md")
    got = subprocess.run([sys.executable, py, "claim", src], capture_output=True, text=True,
                         env=env, timeout=30)
    assert got.returncode == 0, got.stderr
    wip = got.stdout.strip()
    assert wip.endswith("cafe0001.wip.md"), "커스텀 진행중 접미사로 안 잡혔다: " + wip
    dup = subprocess.run([sys.executable, py, "claim", src], capture_output=True, text=True,
                         env=env, timeout=30)
    assert dup.returncode != 0, "이미 잡힌 티켓을 또 잡았다(락 깨짐)"
    back = subprocess.run([sys.executable, py, "release", wip], capture_output=True, text=True,
                          env=env, timeout=30)
    assert back.stdout.strip().endswith("cafe0001.md"), "release 복귀 실패: " + back.stdout

    # 커스텀 엔진으로 실제 디스패치 1회: 토큰 치환이 되고 프롬프트가 인자 1개로 넘어가는가
    rc, out = run("tick", conf, state)
    assert rc == 0, "tick rc={}\n{}".format(rc, out)
    with open(os.path.join(tmp, "engine-prompt.txt"), encoding="utf-8") as f:
        got = f.read()
    assert "please pick up" in got, "엔진이 프롬프트를 못 받았다: " + got
    assert "스펙 원본" in got, "컨텍스트가 붙은 프롬프트가 인자 1개로 안 넘어갔다: " + got
    with open(os.path.join(tmp, "engine-sid.txt"), encoding="utf-8") as f:
        assert len(f.read().strip()) == 36, "{sid} 치환 실패"

    # persona 미지정(=평범한 에이전트)과 경로 조각 가드: select 4번째 필드로 확인
    mk(root, "cafe0003", fm="kind: feedback\n")
    mk(root, "cafe0004", fm="persona: ../../.ssh\n")
    sel = subprocess.run([sys.executable, py, "select", root], capture_output=True, text=True,
                         env=env, timeout=30).stdout
    fields = dict((l.split("|")[1], l.split("|")[3]) for l in sel.strip().split("\n") if l)
    assert fields.get("cafe0003") == "", "persona 없는 티켓에 페르소나가 붙었다: " + sel
    assert fields.get("cafe0004") == "", "경로 조각 persona를 안 걸렀다: " + sel

    # 구 레이아웃 잔여물은 큐에서 안 보이므로 경고로 알린다(조용히 굶지 않게)
    os.makedirs(os.path.join(root, "to-pm", "work"))
    open(os.path.join(root, "to-pm", "work", "dead0001.md"), "w").close()
    warn = subprocess.run([sys.executable, py, "list", root], capture_output=True, text=True,
                          env=env, timeout=30)
    assert "구 레이아웃" in warn.stderr, "구 레이아웃 경고가 없다: " + warn.stderr
    assert "dead0001" not in warn.stdout, "구 레이아웃 티켓이 큐에 섞였다: " + warn.stdout

    # 티켓 루트 기본값: TICKET_ROOT를 안 주면 $TICKET_CWD/.fs-tickets를 쓰고, 없으면 만든다
    proj = os.path.join(tmp, "proofer")
    os.makedirs(proj)
    conf2 = os.path.join(tmp, "proofer.config.sh")
    with open(conf2, "w", encoding="utf-8") as f:
        f.write('TICKET_CWD="{}"\n'.format(proj))
    rc, out = run("dryrun", conf2, state)
    assert rc == 0, "기본 루트 dryrun rc={}\n{}".format(rc, out)
    assert os.path.isdir(os.path.join(proj, ".fs-tickets", "tickets")), \
        "기본 루트/큐를 안 만들었다\n" + out

    # 명시로 준 루트는 없으면 만들지 않고 에러 (미마운트를 빈 큐로 착각하지 않게)
    conf3 = os.path.join(tmp, "ghost.config.sh")
    with open(conf3, "w", encoding="utf-8") as f:
        f.write('TICKET_CWD="{0}"\nTICKET_ROOT="{0}/nope"\n'.format(proj))
    rc, out = run("dryrun", conf3, state)
    assert rc != 0 and not os.path.exists(os.path.join(proj, "nope")), \
        "명시 루트가 없는데 통과했다\n" + out

    # 기본값 회귀: 접미사 기본은 ASCII다(ls·grep에서 한글이 걸리적거려서 바꿨다).
    # 한글 접미사를 쓰던 설치는 config에서 고정해야 하고, 그 경로는 위 .wip/.done 케이스가 덮는다.
    sys.path.insert(0, HERE)
    import tickets as T
    assert T.CLOSED_SUFFIXES == (".wip", ".done"), T.CLOSED_SUFFIXES

    print("PASS 평면 큐·kind/persona frontmatter·접미사·프롬프트·deps·기본 루트")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
