#!/usr/bin/env python3
"""대상 티켓을 처리한 세션 기록(회차 전부)의 요약 (docs/DESIGN.md P572).

    python3 session_digest.py <큐 루트> <대상 해시>

기록을 읽기만 한다. 표준 라이브러리만 쓴다. 이 파일은 claude 기록 갈래다. grok - codex는 fold()가
레코드를 claude 모양으로 접은 뒤 같은 요약기를 탄다(P572-2). 형식 해석 근거는
apps/teams/lib/transcript.ts의 grokRecord와 codexRecord다.
회차가 없으면 한 줄과 찾아본 디렉터리를 내고 종료 코드 0이다.
"""
import glob
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from urllib.parse import quote

LIMIT = 20000
TOOL_MAX = 80
# 엔진이 사용자 메시지로 넣는 문구 표. 정본은 tick.sh다(고치면 여기도 맞춘다).
#   디스패치 문장: `grep -n 'TICKET_PROMPT_FMT=' tick.sh`
#   계획 넛지: `grep -n 'PN_MSG=' tick.sh`
DEFAULT_PROMPT_FMT = ("%s 티켓을 확인해 주세요. (해당 티켓은 이미 진행중으로 잡아두었습니다. 수행을 마치면 "
                      "완료 상태로 rename하고, 막히면 티켓 본문에 블록 이력을 남겨주세요.)")
ENGINE_PREFIXES = ("## 진행 계획을 지금 세워 주세요", "## 진행 계획 상자 중 이미 끝난 항목이")
SECRET_RE = re.compile(r"(?:sk-|ghp_|gho_|github_pat_|xox[abp]-|AKIA)[A-Za-z0-9_\-]{8,}")
BEARER_RE = re.compile(r"(Bearer\s+)\S+")
FILE_KEYS = ("file_path", "notebook_path", "path")


def nfc(s):
    return unicodedata.normalize("NFC", s)


def _gtext(c):
    t = (c or {}).get("text") if isinstance(c, dict) else None
    return t if isinstance(t, str) else ""


def _mk(role, ts, content):
    return {"type": role, "timestamp": ts, "message": {"role": role, "content": content}}


