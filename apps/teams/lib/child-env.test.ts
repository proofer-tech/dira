import { test } from "node:test";
import assert from "node:assert";
import { childEnv } from "./child-env.ts";

test("앱 서버 변수는 거르고 PATH HOME TERM은 남긴다", () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "production", __NEXT_PRIVATE_STANDALONE_CONFIG: "x", TURBOPACK: "1",
    ELECTRON_RUN_AS_NODE: "1", DIRA_ENV_BRIDGE_SECRET: "s", PATH: "/a", HOME: "/h",
  });
  try {
    const e = childEnv({ TERM: "xterm-256color" });
    for (const k of ["NODE_ENV", "__NEXT_PRIVATE_STANDALONE_CONFIG", "TURBOPACK", "ELECTRON_RUN_AS_NODE", "DIRA_ENV_BRIDGE_SECRET"])
      assert.equal(e[k], undefined, k);
    assert.equal(e.PATH, "/a");
    assert.equal(e.HOME, "/h");
    assert.equal(e.TERM, "xterm-256color");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
