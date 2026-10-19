#!/usr/bin/env python3
"""범용 프로젝트 마이그레이션 러너 (DESIGN.md P505). 표준 라이브러리만 쓴다.

항목은 `migrations/NNNN_<slug>.py`(또는 $DIRA_MIGRATIONS_DIR)이고, 이 파일이 유일한 실행기다.
명령: list check gate dry-run apply skip revert promote.
"""
import argparse
import importlib.util
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone

sys.dont_write_bytecode = True

ENGINE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.environ.get("TICKET_LOCAL") or os.path.expanduser("~/.config/dira")
WAIT_LIMIT_S = int(os.environ.get("DIRA_MIGRATE_WAIT_LIMIT_S", "1200"))
POLL_S = float(os.environ.get("DIRA_MIGRATE_POLL_S", "5"))
REQUIRED = ("ID", "DESC", "DESC_EN", "SCOPE", "REVERSIBLE", "targets", "apply", "verify")
SHOWN = {"ok": "적용됨", "hold": "보류", "skipped": "건너뜀", "failed": "실패",
         "broken": "깨짐", "pending": "미적용"}


def now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def die(msg, rc=2):
    print(msg, file=sys.stderr)
    sys.exit(rc)


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.%d.tmp" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except (PermissionError, ValueError, TypeError):
        return True


class Ctx:
    def __init__(self, root=None, project_id=None):
        self.root = root
        self.project_dir = os.path.dirname(root) if root else None
        self.project_id = project_id
        self.local = LOCAL
        self.engine = ENGINE
        self.log = lambda text: log_line(root, "LOG", text)


def mdir(root):
    return os.path.join(root if root else os.path.join(LOCAL), "migrations")


def log_line(root, kind, text):
    d = mdir(root)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "migrate.log"), "a", encoding="utf-8") as f:
        f.write("%s %s %s\n" % (now(), kind, text))


# ---------- 항목 ----------

def load_items():
    d = os.environ.get("DIRA_MIGRATIONS_DIR") or os.path.join(ENGINE, "migrations")
    items, seen = [], {}
    for name in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        m = re.match(r"^(\d{4})_([A-Za-z0-9_]+)\.py$", name)
        if not m:
            continue
        if m.group(1) in seen:
            die("마이그레이션 번호가 겹칩니다: %s, %s" % (seen[m.group(1)], name))
        seen[m.group(1)] = name
        spec = importlib.util.spec_from_file_location("mig_" + m.group(1), os.path.join(d, name))
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception as e:
            die("마이그레이션 로드 실패 %s: %s" % (name, e))
        miss = [k for k in REQUIRED if not hasattr(mod, k)]
        if miss:
            die("마이그레이션 %s에 %s가 없습니다" % (name, ", ".join(miss)))
        if mod.ID != "%s-%s" % (m.group(1), m.group(2).replace("_", "-")):
            die("마이그레이션 ID %s가 파일 이름 %s와 다릅니다" % (mod.ID, name))
        if mod.SCOPE not in ("project", "machine"):
            die("마이그레이션 %s의 SCOPE가 잘못됐습니다" % mod.ID)
        mod.ROLLOUT = getattr(mod, "ROLLOUT", "all")
        items.append(mod)
    return items


def registry():
    reg = read_json(os.path.join(LOCAL, "gui-projects.json"), {})
    out = []
    for p in reg.get("projects", []) if isinstance(reg, dict) else []:
        if isinstance(p, dict) and p.get("root"):
            out.append({"id": p.get("id") or os.path.basename(os.path.dirname(p["root"])),
                        "name": p.get("name") or p.get("id") or "", "root": p["root"]})
    return out


def target_for_root(root):
    """--root R 를 레지스트리 id와 맞춘다. 미등록이면 프로젝트 폴더 이름을 id로 쓴다."""
    real = os.path.realpath(root)
    for p in registry():
        if os.path.realpath(p["root"]) == real:
            return p
    pdir = os.path.dirname(os.path.abspath(root))
    return {"id": os.path.basename(pdir), "name": os.path.basename(pdir), "root": root}


