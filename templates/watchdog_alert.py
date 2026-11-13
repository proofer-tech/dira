#!/usr/bin/env python3
"""디스패치 감시자 판정 - docs/DESIGN.md `§디스패치 감시자` §사람을 부르는 자리는 좁다
(P428-3, 티켓 4eb963cd).

`alert()`가 유일한 진입점이다. `diagnose()`(watchdog_gates)가 낸 줄 중 **`사람`** 줄과,
`자력`인데 `recover`(P428-2, watchdog_gates와 같은 디렉터리의 `<루트>/workers/.watchdog-<코드>`
표식 파일로 이미 한 번 손댄 적이 있는데도 여전히 걸리는 줄만 사람을 부른다. `recover`가
아직 없어도(표식 파일이 없으면) 안전한 쪽으로 - 자력 줄은 그냥 넘어간다.

부르는 방법 둘 다 이 파일이 낸다 - `kind: feedback`/`persona: pm` 티켓 한 장(코드마다 하나,
열려 있으면 새로 안 냄)과 `osascript` 알림(있든 없든 티켓 발행은 그대로 끝난다).
"""
import json
import os
import re
import shlex
import subprocess
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import watchdog_gates as _gates  # noqa: E402


HOME = os.path.expanduser("~")

TEMPLATE = """---
ticket: {hash}
title: {title}
kind: feedback
persona: pm
watchdog_code: {code}
---

## 무슨 일인가요
{what}

## 걸린 대상
{target}

## 왜 자동으로 고치지 않았나요
{why}

## 하실 일
{todo}

## 진단 원문
{code} {who} {text}
"""

# ponytail: 코드별 문장은 이 함수 하나에 모았다. 모르는 코드는 일반 문구로 떨어진다.
# 구현이 둘 이상 되면 코드별 함수로 나눈다.


def _tilde(path):
    return "~" + path[len(HOME):] if path == HOME or path.startswith(HOME + os.sep) else path


