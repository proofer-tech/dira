#!/usr/bin/env python3
"""티켓 큐 헬퍼(프로젝트 무관). <루트> = `tickets/`(큐)와 `personas/`를 담은 티켓 루트.

select <루트>          미할당 열린 티켓들을 오래된 순으로 -> "path|hash|kind|persona"
assign <path> <sid>    frontmatter에 session_id/assigned_at 기록
clear  <path>          frontmatter의 session_id/assigned_at 비우기 (할당 취소)
list   <루트>          열린 티켓 전체 상태 표
find   <루트> <hash>   해시로 티켓 경로 찾기
reap   <루트>          세션이 죽은 진행중 티켓을 백로그로 회수 (스테일 수거)
handclaim <path> [owner]  대화형 세션이 손으로 잡기. claim + pid/claimed_at/transcript 기록

큐는 루트 한 곳이고 하위 디렉터리는 없다. 디렉터리가 뜻하던 것은 전부 frontmatter로 갔다 --
누가 수행하는지는 `persona:`(없으면 페르소나 없는 평범한 에이전트), 성격은 `kind:`.
상태만 여전히 파일명 접미사다(rename이 원자적 락이라 그렇다).

프로젝트별 값은 환경변수로만 갈린다:
  TICKET_INPROGRESS  진행중 상태 접미사 (기본 ".wip")
  TICKET_DONE        완료 상태 접미사 (기본 ".done")
"""
import os
import re
import sys
import glob
import json
import uuid
import errno
import subprocess
import unicodedata
from datetime import datetime, timezone


# 기본 접미사는 ASCII + 마침표 구분이다: <hash>.md / <hash>.wip.md / <hash>.done.md.
# (ls·grep·탭완성에서 한글이 걸리적거리고, 마침표는 확장자처럼 읽혀 해시와 상태가 눈에 갈린다.)
# 다른 접미사로 만든 티켓이 이미 있는 설치는 워커에서 그 값으로 고정해야 한다 - 안 하면
# 접미사가 이름의 일부로 보여서 이미 잡힌 티켓이 큐에 다시 뜬다.
IN_PROGRESS = os.environ.get("TICKET_INPROGRESS") or ".wip"
DONE = os.environ.get("TICKET_DONE") or ".done"
CLOSED_SUFFIXES = (IN_PROGRESS, DONE)


def nfc(s):
    return unicodedata.normalize("NFC", s)


def is_open_name(basename):
    stem = nfc(basename)
    if stem.endswith(".md"):
        stem = stem[:-3]
    return not any(stem.endswith(nfc(sfx)) for sfx in CLOSED_SUFFIXES)


def read_fm(path):
    """frontmatter를 (dict, 원문줄들, 끝인덱스)로 반환. 없으면 (None, ...)."""
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, lines, -1
    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end < 0:
        return {}, lines, -1
    fm = {}
    for i in range(1, end):
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$", lines[i])
        if m:
            fm[m.group(1)] = m.group(2).strip()
    return fm, lines, end


def ticket_hash(path, fm):
    h = (fm.get("ticket") or "").strip().strip("\"'")
    if h:
        return h
    base = nfc(os.path.basename(path))
    return base[:-3] if base.endswith(".md") else base


def is_assigned(fm):
    return bool((fm.get("session_id") or "").strip().strip("\"'"))


PERSONA_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def persona_of(fm):
    """frontmatter `persona:`. 없으면 "" - 페르소나 없는 평범한 에이전트가 처리한다.

    디스패처가 이 값을 <personas>/<값>/PROFILE.md 경로로 조립하므로 이름 문자만 통과시킨다
    (`persona: ../../.ssh/id_rsa` 같은 값이면 임의 파일이 프롬프트에 실려 나간다).
    """
    p = (fm.get("persona") or "").strip().strip("\"'")
    return p if PERSONA_RE.match(p) else ""


def tickets_in(troot):
    """큐(<루트>/tickets/)의 티켓 파일들. 평면이다 - 하위 디렉터리는 보지 않는다."""
    return [p for p in glob.glob(os.path.join(troot, "tickets", "*.md"))
            if not os.path.basename(p).startswith(".")]


