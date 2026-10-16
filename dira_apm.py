#!/usr/bin/env python3
"""dira 패키지(APM) 보조: ensure-cli | install | check | resolve | materialize | skills. 표준 라이브러리만."""
import hashlib, os, re, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MARK = "<!-- dira_apm materialize: 고치지 말고 dira-team/protocols 또는 packages/dira-protocols를 고친다 -->"
SKILL_LINE = re.compile(r"^\s*-\s*`([^`]+)`")


def version():
    return (HERE / "apm-version").read_text().split()[0]


def ensure_cli():
    if os.environ.get("DIRA_APM_BIN"):  # 테스트용 가짜 apm 끼우는 자리
        return os.environ["DIRA_APM_BIN"]
    dest = Path.home() / ".config/dira/tools/apm" / version()
    bin_ = dest / "bin/apm"
    if bin_.exists():
        return str(bin_)
    dest.mkdir(parents=True, exist_ok=True)
    spec = "apm-cli==" + version()
    uv = shutil.which("uv") or str(Path.home() / ".local/bin/uv")
    if os.path.exists(uv):
        env = dict(os.environ, UV_TOOL_DIR=str(dest / "tools"), UV_TOOL_BIN_DIR=str(dest / "bin"))
        r = subprocess.run([uv, "tool", "install", "--python", "3.12", spec], env=env,
                           stdout=sys.stderr, stderr=sys.stderr)
    else:
        py = None
        for v in range(15, 9, -1):
            py = shutil.which("python3.%d" % v)
            if py:
                break
        if not py:
            sys.exit("apm 설치 실패: uv도 python3.10 이상도 없다")
        subprocess.run([py, "-m", "venv", str(dest / "venv")], check=True)
        r = subprocess.run([str(dest / "venv/bin/pip"), "install", spec],
                           stdout=sys.stderr, stderr=sys.stderr)
        (dest / "bin").mkdir(exist_ok=True)
        if r.returncode == 0:
            (dest / "bin/apm").symlink_to(dest / "venv/bin/apm")
    if r.returncode or not bin_.exists():
        sys.exit("apm 설치 실패: rc %s" % r.returncode)
    return str(bin_)


# ponytail: apm.yml 전체 YAML이 아니라 name, version, dependencies.apm 문자열 항목만 읽는다. dict 항목은 무시한다.
def read_yml(path):
    d = {"name": None, "version": None, "deps": []}
    sect = sub = None
    for line in Path(path).read_text().splitlines():
        m = re.match(r"^(\w+):\s*(.*)$", line)
        if m:
            sect, sub = m.group(1), None
            if sect in ("name", "version"):
                d[sect] = m.group(2).strip().strip("'\"")
            continue
        m = re.match(r"^  (\w+):", line)
        if m:
            sub = m.group(1)
            continue
        m = re.match(r"^\s+-\s+([^\s{][^#]*?)\s*(#.*)?$", line)
        if m and sect == "dependencies" and sub == "apm":
            d["deps"].append(m.group(1).strip("'\""))
    return d


def packages(base):
    """base 아래 apm.yml이 있는 디렉터리 -> yml. apm_modules, .claude, 숨은 디렉터리는 안 들어간다."""
    out = []
    for dp, dn, fn in os.walk(base):
        dn[:] = [x for x in dn if x not in ("apm_modules", ".claude", ".agents", ".git", "node_modules")]
        if "apm.yml" in fn:
            out.append(Path(dp))
    return out


def digest(d):
    h = hashlib.sha256()
    for p in sorted(Path(d).rglob("*")):
        if p.is_file():
            h.update(str(p.relative_to(d)).encode() + b"\0" + p.read_bytes())
    return h.hexdigest()


def installed(site):
    """site/apm_modules 안 패키지들: {name: [dir...]} (내용이 같은 사본은 하나로 센다)."""
    byname = {}
    for d in packages(site / "apm_modules") if (site / "apm_modules").is_dir() else []:
        n = read_yml(d / "apm.yml")["name"]
        if n:
            lst = byname.setdefault(n, {})
            lst.setdefault(digest(d), d)
    return {n: list(v.values()) for n, v in byname.items()}


def skills_of(d):
    s = Path(d) / ".apm/skills"
    return [p.name for p in sorted(s.iterdir()) if p.is_dir()] if s.is_dir() else []


def dep_dir(pkg_dir, dep, site):
    ref = dep.split("#")[0]
    if ref.startswith((".", "/")):
        p = (Path(pkg_dir) / ref).resolve()
    else:
        p = site / "apm_modules" / ref
    return p if (p / "apm.yml").exists() else None


def closure(d, site, seen=None):
    seen = seen if seen is not None else set()
    d = Path(d).resolve()
    if d in seen:
        return seen
    seen.add(d)
    for dep in read_yml(d / "apm.yml")["deps"]:
        p = dep_dir(d, dep, site)
        if p:
            closure(p, site, seen)
    return seen


def sites(root):
    r = []
    if (root / "apm.yml").exists():
        r.append(root)
    if (root / "dira-team/apm.yml").exists():
        r.append(root / "dira-team")
    return r


