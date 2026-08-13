#!/usr/bin/env python3
"""비용계 - 트랜스크립트에서 네 축 리포트 (DESIGN.md §토큰 비용 §판정 1).
    python3 apps/teams/usage-report.py --sessions 60 [--root <루트>]

출처는 workers/logs/ 종료 JSON이 아니라 ~/.claude/projects/<워크트리>/*.jsonl 트랜스크립트다
- 세션이 끝나기를 기다리지 않고 턴마다 쌓인 message.usage를 그대로 읽는다(§0-8의 천장을
피한다: 신호로 죽은 세션도 그때까지 쓴 턴은 잡힌다).

티켓·페르소나 귀속은 workers/runner.log의 DISPATCH 줄(시각 - 워커 - 해시 - 페르소나 - sid)을
색인으로 쓴다. 세션 재활용(§4-11)으로 한 sid가 티켓을 여러 개 거치면, 트랜스크립트 사건의
타임스탬프가 어느 DISPATCH 구간에 드는지로 나눠 센다 - 그래서 재디스패치(같은 티켓·다른 sid)와
재활용(같은 sid·다른 티켓) 둘 다 올바르게 갈린다.

단가는 Anthropic 공개 Mtok 단가다(§실측과 대조해 역산 - claude-sonnet-5 3/15/3.75/0.30,
claude-opus-5 15/75/18.75/1.50 USD). 여기 없는 모델은 0으로 안 세고 "단가 미공개"로 따로 센다."""
import argparse
import json
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# USD / 1M 토큰. 모르는 모델은 이 표에 없다 -> 비용 계산에서 빠지고 "단가 미공개"로 따로 잡힌다.
PRICES = {
    "claude-sonnet-5": {"input": 3.0, "output": 15.0, "cache_creation": 3.75, "cache_read": 0.30},
    "claude-opus-5": {"input": 15.0, "output": 75.0, "cache_creation": 18.75, "cache_read": 1.50},
}

AXES = ("input", "output", "cache_creation", "cache_read")
AXIS_FIELD = {
    "input": "input_tokens",
    "output": "output_tokens",
    "cache_creation": "cache_creation_input_tokens",
    "cache_read": "cache_read_input_tokens",
}
AXIS_LABEL = {"input": "신규 입력", "output": "출력", "cache_creation": "캐시 생성", "cache_read": "캐시 읽기"}

DISPATCH_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\S+)\] DISPATCH (\S+) kind=\S+ persona=(\S+) sid=([0-9a-fA-F-]+)"
)


def enc(p: str) -> str:
    """cwd -> ~/.claude/projects/의 디렉터리 이름. 규칙은 비영숫자 전부 '-'다(lib/usage.ts와 같다)."""
    return re.sub(r"[^a-zA-Z0-9]", "-", p)


def local_epoch(s: str) -> float:
    """runner.log의 '%F %T'는 이 머신 로컬 시각이다(tick.sh log()) - time.mktime이 그대로 맞다."""
    return time.mktime(time.strptime(s, "%Y-%m-%d %H:%M:%S"))


def iso_epoch(ts: str) -> float:
    """트랜스크립트의 '2026-08-13T12:09:37.895Z' -> UTC epoch."""
    try:
        return datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except (ValueError, TypeError):
        return 0.0


def load_dispatch_index(runner_log: Path):
    """sid -> [(epoch, 티켓해시, 페르소나), ...] 시간순. DISPATCH 줄이 곧 귀속 색인이다."""
    idx = defaultdict(list)
    if not runner_log.exists():
        return idx
    with runner_log.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            m = DISPATCH_RE.match(line)
            if not m:
                continue
            at, _worker, ticket_hash, persona, sid = m.groups()
            idx[sid].append((local_epoch(at), ticket_hash, persona))
    for sid in idx:
        idx[sid].sort(key=lambda t: t[0])
    return idx


