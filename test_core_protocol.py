#!/usr/bin/env python3
"""코어 프로토콜 인라인 자체검증: <엔진 레포>/protocols/CORE.md가 프롬프트 맨 앞에 붙는가.

임시 큐에서만 판정한다(도그푸딩 큐에서 엔진을 실험하지 않는다). **엔진도 임시 디렉터리로
복사한다** — 코어는 큐가 아니라 엔진 레포 옆에 살아서, 이 레포의 진짜 CORE.md를 지우지 않고
"없을 때"를 재는 길이 그것뿐이다. 엔진을 실제로 부르지 않고 `tick.sh dryrun`이 찍는
프롬프트로 본다. 실패하면 assert로 죽는다.
"""
import os
import shutil
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))

WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/claude" "{{prompt}}")
. "{tick}"
"""


def write(path, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return path


def dryrun(worker, local):
    r = subprocess.run([worker, "dryrun"], capture_output=True, text=True,
                       env=dict(os.environ, TICKET_LOCAL=local), timeout=60)
    assert r.returncode == 0, "dryrun rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)
    return r.stdout + r.stderr


def warns(root):
    p = os.path.join(root, "workers", "runner.log")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        return [ln for ln in f if "WARN" in ln]


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    # 엔진 사본. tick.sh는 자기 위치에서 tickets.py와 protocols/를 유도한다(tick.sh:19).
    code = os.path.join(tmp, "engine")
    os.makedirs(code)
    for f in ("tick.sh", "tickets.py"):
        shutil.copy2(os.path.join(HERE, f), os.path.join(code, f))
    tick = os.path.join(code, "tick.sh")
    core = os.path.join(code, "protocols", "CORE.md")

    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    write(os.path.join(root, "protocols", "AGENTS.md"), "# 협업 프로토콜\n프로젝트-AGENTS-마커\n")
    write(os.path.join(root, "personas", "dev", "PROFILE.md"), "# Dev\n데브-프로필-마커\n")
    write(os.path.join(root, "tickets", "c0e00001.md"),
          "---\nticket: c0e00001\ntitle: t\nkind: work\npersona: dev\n---\n\n## Goal\ntest\n")
    worker = write(os.path.join(root, "workers", "w.sh"),
                   WORKER.format(name="w", tmp=tmp, tick=tick))
    os.chmod(worker, 0o755)

    # 1) 코어 파일이 없어도 디스패치가 성립한다 — rc=0, 프롬프트는 종전 그대로, WARN 한 줄.
    assert not os.path.exists(core), "사본 엔진에 CORE.md가 딸려 왔다"
    base = dryrun(worker, local)
    assert "프로젝트-AGENTS-마커" in base, "큐 AGENTS.md가 안 실렸다\n" + base
    assert "please pick up c0e00001" in base, "티켓 프롬프트가 안 실렸다\n" + base
    assert "CORE.md" not in base, "없는 코어가 프롬프트에 붙었다\n" + base
    w = warns(root)
    assert len(w) == 1 and "코어 프로토콜 없음" in w[0], "코어 없음 WARN이 한 줄이 아니다: {}".format(w)

    # 2) 코어가 있으면 통째로 실린다 — 큐 AGENTS.md 앞에, 그리고 프롬프트 맨 앞에.
    write(core, "# 코어\n코어-본문-마커\n")
    got = dryrun(worker, local)
    block = "===== CORE.md ({}) =====\n# 코어\n코어-본문-마커\n===== 코어 프로토콜 끝 =====\n\n".format(core)
    # dryrun은 프롬프트를 `프롬프트: ` 뒤에 그대로 찍는다 — 그 자리가 곧 프롬프트의 첫 글자다.
    assert "프롬프트: " + block in got, "코어 블록이 프롬프트 맨 앞이 아니다\n" + got
    assert got.index("코어-본문-마커") < got.index("프로젝트-AGENTS-마커") \
        < got.index("please pick up c0e00001"), "코어가 큐 AGENTS.md 앞이 아니다\n" + got
    assert got.index("코어-본문-마커") < got.index("데브-프로필-마커"), \
        "코어가 페르소나 프로필 앞이 아니다(결정 3)\n" + got
    assert got.replace(block, "") == base, \
        "코어 블록 말고 다른 것도 바뀌었다\n--- 기준선\n{}\n--- 지금\n{}".format(base, got)
    assert warns(root) == w, "코어가 있는데 WARN이 늘었다: {}".format(warns(root))

    # 3) 이 레포의 진짜 코어에는 프로젝트 층 자리표시자가 없다(§프롬프트 층 결정 2·3).
    with open(os.path.join(HERE, "protocols", "CORE.md"), encoding="utf-8") as f:
        real = f.read()
    for ph in ("<프로젝트>", "<통합 브랜치>"):
        assert ph not in real, "코어에 프로젝트 층 자리표시자가 남아 있다: {}".format(ph)

    # 4) 큐 vendored 사본(§프롬프트 층 결정 8-b) - 있으면 그것이 우선이고 머리가 큐 절대경로를
    #    찍는다. 엔진 사본(2번의 마커)은 실리지 않는다. WARN도 안 늘어난다.
    vendored = write(os.path.join(root, "protocols", "CORE.md"), "# 큐 코어\n큐-코어-마커\n")
    got2 = dryrun(worker, local)
    block2 = "===== CORE.md ({}) =====\n# 큐 코어\n큐-코어-마커\n===== 코어 프로토콜 끝 =====\n\n".format(vendored)
    assert "프롬프트: " + block2 in got2, "큐 vendored 코어가 프롬프트 맨 앞이 아니다\n" + got2
    assert "코어-본문-마커" not in got2, "엔진 사본이 큐 사본보다 우선했다\n" + got2
    assert warns(root) == w, "큐 vendored 코어가 있는데 WARN이 늘었다: {}".format(warns(root))

    # 5) 큐 사본을 치우면 엔진 사본으로 폴백한다(이상 상태가 아니다 - 결정 8-b).
    os.remove(vendored)
    back = dryrun(worker, local)
    assert back == got, "큐 사본 제거 후 엔진 폴백이 2번과 달라졌다\n" + back

    print("PASS 코어 인라인·큐 AGENTS.md 앞·부재시 디스패치 성립(WARN 1줄)·자리표시자 0건"
          "·큐 vendored 우선·엔진 폴백")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
