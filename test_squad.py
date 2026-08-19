#!/usr/bin/env python3
"""스쿼드(§5-5 §개정) 자체검증: `squad:`가 `members` 첫 줄(리더)로 풀리고, 그 값이
claim 뒤 persona:로 기록되고, 프롬프트에 스쿼드 블록·rules가 실리는가.

docs/DESIGN.md §5-5 §개정 §검증의 (E1)~(E15)를 전부 단언으로 세운다. 임시 큐 + 가짜
스트리밍 엔진에서 낸다(§제약 1 - 도그푸딩으로 안 잰다). 실패하면 assert로 죽는다.
"""
import inspect
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
PY = os.path.join(HERE, "tickets.py")

sys.path.insert(0, HERE)
import tickets as T

WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/fake-engine.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

# 가짜 스트림 엔진(test_limit.py와 같은 모양) - claim이 실제로 도는지만 본다.
ENGINE = """\
#!/bin/bash
IFS= read -r _first
printf '{{"type":"system","subtype":"init"}}\\n'
printf '{{"is_error":false,"num_turns":1,"session_id":"%s","type":"result","subtype":"success"}}\\n' "$1"
exec sleep 60
"""

ALLOWED_FM = {"ticket", "title", "kind", "persona", "squad",
              "session_id", "assigned_at", "owner", "pid", "inbox",
              "claimed_at", "transcript", "attempts", "deps", "awaiting"}


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


