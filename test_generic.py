#!/usr/bin/env python3
"""파라미터화 자체검증: 스트림 전제(한국어 접미사·구글드라이브·레포 경로) 없이도 도는가.

워커(<루트>/workers/<이름>.sh) -> tick.sh -> tickets.py 전 구간을 실제로 태운다.
실패하면 assert로 죽는다.
"""
import os
import sys
import shutil
import tempfile
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="acme"
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
. "{tick}"
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


def mkworker(root, name, body):
    """워커는 <루트>/workers/<이름>.sh. 이 파일 위치가 곧 티켓 루트다."""
    d = os.path.join(root, "workers")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".sh")
    with open(p, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(p, 0o755)
    return p


def run(cmd, worker, local, timeout=60):
    env = dict(os.environ, TICKET_LOCAL=local)
    r = subprocess.run([worker, cmd], capture_output=True, text=True, env=env, timeout=timeout)
    return r.returncode, r.stdout + r.stderr


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    ctxdir = os.path.join(tmp, "docs")
    os.makedirs(ctxdir)
    # 페르소나 디렉터리 기본값($TICKET_ROOT/personas)에 builder 프로필만 둔다
    os.makedirs(os.path.join(root, "personas", "builder"))
    with open(os.path.join(root, "personas", "builder", "PROFILE.md"), "w",
              encoding="utf-8") as f:
        f.write("# Builder\n빌더-프로필-마커\n")
    # 협업 프로토콜 기본값($TICKET_ROOT/protocols/AGENTS.md)
    os.makedirs(os.path.join(root, "protocols"))
    with open(os.path.join(root, "protocols", "AGENTS.md"), "w", encoding="utf-8") as f:
        f.write("# 규약\n프로토콜-마커\n")
    w1 = mkworker(root, "w1", WORKER.format(cwd=tmp, ctxdir=ctxdir, tmp=tmp, tick=TICK))
    eng = os.path.join(tmp, "fake-engine.sh")
    with open(eng, "w", encoding="utf-8") as f:
        f.write(ENGINE.format(tmp=tmp))
    os.chmod(eng, 0o755)

    # 페르소나 지정 티켓 1건 + 선행 미충족 티켓 1건
    mk(root, "cafe0001", fm="kind: work\npersona: builder\n")
    mk(root, "cafe0002", fm="kind: request\ndeps:\n  - cafe9999\n")

    rc, out = run("list", w1, local)
    assert rc == 0, "list rc={}\n{}".format(rc, out)
    assert "cafe0001" in out and "builder" in out, "평면 큐를 못 읽었다\n" + out
    assert "deps 대기 cafe9999" in out, "deps 미충족 표시가 없다\n" + out

    rc, out = run("dryrun", w1, local)
    assert rc == 0, "dryrun rc={}\n{}".format(rc, out)
    assert "선정: cafe0001 (kind work" in out, "frontmatter kind를 못 읽었다\n" + out
    assert "please pick up cafe0001" in out, "프롬프트 템플릿 미적용\n" + out
    assert "cafe0002" not in out, "deps 미충족 티켓이 선정됐다\n" + out
    assert "- {} — 스펙 원본".format(ctxdir) in out, "컨텍스트가 프롬프트에 안 붙었다\n" + out
    assert "no-such-dir" not in out, "없는 컨텍스트 경로가 프롬프트에 붙었다\n" + out
    assert out.count("- " + ctxdir + "\n") == 1, "설명 없는 컨텍스트 항목 처리 실패\n" + out
    assert "페르소나 builder" in out, "persona를 못 읽었다\n" + out
    assert "빌더-프로필-마커" in out, "PROFILE.md가 프롬프트에 안 실렸다\n" + out
    assert "프로토콜-마커" in out, "AGENTS.md가 프롬프트에 안 실렸다\n" + out
    # 순서: 페르소나(누구) -> 프로토콜(어떻게) -> 티켓 지시 -> 참조 컨텍스트
    assert (out.index("빌더-프로필-마커") < out.index("프로토콜-마커")
            < out.index("please pick up cafe0001") < out.index("스펙 원본")), \
        "프롬프트 조립 순서가 틀렸다\n" + out

    # 커스텀 DONE 접미사로 선행을 채우면 대기가 풀린다(-완료가 아니라 .done을 봐야 통과)
    mk(root, "cafe9999.done")
    rc, out = run("list", w1, local)
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

    # Codex 등 Claude가 아닌 커스텀 엔진은 Claude OAuth 토큰 없이도 cron에서 디스패치한다.
    rc, out = run("tick", w1, local)
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

    # 워커 위치가 곧 루트: 설정 0줄 워커가 <루트>/tickets를 만들고 cwd를 루트의 부모로 잡는다
    proj = os.path.join(tmp, "proofer")
    root2 = os.path.join(proj, ".dira")
    mk(root2, "0badcafe")
    bare = mkworker(root2, "bare", '#!/bin/bash\n. "{}"\n'.format(TICK))
    rc, out = run("dryrun", bare, local)
    assert rc == 0, "설정 0줄 워커 dryrun rc={}\n{}".format(rc, out)
    assert "루트 {}, cwd {}".format(root2, proj) in out, "루트/cwd 기본값이 틀렸다\n" + out
    assert os.path.isdir(os.path.join(root2, "tickets")), "큐 디렉터리를 안 만들었다\n" + out

    # workers/ 밖에서 부르면 에러 (tick.sh를 직접 실행하거나 워커를 엉뚱한 데 둔 경우)
    stray = os.path.join(tmp, "stray.sh")
    with open(stray, "w", encoding="utf-8") as f:
        f.write('#!/bin/bash\n. "{}"\n'.format(TICK))
    os.chmod(stray, 0o755)
    rc, out = run("dryrun", stray, local)
    assert rc == 2 and "workers" in out, "workers 밖 실행을 안 걸렀다 rc={}\n{}".format(rc, out)
    rc = subprocess.run(["bash", TICK, "dryrun"], capture_output=True, text=True,
                        timeout=30).returncode
    assert rc == 2, "tick.sh 직접 실행을 안 걸렀다 rc={}".format(rc)

    # 워커 락: 같은 워커는 겹쳐 돌지 않고(SKIP), 다른 워커는 같은 큐에서 동시에 돈다
    runs = os.path.join(tmp, "slow-runs.txt")
    release = os.path.join(tmp, "slow-release")
    slow_eng = os.path.join(tmp, "slow-engine.sh")
    with open(slow_eng, "w", encoding="utf-8") as f:
        # 티켓 프롬프트 줄("slow beef000N")만 뽑는다 - 앞에 붙는 인라인 블록(코어·프로토콜·
        # 페르소나)도 관심사가 아니고, §0-16 §개정 뒤로는 꼬리도 관심사가 아니다(언어 블록이
        # 로케일 무관 항상 붙어 이제 그게 진짜 마지막 줄이다). 이 케이스가 보는 것은 어느
        # 워커가 어느 티켓을 잡았냐이지 프롬프트 조립 순서가 아니다.
        # release 파일이 생길 때까지 버틴다 - sleep 고정값이면 부하 아래서 재진입 확인 전에
        # 세션이 먼저 끝나 "물고 있다" 판정이 스테일 락 회수로 바뀐다.
        f.write('#!/bin/bash\nprintf "%s" "$1" | grep -o "slow beef[0-9]*" >> {}\n'
                'while [ ! -e {} ]; do sleep 0.1; done\n'.format(runs, release))
    os.chmod(slow_eng, 0o755)
    root3 = os.path.join(tmp, "pair", ".dira")
    slow = ('#!/bin/bash\nTICKET_NAME="{name}"\nTICKET_PROMPT_FMT="slow %s"\n'
            'TICKET_ENGINE=("{eng}" "{{prompt}}")\n. "{tick}"\n')
    wa = mkworker(root3, "wa", slow.format(name="wa", eng=slow_eng, tick=TICK))
    wb = mkworker(root3, "wb", slow.format(name="wb", eng=slow_eng, tick=TICK))
    mk(root3, "beef0001")
    mk(root3, "beef0002")
    env2 = dict(os.environ, TICKET_LOCAL=local)
    bg = [subprocess.Popen([w, "tick"], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, env=env2) for w in (wa, wb)]
    try:
        fired = []
        # 부하 아래서는 python3 기동 자체가 여러 초씩 걸린다(2026-09-02 실측: 같은 큐에서
        # 순수 SKIP 판정 하나가 30초를 넘었다) - 15초 창은 워커가 둘뿐인 조용한 기계에서만
        # 안전하다. 240회(60초)로 넉넉히 잡는다.
        for _ in range(240):                            # 디스패치(python 호출 여러 번)를 기다린다
            if os.path.exists(runs):
                with open(runs, encoding="utf-8") as f:
                    fired = [l for l in f.read().split("\n") if l.strip()]
            if len(fired) == 2:
                break
            time.sleep(0.25)
        rc, out = run("tick", wa, local, timeout=30)     # 물고 있는 워커 재진입 -> 즉시 SKIP
        assert rc == 0, "락 걸린 워커가 rc={}로 죽었다\n{}".format(rc, out)
        assert len(fired) == 2, "워커 2개가 티켓 2건을 못 집었다: {}".format(fired)
        assert sorted(fired) == ["slow beef0001", "slow beef0002"], \
            "두 워커가 같은 티켓을 잡았다: {}".format(fired)
    finally:
        with open(release, "w", encoding="utf-8") as f:
            pass
        for p in bg:
            p.wait(timeout=30)
    with open(os.path.join(root3, "workers", "runner.log"), encoding="utf-8") as f:
        assert "아직 티켓을 물고 있다" in f.read(), "워커 락 SKIP 로그가 없다"

    # 프롬프트 경로 치환(§워커는 언제나 자기 워크트리에서 일한다 §개정 1): 워크트리 안에
    # 큐와 같은 곳을 가리키는 이름이 있으면 그 이름을 프롬프트에 적는다. 성립하는 경우와
    # 안 하는 경우를 하나씩 단정한다.
    qroot = os.path.join(tmp, "wtcase", ".dira")
    os.makedirs(os.path.join(qroot, "protocols"))
    with open(os.path.join(qroot, "protocols", "AGENTS.md"), "w", encoding="utf-8") as f:
        f.write("# 규약\n")
    wtroot = os.path.join(tmp, "wtcase", "worktrees", "w2")
    os.makedirs(os.path.join(wtroot, "protocols"))
    os.symlink(qroot, os.path.join(wtroot, ".dira"))
    with open(os.path.join(wtroot, "protocols", "CORE.md"), "w", encoding="utf-8") as f:
        f.write("# 코어-워크트리사본\n")
    mk(qroot, "wtca0001")
    w2 = mkworker(qroot, "w2", '#!/bin/bash\nTICKET_CWD="{}"\n. "{}"\n'.format(wtroot, TICK))
    rc, out = run("dryrun", w2, local)
    assert rc == 0, "wtpath dryrun rc={}\n{}".format(rc, out)
    wt_protocol = os.path.join(wtroot, ".dira", "protocols", "AGENTS.md")
    assert "AGENTS.md ({})".format(wt_protocol) in out, \
        "같은 자리를 가리키는 후보가 있는데 워크트리 경로로 안 바뀌었다\n" + out
    assert "AGENTS.md ({})".format(os.path.join(qroot, "protocols", "AGENTS.md")) not in out, \
        "성립하는 후보가 있는데 AGENTS.md 자리가 canonical로 그대로 남았다\n" + out
    assert "CORE.md ({})".format(os.path.join(wtroot, "protocols", "CORE.md")) in out, \
        "CORE 폴백이 워크트리 사본으로 안 갔다\n" + out

    # TICKET_CWD를 안 준 워커(=후보가 canonical 자신)는 종전대로 canonical 경로를 낸다.
    rc, out = run("dryrun", bare, local)
    assert rc == 0, out
    assert "CORE.md ({})".format(os.path.join(HERE, "protocols", "CORE.md")) in out, \
        "TICKET_CWD 없는 워커의 CORE 경로가 개정 전(엔진 사본)과 달라졌다\n" + out

    # 기본값 회귀: 접미사 기본은 ASCII다(ls·grep에서 한글이 걸리적거려서 바꿨다).
    # 한글 접미사를 쓰던 설치는 config에서 고정해야 하고, 그 경로는 위 .wip/.done 케이스가 덮는다.
    sys.path.insert(0, HERE)
    import tickets as T
    assert T.CLOSED_SUFFIXES == (".wip", ".done"), T.CLOSED_SUFFIXES

    print("PASS 평면 큐·frontmatter·접미사·프롬프트·deps·워커 루트/락/인증게이트")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
