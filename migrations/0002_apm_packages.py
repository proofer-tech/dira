"""페르소나 - 스킬 - 스쿼드 - 프로토콜을 dira-team/ APM 패키지로 옮긴다 (DESIGN.md P506, 항목 0002).

적용 순서와 근거는 DESIGN.md "마이그레이션 항목 migrations/0002_apm_packages.py" 절이다.
memory/ 는 읽지도 옮기지도 않는다. 표준 라이브러리만 쓴다.
"""
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ID = "0002-apm-packages"
DESC = "페르소나 - 스킬 - 스쿼드 - 프로토콜을 dira-team/ 패키지(APM)로 옮긴다"
DESC_EN = "Move personas, skills, squads and protocols into dira-team/ packages (APM)"
SCOPE = "project"
ROLLOUT = "canary"
REVERSIBLE = True

PUBLIC_PKG_REPO = "proofer-tech/dira/packages"
SKILL_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")
SKILL_LINE = re.compile(r"^\s*-\s*`([^`]+)`")
SKIP_DIRS = {".git", "node_modules", "__pycache__"}
COMMIT_MSG = "dira - APM 전환 (P506)"
_BASE = {}  # apply 가 뜬 기준 프롬프트. 같은 프로세스의 verify 가 읽는다.


# ---------- 읽기 ----------

def _read(p):
    with open(p, "rb") as f:
        return f.read()


def _files(d):
    """d 아래 파일 전부(상대경로 정렬). 없는 디렉터리는 빈 목록."""
    out = []
    for dp, dn, fn in os.walk(d, followlinks=True):
        dn[:] = sorted(x for x in dn if x not in SKIP_DIRS)
        out += [os.path.relpath(os.path.join(dp, f), d) for f in sorted(fn) if f != ".DS_Store"]
    return out


def _skills_home():
    return os.environ.get("TICKET_SKILLS_HOME") or os.path.expanduser("~/.claude/skills")


def _skill_names(md):
    if not os.path.isfile(md):
        return []
    out = []
    for line in _read(md).decode("utf-8", "replace").splitlines():
        m = SKILL_LINE.match(line)
        if m and SKILL_NAME.match(m.group(1)) and m.group(1) not in out:
            out.append(m.group(1))
    return out


def _registry(ctx):
    p = os.path.join(ctx.local, "gui-projects.json")
    try:
        with open(p, encoding="utf-8") as f:
            return p, json.load(f)
    except (OSError, ValueError):
        return p, {}


def _market(ctx):
    """레지스트리 market.<personas|squads>.<이름> = {owner,name,v} -> {(kind,이름): (owner,v)}."""
    _, reg = _registry(ctx)
    out = {}
    for p in reg.get("projects", []) if isinstance(reg, dict) else []:
        if isinstance(p, dict) and p.get("id") == ctx.project_id and isinstance(p.get("market"), dict):
            for bucket, kind in (("personas", "persona"), ("squads", "squad")):
                for n, e in (p["market"].get(bucket) or {}).items():
                    if isinstance(e, dict) and e.get("owner") and isinstance(e.get("v"), int):
                        out[(kind, n)] = (e["owner"], e["v"])
    return out


def _public_pkg(ctx):
    return os.path.join(ctx.engine, "packages", "dira-protocols")


# ---------- 계획 ----------

