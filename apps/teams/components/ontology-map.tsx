"use client";

/** 온톨로지 지식 지도 (DESIGN.md P473 결정 1~4, 비주얼 §80). 그래프는 서버가 조립해 내려주고
 *  여기는 좌표 계산(`lib/ontology-graph.ts`의 순수 함수) + SVG 그리기 + 손 조작만 한다.
 *
 *  ponytail: 노드 카드와 간선 이름은 `HoverCard`/`Tooltip` 부품이 아니라 같은 값의 절대 위치 div다 -
 *  노드 283개를 부품 트리거로 감싸면 SVG 안에서 앵커가 안 잡힌다. 부품을 쓰려면 가상 앵커가 필요하다.
 *  ponytail: 시뮬레이션은 숨은 노드까지 전체를 돈다(반발 O(n^2)). 범례를 끄면 좌표는 그대로 두고 가린다. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useT } from "@/components/language-provider";
import { useTrackedRouter } from "@/lib/route-pending";
import { ALPHA_STOP, DRAG_ALPHA, initialLayout, layoutGraph, nextAlpha, stepLayout, type GraphNode, type OntologyGraph, type Point } from "@/lib/ontology-graph";

const PALETTE = ["blue", "orange", "teal", "pink", "yellow", "violet", "green", "sky"];
const MIN_K = 0.25;
const MAX_K = 4;
const FG = "var(--foreground)";
const MUTED = "var(--muted-foreground)";
const BG = "var(--background)";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const radiusOf = (deg: number) => clamp(4 + 2 * Math.sqrt(deg), 4, 16);
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type View = { x: number; y: number; k: number };
type Hover = { kind: "node"; id: number; x: number; y: number } | { kind: "edge"; index: number; x: number; y: number } | null;

/** 노드 견본 - 모양이 종류를 가른다(원 / 모서리 2px 정사각형 / 속이 빈 원). 끄면 빈 윤곽이다. */
function Swatch({ shape, color, size, off }: { shape: "circle" | "square" | "ring"; color: string; size: number; off?: boolean }) {
  const half = size / 2;
  const s = shape === "square" ? half * 1.77 * 0.5 * 2 : 0;
  const outline = { fill: "none", stroke: MUTED, strokeWidth: 1 };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      {shape === "square" ? (
        <rect x={half - s / 2 * 0.9} y={half - s / 2 * 0.9} width={s * 0.9} height={s * 0.9} rx={2} style={off ? outline : { fill: color }} />
      ) : shape === "ring" ? (
        <circle cx={half} cy={half} r={half - 1} style={off ? outline : { fill: BG, stroke: MUTED, strokeWidth: 1.5 }} />
      ) : (
        <circle cx={half} cy={half} r={half - 0.5} style={off ? outline : { fill: color }} />
      )}
    </svg>
  );
}

function LegendItem({
  name,
  meaning,
  count,
  on,
  color,
  sw,
  onToggle,
}: {
  name: string;
  meaning?: string;
  count: number;
  on: boolean;
  color: string;
  sw: "object" | "doc" | "note" | "dash";
  onToggle: () => void;
}) {
  return (
    <Button variant="ghost" size="sm" aria-pressed={on} title={meaning || undefined} onClick={onToggle} className="h-auto w-full justify-start py-1 text-left whitespace-normal">
      <span className="flex w-full min-w-0 flex-col items-start gap-0.5 overflow-hidden">
        <span className="flex w-full items-center gap-2">
          {sw === "dash" ? (
            <svg width={16} height={10} aria-hidden className="shrink-0">
              <line x1={0} y1={5} x2={16} y2={5} style={{ stroke: MUTED, strokeWidth: 1, strokeDasharray: on ? "3 3" : undefined, opacity: on ? 0.8 : 1 }} />
            </svg>
          ) : (
            <Swatch shape={sw === "doc" ? "square" : sw === "note" ? "ring" : "circle"} color={color} size={10} off={!on} />
          )}
          <span className={`text-xs font-medium ${on ? "" : "text-muted-foreground line-through"}`}>{name}</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span>
        </span>
        {meaning ? <span className="line-clamp-1 w-full text-xs break-all text-muted-foreground">{meaning}</span> : null}
      </span>
    </Button>
  );
}