# 구 레이아웃(to-<역할>/<성격>/) 잔여물. 큐에서 안 보이므로 조용히 굶는 대신 알린다.
LEGACY_GLOBS = ("to-*/*/*.md", "to-*/*.md", "request/*.md", "work/*.md", "feedback/*.md",
                "tickets/*/*.md")


def warn_legacy(troot):
    hits = [p for g in LEGACY_GLOBS for p in glob.glob(os.path.join(troot, g))]
    if hits:
        print("WARN 구 레이아웃에 티켓 {}건이 남아 있다 - 큐에서 안 보인다. 루트로 옮기고 "
              "frontmatter에 kind:/persona:를 넣어라 (예: {})".format(len(hits), hits[0]),
              file=sys.stderr)


def birth(path):
    st = os.stat(path)
    return getattr(st, "st_birthtime", st.st_mtime)


def deps_of(lines, end):
    """frontmatter deps의 선행 해시들. `deps: [a, b]`·블록 리스트 둘 다 읽는다.
    read_fm은 스칼라 `key: value`만 담아서 블록 리스트를 못 보므로 원문 줄에서 직접 뽑는다."""
    out = []
    for i in range(1, end):
        m = re.match(r"^deps:\s*(.*)$", lines[i])
        if not m:
            continue
        inline = m.group(1).strip().strip("[]")
        if inline:
            out += [h.strip().strip("\"'") for h in inline.split(",")]
        for j in range(i + 1, end):
            m2 = re.match(r"^\s+-\s*(.+)$", lines[j])
            if not m2:
                break
            out.append(m2.group(1).strip().strip("\"'"))
        break
    return [h for h in out if h]


def deps_unmet(troot, deps):
    """미완료 선행 해시. 티켓을 못 찾으면 미완료로 본다(보수적 - 오탈자 해시로 착수되는 편보다 안전)."""
    unmet = []
    for h in deps:
        pth = find_any(troot, h)
        if not pth or not nfc(os.path.basename(pth)).endswith(nfc(DONE + ".md")):
            unmet.append(h)
    return unmet


def scan(troot):
    """열린 티켓(상태 접미사 없음)을 생성일 오름차순으로."""
    rows = []
    for p in tickets_in(troot):
        if not is_open_name(os.path.basename(p)):
            continue
        try:
            fm, flines, end = read_fm(p)
        except (OSError, UnicodeDecodeError):
            continue
        if end < 0:
            continue
        rows.append({
            "path": p,
            "hash": ticket_hash(p, fm),
            "kind": (fm.get("kind") or "").strip().strip("\"'"),
            "persona": persona_of(fm),
            "birth": birth(p),
            "assigned": is_assigned(fm),
            "session_id": (fm.get("session_id") or "").strip(),
            # deps 미충족이면 큐에서 제외한다(pull 규약을 디스패처 층에서 강제).
            # 없으면 세션이 착수를 거부하고 종료해 티켓이 진행중으로 유실된다(2026-07-28 05990d8e 실사고).
            "unmet": deps_unmet(troot, deps_of(flines, end)),
        })
    rows.sort(key=lambda r: (r["birth"], r["path"]))
    return rows


def set_fm_keys(path, updates):
    """frontmatter 키를 갱신(없으면 닫는 --- 직전에 삽입). 리네임 없이 제자리 쓰기."""
    fm, lines, end = read_fm(path)
    if end < 0:
        raise SystemExit("frontmatter 없음: " + path)
    for key, val in updates.items():
        idx = None
        for i in range(1, end):
            if re.match(r"^" + re.escape(key) + r":\s*", lines[i]):
                idx = i
                break
        newline = "{}: {}".format(key, val) if val else "{}:".format(key)
        if idx is None:
            lines.insert(end, newline)
            end += 1
        else:
            lines[idx] = newline
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def set_deps(path, deps):
    """deps를 인라인 한 줄로 다시 쓴다. 블록 리스트(`- a`)면 children까지 걷어낸다 --
    set_fm_keys는 `deps:` 첫 줄만 고쳐서 children이 고아로 남고 그 해시들이 조용히 사라진다."""
    fm, lines, end = read_fm(path)
    if end < 0:
        raise SystemExit("frontmatter 없음: " + path)
    out, i = [], 0
    while i < end:
        if re.match(r"^deps:", lines[i]):
            i += 1
            while i < end and re.match(r"^\s+-\s", lines[i]):
                i += 1
            continue
        out.append(lines[i])
        i += 1
    out.append("deps: [{}]".format(", ".join(deps)))
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out + lines[end:]))


