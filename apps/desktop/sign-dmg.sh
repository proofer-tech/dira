#!/bin/sh
# electron-builder는 `.app`만 서명·공증한다. 사람에게 건네는 건 `.dmg`라서, dmg가 서명도 공증도
# 안 된 채로 나가면 받는 맥에서 첫 더블클릭이 Gatekeeper에 막힌다 (안의 앱이 스테이플돼 있어도
# 디스크 이미지 자체가 따로 심사된다 — `spctl -a -t open`으로 실측).
#
# 준비물이 없으면 그냥 넘어간다 — `sign-preflight.sh`가 빌드 앞에서 이미 무엇이 없는지 찍었다.
# 여기서 다시 설명하지 않는다. 절대 빌드를 실패시키지 않는다는 것도 preflight와 같다.
set -u

dmg=$(ls dist/*.dmg 2>/dev/null | head -1)
[ -n "$dmg" ] || exit 0

id=$(security find-identity -v -p codesigning 2>/dev/null | grep '"Developer ID Application' \
     | head -1 | sed 's/.*"\(.*\)"/\1/')
[ -n "$id" ] || { echo "dmg 서명 건너뜀 — 인증서를 못 찾는다 (위 preflight 참고)."; exit 0; }

codesign -s "$id" --timestamp -f "$dmg" || exit 1

for v in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "dmg 공증 건너뜀 — $v 가 비어 있다. 서명만 된 dmg가 나간다."; exit 0; }
done

# notarytool submit --wait는 status: Invalid로 끝난 제출에도 종료코드 0을 낸다 (R4 §공증
# 판정, 실측 2026-08-18 제출 00131cb0-91f4-47b8-a732-1a2fbf61adbe) - 그래서 종료코드가 아니라
# --output-format json이 돌려주는 status 필드를 읽어서 판정한다 (notarytool info는 추가
# 왕복이 필요해서 --wait의 결과를 그대로 쓰는 이 쪽이 더 짧다).
submit_out=$(xcrun notarytool submit "$dmg" --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" \
  --wait --output-format json) || exit 1
submit_id=$(printf '%s\n' "$submit_out" | sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' | head -1)
submit_status=$(printf '%s\n' "$submit_out" | sed -n 's/.*"status" *: *"\([^"]*\)".*/\1/p' | head -1)
if [ "$submit_status" != "Accepted" ]; then
  xcrun notarytool log "$submit_id" --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID"
  exit 1
fi
xcrun stapler staple "$dmg"
