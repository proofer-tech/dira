#!/usr/bin/env python3
"""실패 학습 - 실패한 도구 호출과 나중에 성공한 같은 도구 호출을 짝지어 페르소나
memory 교정을 권고한다. 기본은 dry-run - 표준출력만 쓰고 파일은 건드리지 않는다.

원본: headroom `headroom/learn/analyzer.py`. 구조는 결정적 추출(무료, 이 파일 대부분) +
digest 하나에 대한 LLM 호출 한 번(`claude` CLI, 이미 설치돼 있다)뿐이다.

docs/DESIGN.md 판정 5.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

MAX_PAIRS = 60  # digest 크기 상한. 그 이상은 뒤가 잘린다


def transcripts_dir(cwd=None):
    """`claude`가 세션 로그를 쌓는 자리. `/`와 `.`를 `-`로 바꾼 절대경로 이름이다."""
    cwd = str(Path(cwd or Path.cwd()).resolve())
    encoded = re.sub(r"[/.]", "-", cwd)
    return Path.home() / ".claude" / "projects" / encoded


def session_meta(path):
    """첫 dispatch 레코드에서 페르소나 이름과 티켓 해시를 뽑는다. 없으면 (None, None)."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            first = f.readline()
        d = json.loads(first)
    except (OSError, json.JSONDecodeError):
        return None, None
    content = d.get("content", "") if d.get("type") == "queue-operation" else ""
    persona = None
    m = re.search(r"당신은 이 프로젝트의 '([a-z-]+)'", content)
    if m:
        persona = m.group(1)
    ticket_hash = None
    m = re.search(r"tickets/([0-9a-f]{8})\.(?:wip|done)\.md", content)
    if m:
        ticket_hash = m.group(1)
    return persona, ticket_hash


def result_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return "" if content is None else str(content)


def input_key(inp):
    """도구 입력을 사람이 알아볼 한 줄로 줄인다 - 상관 판정과 memory grep 둘 다 이 값을 쓴다."""
    if not isinstance(inp, dict):
        return str(inp)[:80]
    for k in ("file_path", "path", "notebook_path", "pattern", "command", "url", "query"):
        v = inp.get(k)
        if v:
            return str(v)[:200]
    return json.dumps(inp, ensure_ascii=False)[:80]


def load_tool_events(path):
    """세션 파일 하나를 도구 호출 순서열로 편다: [{name, input, is_error, result}, ...]."""
    events = []
    order = {}  # tool_use_id -> events 인덱스
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = d.get("type")
            if t == "assistant":
                content = d.get("message", {}).get("content")
                if not isinstance(content, list):
                    continue
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        order[c.get("id")] = len(events)
                        events.append({"name": c.get("name"), "input": c.get("input") or {}, "is_error": False, "result": ""})
            elif t == "user":
                content = d.get("message", {}).get("content")
                if not isinstance(content, list):
                    continue
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "tool_result":
                        idx = order.get(c.get("tool_use_id"))
                        if idx is not None:
                            events[idx]["is_error"] = bool(c.get("is_error"))
                            events[idx]["result"] = result_text(c.get("content"))
    return events


def find_pairs(events):
    """실패한 호출마다, 그 뒤 같은 도구가 성공한 첫 자리를 찾아 짝짓는다.
    뒤에 같은 도구의 성공이 없으면 버린다 - 교정을 뽑을 근거가 없다(실패 목록이 되는 것을 막는다)."""
    pairs = []
    for i, e in enumerate(events):
        if not e["is_error"]:
            continue
        for j in range(i + 1, len(events)):
            f = events[j]
            if f["name"] == e["name"] and not f["is_error"]:
                pairs.append({
                    "tool": e["name"],
                    "fail_input": input_key(e["input"]),
                    "error": e["result"][:200],
                    "ok_input": input_key(f["input"]),
                    "gap": j - i,
                })
                break
    return pairs


def already_known(pair, memory_text):
    """실패 입력의 눈에 띄는 조각(파일명 또는 명령 첫 낱말)이 이미 memory 본문에 있으면 버린다."""
    if not memory_text:
        return False
    probe = pair["fail_input"]
    tokens = {os.path.basename(probe)}
    parts = probe.split()
    if parts:
        tokens.add(parts[0])
    tokens.discard("")
    return any(tok in memory_text for tok in tokens)


def build_digest(persona, pairs):
    lines = [f"페르소나: {persona}", f"실패->성공 후보 {len(pairs)}개 (이미 memory에 있는 것은 뺐다)", ""]
    for i, p in enumerate(pairs, 1):
        lines.append(f"{i}. [{p['tool']}] 실패: {p['fail_input']}")
        lines.append(f"   에러: {p['error']}")
        lines.append(f"   {p['gap']}턴 뒤 같은 도구 성공: {p['ok_input']}")
    return "\n".join(lines)