def _plan(ctx):
    """원본(.dira 쪽)을 훑어 만들 파일 {경로: 바이트 또는 ('copy', 원본)}과 의존성을 정한다. 이미 옮긴 뒤면 원본이 없다."""
    q, proj = ctx.root, ctx.project_dir
    team = os.path.join(proj, "dira-team")
    mk = _market(ctx)
    plan, deps, srcs = {}, [], []
    # 스킬 이름 -> 원본 디렉터리 (~/.claude/skills 에 SKILL.md 가 있는 것만)
    sk_home = _skills_home()
    lock = {}
    try:
        with open(os.path.expanduser("~/.agents/.skill-lock.json"), encoding="utf-8") as f:
            lock = json.load(f).get("skills", {})
    except (OSError, ValueError, AttributeError):
        pass
    skills = {}

    def skill_deps(md):
        out = []
        for s in _skill_names(md):
            d = os.path.join(sk_home, s)
            if os.path.isfile(os.path.join(d, "SKILL.md")):
                skills[s] = d
                out.append(s)
        return out

    def yml(name, version, desc, dep_list=()):
        t = "name: %s\nversion: %s\ndescription: %s\n" % (name, version, json.dumps(desc, ensure_ascii=False))
        if dep_list:
            t += "dependencies:\n  apm:\n" + "".join("    - %s\n" % x for x in dep_list)
        return t.encode()

    pdir = os.path.join(q, "personas")
    for n in sorted(os.listdir(pdir)) if os.path.isdir(pdir) else []:
        prof = os.path.join(pdir, n, "PROFILE.md")
        if not os.path.isfile(prof):
            continue
        sk = os.path.join(pdir, n, "skills.md")
        srcs += [prof] + ([sk] if os.path.isfile(sk) else [])
        if ("persona", n) in mk:
            owner, v = mk[("persona", n)]
            dest = os.path.join(team, "market", "persona", owner, n)
            ver, up = "%d.0.0" % v, "../../../../"
            dep_ref = "./market/persona/%s/%s" % (owner, n)
        else:
            dest, ver, up, dep_ref = os.path.join(team, "personas", n), "1.0.0", "../../", "./personas/" + n
        plan[os.path.join(dest, "PROFILE.md")] = ("copy", prof)
        if os.path.isfile(sk):
            plan[os.path.join(dest, "skills.md")] = ("copy", sk)
        plan[os.path.join(dest, "apm.yml")] = yml("persona-" + n, ver, "dira persona " + n,
                                                  [up + "skills/" + s for s in skill_deps(sk)])
        deps.append(dep_ref)

    sdir = os.path.join(q, "squads")
    for n in sorted(os.listdir(sdir)) if os.path.isdir(sdir) else []:
        files = [f for f in _files(os.path.join(sdir, n))]
        if not files:
            continue
        if ("squad", n) in mk:
            owner, v = mk[("squad", n)]
            dest, ver, dep_ref = os.path.join(team, "market", "squad", owner, n), "%d.0.0" % v, "./market/squad/%s/%s" % (owner, n)
        else:
            dest, ver, dep_ref = os.path.join(team, "squads", n), "1.0.0", "./squads/" + n
        for f in files:
            plan[os.path.join(dest, f)] = ("copy", os.path.join(sdir, n, f))
            srcs.append(os.path.join(sdir, n, f))
        plan[os.path.join(dest, "apm.yml")] = yml("squad-" + n, ver, "dira squad " + n)
        deps.append(dep_ref)

    # 프로토콜: AGENTS.md + 공용 패키지와 내용이 다른(또는 공용에 없는) 형제 문서 전부
    pub, qp = _public_pkg(ctx), os.path.join(q, "protocols")
    pub_files = {f for f in _files(pub) if f not in ("apm.yml", "AGENTS.template.md")} if os.path.isdir(pub) else set()
    local = []
    for f in sorted(os.listdir(qp)) if os.path.isdir(qp) else []:
        p = os.path.join(qp, f)
        if not os.path.isfile(p) or f == "apm.yml":
            continue
        data = _read(p)
        if data.startswith(b"<!-- dira_apm materialize"):  # materialize 가 쓴 파일은 원본이 아니다
            continue
        if f == "AGENTS.md" or f not in pub_files or _read(os.path.join(pub, f)) != data:
            local.append(f)
            plan[os.path.join(team, "protocols", f)] = ("copy", p)
            srcs.append(p)
    plan[os.path.join(team, "protocols", "apm.yml")] = yml("project-protocols", "1.0.0", "이 프로젝트의 AGENTS.md와 공용 문서를 바꿔 쓴 파일")
    mat = sorted(pub_files | set(local))  # materialize 가 큐에 쓰는 이름들

    # 스킬 패키지
    for s, d in sorted(skills.items()):
        desc = "dira skill " + s
        e = lock.get(s) if isinstance(lock, dict) else None
        if isinstance(e, dict) and e.get("sourceUrl"):
            desc += " (출처 %s %s)" % (e.get("sourceUrl"), e.get("skillPath", ""))
        base = os.path.join(team, "skills", s)
        plan[os.path.join(base, "apm.yml")] = yml("skill-" + s, "1.0.0", desc)
        for f in _files(d):
            plan[os.path.join(base, ".apm", "skills", s, f)] = ("copy", os.path.join(d, f))

    # 공용 의존성 + dira-team/apm.yml
    if os.path.isfile(os.path.join(proj, "packages", "dira-protocols", "apm.yml")):
        pub_dep = "../packages/dira-protocols"
    else:
        pub_dep = "%s/dira-protocols#dira-protocols-v1.0.1" % PUBLIC_PKG_REPO
    plan[os.path.join(team, "apm.yml")] = ("team", [pub_dep, "./protocols"] + sorted(set(deps)))
    return {"plan": plan, "srcs": srcs, "mat": mat, "skills": skills}