def claim(path):
    """<hash>.md -> <hash><진행중>.md 원자적 잡기. 이미 잡혀 있으면 실패."""
    d, base = os.path.split(path)
    stem = nfc(base)[:-3]
    dst = os.path.join(d, stem + IN_PROGRESS + ".md")
    try:
        os.link(path, dst)          # dst가 이미 있으면 EEXIST -> 잡기 실패(락)
        os.unlink(path)
        return dst
    except OSError as e:
        if getattr(e, "errno", None) == errno.EEXIST:
            raise SystemExit("이미 잡힘: " + dst)
    # 하드링크 미지원 파일시스템(구글드라이브 등 FUSE·SMB) 폴백.
    # os.rename은 쓰면 안 된다 - dst가 있어도 조용히 덮어쓰므로 락이 아니다. exists() 선검사는
    # TOCTOU라 두 프로세스가 둘 다 통과해 같은 티켓을 잡고 한쪽 파일이 사라진다.
    # O_CREAT|O_EXCL은 하드링크 없이도 원자적이라, 자리를 먼저 잡고 내용을 옮긴다.
    try:
        with open(path, "rb") as f:
            data = f.read()
    except FileNotFoundError:      # 읽는 사이에 다른 쪽이 이겨서 원본을 치웠다
        raise SystemExit("이미 잡힘: " + dst)
    try:
        fd = os.open(dst, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except OSError as e:
        if getattr(e, "errno", None) == errno.EEXIST:
            raise SystemExit("이미 잡힘: " + dst)
        raise
    with os.fdopen(fd, "wb") as out:
        out.write(data)
    os.unlink(path)
    return dst


def release(path):
    """<hash><진행중>.md -> <hash>.md 되돌리기(백로그 복귀)."""
    d, base = os.path.split(path)
    stem = nfc(base)[:-3]
    if not stem.endswith(nfc(IN_PROGRESS)):
        return path
    dst = os.path.join(d, stem[:-len(nfc(IN_PROGRESS))] + ".md")
    if os.path.exists(dst):
        raise SystemExit("복귀 대상이 이미 존재: " + dst)
    os.rename(path, dst)
    return dst


REAP_GRACE_SEC = 180        # 디스패치 직후 프로세스 등록 지연을 피하는 유예
REAP_MAX_ATTEMPTS = 2       # 이 횟수까지만 자동 회수. 넘으면 사람 개입 대기(-진행중 유지)

# 손 클레임(대화형 세션) 판정용. 디스패처 세션과 달리 ps에 --session-id가 안 뜨므로
# session_id로는 생존을 볼 수 없다(실측 2026-07-29). pid + 트랜스크립트로 대신 본다.
# 시간은 판정이 아니라 점검 트리거다 — 경과만으로 회수하면 오래 걸리는 정상 세션을 죽인다
# (2026-07-28 확정, 그래서 디스패처도 ps 생존 대조를 쓴다).
MANUAL_GRACE_SEC = 1800     # 잡은 뒤 이만큼 지나기 전엔 아예 보지 않는다
MANUAL_IDLE_SEC = 3600      # pid는 살아있는데 트랜스크립트가 이만큼 조용하면 유휴 의심(보고만)


def live_session_ids():
    """지금 돌고 있는 claude -p 세션 id 집합. tick.sh가 --session-id로 띄우므로 ps로 보인다."""
    try:
        out = subprocess.run(["ps", "-eo", "command"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return None      # ps를 못 읽으면 판단 불가 -> 호출자가 아무것도 회수하지 않는다
    return set(re.findall(r"--session-id\s+(\S+)", out))


def pid_alive(pid):
    """pid 생존 여부. ps를 못 읽으면 None -> 호출자는 아무것도 회수하지 않는다."""
    try:
        r = subprocess.run(["ps", "-p", str(pid), "-o", "pid="],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return bool(r.stdout.strip())


def claude_ancestor_pid():
    """조상 중 claude(대화형 세션) 프로세스의 pid. 못 찾으면 None.

    tickets.py는 세션 -> bash -> python3로 실행되므로 자기 pid는 세션이 아니다.
    """
    pid = str(os.getppid())
    for _ in range(8):
        try:
            r = subprocess.run(["ps", "-p", pid, "-o", "ppid=,comm="],
                               capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.SubprocessError):
            return None
        parts = r.stdout.strip().split(None, 1)
        if len(parts) < 2:
            return None
        if os.path.basename(parts[1].strip()) == "claude":
            return pid
        pid = parts[0]
        if pid in ("0", "1"):
            return None
    return None


def newest_transcript(within_sec=120):
    """방금 활동한 세션 트랜스크립트(jsonl) 경로. 애매하면 빈 문자열.

    비면 reap은 pid만으로 판정한다(기능 저하일 뿐 오작동은 아니다).
    """
    root = os.path.expanduser("~/.claude/projects")
    newest, newest_m = "", 0
    for p in glob.glob(os.path.join(root, "*", "*.jsonl")):
        try:
            m = os.path.getmtime(p)
        except OSError:
            continue
        if m > newest_m:
            newest, newest_m = p, m
    if not newest:
        return ""
    import time
    return newest if (time.time() - newest_m) <= within_sec else ""


def transcript_state(path):
    """트랜스크립트를 테일해 (무활동 경과초, 마지막 레코드 종류). 못 읽으면 (None, 사유)."""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None, "트랜스크립트 없음"
    idle = (datetime.now(timezone.utc)
            - datetime.fromtimestamp(mtime, timezone.utc)).total_seconds()
    kind = "?"
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 65536))
            tail = f.read().decode("utf-8", "replace").strip().split("\n")
        for line in reversed(tail):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            kind = str((rec.get("message") or {}).get("role") or rec.get("type") or "?")
            break
    except OSError:
        pass
    return idle, kind


def transcript_of(fm):
    """이 티켓 세션의 트랜스크립트 경로. fm `transcript:` 우선, 없으면 `session_id`로 찾는다.

    디스패처가 붙인 `transcript:`는 reap이 지우기 전까지만 있고, 손 클레임 세션엔 아예 없다.
    그래서 `session_id`로 `~/.claude/projects/*/<sid>.jsonl`도 본다. 못 찾으면 빈 문자열.
    """
    tr = (fm.get("transcript") or "").strip().strip("\"'")
    if tr and os.path.isfile(tr):
        return tr
    sid = (fm.get("session_id") or "").strip().strip("\"'")
    # 티켓 파일은 사람도 고치는 입력이다. glob 메타문자·경로 구분자가 섞이면 큐 밖을 훑는다.
    if not re.match(r"^[A-Za-z0-9._-]+$", sid or ""):
        return ""
    hits = glob.glob(os.path.expanduser("~/.claude/projects/*/{}.jsonl".format(sid)))
    return hits[0] if hits else ""


def _rec_text(rec):
    """트랜스크립트 레코드에서 사람이 읽을 텍스트. 없으면 빈 문자열.

    ponytail: 중첩 content는 str()로 뭉갠다. 읽히기만 하면 되는 인용이라 구조는 필요 없다.
    """
    c = (rec.get("message") or {}).get("content")
    if c is None:
        c = rec.get("content") or rec.get("error") or rec.get("summary")
    if isinstance(c, list):
        c = " ".join(str(it.get("text") or it.get("content") or "") if isinstance(it, dict)
                     else str(it) for it in c)
    return " ".join(str(c or "").split())


def transcript_tail(path, limit=1500):
    """트랜스크립트 끝에서 마지막 텍스트/에러 레코드 한 건(`[역할] 본문`). 못 읽으면 빈 문자열.

    transcript_state와 같은 방식이다 -- 끝에서 64KB만 seek해 읽고 역순으로 json을 파싱한다.
    """
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 65536))
            tail = f.read().decode("utf-8", "replace").strip().split("\n")
    except OSError:
        return ""
    for line in reversed(tail):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        txt = _rec_text(rec)
        if txt:
            return "[{}] {}".format(
                str((rec.get("message") or {}).get("role") or rec.get("type") or "?"),
                txt[:limit])
    return ""


