"""큐 사본 .dira/self-heal.sh 가 sweep 등록 표지 줄을 dira 줄로 센다 (항목 0007).

엔진 sweep 데몬(P565)은 워커 실행 줄을 `# dira-worker "<경로>"` 표지로 바꾼다.
옛 self-heal.sh 는 주석 줄을 dira 줄로 세지 않아서, 다른 줄을 하나 뺄 때 살아 있는 워커가 남아 있어도
"마지막 dira 줄이 빠졌다"로 보고 keymap.json 을 지웠다. 지운 워커의 표지 줄도 남았다.
이 항목은 두 자리를 apps/teams/lib/workers.ts 의 SELF_HEAL_SH 와 같은 바이트로 바꾼다.
① 표지 줄에서 워커 경로를 읽는다(살아 있으면 센다, 파일이 없으면 뺀다).
② 엔진을 지웠으면 그 엔진의 sweep 기동 줄도 뺀다.
표준 라이브러리만 쓴다.
"""
import os

ID = "0007-self-heal-marker"
DESC = "self-heal.sh가 sweep 등록 표지 줄을 dira 줄로 세고, keymap을 잘못 지우지 않게 한다"
DESC_EN = "Teach self-heal.sh to count sweep registration markers so it never drops keymap.json wrongly"
SCOPE = "project"
ROLLOUT = "all"
REVERSIBLE = True

SED = r'''$(printf '%s\n' "$_dira_l" | sed -n 's|.*"\(/[^"]*/workers/[^"/]*\.sh\)".*|\1|p')'''

OLD1 = "      '#'*) ;;   # 주석은 cron이 실행하지 않는다 = dira 줄이 아니다\n"
NEW1 = ("      # 엔진 sweep 데몬이 실행 줄을 바꿔 둔 등록 표지다 - cron은 안 돌려도 dira 줄로 센다(P565)\n"
        "      '# dira-worker '*) _dira_p=" + SED + " ;;\n" + OLD1)

OLD2 = '      case $_dira_l in *"$0"*) _dira_drop=1 ;; esac\n'
NEW2 = ("      # 지운 엔진의 sweep 기동 줄도 같이 뺀다 - 남기면 cron이 없는 dispatch.py를 1분마다 부른다.\n"
        '      case $_dira_l in *"$0"*|*"${_dira_engine%/tick.sh}/dispatch.py\\" sweep"*) _dira_drop=1 ;; esac\n')


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
    # 사본이 없거나, 이미 바뀌었거나, 그 자리를 손으로 고친 큐는 건드리지 않는다.
    if s is None or NEW1 in s or OLD1 not in s or OLD2 not in s:
        return
    with open(p, "w", encoding="utf-8") as f:
        f.write(s.replace(OLD1, NEW1, 1).replace(OLD2, NEW2, 1))


def verify(ctx):
    s = _read(targets(ctx)[0])
    if s is None or (OLD2 not in s and NEW2 not in s):
        return
    assert NEW1 in s and NEW2 in s, "self-heal.sh에 표지 줄 판정이 없다"