def _team_yml(deps):
    return ("name: dira-team\nversion: 1.0.0\ntargets: [claude]\ndependencies:\n  apm:\n"
            + "".join("    - %s\n" % d for d in deps)).encode()


def _dev_skills(ctx):
    """저장소 루트에 이미 커밋된 .claude/skills/<이름>/ 파일들 -> (옛 경로, 새 .apm 경로)."""
    base = os.path.join(ctx.project_dir, ".claude", "skills")
    out = []
    for n in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        d = os.path.join(base, n)
        if os.path.isdir(d) and not os.path.islink(d):
            out += [(os.path.join(d, f), os.path.join(ctx.project_dir, ".apm", "skills", n, f)) for f in _files(d)]
    return out


def targets(ctx):
    pl = _plan(ctx)
    proj, q = ctx.project_dir, ctx.root
    t = list(pl["plan"]) + pl["srcs"]
    t += [os.path.join(q, "protocols", f) for f in pl["mat"]]
    sd = os.path.join(q, "squads")
    t += [os.path.join(sd, n, f) for n in (sorted(os.listdir(sd)) if os.path.isdir(sd) else []) for f in _files(os.path.join(sd, n))]
    for old, new in _dev_skills(ctx):
        t += [old, new]
    t += [os.path.join(proj, ".gitignore"), os.path.join(proj, "apm.yml"), os.path.join(proj, "apm.lock.yaml"),
          os.path.join(proj, "dira-team", "apm.lock.yaml")]
    return sorted(set(os.path.abspath(x) for x in t))


# ---------- 쓰기 ----------

def _put(path, data):
    if os.path.isfile(path) and _read(path) == data:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def _run_apm(ctx, cmd):
    env = dict(os.environ, TICKET_ROOT=ctx.root)
    r = subprocess.run([sys.executable, os.path.join(ctx.engine, "dira_apm.py"), cmd, ctx.project_dir, "--no-frozen"],
                       capture_output=True, text=True, env=env)
    return r.returncode, (r.stdout + r.stderr).strip()


def _gitignore(ctx):
    p = os.path.join(ctx.project_dir, ".gitignore")
    cur = _read(p).decode() if os.path.isfile(p) else ""
    have = set(cur.splitlines())
    add = [l for l in ("dira-team/apm_modules/", "dira-team/.claude/", "dira-team/.agents/") if l not in have]
    if add:
        _put(p, (cur + ("" if not cur or cur.endswith("\n") else "\n") + "\n".join(add) + "\n").encode())


def _market_backup(ctx, mk):
    """레지스트리 market 키를 백업 폴더에 적고 레지스트리에서 지운다."""
    if not mk:
        return
    rp, reg = _registry(ctx)
    for p in reg.get("projects", []):
        if isinstance(p, dict) and p.get("id") == ctx.project_id and "market" in p:
            # 러너가 backup/<ID>/ 의 마지막 항목을 백업 폴더로 읽으므로 그 안에 두지 않고 옆에 둔다.
            bd = os.path.join(ctx.root, "migrations", "backup")
            os.makedirs(bd, exist_ok=True)
            with open(os.path.join(bd, ID + "-market.json"), "w", encoding="utf-8") as f:
                json.dump(p["market"], f, ensure_ascii=False, indent=1)
            del p["market"]
    tmp = "%s.%d.tmp" % (rp, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False, indent=1)
    os.replace(tmp, rp)