def in_progress(troot):
    """상태 접미사가 진행중인 티켓 경로들(NFC/NFD 무관)."""
    return [p for p in tickets_in(troot)
            if nfc(os.path.basename(p))[:-3].endswith(nfc(IN_PROGRESS))]


# 회수할 때 비우는 할당·생존 신호. 남겨 두면 열린 티켓이 '할당됨'으로 보여 select가 영구 제외한다.
REAP_CLEAR = ("session_id", "assigned_at", "owner", "pid", "claimed_at", "transcript")


def _section(body, pat, limit):
    """본문에서 `## <pat>` 절(같은 이름이 여럿이면 마지막 것)의 내용을 limit자까지. 없으면 "".

    h3 이하는 절 안에 남긴다(`^##\\s`는 `### `에 걸리지 않는다) -- 답변 화면도 같은 규칙이다.
    """
    # 제목 매칭은 NFC로 한다(맥에서 온 본문은 `블록`이 NFD로 적혀 있을 수 있다). 인용은 원문 그대로.
    starts = [i for i, l in enumerate(body) if re.match(r"^##\s*" + nfc(pat), nfc(l))]
    if not starts:
        return ""
    out = []
    for l in body[starts[-1] + 1:]:
        if re.match(r"^##\s", l):
            break
        out.append(l)
    return "\n".join(out).strip()[:limit]


