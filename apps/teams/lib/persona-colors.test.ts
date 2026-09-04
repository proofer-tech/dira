import { test } from "node:test";
import assert from "node:assert";
import { PERSONA_COLORS } from "./urls.ts";
import { assignPersonaColors } from "./persona-colors.ts";

test("이름 다섯이면 서로 다른 색 다섯이 나온다", () => {
  const names = ["pm", "developer", "qa", "designer", "writer"];
  const colors = assignPersonaColors(names);
  assert.strictEqual(Object.keys(colors).length, 5);
  const values = names.map((n) => colors[n]);
  assert.strictEqual(new Set(values).size, 5);
  for (const v of values) assert.ok((PERSONA_COLORS as readonly string[]).includes(v));
});

test("이름 아홉이면 아홉 개가 다 차고 그중 여덟이 서로 다르다", () => {
  const names = Array.from({ length: 9 }, (_, i) => `p${i}`);
  const colors = assignPersonaColors(names);
  assert.strictEqual(Object.keys(colors).length, 9);
  const values = names.map((n) => colors[n]);
  assert.strictEqual(new Set(values).size, 8);
});

test("같은 이름 하나로 100번 뽑으면 두 종류 이상이 나온다", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const colors = assignPersonaColors(["solo"]);
    seen.add(colors.solo);
  }
  assert.ok(seen.size >= 2);
});
