/** 엔진 MCP 감시 cron 줄 (docs/DESIGN.md P480 §값 표 - cron 줄 · 설치). electron을 만지지 않는 순수 함수라
 *  `mcp-install.test.ts`가 창 없이 분기를 밟는다. 줄 판정은 `mcp/keepalive.sh` 문자열이다. */

export const MCP_MARK = "mcp/keepalive.sh";

export function mcpCronLine(home: string, tick: string): string {
  return `* * * * * "${home}/.config/dira/mcp/keepalive.sh" "${tick}" >> "${home}/.config/dira/run/mcp.log" 2>&1`;
}

/** crontab 본문 -> 새 본문. 줄이 정확히 하나로 이미 맞으면 `null`(쓰지 않는다). 남의 줄은 바이트 그대로다.
 *  ponytail: 주석 줄은 cron이 실행하지 않으니 우리 줄로 안 센다. 둘 이상이면 첫 줄만 남기고 나머지를 뺀다. */
export function mcpCronEdit(tab: string, home: string, tick: string): string | null {
  const want = mcpCronLine(home, tick);
  const lines = tab === "" ? [] : tab.replace(/\n$/, "").split("\n");
  const mine = lines.filter((l) => !l.startsWith("#") && l.includes(MCP_MARK));
  if (mine.length === 1 && mine[0] === want) return null;
  if (mine.length === 0) return [...lines, want].join("\n") + "\n";
  let placed = false;
  const out: string[] = [];
  for (const l of lines) {
    if (l.startsWith("#") || !l.includes(MCP_MARK)) out.push(l);
    else if (!placed) {
      out.push(want);
      placed = true;
    }
  }
  return out.join("\n") + "\n";
}
