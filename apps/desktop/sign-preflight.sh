#!/bin/sh
# 서명·공증 준비물이 있는지 보고 없으면 무엇이 없어서 건너뛰는지 찍는다.
# 절대 실패하지 않는다 — 준비물이 없으면 서명 없는 빌드로 그냥 간다 (DESIGN.md §배포).
# `pnpm dist`가 앞에 부르고, 사람이 자기 설정을 확인할 때 단독으로도 돌린다.
#
# 시크릿은 이 레포에 없다. 값은 전부 환경변수로만 들어온다.
set -u

ok=1

id=$(security find-identity -v -p codesigning 2>/dev/null | grep '"Developer ID Application' | head -1)
if [ -n "$id" ]; then
  echo "서명: $(printf '%s' "$id" | sed 's/^ *[0-9]*) //')"
else
  echo "서명 건너뜀 — 키체인에 'Developer ID Application' 인증서가 없다."
  echo "         Apple Developer 계정으로 발급해 로그인 키체인에 설치하면 잡힌다."
  ok=0
fi

missing=""
for v in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || missing="$missing $v"
done
if [ -z "$missing" ]; then
  echo "공증: notarytool ($APPLE_ID / 팀 $APPLE_TEAM_ID)"
else
  echo "공증 건너뜀 — 비어 있는 환경변수:$missing"
  ok=0
fi

[ "$ok" = 1 ] || echo "→ 서명 없는 .app이 나온다. 이 맥에서는 돌지만 다른 맥에서는 Gatekeeper가 막는다."
exit 0