def machine_target():
    return {"id": "machine", "name": "이 컴퓨터", "root": None}


def pick_targets(args, with_machine=True):
    if getattr(args, "root", None):
        ps = [target_for_root(args.root)]
    else:
        ps = registry()
    return ([machine_target()] if with_machine else []) + ps


# ---------- 상태 판정 ----------

def applied_path(root):
    return os.path.join(mdir(root), "applied.json")


def inflight_path(root):
    return os.path.join(mdir(root), "inflight.json")


def promoted(item_id):
    return os.path.exists(os.path.join(LOCAL, "migrations", "promoted", item_id))


def state_of(item, tgt, recs, inflight):
    rec = recs.get(item.ID) or {}
    if rec.get("state") == "ok":
        return "ok"
    if (item.ROLLOUT == "canary" and item.SCOPE == "project" and tgt["id"] != "dira"
            and not promoted(item.ID)):
        return "hold"
    if inflight and inflight.get("id") == item.ID:
        return "pending"
    return {"skipped": "skipped", "failed": "failed", "broken": "broken"}.get(rec.get("state"), "pending")


def scoped(items, tgt):
    return [i for i in items if (i.SCOPE == "machine") == (tgt["root"] is None)]


def states(items, tgt):
    recs = read_json(applied_path(tgt["root"]), {})
    inf = read_json(inflight_path(tgt["root"]), None)
    return [(i, state_of(i, tgt, recs, inf)) for i in scoped(items, tgt)]


# ---------- 백업 - 복원 ----------

def rel_for(path, base):
    path = os.path.abspath(path)
    if base and path.startswith(base.rstrip("/") + "/"):
        return os.path.relpath(path, base)
    return os.path.join("_abs", path.lstrip("/"))


def make_backup(item, ctx, tgt):
    base = ctx.project_dir or LOCAL
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    d = os.path.join(mdir(tgt["root"]), "backup", item.ID, stamp)
    n = 0
    while os.path.exists(d):
        n += 1
        d = os.path.join(mdir(tgt["root"]), "backup", item.ID, "%s-%d" % (stamp, n))
    existed, absent = [], []
    os.makedirs(d)
    for t in item.targets(ctx):
        t = os.path.abspath(t)
        if os.path.isfile(t):
            dst = os.path.join(d, rel_for(t, base))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(t, dst)
            existed.append(t)
        elif os.path.exists(t):
            raise RuntimeError("백업할 수 없는 대상: " + t)
        else:
            absent.append(t)
    write_json(os.path.join(d, "manifest.json"), {"existed": existed, "absent": absent})
    return d


def restore(backup, base):
    man = read_json(os.path.join(backup, "manifest.json"), None)
    if man is None:
        raise RuntimeError("manifest.json이 없다: " + backup)
    for t in man["existed"]:
        os.makedirs(os.path.dirname(t), exist_ok=True)
        shutil.copy2(os.path.join(backup, rel_for(t, base)), t)
    for t in man["absent"]:
        if os.path.isfile(t) or os.path.islink(t):
            os.remove(t)


def record(root, item_id, **kw):
    # ponytail: 읽고 쓰는 사이 경합은 막지 않는다(skip과 러너가 겹칠 때만). 문제되면 락.
    recs = read_json(applied_path(root), {})
    recs[item_id] = dict({"at": now()}, **kw)
    write_json(applied_path(root), recs)


def end_log(root, item_id, result, backup, error=None):
    s = "result=%s backup=%s" % (result, backup or "")
    if error:
        s += " error=" + error
    log_line(root, "END", "%s %s" % (item_id, s))


