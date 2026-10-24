#!/usr/bin/env python3
"""P519 슬림 체크아웃: 쉬는 프로젝트의 통합 체크아웃 작업 트리를 비우고 다시 채운다.

사용: slim.py status|empty|fill|auto <큐 루트>   (표준 라이브러리만, 출력은 JSON 한 줄)
비우기는 루트 워크트리 전용 config의 sparse-checkout(패턴 /.dira-slim-empty)과 무시 파일 삭제다.
rc 0 정상, 2 거절(사람 작업이 있거나 대상이 아님), 1 git 실패.
"""
import datetime
import fnmatch
import json
import os
import shutil
import subprocess
import sys
import time

PATTERN = "/.dira-slim-empty"
IDLE_SECS = 72 * 3600


def git(root, *args, check=False):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_") or k.startswith("GIT_SSH")}
    p = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, env=env)
    if check and p.returncode:
        raise RuntimeError((p.stderr or p.stdout).strip() or "git " + args[0] + " 실패")
    return p


def paths(queue):
    queue = os.path.realpath(queue)
    return queue, os.path.dirname(queue)


def enabled(queue):
    try:
        with open(os.path.join(queue, "slim-checkout")) as f:
            return f.readline().strip() == "on"
    except OSError:
        return False


def eligible(root):
    if not os.path.isdir(os.path.join(root, ".git")):
        return False
    p = git(root, "rev-parse", "--show-toplevel")
    return p.returncode == 0 and os.path.realpath(p.stdout.strip()) == root


def state(root):
    p = git(root, "sparse-checkout", "list")
    return "empty" if p.returncode == 0 and p.stdout.split("\n")[:-1] == [PATTERN] else "full"


def last_active(queue):
    for n in ("slim-checkout.active", "slim-checkout"):
        try:
            return os.stat(os.path.join(queue, n)).st_mtime
        except OSError:
            pass
    return None


def wip_count(queue):
    try:
        return sum(1 for n in os.listdir(os.path.join(queue, "tickets")) if n.endswith(".wip.md"))
    except OSError:
        return 0


def integration_branch(queue):
    try:
        with open(os.path.join(queue, "integration-branch")) as f:
            return f.readline().strip()
    except OSError:
        return ""


def dirty_paths(root):
    out = git(root, "status", "--porcelain", "-z").stdout.split("\0")
    res, i = [], 0
    while i < len(out):
        e = out[i]
        i += 1
        if len(e) < 4:
            continue
        if e[0] in "RC":
            i += 1  # 원래 경로 항목
        p = e[3:]
        if p == ".dira" or p.startswith(".dira/"):
            continue
        res.append(p)
    return res


def refusal(queue, root):
    if not eligible(root):
        return "git 저장소의 최상위 폴더가 아닙니다"
    br = git(root, "symbolic-ref", "--short", "-q", "HEAD").stdout.strip()
    if not br:
        return "HEAD가 detached입니다"
    want = integration_branch(queue)
    if want and br != want:
        return "통합 브랜치 %s가 아닌 %s가 체크아웃돼 있습니다" % (want, br)
    d = dirty_paths(root)
    if d:
        return "사람 작업이 있습니다: " + ", ".join(d[:5])
    return ""


def purge_ignored(root):
    """무시 파일을 지운다. .dira .git, 다른 워크트리(와 그 상위), .env 파일은 남긴다."""
    wts = []
    for line in git(root, "worktree", "list", "--porcelain").stdout.splitlines()[1:]:
        if line.startswith("worktree "):
            wts.append(os.path.realpath(line[9:]))
    keep_top = {os.path.join(root, ".dira"), os.path.join(root, ".git")}

    def inside_wt(p):
        return any(p == w or p.startswith(w + os.sep) for w in wts)

    def is_env(n):
        return n == ".env" or fnmatch.fnmatch(n, ".env.*")

    # ponytail: 무시 항목마다 전체 순회. 파일이 수백만이면 rmtree 선판정(.env 유무) 캐시
    for line in git(root, "status", "--ignored", "--porcelain", "-z").stdout.split("\0"):
        if not line.startswith("!! "):
            continue
        top = os.path.join(root, line[3:].rstrip("/"))
        if top in keep_top or inside_wt(top) or not os.path.lexists(top):
            continue
        if os.path.islink(top) or os.path.isfile(top):
            if not is_env(os.path.basename(top)):
                os.unlink(top)
            continue
        dirs_to_try = []
        for cur, dns, fns in os.walk(top):
            dns[:] = [d for d in dns if not inside_wt(os.path.join(cur, d))]
            for d in list(dns):
                dp = os.path.join(cur, d)
                if os.path.islink(dp):
                    os.unlink(dp)
                    dns.remove(d)
            for fn in fns:
                if not is_env(fn):
                    os.unlink(os.path.join(cur, fn))
            dirs_to_try.append(cur)
        for d in reversed(dirs_to_try):
            try:
                os.rmdir(d)  # 남길 것이 있으면 비어 있지 않아 실패한다
            except OSError:
                pass


def do_empty(queue, root):
    why = refusal(queue, root)
    if why:
        return 2, why
    if state(root) == "empty":
        return 0, ""
    git(root, "config", "extensions.worktreeConfig", "true", check=True)
    git(root, "sparse-checkout", "set", "--no-cone", PATTERN, check=True)
    purge_ignored(root)
    return 0, ""


def do_fill(queue, root):
    if state(root) == "empty":
        git(root, "sparse-checkout", "disable", check=True)
    br = git(root, "symbolic-ref", "--short", "-q", "HEAD").stdout.strip()
    want = integration_branch(queue)
    if want and br != want:
        return 2, "통합 브랜치 %s가 아닌 %s가 체크아웃돼 있습니다" % (want, br or "detached")
    return 0, ""


def report(queue, root, reason=""):
    la = last_active(queue)
    return {
        "enabled": enabled(queue),
        "eligible": eligible(root),
        "state": state(root),
        "last_active": datetime.datetime.fromtimestamp(la).astimezone().isoformat(timespec="seconds") if la else None,
        "reason": reason,
    }


def main(argv):
    if len(argv) != 3 or argv[1] not in ("status", "empty", "fill", "auto"):
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    cmd = argv[1]
    queue, root = paths(argv[2])
    rc, why = 0, ""
    try:
        if cmd == "empty":
            rc, why = do_empty(queue, root)
        elif cmd == "fill":
            rc, why = do_fill(queue, root)
        elif cmd == "auto":
            la = last_active(queue)
            if (enabled(queue) and eligible(root) and state(root) == "full" and wip_count(queue) == 0
                    and la is not None and time.time() - la >= IDLE_SECS):
                rc, why = do_empty(queue, root)
    except RuntimeError as e:
        rc, why = 1, str(e)
    print(json.dumps(report(queue, root, why), ensure_ascii=False))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