def _quote(text):
    return "\n".join(("> " + l) if l.strip() else ">" for l in text.split("\n"))


def ask_context(fm, body):
    """자동 상신 질문에 붙일 판단 재료 -- 티켓 Goal · 블록 · 죽은 세션 로그 꼬리.

    정형문("3회 죽었다")만으로는 사람이 답할 자료가 화면에 없었다(요구 11990127: jaso에서
    3라운드가 "다시 시도해보세요"로 소모됐다). 인용 상한은 답변 다이얼로그가 스크롤 없이
    읽히는 길이다. 세션 로그는 티켓 파일 어디에도 없는 유일한 정보라 없으면 없다고 적는다.
    """
    out = ""
    goal = _section(body, "Goal", 600)
    if goal:
        out += "\n### 티켓 Goal\n\n{}\n".format(_quote(goal))
    blk = _section(body, "블록", 1200)
    if blk:
        out += "\n### 티켓 블록\n\n{}\n".format(_quote(blk))
    tr = transcript_of(fm)
    tail = transcript_tail(tr, 1500) if tr else ""
    return out + "\n### 죽은 세션 마지막 기록\n\n{}\n".format(
        _quote(tail or "트랜스크립트를 찾지 못했습니다"))


def ask_human(path, h, attempts, why, blocked=False):
    """자동 회수 상한을 넘겼거나 신선한 `## 블록`이 붙은 티켓을 답변 요청으로 올린다.

    `.wip`에 굳혀 두면(구 `HOLD`) GUI가 `.wip`을 편집할 수 없어 **사람이 눈으로 발견할 때까지
    방치된다** (2026-07-31 5aa9486d: 인증서가 없어 막힌 티켓이 attempts 45까지 로그만 쌓았다).
    대신 열림 + **존재하지 않는 dep**으로 바꾼다 -- deps_unmet은 티켓을 못 찾으면 미완료로 보므로
    재디스패치가 막히고(무한 재시도를 막던 HOLD의 목적은 그대로), GUI는 `awaiting`을 읽어
    `답변 대기` 배지와 답변칸을 그린다. 사람이 답변 파일(`<A><완료>.md`)을 만들면 잠금이 저절로
    풀려 큐에 다시 뜬다(DESIGN.md §요구사항 레이어 결정 3과 같은 장치).
    """
    a = uuid.uuid4().hex[:8]
    fm, lines, end = read_fm(path)
    body = lines[end:]
    try:
        ctx = ask_context(fm, body)
    except Exception as e:                   # 자료 수집 실패가 답변 요청 자체를 막지 않는다
        ctx = "\n### 죽은 세션 마지막 기록\n\n> 자료를 읽지 못했습니다: {}\n".format(e)
    # 사유는 경로마다 사실이 다르다. 블록은 세션이 실패한 게 아니라 벽을 보고 판정하고 멈춘 것이다.
    cause = ("세션이 `## 블록`을 남기고 멈췄습니다" if blocked
             else "자동 회수 {}회 실패({})".format(attempts, why))
    # 지시어는 `아래`다 -- 인용(결정 6)은 정형문 다음에 붙고, 화면에선 답변칸이 본문 위에 있다.
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n## 질문 {}\n\n{}. 엔진은 더 시도하지 않습니다 — {}\n{}".format(
            sum(1 for l in body if re.match(r"^##\s*질문", l)) + 1, cause,
            "아래 인용한 `## 블록`에 적힌 결정을 답해주세요."
            if any(re.match(r"^##\s*블록", nfc(l)) for l in body)
            else "세션이 왜 계속 죽는지, 이 티켓을 계속 갈지 답해주세요.", ctx))
    # 잠금(deps)을 먼저 걸고 할당을 나중에 푼다. 순서를 바꾸면 그 사이에 티켓이
    # 잠금 없이 열려 다음 tick이 답변 없이 집어 간다.
    set_deps(path, deps_of(lines, end) + [a])
    # attempts를 "0" 문자열로 쓴다(0은 falsy라 set_fm_keys가 빈 값으로 적는다) --
    # 답을 받아 다시 디스패치된 뒤엔 자동 회수 2회를 처음부터 다시 쓴다
    upd = {"attempts": "0", "awaiting": a}
    upd.update({k: "" for k in REAP_CLEAR})
    set_fm_keys(path, upd)
    return "ASK {} awaiting={} - {}, 답변 요청으로 전환".format(h, a, cause)


