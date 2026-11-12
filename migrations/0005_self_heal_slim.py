"""큐 사본 .dira/self-heal.sh 에 슬림 체크아웃 블록을 끼운다 (항목 0005).

슬림이 엔진이 든 레포(도그푸딩 큐처럼 워커가 <레포>/tick.sh 를 source 하는 큐)를 비우면 tick.sh 가
작업 트리에서 빠진다. 옛 self-heal.sh 는 그것을 엔진 삭제로 보고 워커 cron 줄을 지워, 사람이
요청을 올려도 큐가 다시 돌지 않았다(2026-11-11 21:33 실측). 블록은 apps/teams/lib/workers.ts 의
SELF_HEAL_SLIM 과 같은 바이트다 - workers.test.ts 가 둘이 같은지 본다. 표준 라이브러리만 쓴다.
"""
import os

ID = "0005-self-heal-slim"
DESC = "self-heal.sh가 슬림으로 비운 엔진 레포를 엔진 삭제로 보지 않게 한다"
DESC_EN = "Teach self-heal.sh that a slim-emptied engine repo is not a removed engine"
SCOPE = "project"
ROLLOUT = "all"
REVERSIBLE = True

ANCHOR = 'if [ -n "$_dira_engine" ] && [ ! -f "$_dira_engine" ]; then _dira_gone=1; else _dira_gone=0; fi\n'
BLOCK = r'''# 슬림 체크아웃(P519)이 엔진이 든 레포를 비운 것이면 지운 것이 아니다 - cron 줄을 남긴다.
# 사람이 올린 열린 티켓이 있으면 레포를 다시 채워 이 tick을 잇고, 없으면 이번 tick만 쉰다.
# 채운 시각을 slim-checkout.active에 남겨 tick.sh의 slim.py auto가 곧바로 다시 비우지 않게 한다.
# ponytail: 열린 티켓 = 접미사 없는 tickets/*.md다. 답변 대기 티켓도 채움을 부른다(채운 채로 두는 쪽으로 틀린다).
if [ "$_dira_gone" = 1 ]; then
  _dira_repo=$(dirname "$_dira_engine")
  if [ "$(git -C "$_dira_repo" sparse-checkout list 2>/dev/null)" = "/.dira-slim-empty" ]; then
    _dira_gone=0
    _dira_q=$(dirname "$(dirname "$0")")
    if ls "$_dira_q/tickets" 2>/dev/null | grep '\.md$' | grep -qv '\.\(wip\|done\)\.md$'; then
      git -C "$_dira_repo" sparse-checkout disable >/dev/null 2>&1 && touch "$_dira_q/slim-checkout.active"
    fi
    [ -f "$_dira_engine" ] || exit 0
  fi
fi'''


def targets(ctx):
    return [os.path.join(ctx.root, "self-heal.sh")]


def _read(p):
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return None


def apply(ctx):
    p = targets(ctx)[0]
    s = _read(p)
    # 사본이 없거나 판정 줄을 손으로 바꾼 큐는 건드리지 않는다.
    if s is None or BLOCK in s or ANCHOR not in s:
        return
    with open(p, "w", encoding="utf-8") as f:
        f.write(s.replace(ANCHOR, ANCHOR + BLOCK + "\n", 1))


def verify(ctx):
    s = _read(targets(ctx)[0])
    if s is None or ANCHOR not in s:
        return
    assert BLOCK in s, "self-heal.sh에 슬림 블록이 없다"
