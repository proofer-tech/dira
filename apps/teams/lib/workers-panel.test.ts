import { test } from "node:test";
import assert from "node:assert";
import {
  buildWorkersPanel,
  EMPTY_SESSION_CAP,
  filteredGroups,
  type WorkersPanelProject,
  type WorkersPanelView,
} from "./workers-panel.ts";
import type { Worker, WorkerStatus } from "./workers.ts";

/** 최소 픽스처 — 이 모듈이 실제로 보는 필드(`status`)만 채우면 되지만, 타입은 `Worker`
 *  전체를 요구하므로 나머지는 무해한 기본값이다. */
function mkWorker(name: string, status: WorkerStatus): Worker {
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
  };
}

function mkProject(id: string, workers: Worker[], connected = true, error: string | null = null): WorkersPanelProject {
  return { id, name: id, connected, error, workers };
}

test("buildWorkersPanel — 읽은 값을 그대로 담는다", () => {
  const view = buildWorkersPanel([mkProject("a", []), mkProject("b", [])]);
  assert.strictEqual(view.projects.length, 2);
  assert.deepStrictEqual(view.sessionCap, EMPTY_SESSION_CAP);
});

test("filteredGroups — 상태 필터로 프로젝트가 0건이 되면 그 묶음을 통째로 뺀다", () => {
  const view: WorkersPanelView = {
    projects: [
      mkProject("dira", [mkWorker("w1", "running"), mkWorker("w2", "idle")]),
      mkProject("stream", [mkWorker("s1", "stopped")]),
    ],
    sessionCap: EMPTY_SESSION_CAP,
  };
  const stale = filteredGroups(view, { project: [], status: ["stale"] });
  assert.deepStrictEqual(stale, []); // 아무도 stale이 아니라 두 묶음 다 사라진다

  const idle = filteredGroups(view, { project: [], status: ["idle"] });
  assert.strictEqual(idle.length, 1);
  assert.strictEqual(idle[0].id, "dira");
  assert.deepStrictEqual(idle[0].workers.map((w) => w.name), ["w2"]);
});

test("filteredGroups — 연결 안 된 프로젝트는 필터로도 안 빠진다(§4-16 결정 5)", () => {
  const view: WorkersPanelView = {
    projects: [
      mkProject("dira", [mkWorker("w1", "running")]),
      mkProject("archive", [], false, "ENOENT: no such file"),
    ],
    sessionCap: EMPTY_SESSION_CAP,
  };
  const running = filteredGroups(view, { project: [], status: ["running"] });
  assert.strictEqual(running.length, 2);
  const archive = running.find((p) => p.id === "archive")!;
  assert.strictEqual(archive.connected, false);
  assert.strictEqual(archive.error, "ENOENT: no such file");
  assert.deepStrictEqual(archive.workers, []);
});
