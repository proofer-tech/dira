// 그래프가 바뀐 첫 렌더에 옛 좌표 배열(길이 0)로 새 노드를 그리다 죽던 문제(2152353f)의 회귀 검증.
// DOM은 jsdom, .tsx 변환은 test-tsx-hooks.mjs가 맡는다.
import { strict as assert } from "node:assert";
import { register } from "node:module";
import test from "node:test";
// @ts-expect-error jsdom은 타입 선언이 없다(@types 안 깐다)
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id=root></div>", { pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const k of ["window", "document", "HTMLElement", "Node", "navigator"]) {
  Object.defineProperty(g, k, { value: (dom.window as unknown as Record<string, unknown>)[k === "window" ? "window" : k], configurable: true });
}
g.IS_REACT_ACT_ENVIRONMENT = true;
g.cancelAnimationFrame = () => {};
g.requestAnimationFrame = () => 0;
g.ResizeObserver = class { observe() {} disconnect() {} };
Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { value: 800 });
Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", { value: 600 });
register("./test-tsx-hooks.mjs", import.meta.url);

test("노드 0개 그래프에서 노드 있는 그래프로 rerender해도 죽지 않고 새 노드를 그린다", async () => {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { OntologyMap } = await import("../components/ontology-map.tsx");
  const mk = (n: number) => ({
    flat: false,
    legend: { types: n ? [{ name: "x", meaning: "", count: n, order: 0 }] : [], relations: [], docs: 0, notes: 0, mentions: 0 },
    nodes: Array.from({ length: n }, (_, id) => ({ id, kind: "object", type: "x", file: `n${id}.md`, label: `n${id}`, degree: 0 })),
    edges: n > 1 ? [{ source: 0, target: 1, kind: "relation", directed: true }] : [],
  });
  const el = (graph: unknown) => createElement(OntologyMap as never, { graph, projectId: "p", sidebarOff: false });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  await act(async () => root.render(el(mk(0))));
  await wait();
  await act(async () => root.render(el(mk(3))));
  await wait();
  assert.equal(dom.window.document.querySelectorAll("[data-node]").length, 3);
  await act(async () => root.unmount());
});