def ticket_of(idx, sid, epoch):
    """이 sid·이 시각에 물려 있던 (티켓해시, 페르소나). epoch 이하 DISPATCH 중 가장 늦은 것 -
    이 sid가 색인에 아예 없으면 None(tick.sh를 거치지 않은 세션 - home-agent 등)."""
    entries = idx.get(sid)
    if not entries:
        return None
    ticket_hash, persona = entries[0][1], entries[0][2]
    for at, h, p in entries:
        if at <= epoch:
            ticket_hash, persona = h, p
        else:
            break
    return ticket_hash, persona


def find_project_dirs(root: Path, claude_projects: Path):
    """이 프로젝트의 워크트리들이 쓰는 ~/.claude/projects/ 디렉터리 전부."""
    prefix = enc(str(root / "worktrees") + os.sep)
    if not claude_projects.exists():
        return []
    return sorted(claude_projects / n for n in os.listdir(claude_projects) if n.startswith(prefix))


def pick_sessions(dirs, limit):
    """mtime 최신순 N개 - 고르기 전에는 열지 않는다(lib/usage.ts 판정 4와 같은 규칙)."""
    found = []
    for d in dirs:
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for n in names:
            if not n.endswith(".jsonl"):
                continue
            p = d / n
            try:
                mt = p.stat().st_mtime
            except OSError:
                continue
            found.append((mt, p))
    found.sort(key=lambda t: t[0], reverse=True)
    return [p for _, p in found[:limit]]


def zero_row():
    return {"sids": set(), "turns": 0, "input": 0, "output": 0, "cache_creation": 0, "cache_read": 0, "unpriced": set()}


def scan_session(path: Path, dispatch_idx, by_ticket, by_persona, by_model, by_ticket_model, by_persona_model):
    """세션 하나를 훑어 네 축 누적 그릇에 더한다. 티켓·페르소나는 (버킷, 모델) 조합으로도
    같이 쌓는다 - 한 버킷이 모델을 섞어 썼을 때 축별 단가를 모델별로 정확히 곱하려면
    그 분해가 있어야 한다(§실측 두 표가 모델별 표를 따로 두는 것과 같은 이유)."""
    sid = path.stem
    seen_ids = set()
    try:
        f = path.open(encoding="utf-8", errors="replace")
    except OSError:
        return
    with f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue  # 세션이 쓰는 중이라 잘린 줄이다
            if rec.get("type") != "assistant":
                continue
            msg = rec.get("message") or {}
            mid = msg.get("id")
            if mid:
                if mid in seen_ids:
                    continue  # 스트리밍이 한 응답을 여러 줄로 적는다 - 첫 등장만 센다
                seen_ids.add(mid)
            usage = msg.get("usage") or {}
            model = msg.get("model") or "(모름)"
            epoch = iso_epoch(rec.get("timestamp") or "")
            hit = ticket_of(dispatch_idx, sid, epoch)
            ticket_hash, persona = hit if hit else ("(미상)", "(미상)")

            tokens = {ax: int(usage.get(AXIS_FIELD[ax], 0) or 0) for ax in AXES}
            unpriced = model not in PRICES

            for key, target in ((ticket_hash, by_ticket), (persona, by_persona), (model, by_model)):
                row = target[key]
                row["sids"].add(sid)
                row["turns"] += 1
                for ax in AXES:
                    row[ax] += tokens[ax]
                if unpriced:
                    row["unpriced"].add(model)

            for key, target in ((ticket_hash, by_ticket_model), (persona, by_persona_model)):
                row = target[key][model]
                row["sids"].add(sid)
                row["turns"] += 1
                for ax in AXES:
                    row[ax] += tokens[ax]


def cost_usd(model, row):
    """priced 모델 하나의 토큰 4축을 단가로 곱해 더한다. 모델을 모르면 None(0으로 안 센다)."""
    p = PRICES.get(model)
    if not p:
        return None
    return sum(row[ax] / 1_000_000 * p[ax] for ax in AXES)


