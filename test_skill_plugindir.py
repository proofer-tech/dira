#!/usr/bin/env python3
"""P461-skill-plugindir 자체검증: skills.md에 적힌 스킬이 실제로 Skill 도구로 불리는가
(d6a0fea9, TC 430a41e7).

`test_skills.py`는 `tick.sh dryrun`의 프롬프트 텍스트(스킬 블록이 "보이는가")만 본다 -
`--setting-sources project,local`이 ~/.claude/skills를 끊은 뒤로 그 텍스트는 있어도 Skill
도구 호출이 "Unknown skill"로 죽는 결함을 못 잡는다. 이 테스트는 실제 Skill 도구 호출 성공
여부 대신(진짜 claude를 부르지 않는다 - DESIGN.md §제약 1, 도그푸딩 금지) `tick.sh`가 claude
엔진에 `--plugin-dir`로 건네는 디렉터리의 실체(매니페스트 + skills/<이름> 심링크)가 Skill
도구가 실제로 찾아내는 모양과 같은지를 판정한다 - 그 모양은 실제 claude 세션으로 수동
확인했다(`## 결과` 참고). 임시 큐에서만 돈다. 실패하면 assert로 죽는다.
"""
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/claude" "{{sid}}")
. "{tick}"
"""

# 가짜 claude: argv에서 --plugin-dir 다음 값을 잡아 그 디렉터리의 실체(매니페스트 + skills/
# 아래 목록)를 probe.log에 적은 뒤 성공 result를 낸다. tick.sh가 이 가짜가 끝나길 기다렸다가
# PLUGDIR을 지우므로(§완료 정리), 지우기 전인 지금 들여다봐야 한다.
ENGINE = """\
#!/bin/bash
PLUG=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--plugin-dir" ]; then PLUG="$a"; fi
  prev="$a"
done
{{
  echo "PLUG=$PLUG"
  if [ -n "$PLUG" ]; then
    echo "MANIFEST=$(cat "$PLUG/.claude-plugin/plugin.json" 2>/dev/null)"
    echo "ENTRIES=$(ls "$PLUG/skills" 2>/dev/null | sort | tr '\\n' ',')"
  fi
}} >> "{tmp}/probe.log"
printf '{{"session_id":"%s","type":"result","is_error":false,"subtype":"success"}}\\n' "$1"
exit 0
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    skillhome = os.path.join(tmp, "skillhome")
    probelog = os.path.join(tmp, "probe.log")
    os.makedirs(local)

    # 실제 ~/.claude/skills를 흉내낸 가짜 스킬 디렉터리 셋 - a·b는 skills.md에 실리고,
    # c는 디스크에는 있지만 skills.md에는 없다(격리 확인용).
    for name in ("skill-a", "skill-b", "skill-c"):
        mkfile(os.path.join(skillhome, name, "SKILL.md"), "---\nname: {}\n---\n내용\n".format(name))

    mkfile(os.path.join(root, "personas", "dev", "PROFILE.md"), "# Dev\n마커\n")
    mkfile(os.path.join(root, "personas", "dev", "skills.md"),
           "## 스킬\n\n- `skill-a` - 디스크에 있고 목록에도 있다\n"
           "- `skill-b` - 디스크에 있고 목록에도 있다 (gstack)\n"
           "- `skill-missing` - 목록엔 있지만 디스크엔 없다\n")

    mkfile(os.path.join(tmp, "claude"), ENGINE.format(tmp=tmp), 0o755)
    w1 = mkfile(os.path.join(root, "workers", "w1.sh"), WORKER.format(tmp=tmp, tick=TICK), 0o755)
    mkfile(os.path.join(local, "oauth-token"), "tok")

    mkfile(os.path.join(root, "tickets", "7a1b2c3d.md"),
           "---\nticket: 7a1b2c3d\ntitle: t\nkind: work\npersona: dev\n---\n\n## Goal\ntest\n")

    env = dict(os.environ, TICKET_LOCAL=local, TICKET_SKILLS_HOME=skillhome)
    r = subprocess.run([w1, "tick"], capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0, "tick rc={}\n{}".format(r.returncode, r.stderr)

    with open(probelog, encoding="utf-8") as f:
        probe = f.read()
    assert "PLUG=" in probe and "PLUG=\n" not in probe, "--plugin-dir가 argv에 안 실렸다\n" + probe
    assert '"name":"dev-skills"' in probe, "플러그인 매니페스트가 없거나 이름이 틀렸다\n" + probe
    assert "ENTRIES=skill-a,skill-b," in probe, \
        "skills/ 아래 심링크 목록이 기대와 다르다(skill-a·skill-b만 있어야 한다)\n" + probe
    assert "skill-c" not in probe, "skills.md에 없는 skill-c가 plugin-dir에 샜다\n" + probe
    assert "skill-missing" not in probe, "디스크에 없는 skill-missing이 plugin-dir에 실렸다\n" + probe

    # 완료 뒤 PLUGDIR 자체는 정리된다(파일 실체 증거는 위 probe.log에 이미 남았다).
    plug_path = probe.split("PLUG=", 1)[1].splitlines()[0]
    assert plug_path and not os.path.isdir(plug_path), "세션 끝난 뒤 plugin-dir이 안 지워졌다: " + plug_path

    print("PASS skill plugin-dir 실체(매니페스트+심링크)가 skills.md와 일치하고 세션 뒤 정리된다")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