def skill_names(md):
    p = Path(md)
    return [m.group(1) for l in p.read_text().splitlines() if (m := SKILL_LINE.match(l))] if p.exists() else []


def check(root):
    bad = []
    apm = None
    for site in sites(root):
        apm = apm or ensure_cli()
        r = subprocess.run([apm, "audit"], cwd=site, capture_output=True, text=True)
        if r.returncode:
            last = (r.stdout + r.stderr).strip().splitlines()[-1:] or ["?"]
            bad.append("%s: apm audit rc %d: %s" % (site.name if site != root else ".", r.returncode, last[0]))
        owners = {}
        locs = [d for d in packages(site) if "apm_modules" not in d.parts]
        if site == root:  # 루트는 dira-team을 자기 패키지로 세지 않는다
            locs = [d for d in locs if "dira-team" not in d.relative_to(site).parts]
        for d in locs:
            for s in skills_of(d):
                owners.setdefault(s, set()).add(read_yml(d / "apm.yml")["name"])
        for n, dirs in installed(site).items():
            for d in dirs:
                for s in skills_of(d):
                    owners.setdefault(s, set()).add(n)
        for s, o in sorted(owners.items()):
            if len(o) > 1:
                bad.append("스킬 이름 충돌: %s <- %s" % (s, ", ".join(sorted(o))))
        if site.name == "dira-team":
            for pd in sorted((site / "personas").glob("*/")) if (site / "personas").is_dir() else []:
                if not (pd / "apm.yml").exists():
                    continue
                have = set()
                for c in closure(pd, site):
                    have.update(skills_of(c))
                for s in skill_names(pd / "skills.md"):
                    if s not in have:
                        bad.append("페르소나 %s: skills.md의 %s가 패키지 폐포에 없다" % (pd.name, s))
    for b in bad:
        print(b)
    return 1 if bad else 0


def resolve(root, kind, name=None):
    team = root / "dira-team"
    if not (team / "apm.yml").exists():
        return 3, "옛 배치: dira-team/apm.yml 없음"
    if kind == "protocols":
        local, pname = team / "protocols", "dira-protocols"
    elif name:
        local, pname = team / (kind + "s") / name, "%s-%s" % (kind, name)
    else:
        return 2, "이름이 필요하다"
    if local.is_dir():
        return 0, str(local)
    found = installed(team).get(pname, [])
    if len(found) > 1:
        return 1, "같은 이름 패키지 %d개: %s" % (len(found), pname)
    if found:
        return 0, str(found[0])
    return 2, "패키지 없음: %s" % pname


def materialize(root):
    team = root / "dira-team"
    out = Path(os.environ.get("TICKET_ROOT") or root / ".dira") / "protocols"
    out.mkdir(parents=True, exist_ok=True)
    srcs = []
    for kind_src in (installed(team).get("dira-protocols", [None])[:1], [team / "protocols"]):
        srcs.append(kind_src[0])
    for src in srcs:
        if not src or not Path(src).is_dir():
            continue
        for f in sorted(Path(src).iterdir()):
            if not f.is_file() or f.name in ("apm.yml", "AGENTS.template.md"):
                continue
            data = f.read_bytes()
            if f.suffix == ".md" and not data.startswith(MARK.encode()):
                data = MARK.encode() + b"\n" + data
            t = out / f.name
            if not t.exists() or t.read_bytes() != data:
                t.write_bytes(data)
    return 0


def skills(root, persona):
    rc, p = resolve(root, "persona", persona)
    if rc:
        print(p, file=sys.stderr)
        return rc
    for s in skill_names(Path(p) / "skills.md"):
        d = root / "dira-team/.claude/skills" / s
        if (d / "SKILL.md").exists():
            print(d)
    return 0


def install(root, frozen):
    apm = ensure_cli()
    rc = 0
    for site in sites(root):
        cmd = [apm, "install"]
        if frozen and (site / "apm.lock.yaml").exists():
            cmd.append("--frozen")
        r = subprocess.run(cmd, cwd=site, stdout=sys.stderr, stderr=sys.stderr)
        rc = rc or r.returncode
    if rc:
        return rc
    rc = check(root)
    if (root / "dira-team/apm.yml").exists():
        materialize(root)
    return rc


def main(a):
    if not a:
        sys.exit(__doc__)
    cmd, rest = a[0], a[1:]
    if cmd == "ensure-cli":
        print(ensure_cli())
        return 0
    flags = [x for x in rest if x.startswith("--")]
    pos = [x for x in rest if not x.startswith("--")]
    root = Path(pos[0]).resolve() if pos else None
    if cmd == "install":
        return install(root, "--no-frozen" not in flags)
    if cmd == "check":
        return check(root)
    if cmd == "materialize":
        return materialize(root)
    if cmd == "resolve":
        rc, msg = resolve(root, *pos[1:3])
        print(msg, file=sys.stdout if rc == 0 else sys.stderr)
        return rc
    if cmd == "skills":
        return skills(root, pos[1])
    sys.exit("모르는 명령: " + cmd)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
