/** `mcp-install.ts` - crontab 본문 계산. */
import assert from "node:assert/strict";
import test from "node:test";
import { mcpCronEdit, mcpCronLine } from "./mcp-install.ts";

const H = "/Users/a";
const T = "/e/tick.sh";
const want = mcpCronLine(H, T);
const other = `# 메모\n\n*/5 * * * * "/x/workers/w1.sh"\n0 3 * * * echo  '남의   줄'\n`;

test("줄이 없으면 끝에 하나 더하고 남의 줄은 그대로다", () => {
  assert.equal(mcpCronEdit(other, H, T), other + want + "\n");
  assert.equal(mcpCronEdit("", H, T), want + "\n");
});

test("같으면 null, 인자가 다르면 그 줄만 바뀐다", () => {
  assert.equal(mcpCronEdit(other + want + "\n", H, T), null);
  const old = mcpCronLine(H, "/old/tick.sh");
  assert.equal(mcpCronEdit(other + old + "\n" + "9 9 * * * z\n", H, T), other + want + "\n" + "9 9 * * * z\n");
});

test("줄이 둘이면 하나로 줄이고 주석 줄은 우리 줄이 아니다", () => {
  const old = mcpCronLine(H, "/old/tick.sh");
  assert.equal(mcpCronEdit(`${old}\n${old}\n`, H, T), want + "\n");
  const c = `# ${old}\n`;
  assert.equal(mcpCronEdit(c, H, T), c + want + "\n");
});