def bucket_usd(by_bucket_model):
    """버킷(티켓 또는 페르소나) -> priced 모델들만 합산한 USD."""
    out = {}
    for key, models in by_bucket_model.items():
        out[key] = sum(cost_usd(m, r) or 0.0 for m, r in models.items())
    return out


def fmt(n):
    return f"{n:,}"


def print_model_table(by_model):
    print("| 모델 | assistant 턴 | 신규 입력 | 출력 | 캐시 생성 | 캐시 읽기 |")
    print("|---|---|---|---|---|---|")
    for model, row in sorted(by_model.items(), key=lambda kv: -kv[1]["turns"]):
        print(f"| `{model}` | {fmt(row['turns'])} | {fmt(row['input'])} | {fmt(row['output'])} | "
              f"{fmt(row['cache_creation'])} | {fmt(row['cache_read'])} |")


def print_cost_table(by_model):
    """§실측 둘째 표와 같은 모양 - 축 | USD | 비중. priced 모델만 더하고, 나머지는 아래
    '단가 미공개' 줄로 따로 센다(0으로 삼키지 않는다)."""
    axis_usd = {ax: 0.0 for ax in AXES}
    unpriced_models = {}
    for model, row in by_model.items():
        p = PRICES.get(model)
        if not p:
            unpriced_models[model] = row
            continue
        for ax in AXES:
            axis_usd[ax] += row[ax] / 1_000_000 * p[ax]
    total = sum(axis_usd.values())
    print()
    print(f"모델별 공개 단가를 곱한 비용 축 (소계 ${total:,.2f}):")
    print()
    print("| 축 | USD | 비중 |")
    print("|---|---|---|")
    for ax, usd in sorted(axis_usd.items(), key=lambda kv: -kv[1]):
        pct = (usd / total * 100) if total else 0.0
        print(f"| {AXIS_LABEL[ax]} | {usd:,.2f} | {pct:.1f}% |")
    print()
    if unpriced_models:
        for model, row in unpriced_models.items():
            print(f"단가 미공개: `{model}` - assistant 턴 {fmt(row['turns'])}, "
                  f"신규 입력 {fmt(row['input'])}, 출력 {fmt(row['output'])}, "
                  f"캐시 생성 {fmt(row['cache_creation'])}, 캐시 읽기 {fmt(row['cache_read'])}")
    else:
        print("단가 미공개: 없음 (표본의 모델이 전부 단가표 안에 있다)")
    return total


def print_bucket_table(title, key_label, buckets, usd_by_key):
    print()
    print(f"### {title}")
    print()
    print(f"| {key_label} | 세션수 | assistant 턴 | 신규 입력 | 출력 | 캐시 생성 | 캐시 읽기 | 비용(USD) |")
    print("|---|---|---|---|---|---|---|---|")
    for key, row in sorted(buckets.items(), key=lambda kv: -kv[1]["turns"]):
        usd = usd_by_key.get(key, 0.0)
        usd_str = f"{usd:,.2f}"
        if row["unpriced"]:
            usd_str += f" (+단가미공개: {','.join(sorted(row['unpriced']))})"
        print(f"| `{key}` | {len(row['sids'])} | {fmt(row['turns'])} | {fmt(row['input'])} | "
              f"{fmt(row['output'])} | {fmt(row['cache_creation'])} | {fmt(row['cache_read'])} | {usd_str} |")


