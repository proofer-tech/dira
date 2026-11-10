import assert from "node:assert";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writePackagedOps } from "./ops-json.ts";

test("ops.json - 설치본 형식(version 1, Electron argv, ELECTRON_RUN_AS_NODE)으로 쓰고 임시 파일을 남기지 않는다", () => {
  const t = path.join(mkdtempSync(path.join(tmpdir(), "ops-")), "nested");
  const f = writePackagedOps(t, "/A.app/Contents/MacOS/dira", "/A.app/Contents/Resources");
  assert.strictEqual(f, path.join(t, "ops.json"));
  assert.deepStrictEqual(JSON.parse(readFileSync(f, "utf8")), {
    version: 1,
    argv: ["/A.app/Contents/MacOS/dira", "/A.app/Contents/Resources/server/lib/ops/cli.ts"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  });
  assert.deepStrictEqual(readdirSync(t), ["ops.json"]);
  writePackagedOps(t, "/B", "/R"); // 덮어쓴다
  assert.strictEqual(JSON.parse(readFileSync(f, "utf8")).argv[0], "/B");
});
