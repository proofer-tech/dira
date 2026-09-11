#!/usr/bin/env python3
"""랜딩 통계 네 셀을 재서 landing.tsx와 lib/i18n.ts를 다시 쓴다. 인자 없음.
    python3 apps/teams/measure-landing-stats.py
정본은 docs/DESIGN.md §P402 - 셀별 측정 명령과 확정 값 표. 사람이 맥에서 직접 돌린다 - 빌드에
안 붙는다(셀 2-3의 재료가 배포 환경에 없다). 두 번 돌려도 같은 트리에서는 같은 값이 나온다.
"""
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LANDING = ROOT / "apps/teams/app/(site)/landing.tsx"
I18N = ROOT / "apps/teams/lib/i18n.ts"


def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True).stdout


def die(msg):
    sys.exit(msg)


def measure_workers():
    """셀 2 - crontab의 워커 스크립트를 중복 제거하고 센다(워커 하나가 :00/:30 두 줄이다).
    reaper.sh는 `workers/w<N>.sh` 모양이 아니라 이 정규식에 저절로 안 걸린다."""
    try:
        out = run(["crontab", "-l"])
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    paths = set()
    for line in out.splitlines():
        m = re.search(r'([^\s"]+/\.dira/workers/w\d+\.sh)', line)
        if m:
            paths.add(m.group(1))
    if not paths:
        return None
    projects = {re.sub(r'/\.dira/workers/w\d+\.sh$', "", p) for p in paths}
    return len(paths), len(projects)


def measure_tickets():
    """셀 3 - 이 큐(.dira/tickets)의 전체 파일과 .done 파일을 센다."""
    tickets_dir = ROOT / ".dira/tickets"
    if not tickets_dir.is_dir():
        return None
    total = len(list(tickets_dir.glob("*.md")))
    done = len(list(tickets_dir.glob("*.done.md")))
    return total, done


def measure_period():
    """셀 4 - 첫 커밋 날짜와 measurement 날짜의 날수 차, master 커밋 수."""
    out = run(["git", "log", "--reverse", "--date=short"])
    m = re.search(r"^Date:\s+(\d{4}-\d{2}-\d{2})", out, re.M)
    first_date = date.fromisoformat(m.group(1))
    today = date.today()
    days = (today - first_date).days
    commits = int(run(["git", "rev-list", "--count", "master"]).strip())
    return days, commits, today


def rewrite_landing(n_workers, n_tickets):
    text = LANDING.read_text()
    out = text
    out, n1 = re.subn(
        r'(<li><b>)\d+(</b><span>\{t\("landing\.stats\.concurrentWorkersLabel"\)\})',
        rf"\g<1>{n_workers}\g<2>",
        out,
    )
    out, n2 = re.subn(
        r'(<li><b>)\d+(</b><span>\{t\("landing\.stats\.ticketsLabel"\)\})',
        rf"\g<1>{n_tickets}\g<2>",
        out,
    )
    if n1 != 1 or n2 != 1:
        die("landing.tsx의 워커/티켓 셀 자리를 못 찾았다 - 형식이 바뀌었다")
    LANDING.write_text(out)


def set_value(chunk, key, value):
    pattern = re.compile(r'("' + re.escape(key) + r'":\s*)"(?:[^"\\]|\\.)*"')
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    new, n = pattern.subn(lambda m: m.group(1) + '"' + escaped + '"', chunk, count=1)
    if n != 1:
        die(f"lib/i18n.ts에 키 {key}가 한 벌이 아니다")
    return new


def rewrite_i18n(n_projects, n_done, days, commits, today):
    text = I18N.read_text()
    ko_start = text.index("export const ko")
    en_start = text.index("export const en")
    head, ko_body, en_body = text[:ko_start], text[ko_start:en_start], text[en_start:]

    ko_body = set_value(
        ko_body,
        "landing.stats.concurrentWorkersLabel",
        f"맥 한 대에서 프로젝트 {n_projects}개에 동시에 도는 워커",
    )
    ko_body = set_value(ko_body, "landing.stats.ticketsValue", f"완료 {n_done}")
    ko_body = set_value(ko_body, "landing.stats.hoursBig", f"{days}일")
    ko_body = set_value(ko_body, "landing.stats.hoursLabel", "첫 커밋 이후")
    ko_body = set_value(ko_body, "landing.stats.hoursCommitsValue", f"커밋 {commits}")
    ko_body = set_value(ko_body, "landing.stats.note", f"{today.isoformat()} 기준")

    en_body = set_value(
        en_body,
        "landing.stats.concurrentWorkersLabel",
        f"Workers running at once across {n_projects} projects on one Mac",
    )
    en_body = set_value(en_body, "landing.stats.ticketsValue", f"{n_done} done")
    en_body = set_value(en_body, "landing.stats.hoursBig", f"{days} days")
    en_body = set_value(en_body, "landing.stats.hoursLabel", "Since the first commit")
    en_body = set_value(en_body, "landing.stats.hoursCommitsValue", f"{commits:,} commits")
    en_body = set_value(en_body, "landing.stats.note", f"As of {today.isoformat()}")

    I18N.write_text(head + ko_body + en_body)


def main():
    workers = measure_workers()
    if workers is None:
        die("크론에 워커 줄이 없다 - 값을 고치지 않고 멈춘다(낡은 값을 0으로 덮는 것이 더 나쁘다)")
    tickets = measure_tickets()
    if tickets is None:
        die(".dira/가 없는 트리다 - 값을 고치지 않고 멈춘다")

    n_workers, n_projects = workers
    n_tickets, n_done = tickets
    days, commits, today = measure_period()

    rewrite_landing(n_workers, n_tickets)
    rewrite_i18n(n_projects, n_done, days, commits, today)

    print(
        f"workers={n_workers} projects={n_projects} tickets={n_tickets} "
        f"done={n_done} days={days} commits={commits} date={today.isoformat()}"
    )


if __name__ == "__main__":
    main()
