"""dira-team/ 을 큐 안 .dira/team/ 으로 옮기고 프로젝트 저장소에서 뺀다 (DESIGN.md P509, 항목 0003).

적용 순서는 DESIGN.md P509 결정 7이다. 표준 라이브러리만 쓴다.
"""
import difflib
import importlib.util
import os
import re
import shutil
import subprocess

ID = "0003-team-into-queue"
DESC = "dira-team/ 을 저장소에서 빼 .dira/team/ 으로 옮긴다"
DESC_EN = "Move dira-team/ out of the repository into .dira/team/"
SCOPE = "project"
ROLLOUT = "canary"
REVERSIBLE = True

COMMIT_MSG = "dira - 운영 정보를 .dira로 옮긴다 (P509)"
REVERT_MSG = "dira - 운영 정보를 dira-team으로 되돌린다 (P509 revert)"
SKIP = {"apm_modules", ".claude", ".agents"}
IGNORE_LINES = ("dira-team/apm_modules/", "dira-team/.claude/", "dira-team/.agents/")
_BASE = {}
_CREATED = []


def _m2(ctx):
    spec = importlib.util.spec_from_file_location("mig_0002", os.path.join(ctx.engine, "migrations", "0002_apm_packages.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _old(ctx):
    return os.path.join(ctx.project_dir, "dira-team")


def _new(ctx):
    return os.path.join(ctx.root, "team")


def _files(base):
    out = []
    for dp, dn, fn in os.walk(base):
        dn[:] = [d for d in dn if not (dp == base and d in SKIP)]
        out += [os.path.join(dp, f) for f in fn if f != ".DS_Store"]
    return sorted(out)


def _todo(ctx):
    return os.path.isfile(os.path.join(_old(ctx), "apm.yml"))


def targets(ctx):
    old, new = _old(ctx), _new(ctx)
    t = [os.path.join(ctx.project_dir, ".gitignore")]
    if os.path.isdir(old):
        for p in _files(old):
            t += [p, os.path.join(new, os.path.relpath(p, old))]
    return sorted(set(os.path.abspath(x) for x in t))


def _fix_deps(src_dir, text, old, new_dir):
    """프로젝트 쪽(옛 팀 디렉터리 밖)을 가리키는 로컬 의존성만 새 위치 기준 상대경로로 다시 쓴다."""
    def sub(m):
        target = os.path.normpath(os.path.join(src_dir, m.group(2)))
        if target == old or target.startswith(old + os.sep):
            return m.group(0)
        return m.group(1) + os.path.relpath(target, new_dir)
    return re.sub(r"(?m)^(\s+-\s+)(\.\.?/[^\s#]*)", sub, text)


def _copy(ctx):
    old, new = _old(ctx), _new(ctx)
    for p in _files(old):
        rel = os.path.relpath(p, old)
        dst = os.path.join(new, rel)
        data = open(p, "rb").read()
        if os.path.basename(p) == "apm.yml":
            data = _fix_deps(os.path.dirname(p), data.decode(), old, os.path.dirname(dst)).encode()
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(data)


def apply(ctx):
    if not _todo(ctx):
        return
    m2 = _m2(ctx)
    _BASE.clear()
    _BASE.update(m2._dryruns(ctx))
    if not os.path.isfile(os.path.join(_new(ctx), "apm.yml")):
        _CREATED.append(_new(ctx))
        try:
            _copy(ctx)
        except BaseException:
            shutil.rmtree(_new(ctx), ignore_errors=True)
            raise
    for cmd in ("install", "check"):
        rc, out = m2._run_apm(ctx, cmd)
        if rc:
            _undo(ctx)
            raise RuntimeError("dira_apm %s 실패 rc %d: %s" % (cmd, rc, (out.splitlines() or ["?"])[-1]))


def _undo(ctx):
    for p in _CREATED:
        shutil.rmtree(p, ignore_errors=True)
    del _CREATED[:]


def _git(proj, *a):
    return subprocess.run(["git", "-C", proj, *a], capture_output=True, text=True)


def verify(ctx):
    if not _todo(ctx):
        return
    m2 = _m2(ctx)
    try:
        rc, out = m2._run_apm(ctx, "check")
        assert rc == 0, "dira_apm check 실패: " + (out.splitlines() or ["?"])[0]
        after = m2._dryruns(ctx)
        bad = [n for n, base in sorted(_BASE.items()) if after.get(n) != base]
        for n in bad:
            ctx.log("%s dryrun diff:\n%s" % (n, "\n".join(list(difflib.unified_diff(_BASE[n], after.get(n, []), lineterm="", n=0))[:20])))
        if bad:
            raise AssertionError("페르소나 dryrun 이 달라졌다: " + ", ".join(bad))
        ctx.log("dryrun 비교 " + ", ".join("%s: 같음" % n for n in sorted(_BASE)))
        _leave_repo(ctx)
    except BaseException:
        _undo(ctx)
        raise


def _leave_repo(ctx):
    proj, old = ctx.project_dir, _old(ctx)
    git = subprocess.run(["git", "-C", proj, "rev-parse", "--git-dir"], capture_output=True).returncode == 0
    if git and _git(proj, "ls-files", "--", "dira-team").stdout.strip():
        r = _git(proj, "rm", "-r", "--cached", "--quiet", "--", "dira-team")
        if r.returncode:
            raise RuntimeError("git rm 실패: " + r.stderr.strip())
    shutil.rmtree(old, ignore_errors=True)
    gi = os.path.join(proj, ".gitignore")
    if os.path.isfile(gi):
        cur = open(gi, encoding="utf-8").read()
        keep = [l for l in cur.splitlines(True) if l.strip() not in IGNORE_LINES]
        if len(keep) != len(cur.splitlines(True)):
            open(gi, "w", encoding="utf-8").write("".join(keep))
    if not git:
        return
    _git(proj, "add", "-A", "--", ".gitignore")
    names = _git(proj, "diff", "--cached", "--name-only", "--", "dira-team", ".gitignore").stdout.split("\n")
    names = [n for n in names if n]
    if not names:
        return  # 추적 파일도 .gitignore 변화도 없다
    r = _git(proj, "commit", "-q", "--no-verify", "-m", COMMIT_MSG, "--", *names)
    if r.returncode:
        raise RuntimeError("커밋 실패: " + (r.stderr.strip().splitlines() or ["?"])[-1])


def revert(ctx):
    """러너가 백업 파일(dira-team 과 .gitignore)을 되살린 뒤 부른다: 큐의 team/ 을 지우고, 이관 커밋이 있으면 되돌림 커밋을 낸다."""
    proj = ctx.project_dir
    shutil.rmtree(_new(ctx), ignore_errors=True)
    if _git(proj, "rev-parse", "--git-dir").returncode:
        return
    log = _git(proj, "log", "-n", "200", "--format=%s").stdout.splitlines()
    if COMMIT_MSG not in log:
        return
    paths = [p for p in ("dira-team", ".gitignore") if os.path.exists(os.path.join(proj, p))]
    _git(proj, "add", "-A", "--", *paths)
    names = [n for n in _git(proj, "diff", "--cached", "--name-only", "--", "dira-team", ".gitignore").stdout.split("\n") if n]
    if names:
        _git(proj, "commit", "-q", "--no-verify", "-m", REVERT_MSG, "--", *names)