def _read_lines(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read().splitlines()
    except OSError:
        return []


def _porcelain_name(s):
    """git status --porcelain 경로 칸에서 실제 파일 이름만 낸다: 이름 바꿈이면 새 이름, 따옴표는 벗긴다."""
    if " -> " in s:
        s = s.rsplit(" -> ", 1)[1]
    if len(s) >= 2 and s[0] == s[-1] == '"':
        s = re.sub(r"\\(.)", r"\1", s[1:-1])
    return s


def _g1(root):
    body = _read_lines(os.path.join(root, "workers", ".gate-dirty"))
    tree = body[0].split(" ", 1)[1].strip() if body and " " in body[0] else "(받는 트리)"
    files = []
    for l in body[1:]:
        if not l:
            continue
        status, _, verdict = l.partition("\t")
        files.append((_porcelain_name(status[3:].strip() or status.strip()), verdict))
    return _tilde(tree), files


def _hhmm(epoch):
    return time.strftime("%H:%M", time.localtime(epoch))


def _g3(root):
    """(소진 계정 수, 가장 늦은 해제 시각 epoch 또는 None)."""
    local = os.environ.get("TICKET_LOCAL") or os.path.join(HOME, ".config", "dira")
    now = time.time()
    worst = None
    alive = _gates._alive_cooldowns(os.path.join(local, "run"), now)
    if alive:
        worst = max(u for _, u in alive)
    n = 0
    try:
        with open(os.path.join(local, "tokens.json"), encoding="utf-8") as f:
            for t in json.load(f).get("claude", {}).get("tokens", []):
                eu = t.get("exhaustedUntil")
                if t.get("enabled") and eu is not None and eu > now:
                    n += 1
    except (OSError, ValueError):
        pass
    return n, worst


def describe(root, code, who, text):
    """(제목, 무슨 일, 걸린 대상, 왜 안 고쳤나, 하실 일). 근거 파일을 다시 읽어 채운다."""
    workers_dir = os.path.join(root, "workers")
    worker_names = sorted(n[:-3] for n in os.listdir(workers_dir) if n.endswith(".sh")) \
        if os.path.isdir(workers_dir) else []
    # `자력` 줄이 올라온 것은 표식 때문이다(needs_alert) - 그때만 "한 번 고쳤다"고 쓴다.
    retried = "한 번 고쳤는데 같은 문제가 다시 걸렸습니다." if who == "자력" else None

    if code == "G1":
        tree, files = _g1(root)
        n = len(files)
        if n:
            title = f"워커가 결과를 올리지 못하고 있습니다: {tree}에 커밋 안 된 파일 {n}개"
        else:
            title = "워커가 결과를 올리지 못하고 있습니다: 커밋 안 된 파일 목록을 읽지 못했습니다"
        what = (f"워커는 작업 결과를 {tree}에 합친 뒤 올립니다. 지금 그 폴더에 커밋하지 않은 변경이 있어서 "
                "워커가 결과를 올리지 못하고 멈춰 있습니다.")
        target = "\n".join(f"{tree}/{f} ({'사람이 편집 중으로 보임' if v == '사람편집' else '작업 잔해로 보임'})"
                           for f, v in files) or tree
        why = retried or ("누군가 편집하던 파일로 보여서 지우지 않았습니다. 지우면 그 작업이 사라집니다."
                          if any(v != "잔해" for _, v in files) else "받는 트리의 변경을 자동으로 되돌리지 못했습니다.")
        if files:
            undo = f"`git -C {tree} restore {shlex.quote(files[0][0])}`처럼 되돌리세요. "
        else:
            undo = f"`git -C {tree} status`로 어떤 파일인지 확인한 뒤 되돌리세요. "
        todo = (f"편집하던 작업이면 커밋하세요. 필요 없는 변경이면 {undo}"
                "둘 중 하나를 하면 워커가 다음 주기에 다시 돕니다.")
    elif code == "G2":
        names = sorted(n[len(".gate-notree-"):] for n in os.listdir(workers_dir)
                       if n.startswith(".gate-notree-")) if os.path.isdir(workers_dir) else []
        title = f"워커가 작업할 폴더가 없어 멈춰 있습니다: 워커 {len(names) or len(worker_names)}개"
        what = "워커는 프로젝트마다 전용 작업 폴더(git 워크트리)에서 일합니다. 그 폴더가 없어서 모든 워커가 일을 시작하지 못합니다."
        target = "워커: " + (", ".join(names) or ", ".join(worker_names))
        why = retried or "작업 폴더는 프로젝트 등록 때 만들어집니다. 폴더가 왜 없어졌는지 알 수 없어 새로 만들지 않았습니다."
        todo = "GUI에서 이 프로젝트를 다시 등록하면 전용 작업 폴더가 만들어집니다."
    elif code == "G3":
        n, worst = _g3(root)
        until = f"{_hhmm(worst)}까지" if worst else "한도가 풀릴 때까지"
        title = f"Claude 계정이 모두 한도에 걸려 일이 멈춰 있습니다: {until}"
        what = "연결된 Claude 계정이 모두 사용 한도에 도달해서 워커가 새 작업을 시작하지 못합니다."
        target = f"소진된 계정 {n}개" + (f", 가장 늦은 해제 시각 {_hhmm(worst)}" if worst else "")
        why = retried or "남은 계정이 없어서 바꿔 끼울 수 없습니다. 한도는 시간이 지나야 풀립니다."
        todo = (f"{_hhmm(worst)}까지 기다리거나, " if worst else "한도가 풀릴 때까지 기다리거나, ") + \
            "GUI 설정에서 계정을 추가하세요."
    elif code == "G4":
        path = "~/.config/dira/oauth-token"
        title = f"Claude 로그인 토큰이 없어 워커가 시작하지 못합니다: {path}"
        what = "워커가 Claude를 부를 때 쓰는 로그인 토큰 파일이 없거나 비어 있습니다."
        target = path
        why = retried or "로그인은 사람이 직접 해야 하는 일이라 자동으로 만들 수 없습니다."
        todo = (f"터미널에서 `claude setup-token`을 실행해 토큰을 받은 뒤 "
                f"`printf '%s' '<받은 토큰>' > {path}`로 저장하세요.")
    elif code == "G5":
        m = re.match(r"워커 (\S+) 셸이 (\d+)벌\(상한 (\d+)\)", text)
        if m:
            name, n, cap = m.groups()
            title = f"워커 {name}의 셸이 {n}벌 쌓여 있습니다(상한 {cap})"
            target = f"워커 {name}, 셸 {n}벌"
        else:
            title = "워커의 셸이 상한을 넘게 쌓여 있습니다"
            target = text
        what = "워커가 띄운 셸 프로세스가 정리되지 않고 쌓이고 있습니다. 더 쌓이면 컴퓨터가 느려집니다."
        why = retried or "정리 대상을 가려내지 못했습니다."
        # recover와 같은 기준(상한 초과분만, 세션을 쥔 셸 제외, 오래된 것부터)으로 정리하는 명령이다.
        gates = os.path.join(os.path.dirname(os.path.abspath(__file__)), "watchdog_gates.py")
        todo = (f"터미널에서 `python3 {shlex.quote(gates)} recover {shlex.quote(os.path.abspath(root))}`를 "
                "실행하세요. 상한을 넘은 만큼만, 작업 중인 세션의 셸은 빼고 오래된 것부터 정리합니다.")
    elif code == "G6":
        title = f"워커 자동 실행이 꺼져 있습니다: 워커 {len(worker_names)}개"
        what = "워커를 주기적으로 깨우는 crontab 줄이 하나도 없어서 워커가 저절로 돌지 않습니다."
        target = "워커: " + ", ".join(worker_names)
        why = retried or "crontab은 사용자 계정의 설정이라 자동으로 다시 쓰지 않았습니다."
        todo = "GUI의 워커 화면에서 그 워커 줄의 `재등록` 버튼을 누르세요."
    elif code == "G7":
        line = text.split(": ", 1)[1] if ": " in text else text
        lic = "license" in line.lower() or "라이선스" in line
        title = "git이 실행되지 않아 워커가 멈춰 있습니다" + (": Xcode 라이선스 동의가 필요합니다" if lic else "")
        what = "이 컴퓨터에서 `git --version`이 오류로 끝납니다. git이 안 되면 워커가 아무 일도 못 합니다."
        target = f"`git --version` 출력: {line}"
        why = retried or "라이선스 동의와 도구 설치는 관리자 권한이 필요해 자동으로 할 수 없습니다."
        todo = ("터미널에서 `sudo xcodebuild -license accept`를 실행하세요." if lic
                else f"위 출력대로 git을 고치세요. 고친 뒤 `git --version`이 성공하면 됩니다.")
    elif code == "G8":
        names = text.split(" - ", 1)[1] if " - " in text else text
        title = f"티켓 파일이 겹치거나 깨져 있습니다: {names}"
        what = "큐에 같은 티켓이 두 파일로 있거나, 머리말이 없는 티켓 파일이 있어서 워커가 그 티켓을 다루지 못합니다."
        target = "\n".join(f".dira/tickets/{n.strip()}" for n in names.split(","))
        why = retried or "어느 파일이 맞는지 알 수 없어서 지우지 않았습니다. 지우면 티켓 내용이 사라집니다."
        todo = "남길 파일 하나를 고르고 나머지는 `.dira/tickets/` 밖으로 옮기세요."
    else:
        title = f"워커가 멈춘 원인이 있습니다: {text}"
        what = "워커가 멈춘 원인이 감지됐습니다. 아래 진단 원문에 그 내용이 있습니다."
        target = text
        why = retried or "이 문제는 자동으로 고치는 방법이 정해져 있지 않습니다."
        todo = f"`workers/runner.log`에서 `{code}`로 시작하는 줄을 찾아 원인을 확인하세요."
    return title, what, target, why, todo


def parse_line(line):
    """`<코드> <자력|사람> <한 줄>`을 셋으로 가른다."""
    code, who, text = line.split(" ", 2)
    return code, who, text


def needs_alert(code, who, root, just_treated=None):
    """`사람` 줄이면 무조건, `자력` 줄이면 recover 표식이 이미 있을 때만.

    `G3 자력`은 예외다 - `recover`의 처방(`token-rotate.sh exhausted`)은 다음 엔진이 쓸
    토큰을 갈아 둘 뿐이라 이미 살아 있는 쿨다운 파일의 만료를 못 당긴다. 그래서 표식이
    남아 있어도 사람이 칠 것이 없다 (P432-1, `docs/DESIGN.md` §디스패치 감시자 §개정).

    `just_treated`는 이번 tick의 `recover`가 방금 "처방"한 코드 집합이다(P436, 티켓
    `80b66dcb`) - 표식 파일은 recover가 처방하는 그 순간에 쓰이므로, 같은 주기 안에서는
    "방금 고쳤다"와 "예전에 고쳤는데 또 걸렸다"를 파일 존재만으로 못 가른다. 이번 주기에
    처방한 코드는 표식이 있어도 사람을 안 부른다 - recover가 건너뛴(이미 처방했다) 경우만
    표식을 근거로 escalate한다.
    """
    if who == "사람":
        return True
    if code == "G3":
        return False
    if just_treated and code in just_treated:
        return False
    marker = os.path.join(root, "workers", f".watchdog-{code}")
    return os.path.isfile(marker)


def open_ticket_codes(tickets_dir):
    """열린(`.done.md` 아닌) 티켓 중 `watchdog_code:` 프론트매터가 있는 코드 집합."""
    codes = set()
    if not os.path.isdir(tickets_dir):
        return codes
    for name in os.listdir(tickets_dir):
        if not name.endswith(".md") or name.endswith(".done.md"):
            continue
        path = os.path.join(tickets_dir, name)
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                for _ in range(20):
                    line = f.readline()
                    if not line:
                        break
                    line = line.strip()
                    if line.startswith("watchdog_code:"):
                        codes.add(line.split(":", 1)[1].strip())
                        break
        except OSError:
            continue
    return codes


def write_ticket(tickets_dir, code, who, text, d):
    """8자 hex 파일명으로 `tickets/`에 직접 새 파일을 만든다(O_EXCL, 하위 디렉터리 없음)."""
    os.makedirs(tickets_dir, exist_ok=True)
    for _ in range(5):
        h = uuid.uuid4().hex[:8]
        path = os.path.join(tickets_dir, f"{h}.md")
        title, what, target, why, todo = d
        body = TEMPLATE.format(hash=h, code=code, who=who, text=text, title=title,
                               what=what, target=target, why=why, todo=todo)
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            continue
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
        return h
    return None


def notify_real(title, message):
    try:
        subprocess.run(
            ["osascript", "-e",
             f"display notification {json.dumps(message)} with title {json.dumps(title)}"],
            capture_output=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        pass


def alert(root, diagnose_lines=None, notify_fn=notify_real, just_treated=None):
    """사람을 불러야 할 줄마다 알림 + (코드당 하나) 티켓. 새로 낸 해시 목록을 반환한다."""
    if diagnose_lines is None:
        diagnose_lines = _gates.diagnose(root)
    tickets_dir = os.path.join(root, "tickets")
    existing = open_ticket_codes(tickets_dir)
    created = []
    for line in diagnose_lines:
        code, who, text = parse_line(line)
        if not needs_alert(code, who, root, just_treated=just_treated):
            continue
        d = describe(root, code, who, text)
        notify_fn(d[0], d[1])
        if code in existing:
            continue
        h = write_ticket(tickets_dir, code, who, text, d)
        if h:
            created.append(h)
            existing.add(code)
    return created


def main(argv):
    root = argv[1] if len(argv) > 1 else os.getcwd()
    for h in alert(root):
        print(h)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