def apply(ctx):
    pl = _plan(ctx)
    proj, q = ctx.project_dir, ctx.root
    _BASE.clear()
    _BASE.update(_dryruns(ctx))  # 2. 기준 프롬프트: 아무것도 쓰기 전에
    if pl["srcs"]:  # 원본이 있을 때만 쓴다(이미 옮겼으면 설치와 검증만 다시)
        for path, v in pl["plan"].items():  # 3 - 5
            if isinstance(v, tuple) and v[0] == "copy":
                _put(path, _read(v[1]))
            elif isinstance(v, tuple) and v[0] == "team":
                _put(path, _team_yml(v[1]))
            else:
                _put(path, v)
        _market_backup(ctx, _market(ctx))
    if not os.path.isfile(os.path.join(proj, "apm.yml")):  # 6
        _put(os.path.join(proj, "apm.yml"), ("name: %s\nversion: 1.0.0\ntargets: [claude]\n" % os.path.basename(proj)).encode())
    for old, new in _dev_skills(ctx):
        _put(new, _read(old))
        os.remove(old)
    _gitignore(ctx)  # 7
    rc, out = _run_apm(ctx, "install")
    if rc:
        raise RuntimeError("dira_apm install 실패 rc %d: %s" % (rc, (out.splitlines() or ["?"])[-1]))
    rc, out = _run_apm(ctx, "check")
    if rc:
        raise RuntimeError("dira_apm check 실패: %s" % (out.splitlines() or ["?"])[0])
    for p in pl["srcs"]:  # 8. 정본이 둘이 되지 않게
        if p.startswith(os.path.join(q, "personas") + os.sep) and os.path.isfile(p):
            os.remove(p)
    sd = os.path.join(q, "squads")
    if os.path.isdir(sd) and pl["srcs"]:
        shutil.rmtree(sd)
    rc, out = _run_apm(ctx, "materialize")
    if rc:
        raise RuntimeError("materialize 실패: " + out)


# ---------- dryrun 비교 ----------

def _norm(text, tmp):
    text = text.replace(tmp, "<임시>")
    from_core = re.sub(r"===== CORE\.md \(.*?\n===== 코어 프로토콜 끝 =====\n\n?", "", text, flags=re.S)
    out = []
    for line in from_core.splitlines():
        if line.startswith("<!-- dira_apm materialize"):  # materialize 표식 줄
            continue
        if line.startswith("====="):
            line = re.sub(r"\([^()]*\)", "(<경로>)", line)
        out.append(line)
    return out


def _dryrun_one(ctx, persona, tmp):
    proj = os.path.join(tmp, "proj")
    root = os.path.join(proj, ".dira")
    if not os.path.isdir(root):
        os.makedirs(os.path.join(root, "tickets"))
        os.makedirs(os.path.join(root, "workers"))
        os.makedirs(os.path.join(tmp, "local"))
        with open(os.path.join(tmp, "local", "oauth-token"), "w") as f:
            f.write("tok")
        for e in os.listdir(ctx.root):
            src = os.path.join(ctx.root, e)
            if e in ("tickets", "workers", "worktrees", "migrations"):
                continue
            if e in ("personas", "squads", "protocols"):  # tick 의 find 가 최상위 심링크를 안 따라가므로 복사한다
                shutil.copytree(src, os.path.join(root, e), symlinks=True, ignore=shutil.ignore_patterns("memory"))
                for n in os.listdir(src) if e == "personas" else []:
                    if os.path.isdir(os.path.join(src, n, "memory")):
                        os.symlink(os.path.join(src, n, "memory"), os.path.join(root, e, n, "memory"))
            else:
                os.symlink(src, os.path.join(root, e))
        for e in ("dira-team", "packages", "apm.yml"):
            if os.path.exists(os.path.join(ctx.project_dir, e)):
                os.symlink(os.path.join(ctx.project_dir, e), os.path.join(proj, e))
        with open(os.path.join(root, "workers", "w1.sh"), "w") as f:
            f.write('#!/bin/bash\nTICKET_NAME="w1"\nTICKET_CWD="%s"\nTICKET_PROMPT_FMT="pick %%s"\n'
                    'TICKET_ENGINE=("/bin/echo" "{sid}")\n. "%s"\n' % (proj, os.path.join(ctx.engine, "tick.sh")))
        os.chmod(os.path.join(root, "workers", "w1.sh"), 0o755)
    for old in os.listdir(os.path.join(root, "tickets")):
        os.remove(os.path.join(root, "tickets", old))
    with open(os.path.join(root, "tickets", "5a5a5a5a.md"), "w", encoding="utf-8") as f:
        f.write("---\nticket: 5a5a5a5a\ntitle: 표본\nkind: work\npersona: %s\n---\n\n## Goal\n표본\n" % persona)
    env = dict(os.environ, TICKET_LOCAL=os.path.join(tmp, "local"), DIRA_APM_NO_INSTALL="1")
    r = subprocess.run([os.path.join(root, "workers", "w1.sh"), "dryrun"], capture_output=True, text=True, env=env, timeout=180)
    out = r.stdout
    if "프롬프트:" not in out:
        raise RuntimeError("dryrun 실패(%s): %s" % (persona, (r.stderr or out).strip()[-200:]))
    sk = [l for l in out.splitlines() if l.startswith("스킬:")]
    return sk + _norm(out.split("프롬프트:", 1)[1], tmp)


