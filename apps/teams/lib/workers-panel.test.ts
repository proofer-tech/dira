import { test } from "node:test";
import assert from "node:assert";
import {
  buildWorkersPanel,
  filteredGroups,
  filteredPool,
  POOL_PROJECT_VALUE,
  type WorkersPanelProject,
  type WorkersPanelView,
} from "./workers-panel.ts";
import type { Worker, WorkerStatus } from "./workers.ts";

/** 최소 픽스처 — 이 모듈이 실제로 보는 필드(`status`·`pool`)만 채우면 되지만, 타입은 `Worker`
 *  전체를 요구하므로 나머지는 무해한 기본값이다. */
function mkWorker(name: string, status: WorkerStatus, pool = false): Worker {
  return {
    name,
    effName: name,
    path: `/root/workers/${name}.sh`,
    status,
    cron: status === "idle" || status === "running",
    lockPid: null,
    holding: null,
    engine: null,
    recentLog: [],
    lastFailure: null,
    context: { ok: true, items: [] },
    commonSource: true,
    selfHealSource: true,
    dispatchGateSource: true,
    dispatchGateStale: false,
    cwd: null,
    defects: [],
    pool,
  };
}

function mkProject(id: string, workers: Worker[], connected = true, error: string | null = null): WorkersPanelProject {
  return { id, name: id, connected, error, workers };
}

test("buildWorkersPanel — borrowedBy는 pool-limit >= 1인 프로젝트 수다(§4-16 결정 3)", () => {
  const view = buildWorkersPanel(
    [
      { name: "pool-1", status: "idle" },
      { name: "pool-2", status: "running" },
    ],
    [mkProject("a", []), mkProject("b", [])],
    [3, 0], // a는 상한 3(빌린다), b는 0(안 빌린다)
  );
  assert.strictEqual(view.pool.length, 2);
  assert.ok(view.pool.every((p) => p.borrowedBy === 1));
  assert.strictEqual(view.pool[0].status, "idle");
  assert.strictEqual(view.pool[1].status, "running");
});

test("filteredPool — 종류=project면 0건, 프로젝트=dira 하나만 골라도 0건(§비주얼 §68 ⑩)", () => {
  const view: WorkersPanelView = {
    pool: [
      { name: "pool-1", status: "running", borrowedBy: 2 },
      { name: "pool-2", status: "idle", borrowedBy: 0 },
    ],
    projects: [],
  };
  assert.strictEqual(filteredPool(view, { project: [], kind: [], status: [] }).length, 2);
  assert.deepStrictEqual(filteredPool(view, { project: [], kind: ["project"], status: [] }), []);
  assert.deepStrictEqual(filteredPool(view, { project: ["dira"], kind: [], status: [] }), []);
  assert.strictEqual(
    filteredPool(view, { project: [POOL_PROJECT_VALUE], kind: [], status: [] }).length,
    2,
  );
  const idleOnly = filteredPool(view, { project: [], kind: [], status: ["idle"] });
  assert.deepStrictEqual(idleOnly.map((p) => p.name), ["pool-2"]);
});

test("filteredGroups — 상태 필터로 프로젝트가 0건이 되면 그 묶음을 통째로 뺀다", () => {
  const view: WorkersPanelView = {
    pool: [],
    projects: [
      mkProject("dira", [mkWorker("w1", "running"), mkWorker("w2", "idle")]),
      mkProject("stream", [mkWorker("s1", "stopped")]),
    ],
  };
  const stale = filteredGroups(view, { project: [], kind: [], status: ["stale"] });
  assert.deepStrictEqual(stale, []); // 아무도 stale이 아니라 두 묶음 다 사라진다

  const idle = filteredGroups(view, { project: [], kind: [], status: ["idle"] });
  assert.strictEqual(idle.length, 1);
  assert.strictEqual(idle[0].id, "dira");
  assert.deepStrictEqual(idle[0].workers.map((w) => w.name), ["w2"]);
});

test("filteredGroups — 연결 안 된 프로젝트는 필터로도 안 빠진다(§4-16 결정 5)", () => {
  const view: WorkersPanelView = {
    pool: [],
    projects: [
      mkProject("dira", [mkWorker("w1", "running")]),
      mkProject("archive", [], false, "ENOENT: no such file"),
    ],
  };
  const running = filteredGroups(view, { project: [], kind: [], status: ["running"] });
  assert.strictEqual(running.length, 2);
  const archive = running.find((p) => p.id === "archive")!;
  assert.strictEqual(archive.connected, false);
  assert.strictEqual(archive.error, "ENOENT: no such file");
  assert.deepStrictEqual(archive.workers, []);
});

test("filteredGroups — 종류=공통은 shim 행만, 상태=idle은 shim 행이 하나도 안 남는다(§비주얼 §68 ⑤)", () => {
  const view: WorkersPanelView = {
    pool: [],
    projects: [
      mkProject("dira", [
        mkWorker("w1", "running"),
        mkWorker("w2", "idle"),
        mkWorker("pool-1", "running", true),
        mkWorker("pool-2", "stopped", true), // shim은 cron 줄이 없어 idle이 될 수 없다
      ]),
    ],
  };
  const poolKind = filteredGroups(view, { project: [], kind: ["pool"], status: [] });
  assert.deepStrictEqual(poolKind[0].workers.map((w) => w.name), ["pool-1", "pool-2"]);

  const idleStatus = filteredGroups(view, { project: [], kind: [], status: ["idle"] });
  assert.deepStrictEqual(idleStatus[0].workers.map((w) => w.name), ["w2"]); // shim 0개
});

test("행 총합 — §4-16 §수용조건 (12): 전체 목록 + 공통 워커 수 = 필터 없는 패널의 행 총수", () => {
  const view: WorkersPanelView = {
    pool: [
      { name: "pool-1", status: "running", borrowedBy: 1 },
      { name: "pool-2", status: "idle", borrowedBy: 0 },
    ],
    projects: [
      mkProject("dira", [mkWorker("w1", "running"), mkWorker("w2", "idle"), mkWorker("pool-1", "running", true)]),
      mkProject("stream", [mkWorker("s1", "stopped")]),
    ],
  };
  const filters = { project: [], kind: [], status: [] };
  const total = filteredPool(view, filters).length + filteredGroups(view, filters).reduce((n, p) => n + p.workers.length, 0);
  const expected = view.pool.length + view.projects.reduce((n, p) => n + p.workers.length, 0);
  assert.strictEqual(total, expected);
  assert.strictEqual(total, 2 + 4);
});