def recover_inflight(tgt):
    """죽은 러너가 남긴 진행 표식이 있으면 그 백업으로 되돌린다."""
    inf = read_json(inflight_path(tgt["root"]), None)
    if not inf:
        return
    if alive(inf.get("pid")) and inf.get("pid") != os.getpid():
        return
    base = os.path.dirname(tgt["root"]) if tgt["root"] else LOCAL
    try:
        restore(inf["backup"], base)
        record(tgt["root"], inf["id"], state="failed", backup=inf["backup"],
               error="러너가 중간에 죽어 백업으로 복원했습니다")
        end_log(tgt["root"], inf["id"], "restored", inf["backup"], "러너가 중간에 죽음")
    except Exception as e:
        record(tgt["root"], inf["id"], state="broken", backup=inf["backup"], error="복원 실패: %s" % e)
        end_log(tgt["root"], inf["id"], "broken", inf["backup"], "복원 실패")
    os.remove(inflight_path(tgt["root"]))


# ---------- 세션 ----------

def live_sessions(root):
    """살아 있는 .wip 세션 수 (tickets.py in_progress와 같은 기준: .wip + fm pid 생존)."""
    d = os.path.join(root, "tickets")
    n = 0
    for name in os.listdir(d) if os.path.isdir(d) else []:
        if not name.endswith(".wip.md"):
            continue
        try:
            with open(os.path.join(d, name), encoding="utf-8") as f:
                head = f.read(4096)
        except OSError:
            continue
        m = re.search(r"^pid:\s*(\d+)\s*$", head, re.M)
        if m and alive(m.group(1)):
            n += 1
    return n


# ---------- 러너 락 ----------

LOCK = os.path.join(LOCAL, "run", "migrate.lock")


def lock_pid():
    try:
        with open(os.path.join(LOCK, "pid")) as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


def lock_busy():
    if not os.path.isdir(LOCK):
        return False
    pid = lock_pid()
    if pid is None:  # mkdir과 pid 쓰기 사이, 또는 그때 죽은 찌꺼기
        return time.time() - os.path.getmtime(LOCK) < 10
    return alive(pid)


def acquire():
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    for _ in range(2):
        try:
            os.mkdir(LOCK)
        except FileExistsError:
            if lock_busy():
                return False
            shutil.rmtree(LOCK, ignore_errors=True)
            continue
        with open(os.path.join(LOCK, "pid"), "w") as f:
            f.write(str(os.getpid()))
        return True
    return False


# ---------- 명령 ----------

def cmd_list(args):
    items = load_items()
    out = []
    for tgt in pick_targets(args):
        for i, s in states(items, tgt):
            out.append({"key": tgt["id"], "item": i.ID, "state": SHOWN[s], "desc": i.DESC})
    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
    else:
        for o in out:
            print("%-14s %-30s %-6s %s" % (o["key"], o["item"], o["state"], o["desc"]))
    return 0


def pending_lines(args, with_skipped):
    items = load_items()
    return [(t, i) for t in pick_targets(args) for i, s in states(items, t)
            if s in ("pending", "failed", "broken") or (with_skipped and s == "skipped")]


def cmd_check(args):
    found = pending_lines(args, False)
    for t, i in found:
        print("%s %s" % (t["id"], i.ID))
    return 1 if found else 0


def cmd_gate(args):
    if lock_busy():
        print("마이그레이션 진행 중")
        return 1
    items = load_items()
    for tgt in (machine_target(), target_for_root(args.root)):
        for i, s in states(items, tgt):
            if s in ("pending", "failed", "broken", "skipped"):
                print("마이그레이션 미적용 %s" % i.ID)
                return 1
    return 0


def cmd_dry_run(args):
    items = [i for i in load_items() if not args.id or i.ID == args.id]
    for tgt in pick_targets(args):
        ctx = Ctx(tgt["root"], None if tgt["root"] is None else tgt["id"])
        for i, s in states(items, tgt):
            if s in ("pending", "failed", "broken"):
                print("%s %s" % (tgt["id"], i.ID))
                for p in i.targets(ctx):
                    print("  %s %s" % ("있음" if os.path.exists(p) else "없음", p))
    return 0