export function OntologyMap({ graph, projectId, sidebarOff }: { graph: OntologyGraph; projectId: string; sidebarOff: boolean }) {
  const t = useT();
  const router = useTrackedRouter();
  const { nodes, edges, flat, legend } = graph;

  const typeColor = useMemo(() => {
    const m = new Map<string, string>();
    legend.types.forEach((ty) => m.set(ty.name, ty.order < PALETTE.length ? `var(--persona-${PALETTE[ty.order]})` : MUTED));
    return m;
  }, [legend.types]);
  const fillOf = (n: GraphNode) => (n.kind === "object" ? (typeColor.get(n.type ?? "") ?? MUTED) : n.kind === "doc" ? FG : MUTED);

  // 범례 상태 - URL에 안 싣는다. 그 밖의 노트만 기본 꺼짐.
  const [off, setOff] = useState<Set<string>>(() => new Set(["note"]));
  const toggle = (key: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const nodeVisible = useCallback(
    (n: GraphNode) => (n.kind === "object" ? !off.has(`type:${n.type}`) : n.kind === "doc" ? !off.has("doc") : n.kind === "note" ? !off.has("note") : true),
    [off],
  );
  const visible = useMemo(() => new Set(nodes.filter(nodeVisible).map((n) => n.id)), [nodes, nodeVisible]);
  const visEdges = useMemo(
    () =>
      edges
        .map((e, index) => ({ e, index }))
        .filter(({ e }) => visible.has(e.source) && visible.has(e.target) && (flat || e.kind !== "mention" || !off.has("mention"))),
    [edges, visible, off, flat],
  );
  const degree = useMemo(() => {
    const d = new Map<number, number>();
    for (const { e } of visEdges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [visEdges]);
  const nbrs = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const { e } of visEdges) {
      (m.get(e.source) ?? m.set(e.source, new Set()).get(e.source)!).add(e.target);
      (m.get(e.target) ?? m.set(e.target, new Set()).get(e.target)!).add(e.source);
    }
    return m;
  }, [visEdges]);

  // 배치 - 화면 밖에서 수렴시킨 뒤 정지 상태로 처음 그린다(모션 예외를 안 연다, §80 (11)).
  const sim = useRef({ pos: [] as Point[], pairs: [] as [number, number][], pinned: new Set<number>(), vel: [] as Point[], alpha: 0, raf: 0, dragging: false });
  const [pos, setPos] = useState<Point[] | null>(null);
  const ready = pos !== null;
  const [, setTick] = useState(0);
  useEffect(() => {
    const pairs = edges.map((e) => [e.source, e.target] as [number, number]);
    const id = setTimeout(() => {
      sim.current.pairs = pairs;
      // 같은 배열을 시뮬레이션이 제자리에서 고친다 - tick이 다시 그리게 한다.
      const laid = nodes.length ? layoutGraph(nodes.length, pairs, { seed: 1 }) : initialLayout(0);
      sim.current.pos = laid;
      sim.current.vel = laid.map(() => ({ x: 0, y: 0 }));
      setPos(laid);
    }, 0);
    return () => clearTimeout(id);
  }, [nodes, edges]);
  useEffect(() => () => cancelAnimationFrame(sim.current.raf), []);

  const startLoop = () => {
    const s = sim.current;
    if (s.raf || reduced()) return;
    const frame = () => {
      // alpha는 식기만 한다 - 끌기 중에는 낮은 목표값을 향하고, 놓으면 0을 향한다(다시 높이지 않는다).
      s.alpha = nextAlpha(s.alpha, s.dragging ? DRAG_ALPHA : 0);
      if (!s.dragging && s.alpha < ALPHA_STOP) {
        s.raf = 0;
        s.pinned.clear();
        return;
      }
      stepLayout(s.pos, s.pairs, s.alpha, s.pinned, s.vel);
      setTick((x) => x + 1);
      s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
  };

  // 화면 맞춤 - 처음 한 번, 안쪽 여백 24px, 0.25~1.5로 자른다.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [userView, setView] = useState<View | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const fit = useMemo<View | null>(() => {
    if (!pos || !size.w || !size.h) return null;
    const pts = pos.filter((_, i) => visible.has(i));
    if (!pts.length) return { x: size.w / 2, y: size.h / 2, k: 1 };
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = clamp(Math.min((size.w - 48) / Math.max(x1 - x0, 1), (size.h - 48) / Math.max(y1 - y0, 1)), MIN_K, 1.5);
    return { x: size.w / 2 - ((x0 + x1) / 2) * k, y: size.h / 2 - ((y0 + y1) / 2) * k, k };
    // 손을 대기 전(userView 없음)에만 쓰인다 - 처음 한 번의 맞춤이라 visible이 바뀌면 다시 맞추지 않게 pos만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, size.w, size.h]);
  const view = userView ?? fit;

  // 휠 확대 - 비수동 리스너여야 페이지 스크롤을 막는다.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      const v = viewRef.current;
      if (!v) return;
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const py = ev.clientY - r.top;
      const k = clamp(v.k * (ev.deltaY < 0 ? 1.2 : 1 / 1.2), MIN_K, MAX_K);
      setView({ k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 포인터 - 노드 끌기 / 바닥 끌기 / 핀치. 끌기를 마친 뒤의 떼기는 이동이 아니다.
  const [hover, setHover] = useState<Hover>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ kind: "node" | "pan"; id: number; sx: number; sy: number; moved: boolean; view: View } | null>(null);
  const pinch = useRef<{ d0: number; w: Point; v0: View } | null>(null);
  const local = (ev: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const goTo = (n: GraphNode) =>
    router.push(`/p/${projectId}/ontology?file=${encodeURIComponent(n.file)}${sidebarOff ? "&sidebar=off" : ""}`);

  const onPointerDown = (ev: React.PointerEvent) => {
    if (!view) return;
    const p = local(ev);
    ptrs.current.set(ev.pointerId, p);
    try {
      box.current!.setPointerCapture(ev.pointerId);
    } catch {
      // 이미 끝난 포인터(합성 이벤트)면 잡을 수 없다 - 캡처 없이도 끌기는 동작한다.
    }
    setHover(null);
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, w: { x: (mid.x - view.x) / view.k, y: (mid.y - view.y) / view.k }, v0: view };
      if (drag.current) drag.current.moved = true;
      return;
    }
    const nodeEl = (ev.target as Element).closest("[data-node]");
    drag.current = {
      kind: nodeEl ? "node" : "pan",
      id: nodeEl ? Number(nodeEl.getAttribute("data-node")) : -1,
      sx: p.x,
      sy: p.y,
      moved: false,
      view,
    };
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const p = local(ev);
    if (ptrs.current.has(ev.pointerId)) ptrs.current.set(ev.pointerId, p);
    if (pinch.current && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = clamp(pinch.current.v0.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d0), MIN_K, MAX_K);
      setView({ k, x: mid.x - pinch.current.w.x * k, y: mid.y - pinch.current.w.y * k });
      return;
    }
    const d = drag.current;
    if (d) {
      if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) < 4) return;
      d.moved = true;
      if (d.kind === "pan") {
        setView({ ...d.view, x: d.view.x + p.x - d.sx, y: d.view.y + p.y - d.sy });
      } else {
        const v = viewRef.current!;
        const s = sim.current;
        s.pos[d.id] = { x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k };
        s.pinned.add(d.id);
        s.dragging = true;
        startLoop();
        setTick((x) => x + 1);
      }
      return;
    }
    const nodeEl = (ev.target as Element).closest("[data-node]");
    const edgeEl = nodeEl ? null : (ev.target as Element).closest("[data-edge]");
    if (nodeEl) setHover({ kind: "node", id: Number(nodeEl.getAttribute("data-node")), x: p.x, y: p.y });
    else if (edgeEl) setHover({ kind: "edge", index: Number(edgeEl.getAttribute("data-edge")), x: p.x, y: p.y });
    else setHover(null);
  };
  const onPointerUp = (ev: React.PointerEvent) => {
    ptrs.current.delete(ev.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    const d = drag.current;
    if (ptrs.current.size > 0 || !d) return;
    drag.current = null;
    const s = sim.current;
    if (d.kind === "node") {
      if (!d.moved) goTo(nodes[d.id]);
      else {
        s.dragging = false;
        if (reduced()) s.pinned.clear();
        else startLoop();
      }
    }
  };

  // 검색
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const matched = useMemo(
    () => (needle ? nodes.filter((n) => visible.has(n.id) && n.label.toLowerCase().includes(needle)) : []),
    [needle, nodes, visible],
  );
  const onEnter = () => {
    const first = [...matched].sort(
      (a, b) =>
        Number(b.label.toLowerCase().startsWith(needle)) - Number(a.label.toLowerCase().startsWith(needle)) ||
        (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
        a.label.localeCompare(b.label),
    )[0];
    if (first) goTo(first);
  };

  // 흐림 집합 - 올리기가 검색보다 이긴다.
  const hoverNode = hover?.kind === "node" ? hover.id : null;
  const lit = useMemo(() => {
    if (hoverNode !== null) return new Set([hoverNode, ...(nbrs.get(hoverNode) ?? [])]);
    if (needle && matched.length) return new Set(matched.map((n) => n.id));
    return null;
  }, [hoverNode, nbrs, needle, matched]);
  const matchedIds = useMemo(() => new Set(matched.map((n) => n.id)), [matched]);

  const k = view?.k ?? 1;
  const shownNodes = nodes.filter((n) => visible.has(n.id));
  const ariaLabel = `${t("ontology.map.ariaPrefix")}${shownNodes.length}${t("ontology.map.ariaMid")}${visEdges.length}${t("ontology.map.ariaSuffix")}`;
  const mentionLabel = t("ontology.map.legend.mention");

  const shape = (n: GraphNode): "circle" | "square" | "ring" => (n.kind === "doc" ? "square" : n.kind === "note" ? "ring" : "circle");
  const meaningOf = (n: GraphNode) =>
    n.kind === "object" ? (legend.types.find((x) => x.name === n.type)?.meaning ?? "") : n.kind === "doc" ? t("ontology.map.legend.docsMeaning") : "";
  const typeNameOf = (n: GraphNode) =>
    n.kind === "object" ? (n.type ?? "") : n.kind === "doc" ? t("ontology.map.legend.docs") : n.kind === "note" ? t("ontology.map.legend.notes") : "";

  const search = (
    <InputGroup className="bg-popover shadow-xs lg:absolute lg:top-3 lg:right-3 lg:z-10 lg:w-56">
      <InputGroupAddon>
        <Search aria-hidden className="size-4" />
      </InputGroupAddon>
      <InputGroupInput
        value={q}
        onChange={(ev) => setQ(ev.target.value)}
        onKeyDown={(ev) => ev.key === "Enter" && !ev.nativeEvent.isComposing && onEnter()}
        placeholder={t("ontology.map.search.placeholder")}
        aria-label={t("ontology.map.search.placeholder")}
      />
      {needle ? (
        <InputGroupAddon align="inline-end">
          <span className="text-xs tabular-nums text-muted-foreground">
            {matched.length ? `${matched.length}${t("ontology.map.search.countSuffix")}` : t("ontology.map.search.none")}
          </span>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );

  const legendPanel = flat ? null : (
    <div className="flex flex-wrap gap-1 rounded-md border bg-popover p-1 shadow-xs lg:absolute lg:top-3 lg:left-3 lg:z-10 lg:max-h-[calc(100%-4.5rem)] lg:w-64 lg:flex-col lg:flex-nowrap lg:gap-0 lg:overflow-y-auto">
      {legend.types.map((ty) => (
        <LegendItem key={ty.name} name={ty.name} meaning={ty.meaning} count={ty.count} on={!off.has(`type:${ty.name}`)} color={typeColor.get(ty.name) ?? MUTED} sw="object" onToggle={() => toggle(`type:${ty.name}`)} />
      ))}
      {legend.docs > 0 && <LegendItem name={t("ontology.map.legend.docs")} meaning={t("ontology.map.legend.docsMeaning")} count={legend.docs} on={!off.has("doc")} color={FG} sw="doc" onToggle={() => toggle("doc")} />}
      <LegendItem name={mentionLabel} count={legend.mentions} on={!off.has("mention")} color={MUTED} sw="dash" onToggle={() => toggle("mention")} />
      {legend.notes > 0 && <LegendItem name={t("ontology.map.legend.notes")} count={legend.notes} on={!off.has("note")} color={MUTED} sw="note" onToggle={() => toggle("note")} />}
    </div>
  );

  const dim = (id: number) => (lit && !lit.has(id) ? "opacity-15" : "");
  const sy = (y: number) => (view ? y * view.k + view.y : 0);

  const hn = hover?.kind === "node" ? nodes[hover.id] : null;
  const he = hover?.kind === "edge" ? edges[hover.index] : null;
  const cardLeft = hover ? (hover.x + 300 > size.w ? hover.x - 300 : hover.x + 14) : 0;

  return (
    <div className="lg:relative lg:h-[max(24rem,calc(100dvh-11.5rem))] lg:overflow-hidden lg:rounded-lg lg:border lg:bg-background">
      <div className="flex flex-col gap-2 pb-2 lg:contents">
        {search}
        {legendPanel}
      </div>
      <div
        ref={box}
        role="img"
        aria-label={ariaLabel}
        className="relative h-[28rem] touch-none overflow-hidden rounded-lg border bg-background select-none lg:h-full lg:rounded-none lg:border-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !drag.current && setHover(null)}
      >
        {!ready || !view ? (
          <p className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">{t("ontology.map.loading")}</p>
        ) : shownNodes.length === 0 ? (
          <p className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-muted-foreground">{t("ontology.map.allOff")}</p>
        ) : (
          <svg width="100%" height="100%" className="block">
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {[...visEdges].sort((a, b) => Number(a.e.kind === "relation") - Number(b.e.kind === "relation")).map(({ e, index }) => {
                const a = pos[e.source];
                const b = pos[e.target];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len = Math.hypot(dx, dy) || 1;
                const ux = dx / len;
                const uy = dy / len;
                const rs = radiusOf(degree.get(e.source) ?? 0);
                const rt = radiusOf(degree.get(e.target) ?? 0);
                const x1 = a.x + ux * rs;
                const y1 = a.y + uy * rs;
                const x2 = b.x - ux * rt;
                const y2 = b.y - uy * rt;
                const rel = e.kind === "relation";
                const d = `M${x1} ${y1}L${x2} ${y2}`;
                const hl = hoverNode !== null && (e.source === hoverNode || e.target === hoverNode);
                const stroke = hl ? FG : MUTED;
                const w = (rel ? 1.5 : 1) + (hl ? 0.5 : 0);
                return (
                  <g key={index} className={`transition-opacity duration-100 ease-out motion-reduce:transition-none ${lit && !hl ? "opacity-15" : ""}`}>
                    <path d={d} fill="none" vectorEffect="non-scaling-stroke" style={{ stroke, strokeWidth: w, strokeDasharray: rel || flat ? undefined : "3 3", opacity: rel || flat ? 1 : 0.8 }} />
                    {rel && e.directed && len > rs + rt + 6 / k && (
                      <polygon
                        points={`${x2},${y2} ${x2 - ux * (6 / k) - uy * (2.5 / k)},${y2 - uy * (6 / k) + ux * (2.5 / k)} ${x2 - ux * (6 / k) + uy * (2.5 / k)},${y2 - uy * (6 / k) - ux * (2.5 / k)}`}
                        style={{ fill: stroke }}
                      />
                    )}
                    <path d={d} data-edge={index} fill="none" vectorEffect="non-scaling-stroke" style={{ stroke: "transparent", strokeWidth: 8, pointerEvents: "stroke" }} />
                  </g>
                );
              })}
              {shownNodes.map((n) => {
                const p = pos[n.id];
                const r = radiusOf(degree.get(n.id) ?? 0);
                const showLabel = r * k >= 7 || lit?.has(n.id) || matchedIds.has(n.id);
                const label = n.label.length > 20 ? `${n.label.slice(0, 20)}…` : n.label;
                const side = r * 1.77;
                return (
                  <g key={n.id} data-node={n.id} className={`cursor-pointer transition-opacity duration-100 ease-out motion-reduce:transition-none ${dim(n.id)}`}>
                    {matchedIds.has(n.id) && <circle cx={p.x} cy={p.y} r={r + 2 + 2 / k} fill="none" style={{ stroke: "var(--ring)", strokeWidth: 2 / k }} />}
                    {n.kind === "doc" ? (
                      <rect x={p.x - side / 2} y={p.y - side / 2} width={side} height={side} rx={2 / k} style={{ fill: FG, stroke: BG, strokeWidth: 1 / k }} />
                    ) : n.kind === "note" ? (
                      <circle cx={p.x} cy={p.y} r={r} style={{ fill: BG, stroke: MUTED, strokeWidth: 1.5 / k }} />
                    ) : (
                      <circle cx={p.x} cy={p.y} r={r} style={{ fill: flat ? MUTED : fillOf(n), stroke: BG, strokeWidth: 1 / k }} />
                    )}
                    {showLabel && (
                      <text
                        x={p.x}
                        y={p.y + (n.kind === "doc" ? side / 2 : r) + 4 / k + 10 / k}
                        textAnchor="middle"
                        fontSize={12 / k}
                        style={{ fill: FG, stroke: BG, strokeWidth: 3 / k, paintOrder: "stroke" }}
                        pointerEvents="none"
                      >
                        {label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {hn && hover && view && (
          <div
            className="pointer-events-none absolute z-20 w-72 space-y-1.5 rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10"
            style={{ left: cardLeft, top: clamp(sy((pos?.[hn.id]?.y) ?? 0) - 12, 4, Math.max(4, size.h - 160)) }}
          >
            <p className="text-sm font-medium break-words">{hn.label}</p>
            {!flat && (
              <p className="text-xs">
                <span className="mr-1.5 inline-block align-middle">
                  <Swatch shape={shape(hn)} color={fillOf(hn)} size={10} />
                </span>
                <span>{typeNameOf(hn)}</span>{" "}
                {meaningOf(hn) ? <span className="text-muted-foreground">- {meaningOf(hn)}</span> : null}
              </p>
            )}
            {hn.description ? <p className="line-clamp-3 text-xs text-muted-foreground">{hn.description}</p> : null}
            <p className="text-xs tabular-nums text-muted-foreground">
              {flat
                ? `${mentionLabel} ${degree.get(hn.id) ?? 0}`
                : `${t("ontology.map.card.relations")} ${hn.relationCount} - ${mentionLabel} ${(degree.get(hn.id) ?? 0) - hn.relationCount}`}
            </p>
          </div>
        )}
        {he && hover && (
          <div
            className="pointer-events-none absolute z-20 max-w-64 rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10"
            style={{ left: Math.min(hover.x + 12, Math.max(4, size.w - 260)), top: hover.y + 12 }}
          >
            {he.kind === "relation" ? (
              <>
                <p className="font-medium">{he.relation}</p>
                {legend.relations.find((r) => r.name === he.relation)?.meaning ? (
                  <p className="line-clamp-3 text-muted-foreground">{legend.relations.find((r) => r.name === he.relation)?.meaning}</p>
                ) : null}
              </>
            ) : (
              <p>{mentionLabel}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