def _dryruns(ctx):
    """페르소나마다 연달아 두 번 떠서 서로 다른 줄(시각 등)을 걷어낸 기준 줄 목록."""
    res = {}
    pdir = os.path.join(ctx.root, "personas")
    names = [n for n in sorted(os.listdir(pdir)) if os.path.isdir(os.path.join(pdir, n))] if os.path.isdir(pdir) else []
    for n in names:
        has = os.path.isfile(os.path.join(pdir, n, "PROFILE.md")) or os.path.isdir(os.path.join(ctx.project_dir, "dira-team"))
        if not has:
            continue
        with tempfile.TemporaryDirectory() as tmp:
            a = _dryrun_one(ctx, n, tmp)
            b = _dryrun_one(ctx, n, tmp)
        noisy = set(a) ^ set(b)
        res[n] = [l for l in a if l not in noisy]
    return res


def _commit(ctx):
    proj = ctx.project_dir
    if subprocess.run(["git", "-C", proj, "rev-parse", "--git-dir"], capture_output=True).returncode:
        ctx.log("git 저장소가 아니라 커밋하지 않는다")
        return
    # 프로젝트의 husky/lint-staged 가 dira-team 을 서식 변환하지 못하도록 --no-verify 로 커밋한다(verify 는 커밋 전에 끝난다)
    paths = []
    for p in ("apm.yml", "apm.lock.yaml", ".apm", ".claude/skills", "dira-team", ".gitignore"):
        if os.path.exists(os.path.join(proj, p)):
            # 무시된 경로나 빈 디렉터리는 git 이 모르는 pathspec 이라 commit 이 거부하므로 뺀다
            subprocess.run(["git", "-C", proj, "add", "-A", "--", p], capture_output=True)
            if subprocess.run(["git", "-C", proj, "ls-files", "--error-unmatch", "--", p], capture_output=True).returncode == 0:
                paths.append(p)
    if subprocess.run(["git", "-C", proj, "diff", "--cached", "--quiet", "--"] + paths).returncode == 0:
        return  # 이미 같은 트리
    r = subprocess.run(["git", "-C", proj, "commit", "-q", "--no-verify", "-m", COMMIT_MSG, "--"] + paths, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError("커밋 실패: " + (r.stderr.strip().splitlines() or ["?"])[-1])


def verify(ctx):
    rc, out = _run_apm(ctx, "check")
    if rc:
        raise AssertionError("dira_apm check 실패: " + (out.splitlines() or ["?"])[0])
    after = _dryruns(ctx)
    rows, bad, names = [], [], []
    for n, base in sorted(_BASE.items()):
        same = after.get(n) == base
        rows.append("%s: %s" % (n, "같음" if same else "다름"))
        if not same:
            names.append(n)
            d = list(difflib.unified_diff(base, after.get(n, []), lineterm="", n=0))[:12]
            bad.append("%s dryrun 이 달라졌다:\n%s" % (n, "\n".join(d)))
    ctx.log("dryrun 비교 " + ", ".join(rows))
    if bad:
        ctx.log("\n".join(bad))
        raise AssertionError("페르소나 dryrun 이 달라졌다: " + ", ".join(names))  # 러너는 마지막 줄만 기록한다
    _commit(ctx)