class Status:
    def __init__(self, path, tgts):
        self.path = path
        self.data = {"pid": os.getpid(), "started_at": now(), "finished_at": None, "rows": []}
        for t in tgts:
            self.data["rows"].append({
                "key": t["id"], "name": t["name"], "root": t["root"], "state": "대기",
                "item": "", "desc": "", "desc_en": "", "sessions": 0, "waited_s": 0,
                "error": "", "log": os.path.join(mdir(t["root"]), "migrate.log"), "backup": ""})
        self.flush()

    def row(self, key):
        return next(r for r in self.data["rows"] if r["key"] == key)

    def set(self, key, **kw):
        self.row(key).update(kw)
        self.flush()

    def flush(self):
        write_json(self.path, self.data)


def wait_sessions(tgt, st, args):
    start = time.time()
    while True:
        n = live_sessions(tgt["root"])
        if n == 0:
            return True
        wf = os.path.join(LOCAL, "run", "migrate-wait-" + tgt["id"])
        ref = max(start, os.path.getmtime(wf)) if os.path.exists(wf) else start
        st.set(tgt["id"], state="세션 대기", sessions=n, waited_s=int(time.time() - ref))
        pend = [i for i, s in states(load_items(), tgt) if s in ("pending", "failed", "broken")]
        if not pend:  # 기다리는 사이 사람이 건너뛰었다
            return False
        time.sleep(POLL_S)


def run_item(item, tgt, st):
    root = tgt["root"]
    ctx = Ctx(root, None if root is None else tgt["id"])
    base = ctx.project_dir or LOCAL
    st.set(tgt["id"], state="진행", item=item.ID, desc=item.DESC, desc_en=item.DESC_EN, sessions=0)
    log_line(root, "START", item.ID)
    try:
        backup = make_backup(item, ctx, tgt)
    except Exception as e:
        err = str(e).splitlines()[-1] if str(e) else type(e).__name__
        record(root, item.ID, state="failed", backup="", error="백업 실패: " + err)
        end_log(root, item.ID, "failed", "", "백업 실패: " + err)
        st.set(tgt["id"], state="실패", error="백업 실패: " + err)
        return False
    write_json(inflight_path(root), {"id": item.ID, "backup": backup, "pid": os.getpid()})
    try:
        item.apply(ctx)
        item.verify(ctx)
    except BaseException as e:
        if isinstance(e, (KeyboardInterrupt, SystemExit)):
            raise
        err = (str(e).splitlines() or [type(e).__name__])[-1]
        try:
            restore(backup, base)
            record(root, item.ID, state="failed", backup=backup, error=err)
            end_log(root, item.ID, "restored", backup, err)
            st.set(tgt["id"], state="실패", error=err, backup=backup)
        except Exception as e2:
            err = "복원 실패: %s (원인: %s)" % (e2, err)
            record(root, item.ID, state="broken", backup=backup, error=err)
            end_log(root, item.ID, "broken", backup, err)
            st.set(tgt["id"], state="실패", error=err, backup=backup)
        os.remove(inflight_path(root))
        return False
    record(root, item.ID, state="ok", backup=backup)
    os.remove(inflight_path(root))
    end_log(root, item.ID, "ok", backup)
    st.set(tgt["id"], backup=backup, error="")
    return True


def apply_target(tgt, items, st, args):
    """한 대상(머신 또는 프로젝트)을 끝까지. 성공 여부를 돌려준다."""
    recover_inflight(tgt)
    sts = states(items, tgt)
    todo = [i for i, s in sts if s in ("pending", "failed", "broken") or (args.id and s == "skipped")]
    if not todo:
        skipped = any(s == "skipped" for _, s in sts)
        st.set(tgt["id"], state="건너뜀" if skipped else "완료",
               error="" if not skipped else "건너뜀")
        return not skipped
    if tgt["root"] and not wait_sessions(tgt, st, args):
        st.set(tgt["id"], state="건너뜀")
        return False
    for i in todo:
        if not run_item(i, tgt, st):
            return False
    st.set(tgt["id"], state="완료", item="", sessions=0)
    return True