tmp = os.path.realpath(tempfile.mkdtemp())
audited = [0]
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    tdir = os.path.join(root, "tickets")
    sdir = os.path.join(root, "squads")
    runlog = os.path.join(root, "workers", "runner.log")
    env = dict(os.environ, TICKET_LOCAL=local)

    mkfile(os.path.join(tmp, "fake-engine.sh"), ENGINE.format(tmp=tmp), 0o755)
    WS = {}
    for n in ("w1", "w2", "w3", "w4", "w5"):
        WS[n] = mkfile(os.path.join(root, "workers", n + ".sh"),
                       WORKER.format(name=n, tmp=tmp, tick=TICK), 0o755)

    # --- 페르소나 셋 - PROFILE.md 첫 줄이 §값 (4) "역할 칸이 비면 프로필 첫 줄"의 그 값이다 ---
    mkfile(os.path.join(root, "personas", "developer", "PROFILE.md"), "개발자 기본 역할\n")
    mkfile(os.path.join(root, "personas", "designer", "PROFILE.md"), "디자이너 기본 역할\n")
    mkfile(os.path.join(root, "personas", "pm", "PROFILE.md"), "피엠 기본 역할\n")
    # (E10) 후반 - 어느 스쿼드에도 안 든 페르소나. developer/designer/pm은 모두 alpha/beta/
    # gamma/delta/zeta 중 하나 이상의 멤버라 "0줄"을 재려면 넷째가 필요하다.
    mkfile(os.path.join(root, "personas", "qa", "PROFILE.md"), "큐에이 기본 역할\n")

    # --- 스쿼드 여섯 - 정상 넷 + (E5)의 망가진 넷 ---
    mkfile(os.path.join(sdir, "alpha", "members"), "developer\ndesigner\n")       # 리더 developer
    mkfile(os.path.join(sdir, "beta", "members"), "pm\n")                        # 리더 pm 하나뿐
    mkfile(os.path.join(sdir, "gamma", "members"), "developer\n")                # (E8) 동시 claim 전용
    mkfile(os.path.join(sdir, "delta", "members"),
           "developer 프론트를 맡는다\ndesigner\n")                              # (E9) 역할 순서
    mkfile(os.path.join(sdir, "zeta", "members"), "developer\ndesigner\n")       # (E10)(E11) 상시+rules
    mkfile(os.path.join(sdir, "zeta", "rules"), "규칙 본문 마커\n")
    # (E5) 망가진 넷: squads/ 없음(디렉터리 자체를 안 만든다) - members 없음 - members 빈 파일 -
    # 첫 줄 이름이 PERSONA_RE 밖
    os.makedirs(os.path.join(sdir, "nomembers"))
    mkfile(os.path.join(sdir, "blank", "members"), "")
    mkfile(os.path.join(sdir, "badname", "members"), "bad*name 상관없는 역할\n")

    def ticket_body(h, kind="work", persona=None, squad=None):
        extra = "kind: {}\n".format(kind)
        if persona is not None:
            extra += "persona: {}\n".format(persona)
        if squad is not None:
            extra += "squad: {}\n".format(squad)
        return "---\nticket: {h}\ntitle: t\n{extra}---\n\n## Goal\ntest\n".format(h=h, extra=extra)

    def audit():
        """(E14) 큐 무수정 - `squad:`-`persona:` 밖의 새 frontmatter 키가 0개다."""
        for f in sorted(os.listdir(tdir)):
            audited[0] += 1
            assert (re.match(r"^[0-9a-z]{8}\.md$", f)
                    or re.match(r"^[0-9a-z]{8}\.(wip|done)\.md$", f)), \
                "상태 접미사가 3종이 아니다: " + f
            with open(os.path.join(tdir, f), encoding="utf-8") as fh:
                lines = fh.read().split("\n")
            assert lines[0] == "---", "frontmatter가 깨졌다: " + f
            for line in lines[1:]:
                if line.strip() == "---":
                    break
                m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):", line)
                assert not m or m.group(1) in ALLOWED_FM, \
                    "새 frontmatter 키가 생겼다: {} ({})".format(m.group(1), f)

    def queue(open_=(), wip=()):
        """큐를 원하는 모양으로 다시 세운다. open_/wip는 (h, kind, persona, squad) 튜플."""
        if os.path.isdir(tdir):
            audit()
            shutil.rmtree(tdir)
        os.makedirs(tdir)
        for h, kind, persona, squad in open_:
            mkfile(os.path.join(tdir, h + ".md"), ticket_body(h, kind, persona, squad))
        for h, kind, persona, squad in wip:
            mkfile(os.path.join(tdir, h + ".wip.md"), ticket_body(h, kind, persona, squad))

    def limit(persona, body):
        f = os.path.join(root, "personas", persona, "limit")
        if body is None:
            if os.path.exists(f):
                os.remove(f)
        else:
            mkfile(f, body)

    def log():
        try:
            with open(runlog, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def wips():
        return sorted(f for f in os.listdir(tdir) if f.endswith(".wip.md"))

    def fm_of(h):
        for f in os.listdir(tdir):
            if f.startswith(h):
                return T.read_fm(os.path.join(tdir, f))[0]
        raise AssertionError("티켓을 못 찾음: " + h)

    def tick(name="w1", **over):
        r = subprocess.run([WS[name], "tick"], capture_output=True, text=True,
                           env=dict(env, **over), timeout=180)
        assert r.returncode == 0, "{} tick rc={}\n{}".format(name, r.returncode, r.stderr)
        return r

    def dryrun(name="w1"):
        r = subprocess.run([WS[name], "dryrun"], capture_output=True, text=True,
                           env=env, timeout=60)
        assert r.returncode == 0, "dryrun rc={}\n{}".format(r.returncode, r.stderr)
        out = r.stdout + r.stderr
        i = out.index("프롬프트: ")
        return out[i + len("프롬프트: "):]

    def select():
        r = subprocess.run([sys.executable, PY, "select", root],
                           capture_output=True, text=True, env=env, timeout=30)
        assert r.returncode == 0, r.stderr
        rows = [l.split("|") for l in r.stdout.strip().split("\n") if l]
        return rows, r.stderr

    # ================= (E1) 해석 - members 첫 줄이 뜨고 persona:도 그 이름으로 갈린다 =================
    limit("developer", None)
    queue(open_=[("e1e10001", "work", None, "alpha")])
    before = len(log())
    tick()
    added = log()[before:]
    assert "DISPATCH e1e10001 kind=work persona=developer" in added, \
        "(E1) 리더로 안 떴다:\n" + added
    fm = fm_of("e1e10001")
    assert fm.get("persona") == "developer", "(E1) claim 뒤 persona: 기록 실패: " + repr(fm)
    print("OK (E1) 리더 developer로 뜨고 persona: developer로 기록됨")

    # ================= (E2) 진행중을 안 센다 - developer가 바빠도 여전히 developer =================
    queue(open_=[("e2220001", "work", None, "alpha")],
          wip=[("e2ff0001", "work", "developer", None), ("e2ff0002", "work", "developer", None)])
    before = len(log())
    tick()
    added = log()[before:]
    assert "DISPATCH e2220001 kind=work persona=developer" in added, \
        "(E2) 진행중 수를 세서 designer로 넘어갔다:\n" + added
    print("OK (E2) developer .wip 2장이 있어도 여전히 developer로 뜸")

    # ================= (E3)(E4) 리더 상한 - 다른 멤버로 안 넘어가고, 다른 페르소나는 안 굶는다 =================
    limit("developer", "1\n")
    limit("pm", "1\n")
    queue(open_=[("e3330001", "work", None, "alpha"), ("e4440001", "work", None, "beta"),
                 ("e3ee0003", "work", "designer", None)],
          wip=[("e3ff0001", "work", "developer", None), ("e4ff0001", "work", "pm", None)])
    before = len(log())
    tick()
    added = log()[before:]
    assert "SKIP 페르소나 상한 developer 1/1" in added, "(E3) 리더 상한이 안 걸렸다:\n" + added
    assert "SKIP 페르소나 상한 pm 1/1" in added, "(E4) 상한이 스쿼드로 뚫렸다:\n" + added
    assert "DISPATCH e3330001" not in added and "DISPATCH e4440001" not in added, \
        "(E3)(E4) 상한 찬 리더 스쿼드 티켓이 떴다:\n" + added
    assert "DISPATCH e3ee0003 kind=work persona=designer" in added, \
        "(E3)(E4) 상한과 무관한 페르소나까지 굶겼다:\n" + added
    print("OK (E3) 리더 상한 developer 1/1 - SKIP, 다른 멤버로 안 넘어감")
    print("OK (E4) 상한 pm 1/1 - SKIP, 스쿼드로 안 뚫림 + designer는 안 굶음")
    limit("developer", None)
    limit("pm", None)

    # ================= (E5) 못 읽는 값 - 넷 다 WARN 한 줄 + squad_persona="" =================
    queue(open_=[("e5aa0001", "work", None, "nosuchsquad"),
                 ("e5bb0001", "work", None, "nomembers"),
                 ("e5cc0001", "work", None, "blank"),
                 ("e5dd0001", "work", None, "badname")])
    rows, err = select()
    byhash = dict((r[1], r) for r in rows)
    for h in ("e5aa0001", "e5bb0001", "e5cc0001", "e5dd0001"):
        assert byhash[h][7] == "", "(E5) {} squad_persona가 안 비었다: {}".format(h, byhash[h])
    assert err.count("WARN 스쿼드 nosuchsquad 못 읽음") == 1, "(E5) squads/ 없음 WARN 실패:\n" + err
    assert err.count("WARN 스쿼드 nomembers 못 읽음") == 1, "(E5) members 없음 WARN 실패:\n" + err
    assert err.count("WARN 스쿼드 blank members가 비었다") == 1, "(E5) 빈 파일 WARN 실패:\n" + err
    assert err.count("WARN 스쿼드 badname 첫 줄 이름이 규칙 밖이다") == 1, \
        "(E5) PERSONA_RE 밖 WARN 실패:\n" + err
    print("OK (E5) squads/ 없음 - members 없음 - 빈 파일 - PERSONA_RE 밖, 넷 다 WARN 한 줄 + squad_persona=''")

    # ================= (E6) 우선 - squad:가 persona:를 이긴다 =================
    queue(open_=[("e6660001", "work", "designer", "alpha")])
    before = len(log())
    tick()
    added = log()[before:]
    assert "DISPATCH e6660001 kind=work persona=developer" in added, \
        "(E6) squad:가 persona:를 못 이겼다:\n" + added
    fm = fm_of("e6660001")
    assert fm.get("persona") == "developer", "(E6) 뜬 뒤 persona:가 안 갈렸다: " + repr(fm)
    print("OK (E6) squad:가 persona:를 이기고, 뜬 뒤 persona:가 developer로 갈림")

    # ================= (E7) 해제 뒤 - session_id/owner/assigned_at/pid는 비고 persona:는 남는다 =================
    wp = os.path.join(tdir, [f for f in os.listdir(tdir) if f.startswith("e6660001")][0])
    upd = {k: "" for k in T.REAP_CLEAR}
    T.set_fm_keys(wp, upd)
    fm = T.read_fm(wp)[0]
    for k in ("session_id", "owner", "assigned_at", "pid"):
        assert (fm.get(k) or "") == "", "(E7) {}가 안 비었다: {}".format(k, fm.get(k))
    assert fm.get("persona") == "developer", "(E7) 해제 뒤 persona:가 사라졌다: " + repr(fm)
    print("OK (E7) 해제 뒤 session_id/owner/assigned_at/pid는 비고 persona:는 남음")

    # ================= (E8) 동시 claim - limit=1 스쿼드 리더에 후보 5장 + 워커 5개 =================
    limit("developer", "1\n")
    queue(open_=[("e888000%d" % i, "work", None, "gamma") for i in range(1, 6)])
    ps = [subprocess.Popen([WS[n], "tick"], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, env=env)
          for n in ("w1", "w2", "w3", "w4", "w5")]
    for p in ps:
        p.wait(timeout=180)
    got = wips()
    assert len(got) == 1, "(E8) 상한 1인 리더인데 {}장을 잡았다: {}".format(len(got), got)
    print("OK (E8) limit=1 developer 리더에 후보 5 + 워커 5 동시 -> .wip 정확히 1장: {}".format(got))
    limit("developer", None)

    # ================= (E9) 역할의 순서 - members 줄의 역할, 없으면 PROFILE 첫 줄 =================
    queue(open_=[("e9990001", "work", None, "delta")])
    prompt = dryrun()
    assert "developer (리더) - 프론트를 맡는다" in prompt, "(E9) 명시 역할이 안 실렸다:\n" + prompt
    assert "designer - 디자이너 기본 역할" in prompt, "(E9) 역할 없는 멤버가 PROFILE 첫 줄로 안 떨어졌다:\n" + prompt
    print("OK (E9) 명시 역할 '프론트를 맡는다' 실림 + 역할 없는 멤버는 PROFILE 첫 줄로 떨어짐")

    # ================= (E10) 블록의 대상 - squad: 없는 평범한 persona: 티켓도 상시로 싣고,
    #                    어느 스쿼드에도 없으면 0줄이다 =================
    queue(open_=[("e10a0001", "work", "designer", None)])
    prompt = dryrun()
    assert "===== 스쿼드 zeta =====" in prompt, "(E10) squad: 없는 티켓에 상시 블록이 안 실렸다:\n" + prompt
    queue(open_=[("e10b0001", "work", "qa", None)])
    prompt = dryrun()
    assert "===== 스쿼드" not in prompt, "(E10) 어느 스쿼드에도 없는데 블록이 실렸다:\n" + prompt
    print("OK (E10) squad: 없는 티켓도 상시 블록이 실리고, 어느 스쿼드에도 없으면 0줄")

    # ================= (E11) rules - 리더 프롬프트에만 전문, 리더가 아니면 0줄 =================
    queue(open_=[("e11a0001", "work", None, "zeta")])
    prompt = dryrun()
    assert "===== 스쿼드 zeta 규칙 (" in prompt and "규칙 본문 마커" in prompt, \
        "(E11) 리더 프롬프트에 rules가 안 실렸다:\n" + prompt
    queue(open_=[("e11b0001", "work", "designer", None)])
    prompt = dryrun()
    assert "규칙 본문 마커" not in prompt and "스쿼드 zeta 규칙" not in prompt, \
        "(E11) 리더가 아닌 멤버에게 rules가 샜다:\n" + prompt
    print("OK (E11) rules는 리더 프롬프트에만 전문, 리더 아닌 멤버는 0줄")

    # ================= (E12) 호출 수 - squad_leader는 첫 줄만 읽는다. 프로세스 스폰 0개 =================
    src = inspect.getsource(T.squad_leader)
    for bad in ("subprocess", "Popen", "os.system", "os.popen", "os.exec"):
        assert bad not in src, "(E12) squad_leader가 프로세스를 스폰한다({}) - 호출 수가 0이 아니다".format(bad)
    print("OK (E12) squad_leader 소스에 subprocess/Popen/os.system/os.popen/os.exec 0개")

    # ================= (E13) 상한 - 스쿼드 블록이 1,500B 이하다 =================
    queue(open_=[("e1330001", "work", None, "alpha")])
    prompt = dryrun()
    m = re.search(r"===== 스쿼드 alpha =====.*?===== 스쿼드 끝 =====", prompt, re.S)
    assert m, "(E13) 블록을 못 찾았다:\n" + prompt
    assert len(m.group(0).encode("utf-8")) <= 1500, "(E13) 블록이 1,500B를 넘었다"
    print("OK (E13) 스쿼드 alpha 블록 {}B <= 1500B".format(len(m.group(0).encode("utf-8"))))

    # ================= (E14) 큐 무수정 =================
    audit()
    print("OK (E14) 큐 무수정 - squad:/persona: 밖의 새 frontmatter 키 0개 (티켓 {}건 감사)".format(audited[0]))

    # ================= (E15) select 회귀 - 4번째 필드가 여전히 persona다 =================
    queue(open_=[("e1550001", "work", "designer", None)])
    rows, _ = select()
    row = [r for r in rows if r[1] == "e1550001"][0]
    assert row[3] == "designer", "(E15) select 4번째 필드가 persona가 아니게 됐다: " + str(row)
    assert len(row) == 8, "(E15) select 필드 수가 8이 아니다(맨 뒤에 붙어야 한다): " + str(row)
    print("OK (E15) select 4번째 필드 여전히 persona, 필드 수 8(squad_persona가 맨 뒤): {}".format(row))

    audit()
    print("PASS 스쿼드 해석·상한·rules·프롬프트 틀 (E1)~(E15) - 티켓 {}건 무수정".format(audited[0]))
finally:
    subprocess.run(["pkill", "-f", os.path.join(tmp, "fake-engine.sh")], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