def selftest():
    """비자명한 로직 넷 - enc, 시각 변환, ticket_of 구간 판정, dedup. 깨지면 여기서 먼저 죽는다."""
    assert enc("/a/b c!.d") == "-a-b-c--d"

    epoch = local_epoch("2026-08-13 21:59:32")
    assert abs(iso_epoch(datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")) - epoch) < 1

    idx = defaultdict(list)
    idx["sid1"] = [(100.0, "티켓A", "developer"), (200.0, "티켓B", "developer")]
    assert ticket_of(idx, "sid1", 50.0) == ("티켓A", "developer")   # 첫 DISPATCH보다 이른 사건 -> 첫 항목
    assert ticket_of(idx, "sid1", 150.0) == ("티켓A", "developer")  # 구간 안
    assert ticket_of(idx, "sid1", 250.0) == ("티켓B", "developer")  # 재활용 뒤 구간
    assert ticket_of(idx, "없는sid", 0.0) is None

    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "sid1.jsonl"
        lines = [
            {"type": "assistant", "timestamp": "2026-08-13T00:00:00.000Z",
             "message": {"id": "m1", "model": "claude-sonnet-5", "usage": {"input_tokens": 1, "output_tokens": 2}}},
            {"type": "assistant", "timestamp": "2026-08-13T00:00:01.000Z",  # 같은 id 재등장 - 스트리밍 중복
             "message": {"id": "m1", "model": "claude-sonnet-5", "usage": {"input_tokens": 1, "output_tokens": 2}}},
        ]
        p.write_text("\n".join(json.dumps(o) for o in lines), encoding="utf-8")
        by_t, by_p, by_m = defaultdict(zero_row), defaultdict(zero_row), defaultdict(zero_row)
        by_tm, by_pm = defaultdict(lambda: defaultdict(zero_row)), defaultdict(lambda: defaultdict(zero_row))
        scan_session(p, defaultdict(list), by_t, by_p, by_m, by_tm, by_pm)
        assert by_m["claude-sonnet-5"]["turns"] == 1, "message.id 중복 라인이 두 번 세였다"
        assert by_m["claude-sonnet-5"]["output"] == 2

    print("selftest OK")


def main():
    ap = argparse.ArgumentParser(description="dira 비용계 - 트랜스크립트 네 축 리포트")
    ap.add_argument("--sessions", type=int, default=60, help="최신 N개 세션 표본 (기본 60)")
    ap.add_argument("--root", type=Path, default=None, help="큐 루트 (기본: 이 파일 위치에서 유도)")
    ap.add_argument("--selftest", action="store_true", help="로직 자체 점검만 하고 끝낸다")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return

    root = args.root or Path(__file__).resolve().parents[4]  # <root>/worktrees/<워커>/apps/teams/이 파일
    runner_log = root / "workers" / "runner.log"
    claude_projects = Path.home() / ".claude" / "projects"

    dispatch_idx = load_dispatch_index(runner_log)
    dirs = find_project_dirs(root, claude_projects)
    sessions = pick_sessions(dirs, args.sessions)

    by_ticket, by_persona, by_model = defaultdict(zero_row), defaultdict(zero_row), defaultdict(zero_row)
    by_ticket_model = defaultdict(lambda: defaultdict(zero_row))
    by_persona_model = defaultdict(lambda: defaultdict(zero_row))

    for path in sessions:
        scan_session(path, dispatch_idx, by_ticket, by_persona, by_model, by_ticket_model, by_persona_model)

    print(f"# 비용계 - 표본 {len(sessions)}세션 (요청 {args.sessions})")
    print()
    print(f"루트: `{root}`")
    print(f"트랜스크립트 디렉터리 {len(dirs)}개, runner.log DISPATCH sid {len(dispatch_idx)}개")
    print()
    print("## 모델별")
    print()
    print_model_table(by_model)
    total_usd = print_cost_table(by_model)

    print_bucket_table("티켓별", "티켓", by_ticket, bucket_usd(by_ticket_model))
    print_bucket_table("페르소나별", "페르소나", by_persona, bucket_usd(by_persona_model))

    n_redispatched = sum(1 for r in by_ticket.values() if len(r["sids"]) > 1)
    print()
    print(f"합계: 세션 {len(sessions)}건 - 비용 추정 ${total_usd:,.2f} - "
          f"재디스패치(세션 2개 이상)로 합쳐 센 티켓 {n_redispatched}건")


if __name__ == "__main__":
    main()