def cmd_apply(args):
    items = [i for i in load_items() if not args.id or i.ID == args.id]
    if not acquire():
        return 3
    tgts = pick_targets(args)
    st = Status(args.status or os.path.join(LOCAL, "run", "migrate-status.json"), tgts)
    ok = True
    try:
        machine_ok = True
        for tgt in tgts:
            if tgt["root"] is None:
                machine_ok = apply_target(tgt, items, st, args)
                ok = ok and machine_ok
            elif not machine_ok:
                st.set(tgt["id"], state="실패", error="이 컴퓨터 항목이 실패해 적용하지 않았습니다")
                ok = False
            elif not apply_target(tgt, items, st, args):
                ok = False
    finally:
        st.data["finished_at"] = now()
        st.flush()
        shutil.rmtree(LOCK, ignore_errors=True)
    return 0 if ok else 1


def cmd_skip(args):
    tgt = target_for_root(args.root)
    for i, s in states(load_items(), tgt):
        if s in ("pending", "failed", "broken"):
            record(tgt["root"], i.ID, state="skipped")
            log_line(tgt["root"], "END", "%s result=skipped backup=" % i.ID)
    return 0


def cmd_revert(args):
    items = {i.ID: i for i in load_items()}
    item = items.get(args.id)
    if not item:
        print("없는 항목: " + args.id)
        return 1
    if not item.REVERSIBLE:
        print("되돌릴 수 없는 항목입니다: " + args.id)
        return 1
    tgt = machine_target() if item.SCOPE == "machine" else target_for_root(args.root)
    bdir = os.path.join(mdir(tgt["root"]), "backup", args.id)
    runs = sorted(os.listdir(bdir)) if os.path.isdir(bdir) else []
    if not runs:
        print("백업이 없습니다: " + args.id)
        return 1
    last = os.path.join(bdir, runs[-1])
    restore(last, os.path.dirname(tgt["root"]) if tgt["root"] else LOCAL)
    if hasattr(item, "revert"):  # 파일 복원만으로 모자란 항목(git 커밋 - 큐 안 디렉터리)의 뒷정리
        item.revert(Ctx(tgt["root"], None if tgt["root"] is None else tgt["id"]))
    recs = read_json(applied_path(tgt["root"]), {})
    recs.pop(args.id, None)
    write_json(applied_path(tgt["root"]), recs)
    end_log(tgt["root"], args.id, "restored", last)
    return 0


def cmd_promote(args):
    if args.id not in {i.ID for i in load_items()}:
        print("없는 항목: " + args.id)
        return 2
    p = os.path.join(LOCAL, "migrations", "promoted", args.id)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "a").close()
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="migrate.py")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def scope(p):
        g = p.add_mutually_exclusive_group()
        g.add_argument("--root")
        g.add_argument("--all", action="store_true")

    p = sub.add_parser("list"); scope(p); p.add_argument("--json", action="store_true")
    p = sub.add_parser("check"); scope(p)
    p = sub.add_parser("gate"); p.add_argument("root")
    p = sub.add_parser("dry-run"); scope(p); p.add_argument("--id")
    p = sub.add_parser("apply"); scope(p); p.add_argument("--id"); p.add_argument("--status")
    p = sub.add_parser("skip"); p.add_argument("--root", required=True)
    p = sub.add_parser("revert"); p.add_argument("--root"); p.add_argument("--id", required=True)
    p = sub.add_parser("promote"); p.add_argument("id")
    args = ap.parse_args(argv)
    fn = {"list": cmd_list, "check": cmd_check, "gate": cmd_gate, "dry-run": cmd_dry_run,
          "apply": cmd_apply, "skip": cmd_skip, "revert": cmd_revert, "promote": cmd_promote}[args.cmd]
    return fn(args)


if __name__ == "__main__":
    sys.exit(main())