def reclaim(path, fm, why):
    """attempts 상한까지 백로그로 복귀. 상한을 넘거나 신선한 블록이 있으면 답변 요청으로 올린다."""
    h = ticket_hash(path, fm)
    attempts = int((fm.get("attempts") or "0").strip() or 0) + 1
    # 되돌리기(rename)를 먼저 이긴다. frontmatter를 먼저 쓰면 리퍼 둘이 겹칠 때 진 쪽의
    # open(w)이 **이미 사라진 `.wip`을 되살려** 주인 없는 유령이 영구 잔류한다
    # (2026-07-31 5f0498c9 실사고: w6이 이기고 w1·w2가 되살렸다. 그 파일은 pid도 session_id도
    # 비어 있어 reap이 두 번 다시 보지 않는다). claim이 원자적인 것과 같은 이유로 여기도 rename이 락이다.
    try:
        path = release(path)
    except (SystemExit, OSError) as e:
        return "REAP-FAIL {} {}".format(h, e)
    # 본문의 마지막 `##` 절이 `블록`이면 세션이 벽을 보고 "이건 사람이 푼다"고 판정한 것이라
    # 재실행이 얻는 게 없다 -- attempts와 무관하게 사람에게 올린다(DESIGN.md 결정 7).
    # 묵은 블록 뒤에는 ask_human이 붙인 `## 질문 n`이 반드시 오므로 마지막 절 하나로 갈린다.
    # 빗나가면 현행 동작(자동 회수 2회)으로 떨어질 뿐이라 티켓을 잃지 않는다.
    lines, end = read_fm(path)[1:]
    heads = [l for l in lines[end:] if re.match(r"^##\s", nfc(l))]
    blocked = bool(heads) and bool(re.match(r"^##\s*블록", nfc(heads[-1])))
    if attempts > REAP_MAX_ATTEMPTS or blocked:
        return ask_human(path, h, attempts, why, blocked)
    upd = {"attempts": attempts}
    upd.update({k: "" for k in REAP_CLEAR})
    set_fm_keys(path, upd)
    return "REAP {} attempts={} - {}, 백로그 복귀".format(h, attempts, why)