PROMPT_TEMPLATE = """아래는 dira 세션 트랜스크립트에서 뽑은 <도구 실패 -> 나중에 같은 도구가 성공>
후보 쌍이다. 같은 원인으로 보이는 쌍을 묶어서, 다음 세션이 같은 실패를 반복하지 않게
하는 교정을 뽑아라.

규칙:
- 후보 쌍에 실제로 근거가 있는 것만 낸다. 추측으로 채우지 않는다.
- 실패 목록을 다시 나열하지 않는다 - "무엇이 맞았나"까지 한 문장에 넣는다.
- 문장부호는 ASCII만 쓴다(en dash, 가운뎃점, 화살표 기호 금지 - 그 자리는 "-"나 "->"로).
- 근거가 부족하면 빈 배열을 낸다.

{digest}

출력은 JSON 배열 하나만, 다른 텍스트 없이. 각 항목:
{{"title": "6~20자 개념 제목(슬래시/마침표 금지)", "body": "교정 문장 1~3줄"}}
"""


def call_llm(prompt, model):
    r = subprocess.run(
        ["claude", "-p", prompt, "--model", model, "--output-format", "json"],
        capture_output=True, text=True, timeout=180,
    )
    if r.returncode != 0:
        raise RuntimeError(f"claude 종료코드 {r.returncode}: {r.stderr[:300]}")
    data = json.loads(r.stdout)
    if data.get("is_error"):
        raise RuntimeError(f"claude 오류: {data.get('result')}")
    text = data.get("result", "").strip()
    text = re.sub(r"^```(?:json)?\n?|\n?```$", "", text.strip())
    return json.loads(text)


def sanitize_title(title):
    title = re.sub(r"[/.\\]", " ", title).strip()
    return title or "이름 없는 교정"


def write_memory(mem_dir, title, body, ticket_hashes):
    mem_dir.mkdir(parents=True, exist_ok=True)
    path = mem_dir / f"{title}.md"
    src = " ".join(f"`{h}`" for h in sorted(set(filter(None, ticket_hashes))))
    text = f"# {title}\n\n{body}\n"
    if src:
        text += f"\n출처: {src}\n"
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        print(f"  (건너뜀 - 이미 있음: {path})")
        return
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"  -> {path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--persona", required=True)
    ap.add_argument("--sessions", type=int, default=60, help="최근 세션 표본 수")
    ap.add_argument("--model", default="haiku")
    ap.add_argument("--apply", action="store_true", help="기본은 dry-run. 이 플래그가 있어야 memory에 쓴다")
    ap.add_argument("--transcripts-dir")
    ap.add_argument("--personas-root", default=os.environ.get("TICKET_PERSONAS", ".dira/personas"))
    args = ap.parse_args()

    tdir = Path(args.transcripts_dir) if args.transcripts_dir else transcripts_dir()
    if not tdir.is_dir():
        print(f"트랜스크립트 디렉터리 없음: {tdir}", file=sys.stderr)
        sys.exit(1)

    files = sorted(tdir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    sessions = []  # (path, ticket_hash)
    for f in files:
        if len(sessions) >= args.sessions:
            break
        persona, ticket_hash = session_meta(f)
        if persona == args.persona:
            sessions.append((f, ticket_hash))

    if not sessions:
        print(f"{args.persona} 세션 0개 - 권고 없음")
        return

    all_pairs = []
    hashes = []
    for f, h in sessions:
        all_pairs.extend(find_pairs(load_tool_events(f)))
        hashes.append(h)

    if not all_pairs:
        print(f"세션 {len(sessions)}개, 실패->성공 쌍 0개 - 권고 없음")
        return

    mem_dir = Path(args.personas_root) / args.persona / "memory"
    memory_text = ""
    if mem_dir.is_dir():
        for mf in mem_dir.glob("*.md"):
            memory_text += mf.read_text(encoding="utf-8", errors="replace")

    fresh = [p for p in all_pairs if not already_known(p, memory_text)][:MAX_PAIRS]

    if not fresh:
        print(f"세션 {len(sessions)}개, 쌍 {len(all_pairs)}개 - 전부 memory에 이미 있음. 권고 없음")
        return

    digest = build_digest(args.persona, fresh)
    try:
        recs = call_llm(PROMPT_TEMPLATE.format(digest=digest), args.model)
    except Exception as e:
        print(f"LLM 호출 실패: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"세션 {len(sessions)}개 / 쌍 {len(all_pairs)}개 (memory 중복 제외 {len(fresh)}개) -> 교정 {len(recs)}개\n")
    if not recs:
        return

    for r in recs:
        title = sanitize_title(r.get("title", ""))
        body = (r.get("body") or "").strip()
        print(f"## {title}")
        print(body)
        if args.apply:
            write_memory(mem_dir, title, body, hashes)
        print()

    if not args.apply:
        print("(dry-run - memory에 안 썼다. 반영하려면 --apply)")


if __name__ == "__main__":
    main()