def fold_grok(rec):
    """grok updates.jsonl 한 줄 -> claude 모양 레코드(접히지 않으면 None). timestamp는 unix 초다."""
    if not isinstance(rec, dict) or not isinstance(rec.get("timestamp"), (int, float)):
        return None
    ts = datetime.fromtimestamp(rec["timestamp"], timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    u = ((rec.get("params") or {}).get("update")) or {}
    k, tid = u.get("sessionUpdate"), u.get("toolCallId")
    if k == "user_message_chunk":
        return _mk("user", ts, [{"type": "text", "text": _gtext(u.get("content"))}])
    if k == "agent_message_chunk":
        return _mk("assistant", ts, [{"type": "text", "text": _gtext(u.get("content"))}])
    if k == "tool_call":
        label = (((u.get("_meta") or {}).get("x.ai/tool")) or {}).get("label")
        return _mk("assistant", ts, [{"type": "tool_use", "name": label, "input": u.get("rawInput") or {}, "id": tid}])
    if k == "tool_call_update":
        txt = "".join(_gtext(b.get("content")) if b.get("type") == "content" else str(b.get("path") or "")
                      for b in (u.get("content") or []) if isinstance(b, dict))
        if not txt.strip():
            return None
        return _mk("user", ts, [{"type": "tool_result", "tool_use_id": tid, "content": txt,
                                 "is_error": u.get("status") == "failed"}])
    return None


def fold_codex(rec):
    """codex rollout response_item -> claude 모양 레코드. 그 밖의 줄(event_msg 등)은 None."""
    if not isinstance(rec, dict) or rec.get("type") != "response_item" or not isinstance(rec.get("timestamp"), str):
        return None
    ts, p = rec["timestamp"], rec.get("payload") or {}
    t = p.get("type")
    text = lambda v: "\n".join(_gtext(b) for b in v if _gtext(b)) if isinstance(v, list) else ""
    if t == "message" and p.get("role") in ("user", "assistant"):
        x = text(p.get("content"))
        return _mk(p["role"], ts, [{"type": "text", "text": x}]) if x else None
    if t in ("function_call", "custom_tool_call"):
        inp = p.get("arguments") if t == "function_call" else p.get("input")
        if isinstance(inp, str):
            try:
                inp = json.loads(inp)
            except ValueError:
                inp = {"input": inp}
        return _mk("assistant", ts, [{"type": "tool_use", "name": p.get("name"), "input": inp if isinstance(inp, dict) else {},
                                      "id": p.get("call_id")}])
    if t in ("function_call_output", "custom_tool_call_output"):
        return _mk("user", ts, [{"type": "tool_result", "tool_use_id": p.get("call_id"), "content": ""}])
    return None


def fold(rec, engine):
    """엔진 형식의 레코드 하나를 claude 모양으로 접는다. claude는 그대로다."""
    return fold_grok(rec) if engine == "grok" else fold_codex(rec) if engine == "codex" else rec


def merge_chunks(recs):
    """grok의 연속 텍스트 조각(같은 역할)을 한 메시지로 잇는다. 줄 번호는 첫 조각 것이다."""
    out = []
    for n, r in recs:
        b = (r.get("message") or {}).get("content")
        solo = isinstance(b, list) and len(b) == 1 and b[0].get("type") == "text"
        if out and solo and out[-1][2] and out[-1][1]["type"] == r["type"]:
            out[-1][1]["message"]["content"][0]["text"] += b[0]["text"]
            continue
        out.append([n, r, solo])
    return [(n, r) for n, r, _ in out]


def prompt_re():
    fmt = os.environ.get("TICKET_PROMPT_FMT") or DEFAULT_PROMPT_FMT
    if "%s" not in fmt:
        fmt = DEFAULT_PROMPT_FMT
    return re.compile("([A-Za-z0-9_-]+)".join(re.escape(x) for x in fmt.split("%s")))


def fm_of(path):
    out = {}
    try:
        lines = open(path, encoding="utf-8").read().split("\n")
    except (OSError, UnicodeDecodeError):
        return out
    if lines and lines[0].strip() == "---":
        for ln in lines[1:]:
            if ln.strip() == "---":
                break
            k, _, v = ln.partition(":")
            out[k.strip()] = v.strip().strip("\"'")
    return out


def engine_of(path):
    if os.sep + ".grok" + os.sep in path:
        return "grok"
    return "codex" if os.path.basename(path).startswith("rollout-") else "claude"


def codex_cwd(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for _, line in zip(range(50), f):
                if '"session_meta"' in line:
                    return (json.loads(line).get("payload") or {}).get("cwd") or ""
    except (OSError, ValueError):
        pass
    return ""


def enc_dir(cwd):
    return re.sub(r"[^A-Za-z0-9]", "-", cwd)


def candidates(root, h):
    """(파일, fm에서 온 것인가) 목록과 찾아본 디렉터리들."""
    home = os.path.expanduser("~")
    files, searched, birth = {}, [], None
    for p in glob.glob(os.path.join(root, "tickets", "*.md")):
        base = nfc(os.path.basename(p))[:-3]
        if not re.match(re.escape(nfc(h)) + r"(\.wip|\.done)?\Z", base):
            continue
        st = os.stat(p)
        b = getattr(st, "st_birthtime", 0)
        birth = b if birth is None else min(birth, b)
        fm = fm_of(p)
        tr = fm.get("transcript", "")
        if tr and os.path.isfile(tr):
            files[os.path.realpath(tr)] = True
        sid = fm.get("session_id", "")
        if re.match(r"^[A-Za-z0-9._-]+$", sid or ""):
            for g in (glob.glob(os.path.join(home, ".claude", "projects", "*", sid + ".jsonl"))
                      + glob.glob(os.path.join(home, ".grok", "sessions", "*", sid, "updates.jsonl"))):
                files[os.path.realpath(g)] = True
    seen, cwds = set(), set()
    for w in sorted(glob.glob(os.path.join(root, "worktrees", "*"))):
        for cwd in (os.path.abspath(w), os.path.realpath(w)):
            cwds.add(cwd)
            for d, pat in ((os.path.join(home, ".claude", "projects", enc_dir(cwd)), "*.jsonl"),
                           (os.path.join(home, ".grok", "sessions", quote(cwd, safe="!~*'()")),
                            os.path.join("*", "updates.jsonl"))):
                if d in seen:
                    continue
                seen.add(d)
                searched.append(d)
                for f in glob.glob(os.path.join(d, pat)):
                    f = os.path.realpath(f)
                    if f not in files and os.path.getmtime(f) >= (birth or 0):
                        files[f] = False
    cx = os.path.join(os.environ.get("CODEX_HOME") or os.path.join(home, ".codex"), "sessions")
    searched.append(cx)
    # ponytail: rollout은 날짜 디렉터리 전체를 훑는다(해시 선필터가 비용을 줄인다). 수천 개면 날짜 창으로 줄인다
    for f in glob.glob(os.path.join(cx, "**", "rollout-*.jsonl"), recursive=True):
        f = os.path.realpath(f)
        if f in files or os.path.getmtime(f) < (birth or 0):
            continue
        c = codex_cwd(f)
        if any(c == w or c.startswith(w + os.sep) for w in cwds):
            files[f] = False
    return files, searched


def user_text(rec):
    """사용자 문자열 메시지(도구 결과 제외). 아니면 None."""
    if rec.get("type") != "user" or rec.get("isMeta"):
        return None
    c = (rec.get("message") or {}).get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list) and c and all(isinstance(x, dict) and x.get("type") == "text" for x in c):
        return "\n".join(str(x.get("text") or "") for x in c)
    return None


def blocks(rec):
    c = (rec.get("message") or {}).get("content")
    return [x for x in c if isinstance(x, dict)] if isinstance(c, list) else []


def tool_line(b, failed):
    name, inp = str(b.get("name")), b.get("input") or {}
    if name == "Bash":
        s = str(inp.get("command", ""))[:160]
    elif any(k in inp for k in FILE_KEYS):
        s = str(next(inp[k] for k in FILE_KEYS if k in inp))
    else:
        s = json.dumps(inp, ensure_ascii=False)[:120]
    return "%s: %s%s" % (name, " ".join(s.split()), " (실패)" if failed else "")


def segments(path, fmt_re, h, from_fm):
    """이 기록 파일에서 대상 티켓의 구간들: [{start, end, recs}]."""
    try:
        raw = open(path, "rb").read()
    except OSError:
        return []
    if h.encode() not in raw and not from_fm:
        return []
    engine, recs = engine_of(path), []
    for i, line in enumerate(raw.decode("utf-8", "replace").split("\n")):
        try:
            r = fold(json.loads(line), engine)
        except ValueError:
            continue
        if isinstance(r, dict):
            recs.append((i + 1, r))
    if engine == "grok":
        recs = merge_chunks(recs)
    segs, cur = [], None
    for n, r in recs:
        t = user_text(r)
        m = fmt_re.match(t.strip()) if t else None
        if m:
            mine = nfc(m.group(1)) == nfc(h)
            if mine and cur is None:
                cur = {"start": n, "recs": []}
            elif not mine and cur is not None:
                segs.append(cur)
                cur = None
        if cur is not None:
            cur["end"] = n
            cur["recs"].append((n, r))
    if cur is not None:
        segs.append(cur)
    if not segs and from_fm and recs:  # 디스패치 문장이 없는 기록(손 클레임 등)은 통째로 한 회차다
        segs = [{"start": recs[0][0], "end": recs[-1][0], "recs": recs}]
    for s in segs:
        s["file"], s["engine"] = path, engine
    return segs


def summarize(seg, fmt_re):
    results, calls, inputs, last, first_dispatch = {}, [], [], "", False
    stamps = [r.get("timestamp") for _, r in seg["recs"] if r.get("timestamp")]
    for _, r in seg["recs"]:
        for b in blocks(r):
            if b.get("type") == "tool_result":
                results[b.get("tool_use_id")] = bool(b.get("is_error"))
    for _, r in seg["recs"]:
        t = user_text(r)
        if t is not None:
            if fmt_re.match(t.strip()):
                first_dispatch = True
            elif first_dispatch:
                kind = "엔진" if t.strip().startswith(ENGINE_PREFIXES) else "참견"
                inputs.append([r.get("timestamp") or "", kind, t.strip()])
        if r.get("type") == "assistant":
            for b in blocks(r):
                if b.get("type") == "tool_use":
                    calls.append((str(b.get("name")), tool_line(b, results.get(b.get("id")))))
                elif b.get("type") == "text" and str(b.get("text") or "").strip():
                    last = str(b["text"]).strip()
    return {"seg": seg, "calls": calls, "inputs": inputs, "last": last, "collapsed": False,
            "from": stamps[0] if stamps else "", "to": stamps[-1] if stamps else ""}


def render_calls(s):
    calls = s["calls"]
    if s["collapsed"] or len(calls) > TOOL_MAX:
        cnt = {}
        for n, _ in (calls if s["collapsed"] else calls[40:-20]):
            cnt[n] = cnt.get(n, 0) + 1
        tail = "(%s %d건 생략: %s)" % ("전체" if s["collapsed"] else "가운데",
                                       sum(cnt.values()), ", ".join("%s %d" % kv for kv in sorted(cnt.items())))
        if s["collapsed"]:
            return [tail]
        return [l for _, l in calls[:40]] + [tail] + [l for _, l in calls[-20:]]
    return [l for _, l in calls]


def render(sums, cap, first=1):
    out = []
    for k, s in enumerate(sums, first):
        sg = s["seg"]
        sid = (os.path.basename(os.path.dirname(sg["file"])) if sg["engine"] == "grok"
               else os.path.splitext(os.path.basename(sg["file"]))[0])
        out += ["## 회차 %d - %s session_id=%s" % (k, sg["engine"], sid), "기록: %s" % sg["file"],
                "구간: 줄 %d-%d, %s ~ %s" % (sg["start"], sg["end"], s["from"] or "?", s["to"] or "?"), "",
                "### 도중 입력"]
        out += ["- %s [%s] %s" % (ts, kind, " ".join(t[:cap(s)].split())) for ts, kind, t in s["inputs"]] or ["(없음)"]
        out += ["", "### 도구 호출"] + (render_calls(s) or ["(없음)"])
        out += ["", "### 마지막 응답", s["last"][:1500] or "(없음)", ""]
    return "\n".join(out)


def mask(text):
    return BEARER_RE.sub(r"\1***", SECRET_RE.sub("***", text))


def main(root, h):
    root = os.path.abspath(os.path.expanduser(root))
    fmt_re = prompt_re()
    files, searched = candidates(root, h)
    segs = [s for f, fm in files.items() for s in segments(f, fmt_re, h, fm)]
    if not segs:
        print("세션 기록을 찾지 못했다\n찾아본 디렉터리:\n" + "\n".join("- " + d for d in searched or ["(워크트리 없음)"]))
        return
    sums = [summarize(s, fmt_re) for s in segs]
    sums.sort(key=lambda s: (s["from"], s["seg"]["file"], s["seg"]["start"]))
    for s in sums:
        s["inputs"] = [[a, b, mask(c)] for a, b, c in s["inputs"]]
    size = lambda t: len(mask(t).encode("utf-8"))
    wide = lambda s: 800
    text = render(sums, wide)
    for s in sums:  # 오래된 회차부터 도구 호출을 개수 한 줄로
        if size(text) <= LIMIT:
            break
        s["collapsed"] = True
        text = render(sums, wide)
    narrow = set()
    for s in sums:  # 그래도 크면 오래된 회차의 도중 입력을 200자로
        if size(text) <= LIMIT:
            break
        narrow.add(id(s))
        text = render(sums, lambda x: 200 if id(x) in narrow else 800)
    text = mask(text)
    drop = 0
    while size(text) > LIMIT and drop < len(sums) - 1:  # 마지막 방어선: 오래된 회차를 통째로 생략하고 최신 회차는 남긴다
        drop += 1
        note = "(회차 %d개 생략: 오래된 회차 1-%d. 원문은 회차 머리의 경로로 읽는다)" % (drop, drop)
        text = mask(note + "\n\n" + render(sums[drop:], lambda x: 200 if id(x) in narrow else 800, drop + 1))
    if size(text) > LIMIT:  # 최신 회차 하나가 한도를 넘으면 줄 단위로 자른다
        lines = text.split("\n")
        tail = "(줄 %d개 생략: 뒤쪽. 원문은 회차 머리의 경로로 읽는다)"
        while lines and size("\n".join(lines) + "\n" + tail % 999999) > LIMIT:
            lines.pop()
        text = "\n".join(lines) + "\n" + tail % (len(text.split("\n")) - len(lines))
    print(text)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