def reap_manual(path, fm, now):
    """손으로 잡은 진행중 티켓(session_id 없음) 판정. 메시지 리스트 반환.

    pid가 없으면 종전대로 손대지 않는다(생존을 확인할 방법이 없으므로 회수도 하지 않는다).
    pid 죽음 = 회수. pid 살아있음 = 트랜스크립트를 테일해 유휴 여부만 보고하고 건드리지 않는다 --
    작업 중인 워크트리를 자동 회수하면 미완 변경분이 붕 뜨므로, 블록 처리 규약대로 사람 판단에 맡긴다.
    """
    pid = (fm.get("pid") or "").strip().strip("\"'")
    if not pid.isdigit():
        return []
    h = ticket_hash(path, fm)
    try:
        at = datetime.fromisoformat((fm.get("claimed_at") or "").strip())
        if (now - at).total_seconds() < MANUAL_GRACE_SEC:
            return []                    # 아직 점검할 시각이 아니다
    except ValueError:
        pass                             # claimed_at이 없거나 깨졌으면 유예 없이 점검
    alive = pid_alive(pid)
    if alive is None:
        return ["SKIP {} ps 조회 실패 - 판단 보류".format(h)]
    if not alive:
        return [reclaim(path, fm, "손 클레임 세션 pid={} 사망".format(pid))]
    tr = (fm.get("transcript") or "").strip().strip("\"'")
    if not tr:
        return []                        # 살아있고 볼 로그가 없으면 정상으로 본다
    idle, kind = transcript_state(tr)
    if idle is None:
        return ["SUSPECT {} pid={} 살아있음, {}".format(h, pid, kind)]
    if idle < MANUAL_IDLE_SEC:
        return []                        # 활동 중
    return ["SUSPECT {} pid={} 살아있으나 {}분 무활동(마지막 레코드={}) - 사람 확인".format(
        h, pid, int(idle // 60), kind)]


def reap(troot):
    """세션이 죽었는데 진행중으로 남은 티켓을 백로그로 되돌린다.

    죽는 방식 두 가지를 다 덮는다: (a) 프로세스가 0으로 끝났지만 세션이 사람에게 질문만 하고
    티켓 상태를 안 바꾼 경우(tick.sh의 FAIL 경로가 못 잡는다), (b) 머신 재부팅·tick 강제종료로
    FAIL 경로 자체가 안 돈 경우. 무한 재시도를 막으려고 attempts를 세고 상한을 넘으면 사람 대기.
    """
    live = live_session_ids()
    if live is None:
        return ["SKIP ps 조회 실패 - 회수 판단 보류"]
    now = datetime.now(timezone.utc)
    msgs = []
    for p in in_progress(troot):
        try:
            fm, lines, end = read_fm(p)
        except (OSError, UnicodeDecodeError):
            continue
        if end < 0:
            continue
        sid = (fm.get("session_id") or "").strip().strip("\"'")
        if not sid:
            msgs.extend(reap_manual(p, fm, now))   # 손 클레임 -> pid + 트랜스크립트로 판정
            continue
        # Codex는 Claude식 --session-id를 ps에서 찾을 수 없다. tick.sh가 남긴 실제
        # 엔진 pid가 살아 있으면, 엔진 종류와 무관하게 아직 실행 중이다.
        pid = (fm.get("pid") or "").strip().strip("\"'")
        if pid.isdigit() and pid_alive(pid):
            continue
        if sid in live:
            continue                     # 살아있는 디스패처 세션
        at = (fm.get("assigned_at") or "").strip()
        try:
            if (now - datetime.fromisoformat(at)).total_seconds() < REAP_GRACE_SEC:
                continue
        except ValueError:
            pass                         # assigned_at이 깨졌으면 유예 없이 회수 대상
        msgs.append(reclaim(p, fm, "세션 {} 사망".format(sid[:8])))
    return msgs


def find_any(troot, want):
    """상태 무관하게 해시로 티켓 경로 찾기. 정확 일치가 없으면 `re-<해시>`(피드백 티켓)도 본다 —
    설계 확정본이 feedback으로만 존재할 때 deps에 접두 없이 적혀도 영구 대기에 빠지지 않게."""
    hit = _find_stem(troot, nfc(want))
    if hit or nfc(want).startswith(nfc("re-")):
        return hit
    return _find_stem(troot, nfc("re-" + want))


def _find_stem(troot, want):
    for pth in tickets_in(troot):
        stem = nfc(os.path.basename(pth))[:-3]
        for sfx in ("",) + CLOSED_SUFFIXES:
            if stem == want + nfc(sfx):
                return pth
    return None


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if len(sys.argv) > 2 and os.path.isdir(sys.argv[2]):
        warn_legacy(sys.argv[2])

    if cmd == "select":
        # 미할당 열린 티켓을 생성일 오름차순으로 전부. 호출자가 위에서부터 claim 시도.
        for r in scan(sys.argv[2]):
            if not r["assigned"] and not r["unmet"]:
                print("{}|{}|{}|{}".format(r["path"], r["hash"], r["kind"], r["persona"]))
        return

    if cmd == "list":
        rows = scan(sys.argv[2])
        if not rows:
            print("열린 티켓 없음")
            return
        for r in rows:
            when = datetime.fromtimestamp(r["birth"]).strftime("%Y-%m-%d %H:%M")
            if r["assigned"]:
                mark = "할당됨 " + r["session_id"]
            elif r["unmet"]:
                mark = "deps 대기 " + ",".join(r["unmet"])
            else:
                mark = "대기"
            print("{}  {:<12} {:<9} {:<10} {}".format(
                when, r["hash"], r["kind"] or "-", r["persona"] or "-", mark))
        return

    if cmd == "reap":
        for m in reap(sys.argv[2]):
            print(m)
        return

    if cmd == "find":
        pth = find_any(sys.argv[2], sys.argv[3])
        if not pth:
            raise SystemExit("티켓을 못 찾음: " + sys.argv[3])
        print(pth)
        return

    if cmd == "claim":
        print(claim(sys.argv[2]))
        return

    if cmd == "handclaim":
        # 대화형 세션의 손 클레임. claim(락)이 성공한 뒤에만 생존 신호를 적는다.
        dst = claim(sys.argv[2])
        upd = {"claimed_at": datetime.now().astimezone().isoformat(timespec="seconds")}
        pid = claude_ancestor_pid()
        if pid:
            upd["pid"] = pid
        tr = newest_transcript()
        if tr:
            upd["transcript"] = tr
        if len(sys.argv) > 3:
            upd["owner"] = sys.argv[3]
        set_fm_keys(dst, upd)
        print(dst)
        if not pid:
            print("WARN claude 조상 pid를 못 찾음 - 이 티켓은 스테일 회수 대상이 아니다",
                  file=sys.stderr)
        return

    if cmd == "release":
        print(release(sys.argv[2]))
        return

    if cmd == "assign":
        path, sid = sys.argv[2], sys.argv[3]
        upd = {
            "session_id": sid,
            "assigned_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "pid": "",
        }
        if len(sys.argv) > 4:
            upd["owner"] = sys.argv[4]
        set_fm_keys(path, upd)
        return

    if cmd == "setpid":
        set_fm_keys(sys.argv[2], {"pid": sys.argv[3]})
        return

    if cmd == "setinbox":
        # 도는 세션에 말을 거는 FIFO 경로. 세션이 끝나면 그 파일은 사라진다.
        set_fm_keys(sys.argv[2], {"inbox": sys.argv[3]})
        return

    if cmd == "clear":
        set_fm_keys(sys.argv[2], {"session_id": "", "assigned_at": "", "pid": "",
                                  "inbox": ""})
        return

    raise SystemExit("알 수 없는 명령: " + cmd)


if __name__ == "__main__":
    main()
