/**
 * 静的サイトの表示層。DOM と SVG に触るのはこのファイルだけ。
 *
 * 計算は `site_logic.ts` の純関数に任せ、ここは「受け取った値を貼る」「イベントを
 * 繋ぐ」に徹する。esbuild が依存モジュールと bundle し、`site.py` は生成物を HTML に埋め込む。
 */

import type { PanZoomController } from "./site_graph_view.ts";
import {
  applyGraphTheme,
  createGraphViewPrimitives,
  createPanZoom,
  POLYGON_SHAPES,
} from "./site_graph_view.ts";
import type { TableRow } from "./site_table.ts";
import type {
  Direction,
  ExternalReference,
  Finding,
  GraphBandElement,
  GraphEdgeElement,
  GraphElementDefinition,
  GraphNodeElement,
  NodeId,
  Point,
  Severity,
  SiteData,
  ViewMode,
  ViewState,
} from "./site_types.ts";

interface PageElement extends HTMLElement {
  value: string;
  checked: boolean;
  disabled: boolean;
  min: string;
  max: string;
  step: string;
  select(): void;
}
const getElement = (id: string): PageElement => document.getElementById(id) as PageElement;
/**
 * テンプレートに必ずある要素を引く。無ければテンプレートと JS の食い違いなので、
 * 後段で黙って壊れないよう、その場で例外にする。
 */
function requireElement<T extends Element>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`テンプレートに要素が無い: ${selector}`);
  return found;
}
/**
 * セレクタで存在を確かめた `data-*` 属性を読む。name は dataset の鍵 (camelCase)。
 * 無ければセレクタと読み出しの食い違いなので例外にする。
 */
function dataValue(element: HTMLElement, name: string): string {
  const value = element.dataset[name];
  if (value === undefined) throw new Error(`data 属性が無い: ${name}`);
  return value;
}
const queryElements = (selector: string): NodeListOf<PageElement> =>
  document.querySelectorAll<HTMLElement>(selector) as NodeListOf<PageElement>;

import {
  ALL_SEVERITIES,
  ANALYSIS_BANDS,
  analysisBandLayout,
  bandDefs,
  bandedLayout,
  bandId,
  createView,
  decodeHash,
  edgeControl,
  edgeItems,
  encodeHash,
  estimateTextWidth,
  explainCommand,
  FOCUS_DEPTHS,
  fieldLabel,
  focusedNodes,
  focusTrail,
  graphElements,
  groupFindings,
  IMPACT_DEPTHS,
  impactSets,
  initialHash,
  isBandElement,
  isEdgeElement,
  isNodeElement,
  LABEL_FONT,
  layoutOptions,
  legendGroups,
  matchesQuery,
  mermaidText,
  nextSort,
  nextTheme,
  nodeContext,
  normalizeTheme,
  parseFocus,
  quadraticPath,
  quadraticPoint,
  safeHref,
  searchHits,
  selectNodeState,
  severityTabs,
  sortRows,
  sourceUrl,
  statusFilters,
  stepHit,
  storableHash,
  TABLE_COLUMNS,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  tableRows,
  truncate,
  VIEW_STORAGE_KEY,
  visibleBandKeys,
} from "./site_logic.ts";

const dagre = window.dagre;
const SVG_NS = "http://www.w3.org/2000/svg";

// 要素の textContent は null にならない (null は Document などの Node だけ)。
const DATA: SiteData = JSON.parse(getElement("model-data").textContent ?? "");
//: 初期描画・レイアウト・絞り込みの所要時間は SVG の data-* 属性に残す
//: (docs/design/site.md の実測値はここから読んだもの)。
const STARTED_AT = Date.now();
// 影響範囲の色は背景に対する明度差で読ませるので、ノードの配色と同じくテーマ別に持つ。
const impactColors = () =>
  (palette().dark ? DATA.meta.dark_impact_colors : null) ??
  DATA.meta.impact_colors ?? { selected: "", upstream: "", downstream: "", related: "" };

// --- 保存 (localStorage) ----------------------------------------------------
//
// 使えない環境 (file:// で開いた・プライベートモード・容量超過) では黙って
// 諦める。保存はどれも「次に開いたときの利便」でしかなく、無くても表示は成立する。

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // 保存できない環境。
  }
}

/**
 * 表示状態。持ち物は `defaultState()` を参照 (絞り込みの集合・選択ノード・
 * グラフの向き・中央ペインのタブ・検索語・テーブルの並び順)。
 *
 * URL ハッシュが唯一の出典なので、初期値はハッシュから作り、以降も変更のたびに
 * `writeHash()` で書き戻す (戻る/進むは `applyHash()` で戻す)。ハッシュの無い
 * URL で開いたときだけ、前回の絞り込み (localStorage) を初期値に使う。
 */
let state: ViewState = decodeHash(initialHash(location.hash, readStore(VIEW_STORAGE_KEY)), DATA);

/** 絞り込みを反映した現在のグラフ。refresh() で作り直す。 */
let view = createView(DATA, state);

// --- SVG graph view adapter -------------------------------------------------

const graphPrimitives = createGraphViewPrimitives();
const {
  svgEl,
  htmlEl,
  setAttrs,
  classed,
  labelMeasurer,
  renderLabel,
  shapeEl,
  polygonCoords,
  updateShape,
  palette,
} = graphPrimitives;
const graphEl = getElement("graph");
let svg: SVGSVGElement | null = null;
let defs: SVGDefsElement | null = null;
let graph: GraphElementDefinition[] = [];
let panZoom: PanZoomController | null = null;
const nodeItems = new Map<string, GraphNodeElement>();
const edgeItemsByKey = new Map<string, GraphEdgeElement>();
const bandItems = new Map<string, GraphBandElement>();

/** 図を組む。組めたら SVG を返す。描画ライブラリが無ければ案内を出して null を返す。 */
function initGraph(): SVGSVGElement | null {
  if (!dagre) {
    graphEl.replaceChildren(
      htmlEl(
        "p",
        { class: "empty" },
        "描画ライブラリ (dagre) を読み込めなかった。図の元データは ",
        htmlEl("a", { href: "graph.mmd" }, "graph.mmd"),
        " / ",
        htmlEl("a", { href: "graph.dot" }, "graph.dot"),
        " にある。",
      ),
    );
    return null;
  }
  graph = graphElements(DATA, labelMeasurer());
  graphEl.replaceChildren();
  const root = svgEl("svg", {
    class: "req-graph",
    tabindex: 0,
    role: "img",
    "aria-label": DATA.title,
  });
  const defsEl = svgEl("defs");
  const viewport = svgEl("rect", {
    class: "graph-bg",
    x: -100000,
    y: -100000,
    width: 200000,
    height: 200000,
  });
  const graphLayer = svgEl("g", { class: "graph-layer" });
  const controller = createPanZoom(graphEl, graphLayer);
  root.append(defsEl, viewport, graphLayer);
  graphEl.append(root);
  //: 以降の描画関数は「図があるか」をこれらで見分けるので、DOM を組む前に確定させる。
  svg = root;
  defs = defsEl;
  panZoom = controller;
  buildGraphDom(defsEl, graphLayer);
  controller.bind(root, viewport, () => {
    if (state.mode !== "analysis") selectNode(state.selected);
  });
  runLayout();
  return root;
}

function buildGraphDom(defs: SVGDefsElement, graphLayer: SVGGElement) {
  const arrow = svgEl("marker", {
    id: "req-arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: "auto",
  });
  // 強調時に線色が変わっても、先端が同じ色になるよう線の色を継承する。
  arrow.append(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "context-stroke" }));
  defs.replaceChildren(arrow);

  const edgeLayer = svgEl("g", { class: "edges" });
  const bandLayer = svgEl("g", { class: "bands" });
  const nodeLayer = svgEl("g", { class: "nodes" });
  graphLayer.replaceChildren(bandLayer, edgeLayer, nodeLayer);

  for (const item of graph.filter(isEdgeElement)) {
    const path = svgEl("path", { class: "edge-line", "marker-end": "url(#req-arrow)" });
    const label = svgEl("text", { class: "edge-label", "text-anchor": "middle" });
    label.textContent = item.data.name;
    const group = svgEl("g", {
      class: "edge",
      "data-id": item.data.id,
      "data-source": item.data.source,
      "data-target": item.data.target,
    });
    group.append(path, label);
    edgeLayer.append(group);
    edgeItemsByKey.set(item.data.id, {
      ...item.data,
      group,
      path,
      label,
      points: [],
    } as GraphEdgeElement);
  }

  const types = DATA.meta.types || {};
  const analysisFrames = Object.entries(ANALYSIS_BANDS).map(([key, label]) => ({
    data: { id: bandId(`analysis:${key}`), bandKey: `analysis:${key}`, label },
  }));
  for (const item of [...graph.filter(isBandElement), ...analysisFrames]) {
    const group = svgEl("g", {
      class: "node band",
      "data-id": item.data.id,
      "data-band-key": item.data.bandKey,
    });
    const shape = svgEl("rect", { class: "node-shape", rx: 8 });
    const label = svgEl("text", { class: "node-label band-label" });
    renderLabel(label, item.data.label, 0, -11, 11, "bold");
    group.append(shape, label);
    bandLayer.append(group);
    bandItems.set(item.data.id, { ...item.data, x: 0, y: 0, w: 10, h: 10, group, shape, label });
  }
  for (const item of graph.filter(isNodeElement)) {
    const typeMeta = types[item.data.type] || {};
    const group = svgEl("g", {
      class: `node status-${item.data.status || "unknown"}`,
      "data-node-id": item.data.id,
      tabindex: 0,
      role: "button",
      "aria-label": String(item.data.label).replaceAll("\n", " "),
    });
    //: 形状を持たない型は矩形で描く (`applyGraphTheme()` の既定と同じ)。
    const shapeName = typeMeta.shape || "round-rectangle";
    const shape = shapeEl(shapeName);
    shape.classList.add("node-shape");
    const statusRing = shapeEl(shapeName);
    statusRing.classList.add("node-status-ring");
    const label = svgEl("text", { class: "node-label" });
    renderLabel(label, item.data.label, 0, 0);
    group.append(shape, statusRing, label);
    group.addEventListener("click", () => selectNode(item.data.id));
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      chooseNode(item.data.id);
    });
    nodeLayer.append(group);
    nodeItems.set(item.data.id, {
      ...item.data,
      shapeName,
      x: 0,
      y: 0,
      group,
      shape,
      statusRing,
      label,
    } as GraphNodeElement);
  }
  restyleGraph();
}

// --- フォーカス (近傍だけを描く) --------------------------------------------
//
// 大きいグラフは全体を 1 枚に収めると横長になり、文字が読める倍率では
// 目的のノードに辿り着けない。フォーカスを入れると、図に描くのは選択ノードの
// 近傍だけになる。
//
// これは**図の描画だけの絞り込み**である。view (左の一覧・テーブル・詳細ペイン・
// 「影響部分グラフをコピー」) は全体のまま。ここを view 側で絞ると、上流/下流の
// 件数もコピー本文も近傍で切られた別物になり、`req explain` と食い違う。

/** 図に描くノードの id。フォーカス無し (または選択無し) なら null = 全部描く。 */
function focusedIds() {
  return focusedNodes(view);
}

//: 直近のレイアウトが対象にしたフォーカス (`深さ:選択ノード`)。
let laidOutFocus = "";

const focusKey = () =>
  state.mode === "analysis"
    ? JSON.stringify([
        "analysis",
        state.selected,
        state.depth,
        [...state.types],
        [...state.statuses],
        [...state.edges],
      ])
    : focusedIds()
      ? `${state.focus}:${state.selected}`
      : "";

/** 分析の図とその書き出しを起点の影響範囲に限定する。 */
function analysisIds() {
  return state.mode === "analysis" ? focusedIds() : null;
}
function displayedView() {
  const ids = analysisIds();
  return ids
    ? {
        ...view,
        nodes: view.nodes.filter((node) => ids.has(node.id)),
        edges: view.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
      }
    : view;
}

/**
 * 描く範囲が変わっていれば並べ直す。
 *
 * 種別や status の絞り込みでは位置を保つ (覚えた場所が壊れないように) が、
 * フォーカスは描く範囲そのものが変わるので並べ直す。近傍だけを並べ直した
 * 結果に `fitInitial()` が掛かり、読める倍率に戻る。
 */
function syncFocusLayout() {
  const key = focusKey();
  if (key === laidOutFocus) return;
  laidOutFocus = key;
  runLayout();
}

function shownNodeItems() {
  return [...nodeItems.values()].filter((item) => !item.group.classList.contains("hidden"));
}

function shownEdgeItems() {
  return [...edgeItemsByKey.values()].filter((item) => !item.group.classList.contains("hidden"));
}

function shownBandItems() {
  return [...bandItems.values()].filter((item) => !item.group.classList.contains("hidden"));
}

function moveItem(item: { x: number; y: number; group: SVGGElement }, x: number, y: number) {
  item.x = x;
  item.y = y;
  item.group.setAttribute("transform", `translate(${x} ${y})`);
}

function rectangleEndpoint(from: GraphNodeElement, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!dx && !dy) return { x: from.x, y: from.y };
  const scale = Math.min(Math.abs(from.w / 2 / (dx || 1e-9)), Math.abs(from.h / 2 / (dy || 1e-9)));
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function ellipseEndpoint(from: GraphNodeElement, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!dx && !dy) return { x: from.x, y: from.y };
  const rx = from.w / 2;
  const ry = from.h / 2;
  const scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function polygonEndpoint(from: GraphNodeElement, shape: string, to: Point): Point {
  const ray = { x: to.x - from.x, y: to.y - from.y };
  if (!ray.x && !ray.y) return { x: from.x, y: from.y };
  const vertices = polygonCoords(shape, from.w, from.h);
  const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
  let closest = Infinity;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    const side = { x: b.x - a.x, y: b.y - a.y };
    const denominator = cross(ray, side);
    if (Math.abs(denominator) < 1e-9) continue;
    const t = cross(a, side) / denominator;
    const u = cross(a, ray) / denominator;
    if (t >= 0 && u >= 0 && u <= 1) closest = Math.min(closest, t);
  }
  if (!Number.isFinite(closest)) return rectangleEndpoint(from, to);
  return { x: from.x + ray.x * closest, y: from.y + ray.y * closest };
}

/** Rendered node boundary on the ray from the node centre toward `to`. */
function edgeEndpoint(from: GraphNodeElement, to: Point): Point {
  const shape = from.shapeName;
  if (shape === "ellipse") return ellipseEndpoint(from, to);
  if (shape && POLYGON_SHAPES.includes(shape)) {
    return polygonEndpoint(from, shape, to);
  }
  return rectangleEndpoint(from, to);
}

function updateEdges() {
  for (const edge of edgeItemsByKey.values()) {
    const source = nodeItems.get(edge.source);
    const target = nodeItems.get(edge.target);
    if (!source || !target) continue;
    const offset = edge.parallelOffset || 0;
    let control = edgeControl(source, target, state.direction, offset);
    const from = edgeEndpoint(source, control);
    const to = edgeEndpoint(target, control);
    control = edgeControl(from, to, state.direction, offset);
    setAttrs(edge.path, { d: quadraticPath(from, control, to) });
    const middle = quadraticPoint(from, control, to);
    setAttrs(edge.label, { x: middle.x, y: middle.y - 4 });
    edge.x1 = from.x;
    edge.y1 = from.y;
    edge.x2 = to.x;
    edge.y2 = to.y;
    edge.points = [from, control, to];
  }
}

/**
 * Goal / Need の帯を図の上 (LR なら左) に並べ直し、枠を掛け直す。
 * dagre の副軸方向の並びは保つので、「整列」のたびに図の形が大きく変わる
 * ことは無い。
 */
function applyBanding() {
  if (!svg) return;
  const bands = bandDefs(DATA);
  if (!bands.length && state.mode !== "analysis") return;
  const placed = shownNodeItems().map((item) => ({
    id: item.id,
    type: item.type,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
  }));
  if (!placed.length) return;
  const { positions, frames } =
    state.mode === "analysis"
      ? analysisBandLayout(view, placed, state.direction)
      : bandedLayout(bands, placed, view.edges, state.direction);
  for (const item of bandItems.values()) classed(item.group, "hidden", !frames.has(item.bandKey));
  for (const [id, position] of positions) {
    const item = nodeItems.get(id);
    if (item) moveItem(item, position.x, position.y);
  }
  for (const [key, frame] of frames) {
    const item = bandItems.get(bandId(key));
    if (!item) continue;
    item.w = frame.w;
    item.h = frame.h;
    updateShape(item.shape, "round-rectangle", item);
    moveItem(item, frame.x, frame.y);
    // renderLabel() puts the coordinates on tspans, so changing the parent
    // text's y attribute would leave the title at the centre of the frame.
    // Use the frame's existing top padding as a header instead: the title is
    // kept inside the group while remaining clear of its first node row.
    renderLabel(item.label, item.label.textContent, 0, -item.h / 2 + 7, 11, "bold");
    // 分析の枠は起点と結ぶエッジが辺の中央を通るので、見出しを隅へ寄せて重ねない。
    if (state.mode === "analysis") {
      for (const line of item.label.children) line.setAttribute("x", String(-item.w / 2 + 10));
      item.label.setAttribute("text-anchor", "start");
    }
  }
  updateEdges();
}

/** dagre → 帯の並べ直し → 倍率合わせ。初期表示・「整列」・向きの変更が通る。 */
function runLayout() {
  if (!svg || !dagre) return;
  const startedAt = Date.now();
  const g = new dagre.graphlib.Graph({ multigraph: true });
  const opts = layoutOptions(state.direction);
  g.setGraph({
    rankdir: opts.rankDir,
    nodesep: opts.nodeSep,
    ranksep: opts.rankSep,
    edgesep: opts.edgeSep,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const nodes = new Set(shownNodeItems().map((item) => item.id));
  for (const item of shownNodeItems()) g.setNode(item.id, { width: item.w, height: item.h });
  const parallel = new Map<string, GraphEdgeElement[]>();
  for (const item of shownEdgeItems()) {
    const edge = DATA.edges[item.index];
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    g.setEdge(
      edge.source,
      edge.target,
      { width: estimateTextWidth(edge.name), height: 12 },
      item.id,
    );
    const key = [edge.source, edge.target].sort().join("\u0000");
    const siblings = parallel.get(key) || [];
    siblings.push(item);
    parallel.set(key, siblings);
  }
  dagre.layout(g);
  for (const id of g.nodes()) {
    const pos = g.node(id);
    const item = nodeItems.get(id);
    if (item) moveItem(item, pos.x, pos.y);
  }
  for (const siblings of parallel.values()) {
    siblings.forEach((item, index) => {
      const orientation = item.source.localeCompare(item.target) <= 0 ? 1 : -1;
      item.parallelOffset = (index - (siblings.length - 1) / 2) * 12 * orientation;
    });
  }
  applyBanding();
  fitInitial();
  svg.dataset.layoutMs = String(Date.now() - startedAt);
}

/** 絞り込みの反映。再レイアウトはせず、表示・非表示だけを切り替える。 */
function applyVisibility() {
  if (!svg) return;
  const startedAt = Date.now();
  const focused = focusedIds();
  const shown = focused ? view.nodes.filter((node) => focused.has(node.id)) : view.nodes;
  const nodes = new Set(shown.map((node) => node.id));
  const edges = new Set(
    view.edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)),
  );
  const visibleBands =
    state.mode === "analysis"
      ? new Set(
          analysisBandLayout(
            view,
            [...nodeItems.values()].filter((item) => nodes.has(item.id)),
            state.direction,
          ).frames.keys(),
        )
      : visibleBandKeys(DATA, shown);
  for (const item of nodeItems.values()) classed(item.group, "hidden", !nodes.has(item.id));
  for (const item of bandItems.values())
    classed(item.group, "hidden", !visibleBands.has(item.bandKey));
  for (const item of edgeItemsByKey.values())
    classed(item.group, "hidden", !edges.has(DATA.edges[item.index]));
  svg.dataset.filterMs = String(Date.now() - startedAt);
}

function applyHighlight() {
  if (!svg) return;
  for (const item of [...nodeItems.values(), ...edgeItemsByKey.values()])
    item.group.classList.remove(
      "sel",
      "up",
      "down",
      "rel",
      "dim",
      "on-path",
      "detail-target",
      "detail-path",
      "trail-muted",
    );
  if (!state.selected || !view.byId.has(state.selected)) return;
  const { upstream, downstream, whole, undirected } = impactSets(view, state.selected);
  for (const item of nodeItems.values()) {
    if (item.id === state.selected) item.group.classList.add("sel");
    else if (undirected) item.group.classList.add(downstream.has(item.id) ? "rel" : "dim");
    else if (upstream.has(item.id)) item.group.classList.add("up");
    else if (downstream.has(item.id)) item.group.classList.add("down");
    else item.group.classList.add("dim");
  }
  for (const item of edgeItemsByKey.values()) {
    const linked = whole.has(item.source) && whole.has(item.target);
    item.group.classList.add(linked ? "on-path" : "dim");
  }
  if (state.mode === "analysis" && state.detail) {
    const trail = focusTrail(view);
    for (const item of nodeItems.values()) {
      classed(item.group, "detail-target", item.id === state.detail);
      classed(item.group, "detail-path", trail.nodes.has(item.id));
      if (trail.nodes.has(item.id)) item.group.classList.remove("dim");
      classed(item.group, "trail-muted", trail.nodes.size && !trail.nodes.has(item.id));
    }
    for (const item of edgeItemsByKey.values()) {
      classed(item.group, "detail-path", trail.edges.has(DATA.edges[item.index]));
      if (trail.edges.has(DATA.edges[item.index])) item.group.classList.remove("dim");
      classed(
        item.group,
        "trail-muted",
        trail.nodes.size && !trail.edges.has(DATA.edges[item.index]),
      );
    }
  }
}

// --- 検索のグラフ連動 -------------------------------------------------------
let cursor: string | null = null;
const hits = () => searchHits(view, state.query);

function applySearchHits() {
  if (!svg) return;
  const matched = new Set(hits());
  for (const item of nodeItems.values()) {
    classed(item.group, "hit", matched.has(item.id));
    classed(item.group, "hit-current", item.id === cursor);
  }
}

function moveCursor(delta: number) {
  const next = stepHit(hits(), cursor, delta);
  if (next === null) return;
  cursor = next;
  renderNodeList();
  applySearchHits();
  revealNode(cursor);
  const active = document.querySelector("#node-list .node-btn.cursor");
  if (active) active.scrollIntoView({ block: "nearest" });
}

function graphBox() {
  const boxes = [...shownNodeItems(), ...shownBandItems()];
  if (!boxes.length) return { x1: 0, y1: 0, x2: 1, y2: 1 };
  return {
    x1: Math.min(...boxes.map((box) => box.x - box.w / 2)),
    y1: Math.min(...boxes.map((box) => box.y - box.h / 2)),
    x2: Math.max(...boxes.map((box) => box.x + box.w / 2)),
    y2: Math.max(...boxes.map((box) => box.y + box.h / 2)),
  };
}

function fitToView() {
  panZoom?.fit(graphBox());
}

function fitInitial() {
  panZoom?.fit(graphBox(), true);
}

function revealNode(id: NodeId | null) {
  if (id === null || !svg || state.mode === "table") return;
  const item = nodeItems.get(id);
  if (!item || item.group.classList.contains("hidden")) return;
  panZoom?.reveal(item);
}
const revealSelected = () => revealNode(state.selected);

function zoomBy(factor: number) {
  panZoom?.zoomBy(factor);
}

// --- 詳細パネル ------------------------------------------------------------

function appendReferenceSection(
  panel: HTMLElement,
  title: string,
  references: readonly ExternalReference[] | undefined,
) {
  if (!Array.isArray(references) || references.length === 0) return;
  panel.append(htmlEl("h2", {}, title));
  const list = htmlEl("ul", { class: "sources" });
  for (const reference of references) {
    const item = htmlEl("li", {}, htmlEl("span", { class: "id" }, reference.title || "(untitled)"));
    const href = safeHref(reference.url);
    if (href) {
      item.append(
        " ",
        htmlEl("a", { href, target: "_blank", rel: "noopener noreferrer" }, reference.url),
      );
    } else if (reference.url) {
      // 安全でない URL も情報としては失わず、操作できないテキストで表示する。
      item.append(" ", reference.url);
    }
    if (reference.note) item.append(htmlEl("span", { class: "text" }, reference.note));
    list.append(item);
  }
  panel.append(list);
}

function appendTerm(
  list: HTMLElement,
  term: string,
  value: Node | string,
  className: string | null = null,
) {
  list.append(htmlEl("dt", {}, term), htmlEl("dd", className ? { class: className } : {}, value));
}

function renderDetail() {
  const panel = getElement("detail");
  panel.replaceChildren();
  const detailId = state.mode === "analysis" && state.detail ? state.detail : state.selected;
  const node = detailId ? view.byId.get(detailId) : undefined;
  if (!node) {
    panel.append(
      htmlEl(
        "p",
        { class: "empty" },
        "グラフのノードをクリックすると、本文・根拠・影響範囲を表示する。",
      ),
    );
    return;
  }
  const impact = impactSets(view, node.id);

  panel.append(
    htmlEl("h3", {}, node.id, " ", htmlEl("span", { class: "node-btn type" }, `[${node.type}]`)),
    htmlEl("p", { class: "text" }, node.text),
  );
  const details = htmlEl("dl");
  appendTerm(details, fieldLabel("status"), node.status);
  if (node.location) appendTerm(details, "出所", locationElement(node.location), "loc");
  //: 件数は影響範囲の設定 (深さ・向き) に従う。図の色分けと同じ範囲を数える。
  if (impact.undirected) appendTerm(details, "関連", `${impact.downstream.size} 件`);
  else {
    appendTerm(details, "上流", `${impact.upstream.size} 件`);
    appendTerm(details, "下流", `${impact.downstream.size} 件`);
  }
  panel.append(details);

  //: 外部参照はノードではなく Reference 値として各フィールドに直接保持する。
  appendReferenceSection(panel, fieldLabel("source"), node.source);
  appendReferenceSection(panel, fieldLabel("realized_by"), node.realized_by);
  appendReferenceSection(panel, fieldLabel("evidence"), node.evidence);
  const criteria = node.acceptance_criteria || [];
  if (criteria.length) {
    panel.append(htmlEl("h2", {}, "受け入れ基準"));
    panel.append(htmlEl("ul", {}, ...criteria.map((criterion) => htmlEl("li", {}, criterion))));
  }
  const suppressed = node.suppress || [];
  if (suppressed.length) {
    panel.append(htmlEl("h2", {}, "抑制中の指摘"));
    panel.append(
      htmlEl(
        "ul",
        {},
        ...suppressed.map(([code, reason]) =>
          htmlEl("li", {}, htmlEl("code", {}, code), `: ${reason}`),
        ),
      ),
    );
  }

  const appendEdges = (title: string, items: ReturnType<typeof edgeItems>["out"]) => {
    if (!items.length) return;
    const list = htmlEl("ul", { class: "plain" });
    for (const item of items) {
      const button = htmlEl(
        "button",
        { class: "node-btn", "data-goto": item.id },
        htmlEl("span", { class: "arrow" }, item.arrow),
        " ",
        htmlEl("span", { class: "id" }, item.id),
        " ",
        htmlEl("span", { class: "type" }, item.type),
        " ",
        htmlEl("span", { class: "text" }, truncate(item.text, 40)),
      );
      list.append(htmlEl("li", { class: "edge" }, button));
    }
    panel.append(htmlEl("h2", {}, title), list);
  };
  const links = edgeItems(displayedView(), node.id);
  appendEdges("出るエッジ", links.out);
  appendEdges("入るエッジ", links.in);

  const nodeFindings = DATA.findings.filter((finding) => finding.node_id === node.id);
  if (nodeFindings.length) {
    panel.append(htmlEl("h2", { id: "node-findings" }, "このノードへの指摘"));
    for (const finding of nodeFindings) panel.append(findingElement(finding, false));
  }

  const copyButton = htmlEl("button", { id: "copy-context" }, "影響部分グラフをコピー");
  panel.append(
    htmlEl("h2", {}, "LLM 連携"),
    copyButton,
    htmlEl(
      "p",
      { class: "hint" },
      htmlEl("code", {}, explainCommand(view, node.id)),
      " と同じ内容をクリップボードに入れる。",
    ),
  );

  panel.querySelectorAll<HTMLElement>("button[data-goto]").forEach((button: HTMLElement) => {
    button.addEventListener("click", () => selectNode(dataValue(button, "goto")));
  });
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(nodeContext(view, node.id));
      copyButton.textContent = "コピーした";
    } catch {
      copyButton.textContent = "コピーできなかった";
    }
    setTimeout(() => (copyButton.textContent = "影響部分グラフをコピー"), 1600);
  });
}

/** 出所を、安全な場合だけリポジトリ上の定義へのリンクにする。 */
function locationElement(location: string) {
  const href = safeHref(sourceUrl(DATA, location));
  return href
    ? htmlEl(
        "a",
        { href, target: "_blank", rel: "noopener", title: "GitHub でこの定義を開く" },
        `${location} ↗`,
      )
    : document.createTextNode(location);
}

/** 指摘 1 件。動的値はすべて textContent 相当で追加する。 */
function findingElement(finding: Finding, interactive = true) {
  const where = finding.node_id ? ` (${finding.node_id})` : "";
  const content = [
    htmlEl(
      "div",
      { class: "code" },
      `${finding.severity.toUpperCase()} · L${finding.layer} · ${finding.code}${where}`,
    ),
    htmlEl("div", {}, finding.message),
  ];
  if (interactive && finding.node_id) {
    if (finding.location) content.push(htmlEl("div", { class: "loc" }, finding.location));
    return htmlEl(
      "button",
      {
        type: "button",
        class: `finding ${finding.severity}`,
        "data-id": finding.node_id,
      },
      ...content,
    );
  }
  if (finding.location)
    content.push(htmlEl("div", { class: "loc" }, locationElement(finding.location)));
  return htmlEl("div", { class: `finding ${finding.severity}` }, ...content);
}

// --- 左サイドバー ----------------------------------------------------------

function renderNodeList() {
  const list = getElement("node-list");
  const matched = view.nodes.filter((node) => matchesQuery(node, state.query));
  list.replaceChildren(
    ...matched.map((node) => {
      const marks = [node.id === state.selected ? "active" : "", node.id === cursor ? "cursor" : ""]
        .filter(Boolean)
        .join(" ");
      return htmlEl(
        "li",
        {},
        htmlEl(
          "button",
          {
            class: `node-btn ${marks}`.trim(),
            "data-id": node.id,
          },
          htmlEl("span", { class: "id" }, node.id),
          " ",
          htmlEl("span", { class: "type" }, node.type),
          htmlEl("br"),
          truncate(node.text, 34),
        ),
      );
    }),
  );
  list.querySelectorAll<HTMLElement>("button[data-id]").forEach((button: HTMLElement) => {
    button.addEventListener("click", () => selectRoot(dataValue(button, "id")));
  });
}

/**
 * チェックボックス 1 群。`items` は `{ key, label, count }` の配列。
 * チェックの有無は state の集合から取る (ハッシュ付きの URL で開いたとき用)。
 */
function renderToggles(
  containerId: string,
  attribute: string,
  items: readonly { key: string; label: string; count: number }[],
  set: ReadonlySet<string>,
) {
  getElement(containerId).replaceChildren(
    ...items.map((item) =>
      htmlEl(
        "label",
        { class: "toggle" },
        htmlEl("input", {
          type: "checkbox",
          [`data-${attribute}`]: item.key,
          checked: set.has(item.key),
        }),
        ` ${item.label}`,
        htmlEl("span", { class: "count" }, String(item.count)),
      ),
    ),
  );
}

/**
 * チェックの付け外しを state の集合に写す。集合は押されたときに引き直す
 * (`applyHash()` が state ごと差し替えるので、ここで掴んでおくと古い集合が残る)。
 */
function bindToggles(attribute: string, key: FilterKey) {
  queryElements(`input[data-${attribute}]`).forEach((input) => {
    const value = dataValue(input, attribute);
    input.addEventListener("change", () => {
      input.checked ? state[key].add(value) : state[key].delete(value);
      refresh();
      writeHash();
    });
  });
}

//: 絞り込み 1 群の [チェックボックスの属性名, state のキー]。置き場所は
//: `<属性名>-filters`。描画・イベント・URL からの復元がこの並びを共有する。
type FilterKey = "types" | "statuses" | "edges";
const FILTER_SETS: readonly (readonly [string, FilterKey])[] = [
  ["type", "types"],
  ["status", "statuses"],
  ["edge", "edges"],
];

function renderFilters() {
  const countBy = (keys: Iterable<string>) => {
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  };

  const typeCounts = countBy(DATA.nodes.map((node) => node.type));
  const edgeCounts = countBy(DATA.edges.map((edge) => edge.name));
  const items: Record<FilterKey, { key: string; label: string; count: number }[]> = {
    types: DATA.types.map((type) => ({
      key: type,
      label: type,
      count: typeCounts.get(type) || 0,
    })),
    statuses: statusFilters(DATA),
    edges: DATA.edge_names.map((name) => ({
      key: name,
      label: name,
      count: edgeCounts.get(name) || 0,
    })),
  };

  for (const [attribute, key] of FILTER_SETS) {
    renderToggles(`${attribute}-filters`, attribute, items[key], state[key]);
    bindToggles(attribute, key);
  }
}

/** 通常グラフ用の近傍の深さを並べる。 */
function renderFocusOptions() {
  getElement("focus").replaceChildren(
    htmlEl("option", { value: 0 }, "フォーカス: 切"),
    ...FOCUS_DEPTHS.map((depth) => htmlEl("option", { value: depth }, `近傍 ${depth} ホップ`)),
  );
}

const directionName = (direction: Direction) => (direction === "LR" ? "横 (LR)" : "縦 (TD)");
const focusName = () => (state.focus ? `近傍 ${state.focus} ホップ` : "フォーカス: 切");

/** アイコンだけの向き・フォーカス操作にも現在値を伝える。 */
function syncGraphControlLabels() {
  const direction = getElement("direction");
  const nextDirection = state.direction === "LR" ? "TD" : "LR";
  const directionLabel = `図の向き: ${directionName(state.direction)} (クリックで${directionName(nextDirection)}へ)`;
  direction.title = directionLabel;
  direction.setAttribute("aria-label", directionLabel);
  direction.dataset.direction = state.direction;

  const focus = getElement("focus");
  const focusControl = getElement("focus-control");
  focus.value = String(state.focus);
  const focusLabel = `${focusName()} (選択したノードの近傍を描く)`;
  focus.setAttribute("aria-label", state.focus ? `フォーカス: ${focusName()}` : focusName());
  focusControl.classList.toggle("active", Boolean(state.focus));
  focus.title = focusLabel;
  focusControl.title = focusLabel;
  focusControl.hidden = state.mode === "analysis";
  getElement("tab-analysis").disabled = !state.selected && state.mode !== "analysis";
  getElement("undirected").disabled = state.mode === "analysis";
  getElement("undirected").checked = state.mode !== "analysis" && state.undirected;
}

/**
 * 影響範囲の探索設定。深さの上限は `IMPACT_DEPTHS` を唯一の出典とする。
 *
 * ここはグラフの描画ではなく**影響範囲そのもの**の設定なので、図のツールバー
 * (フォーカス) ではなく絞り込みと同じ左サイドバーに置く。色分け・詳細ペインの
 * 件数・コピー本文の 3 つに同じだけ効く。
 */
function renderImpactControls() {
  const slider = getElement("depth");
  slider.min = "0";
  slider.max = String(Math.max(...IMPACT_DEPTHS));
  slider.step = "1";
}

/** 深さスライダの現在値の表示。0 は上限無し。 */
const depthLabel = () => (state.depth ? `${state.depth} ホップ` : "無制限");

/** 入力欄・チェック・タブを state に合わせ直す。ハッシュから復元したとき用。 */
function syncControls() {
  getElement("search").value = state.query;
  syncGraphControlLabels();
  getElement("depth").value = String(state.depth);
  getElement("depth-value").textContent = depthLabel();
  for (const [attribute, key] of FILTER_SETS) {
    queryElements(`input[data-${attribute}]`).forEach((input) => {
      input.checked = state[key].has(dataValue(input, attribute));
    });
  }
}

function renderStats() {
  const counts = DATA.stats.findings;
  const chips = [
    htmlEl("span", { class: "chip" }, `${DATA.stats.nodes} ノード`),
    htmlEl("span", { class: "chip" }, `${DATA.stats.edges} エッジ`),
  ];
  const severities: readonly Severity[] = ["error", "severe", "warning", "info"];
  for (const severity of severities) {
    if (counts[severity])
      chips.push(htmlEl("span", { class: `chip ${severity}` }, `${severity} ${counts[severity]}`));
  }
  if (!counts.error && !counts.severe && !counts.warning && !counts.info) {
    chips.push(htmlEl("span", { class: "chip" }, "指摘なし"));
  }
  if (DATA.stats.suppressed)
    chips.push(htmlEl("span", { class: "chip" }, `抑制 ${DATA.stats.suppressed} 件`));
  getElement("stats").replaceChildren(...chips);
  getElement("sources").textContent = DATA.generated_from.join(", ");
  renderLegend();
  renderFindings();
}

/** 現在のテーマの配色で凡例を描く。 */
function renderLegend() {
  const scheme = palette().dark ? "dark" : "light";
  const groups = legendGroups(DATA.meta, scheme).map((group) => {
    const container = htmlEl("div", { class: "legend-group" }, htmlEl("b", {}, group.title));
    for (const { label, swatch } of group.items) {
      const mark = htmlEl("i", { class: "swatch" });
      //: 配色を持たない型は塗らない (CSS の既定のまま)。
      mark.style.background = swatch.background ?? "";
      mark.style.borderColor = swatch.borderColor || "currentColor";
      mark.style.borderStyle = swatch.borderStyle;
      mark.style.borderWidth = `${swatch.borderWidth}px`;
      container.append(htmlEl("span", {}, mark, label));
    }
    return container;
  });
  getElement("legend").replaceChildren(...groups);
}

// --- 検証結果 ---------------------------------------------------------------
//
// 指摘は数が増えるほど「重い順の 1 本の帯」では読めなくなる。重大度で絞り、
// 残りをチェックコードごとにまとめる。同じ規則の違反はまとめて直す (あるいは
// まとめて抑制する) ものなので、コードが片付ける単位になる。

//: 指摘一覧で選んでいる重大度。URL には載せない (パーマリンクで渡すのは図の状態
//: であって、右ペインの読み方ではない)。
let findingSeverity = ALL_SEVERITIES;

/** 重大度タブを選ぶ。押しても ←→ で移っても同じ。 */
function showSeverity(tab: HTMLElement) {
  findingSeverity = dataValue(tab, "severity");
  renderFindings();
}

function renderFindings() {
  const tabs = severityTabs(DATA.findings);
  if (!tabs.some((tab) => tab.key === findingSeverity)) findingSeverity = ALL_SEVERITIES;

  const tabBar = getElement("finding-tabs");
  const refocus = tabBar.contains(document.activeElement);
  tabBar.replaceChildren(
    ...tabs.map((tab) =>
      htmlEl(
        "button",
        {
          type: "button",
          role: "tab",
          "aria-controls": "findings",
          "data-severity": tab.key,
          class: tab.key === findingSeverity ? "active" : "",
          "aria-selected": tab.key === findingSeverity,
          tabindex: tab.key === findingSeverity ? 0 : -1,
        },
        tab.label,
        htmlEl("span", { class: "count" }, String(tab.count)),
      ),
    ),
  );
  tabBar.querySelectorAll<HTMLElement>("button[data-severity]").forEach((button: HTMLElement) => {
    button.addEventListener("click", () => showSeverity(button));
  });
  bindTabKeys(tabBar, showSeverity);
  if (refocus) (tabBar.querySelector("button.active") as HTMLElement | null)?.focus();

  const groups = groupFindings(DATA.findings, findingSeverity);
  const panel = getElement("findings");
  if (!groups.length) panel.replaceChildren(htmlEl("p", { class: "empty" }, "指摘は無い。"));
  else {
    const children: HTMLElement[] = [];
    for (const group of groups) {
      children.push(
        htmlEl(
          "div",
          { class: "code-head" },
          htmlEl("span", {}, group.code),
          htmlEl("span", {}, `${group.items.length} 件`),
        ),
      );
      children.push(...group.items.map((finding) => findingElement(finding)));
    }
    panel.replaceChildren(...children);
  }
  panel.querySelectorAll<HTMLElement>("button.finding[data-id]").forEach((button: HTMLElement) => {
    button.addEventListener("click", () => selectRoot(dataValue(button, "id")));
  });
}

// --- テーブルビュー --------------------------------------------------------
//
// グラフと同じ view / state を見るので、絞り込みも選択もそのまま共有される。
// 中央ペインの表示を差し替えるだけで、グラフ側は作り直さない。

function renderTable() {
  if (state.mode !== "table") return;
  const rows = sortRows(view, tableRows(view, state.query), state.sort);
  const headRow = htmlEl("tr");
  for (const column of TABLE_COLUMNS) {
    const active = state.sort.key === column.key;
    const order = active ? (state.sort.asc ? "ascending" : "descending") : "none";
    const arrow = active ? (state.sort.asc ? "▲" : "▼") : "";
    headRow.append(
      htmlEl(
        "th",
        { class: column.numeric ? "num" : "", "aria-sort": order },
        htmlEl(
          "button",
          { "data-key": column.key, title: "この列で並べ替える" },
          column.label,
          htmlEl("span", { class: "arrow" }, arrow),
        ),
      ),
    );
  }

  const cell = (row: TableRow, key: string) => {
    if (key === "text") return htmlEl("td", { class: "text" }, row.text);
    if (key === "findings") {
      return row.findings
        ? htmlEl(
            "td",
            { class: "num" },
            htmlEl(
              "button",
              {
                class: `finding-count ${row.severity || ""}`.trim(),
                "data-findings": row.id,
                title: "このノードへの指摘を見る",
              },
              String(row.findings),
            ),
          )
        : htmlEl("td", { class: "num dash" }, "—");
    }
    if (key === "evidence") {
      return row.evidence
        ? htmlEl("td", { class: "num" }, String(row.evidence))
        : htmlEl("td", { class: "num dash" }, "—");
    }
    if (key === "id" || key === "type" || key === "status") {
      return htmlEl("td", { class: key }, row[key]);
    }
    return htmlEl("td", { class: key }, "");
  };

  const body = htmlEl("tbody");
  if (rows.length) {
    for (const row of rows) {
      body.append(
        htmlEl(
          "tr",
          {
            "data-id": row.id,
            tabindex: 0,
            class: row.id === state.selected ? "sel" : "",
          },
          ...TABLE_COLUMNS.map((column) => cell(row, column.key)),
        ),
      );
    }
  } else {
    body.append(
      htmlEl(
        "tr",
        {},
        htmlEl(
          "td",
          {
            class: "empty",
            colspan: TABLE_COLUMNS.length,
          },
          "条件に合うノードは無い。",
        ),
      ),
    );
  }

  const table = getElement("node-table");
  table.replaceChildren(htmlEl("thead", {}, headRow), body);
  getElement("table-note").textContent =
    `${rows.length} 件を表示中 (全 ${DATA.nodes.length} 件)。` +
    " 行をクリック (キーボードなら Enter) すると右ペインに詳細が出る。列見出しで並べ替える。";

  table.querySelectorAll<HTMLElement>("thead button[data-key]").forEach((button: HTMLElement) => {
    button.addEventListener("click", () => {
      state.sort = nextSort(state.sort, dataValue(button, "key"));
      renderTable();
      writeHash();
    });
  });
  table.querySelectorAll<HTMLElement>("tbody tr[data-id]").forEach((tr: HTMLElement) => {
    tr.addEventListener("click", () => selectNode(dataValue(tr, "id")));
    tr.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectNode(dataValue(tr, "id"));
    });
  });
  table.querySelectorAll<HTMLElement>("button[data-findings]").forEach((button: HTMLElement) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      showFindings(dataValue(button, "findings"));
    });
  });
}

/** 指摘数から検証結果へ辿る。そのノードを選び、右ペインの指摘まで送る。 */
function showFindings(id: NodeId) {
  if ((state.detail || state.selected) !== id) chooseNode(id);
  const heading = getElement("node-findings");
  if (heading) heading.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// --- タブ (中央ペイン / 指摘の重大度) ---------------------------------------

/**
 * タブ群のキーボード操作 (WAI-ARIA の tablist と同じ約束)。
 *
 * ←→ で隣のタブへ、Home / End で端へ移り、移った先がそのまま選ばれる。
 * tab キーで飛ぶ先は選択中の 1 つだけ (roving tabindex) なので、タブが増えても
 * キーボードでの移動距離が伸びない。
 */
function bindTabKeys(container: HTMLElement, activate: (tab: HTMLElement) => void) {
  const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
  container.onkeydown = (event) => {
    const buttons = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
      (button) => !button.hasAttribute("disabled"),
    );
    const at = buttons.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    let next: HTMLElement | undefined;
    if (event.key in keys) next = buttons[(at + keys[event.key] + buttons.length) % buttons.length];
    else if (event.key === "Home") next = buttons[0];
    else if (event.key === "End") next = buttons[buttons.length - 1];
    if (!next) return;
    event.preventDefault();
    next.focus();
    activate(next);
  };
}

//: 中央ペインのタブ [ボタンの id, 表示]。
const VIEW_TABS: readonly (readonly [string, ViewMode])[] = [
  ["tab-graph", "graph"],
  ["tab-analysis", "analysis"],
  ["tab-table", "table"],
];

/** 中央ペインの表示切り替え。グラフは消さず、隠すだけ。 */
function setMode(mode: ViewMode) {
  if (mode !== state.mode) state.detail = null;
  state.mode = mode;
  getElement("graph-frame").hidden = mode === "table";
  getElement("graph-frame").setAttribute(
    "aria-label",
    mode === "analysis" ? "フォーカス分析" : "グラフ",
  );
  getElement("table-frame").hidden = mode !== "table";
  for (const element of queryElements(".graph-only")) {
    element.hidden = mode === "table";
  }
  for (const [id, name] of VIEW_TABS) {
    const tab = getElement(id);
    tab.classList.toggle("active", mode === name);
    tab.setAttribute("aria-selected", String(mode === name));
    //: tab キーで入る先は選択中のタブだけにする。
    tab.tabIndex = mode === name ? 0 : -1;
  }
  refresh();
  if (mode === "table") {
    renderTable();
    return;
  }
  // 隠している間にコンテナの大きさが変わっているので、測り直してから追従する。
  revealSelected();
}

// --- URL ハッシュ ----------------------------------------------------------
//
// 表示状態と URL を両向きに繋ぐ。書くのは writeHash()、読むのは applyHash() だけ。

/**
 * いまの状態を URL に書き戻す。
 *
 * push=true なら履歴に積む (戻る/進むで辿れる)。検索語のように 1 打鍵ごとに
 * 変わるものは push=false で最後のエントリを置き換え、履歴を埋めない。
 */
function writeHash(push = true) {
  const hash = encodeHash(state, DATA);
  //: 次に (ハッシュ無しの URL で) 開いたときに戻すぶん。選択と検索語は持ち越さない。
  writeStore(VIEW_STORAGE_KEY, storableHash(state, DATA));
  if (hash === location.hash) return;
  // ハッシュが空になるときは "#" 自体を落とす。
  const url = hash || location.pathname + location.search;
  try {
    push ? history.pushState(null, "", url) : history.replaceState(null, "", url);
  } catch {
    // file:// で開いていると pushState が使えないことがある。履歴の粒度は
    // 諦めて、URL だけは合わせる (この代入は hashchange を起こす)。
    location.hash = hash;
  }
}

/**
 * URL のハッシュから表示状態を作り直す。戻る/進む (popstate) と、URL を手で
 * 書き換えたとき (hashchange) の入口。既に一致していれば何もしない。
 */
function applyHash() {
  if (location.hash === encodeHash(state, DATA)) return;
  const next = decodeHash(location.hash, DATA);
  const turned = next.direction !== state.direction;
  state = next;
  syncControls();
  setMode(state.mode);
  if (turned) runLayout();
  // 手で書かれた URL はここで正しい形に直す。履歴は増やさない。
  writeHash(false);
}

// --- 操作 ------------------------------------------------------------------

/** 一覧・検索・指摘からの選択は通常画面と同様に起点を切り替える。 */
function selectRoot(id: NodeId, toggle = true) {
  state.selected = toggle && state.selected === id ? null : id;
  state.detail = null;
  refresh();
  revealSelected();
  writeHash();
}

function selectNode(id: NodeId | null) {
  const inspecting = state.mode === "analysis" && Boolean(state.selected);
  if (inspecting && (id === null || !analysisIds()?.has(id))) return;
  state = selectNodeState(state, id);
  if (inspecting) {
    view.state = state;
    renderDetail();
    applyHighlight();
  } else {
    refresh();
    revealSelected();
  }
  writeHash();
}

/** 選択を決める (トグルしない)。キーボードの Enter から呼ぶ。 */
function chooseNode(id: NodeId) {
  if ((state.detail || state.selected) === id) {
    if (state.mode !== "analysis") revealNode(id);
    return;
  }
  selectNode(id);
}

function refresh() {
  view = createView(DATA, state);
  if (state.mode === "analysis" && state.detail && !analysisIds()?.has(state.detail))
    state.detail = null;
  syncGraphControlLabels();
  //: 絞り込みや検索語の変更で候補から外れた位置は捨てる。
  if (cursor !== null && !hits().includes(cursor)) cursor = null;
  renderNodeList();
  renderDetail();
  renderTable();
  applyVisibility();
  applyHighlight();
  applySearchHits();
  //: 選択の変更・フォーカスの入切・URL からの復元がすべてここを通る。
  syncFocusLayout();
}

/** 検索語を差し替える。入力欄からも、キーボードの Esc からも通る。 */
function applyQuery(value: string) {
  state.query = value;
  getElement("search").value = value;
  //: 語が変われば候補も変わる。位置は先頭から数え直す。
  cursor = null;
  renderNodeList();
  renderTable();
  applySearchHits();
  writeHash(false);
}

for (const [id, name] of VIEW_TABS) {
  getElement(id).addEventListener("click", () => {
    setMode(name);
    writeHash();
  });
}
bindTabKeys(requireElement<HTMLElement>(".tabs"), (tab) => {
  const entry = VIEW_TABS.find(([id]) => id === tab.id);
  //: 中央ペインのタブ以外は切り替え先を持たないので、何もしない。
  if (!entry) return;
  setMode(entry[1]);
  writeHash();
});
getElement("search").addEventListener("input", (event) => {
  applyQuery((event.target as HTMLInputElement).value);
});
//: ↑↓ で候補を送り、Enter で決める。入力欄から手を離さずに図を辿れるようにする。
getElement("search").addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveCursor(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  const target = cursor === null ? hits()[0] : cursor;
  if (target) selectRoot(target, false);
});
getElement("depth").addEventListener("input", (event) => {
  state.depth = Number((event.target as HTMLInputElement).value);
  getElement("depth-value").textContent = depthLabel();
  //: 分析フォーカス中だけは描画範囲も変わるため並べ直す。
  refresh();
  //: つまみを動かしている間の 1 段ごとに履歴を積まない。
  writeHash(false);
});
getElement("undirected").addEventListener("change", (event) => {
  state.undirected = (event.target as HTMLInputElement).checked;
  refresh();
  writeHash();
});
getElement("direction").addEventListener("click", () => {
  state.direction = state.direction === "LR" ? "TD" : "LR";
  syncGraphControlLabels();
  runLayout();
  writeHash();
});
getElement("focus").addEventListener("change", (event) => {
  state.focus = parseFocus((event.target as HTMLSelectElement).value);
  state.detail = null;
  syncGraphControlLabels();
  //: 描く範囲が変わるので、refresh() の中の syncFocusLayout() が並べ直す。
  refresh();
  writeHash();
});
function exitFocus() {
  setMode("graph");
  writeHash();
}
getElement("relayout").addEventListener("click", runLayout);
getElement("zoom-in").addEventListener("click", () => zoomBy(1.2));
getElement("zoom-out").addEventListener("click", () => zoomBy(1 / 1.2));
getElement("zoom-reset").addEventListener("click", () => {
  panZoom?.reset();
});
getElement("zoom-fit").addEventListener("click", fitToView);

// --- テーマ ------------------------------------------------------------------
//
// 既定は OS 設定への追従。明るい部屋やプロジェクタでは追従されると困るので、
// ヘッダのボタンで固定できる。固定した選択は次回にも残す。

let theme = normalizeTheme(readStore(THEME_STORAGE_KEY));
const themeButton = getElement("theme");

/** テーマを反映する。図の配色も CSS 変数から引き直す。 */
function applyTheme() {
  //: 自動のときは属性を外し、CSS 側の OS 追従に任せる。
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
  themeButton.textContent = THEME_LABELS[theme];
  restyleGraph();
}

/** テーマ依存の色を凡例と SVG に入れ直す。凡例は図を組めなかったときも出ている。 */
function restyleGraph() {
  renderLegend();
  if (!svg || !defs) return;
  applyGraphTheme(graphEl, DATA, nodeItems.values(), bandItems.values(), graphPrimitives);
}

themeButton.addEventListener("click", () => {
  theme = nextTheme(theme);
  writeStore(THEME_STORAGE_KEY, theme === "auto" ? null : theme);
  applyTheme();
});
//: 自動のときだけ効く (固定中は data-theme が勝つので、引き直しても色は動かない)。
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", restyleGraph);

// --- 書き出し ----------------------------------------------------------------
//
// 出力先の graph.mmd / graph.dot は全体のグラフなので、絞り込んだ図はここで組む。
// SVG は「いま図に描かれているもの」(フォーカス中なら近傍だけ) を写す。

const exportMenu = requireElement<HTMLDetailsElement>(".export-menu");
const exportSummary = requireElement<HTMLElement>("summary", exportMenu);
const exportOptions = requireElement<HTMLElement>(".export-options", exportMenu);

/** 開いたメニューを画面内に収める。下に入らなければアイコンの上に開く。 */
function positionExportMenu() {
  if (!exportMenu.open) return;
  const anchor = exportSummary.getBoundingClientRect();
  const menu = exportOptions.getBoundingClientRect();
  const margin = 8;
  const gap = 4;
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  const top =
    anchor.bottom + gap + menu.height <= height - margin
      ? anchor.bottom + gap
      : anchor.top - gap - menu.height;
  exportOptions.style.left = `${Math.max(margin, Math.min(anchor.right - menu.width, width - margin - menu.width))}px`;
  exportOptions.style.top = `${Math.max(margin, Math.min(top, height - margin - menu.height))}px`;
}

exportMenu.addEventListener("toggle", positionExportMenu);
window.addEventListener("resize", positionExportMenu);
document.addEventListener("scroll", positionExportMenu, true);

/** 文字列をファイルとして保存させる。 */
let lastDownloadUrl: string | null = null;
function download(name: string, text: string, type: string) {
  document.querySelector("a[data-generated-download]")?.remove();
  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
  const url = URL.createObjectURL(new Blob([text], { type }));
  lastDownloadUrl = url;
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  link.dataset.generatedDownload = "";
  document.body.append(link);
  link.click();
  // Keep the anchor and URL alive. Removing/revoking either in the same task
  // can cancel the download in Chromium/WebKit. The next download replaces it.
}

/** Serialize the visible SVG DOM itself as a standalone document. */
function currentSvg() {
  if (!svg) return null;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  for (const element of copy.querySelectorAll(".hidden")) element.remove();
  copy.querySelectorAll("[tabindex], [role], [aria-label]").forEach((element) => {
    element.removeAttribute("tabindex");
    element.removeAttribute("role");
    element.removeAttribute("aria-label");
  });
  const box = graphBox();
  const padding = 24;
  const width = box.x2 - box.x1 + padding * 2;
  const height = box.y2 - box.y1 + padding * 2;
  setAttrs(copy, {
    xmlns: SVG_NS,
    viewBox: `${box.x1 - padding} ${box.y1 - padding} ${width} ${height}`,
    width,
    height,
  });
  copy.querySelector(".graph-layer")?.removeAttribute("transform");
  const pal = palette();
  const background = copy.querySelector(".graph-bg");
  if (background)
    setAttrs(background, {
      x: box.x1 - padding,
      y: box.y1 - padding,
      width,
      height,
      fill: pal.bg,
    });
  const impact = impactColors();
  const style = svgEl("style");
  style.textContent = `
    .node-label { fill: ${pal.fg}; font-family: ${LABEL_FONT.family}; }
    .band-label, .edge-label { fill: ${pal.muted}; }
    .edge-label { stroke: ${pal.bg}; stroke-width: 3; paint-order: stroke; font-size: 9px; }
    .edge-line { fill: none; stroke: ${pal.border}; stroke-width: 1.2; }
    .node-status-ring { display: none; fill: none; transform: scale(.92); transform-box: fill-box; transform-origin: center; }
    .status-verified .node-status-ring { display: block; }
    .dim { opacity: .28; }
    .node.sel .node-shape { stroke: ${impact.selected || pal.fg}; stroke-width: 4; }
    .node.up .node-shape { stroke: ${impact.upstream || pal.fg}; stroke-width: 3; }
    .node.down .node-shape { stroke: ${impact.downstream || pal.fg}; stroke-width: 3; }
    .node.rel .node-shape { stroke: ${impact.related || pal.fg}; stroke-width: 3; }
    .edge.on-path .edge-line { stroke: ${pal.fg}; stroke-width: 2; }
    .hit .node-shape { filter: drop-shadow(0 0 8px ${DATA.meta.search?.hit || pal.fg}); }
    .dim.hit { opacity: .65; }
    .trail-muted { opacity: .35; }
    .node.detail-path:not(.sel) .node-shape { stroke: ${impact.related || pal.fg}; stroke-width: 4; }
    .node.detail-target .node-shape { stroke-dasharray: 7 3; stroke-width: 5; }
    .edge.detail-path .edge-line { stroke: ${impact.related || pal.fg}; stroke-width: 4; }
  `;
  copy.prepend(style);
  const title = svgEl("title");
  title.textContent = DATA.title;
  copy.prepend(title);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`;
}

const exportSvg = getElement("export-svg");
exportSvg.addEventListener("click", () => {
  const text = currentSvg();
  if (!text) return;
  download("graph.svg", text, "image/svg+xml;charset=utf-8");
  exportMenu.open = false;
});
const exportMmd = getElement("export-mmd");
exportMmd.addEventListener("click", () => {
  download("graph.mmd", mermaidText(displayedView()), "text/plain;charset=utf-8");
  exportMenu.open = false;
});

// --- キーボード --------------------------------------------------------------
//
// SVG ノードを含む操作要素はすべてキーボードで辿れる。よく使う 2 つだけ、どこからでも
// 効く近道を置く。入力中の打鍵は奪わない。

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  //: 文字を打ち込める場所からは打鍵を奪わない。チェックボックスや範囲入力は
  //: 文字を受け取らないので、ここでは「入力中」に数えない。
  const typing =
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["SELECT", "TEXTAREA"].includes(target.tagName) ||
      (target instanceof HTMLInputElement &&
        !["checkbox", "radio", "range", "button"].includes(target.type)));

  if (event.key === "/" && !typing) {
    event.preventDefault();
    const search = getElement("search");
    search.focus();
    search.select();
    return;
  }
  if (event.key !== "Escape") return;
  //: フォーカス → 選択 → 検索語の順に解除し、その後で入力欄から手を離す。
  if (state.mode === "analysis") {
    event.preventDefault();
    exitFocus();
  } else if (state.selected) {
    event.preventDefault();
    state.selected = null;
    state.detail = null;
    refresh();
    writeHash();
  } else if (state.query) {
    event.preventDefault();
    applyQuery("");
  } else if (typing) {
    target.blur();
  }
});

window.addEventListener("popstate", applyHash);
window.addEventListener("hashchange", applyHash);

//: 図を組む前にテーマを確定させる (初期スタイルが CSS 変数を読むため)。
applyTheme();
const drawn = initGraph();
//: 描画ライブラリを読めなかったときは、写す図が無い。
exportSvg.disabled = !drawn;
renderFilters();
renderFocusOptions();
renderImpactControls();
syncControls();
renderStats();
setMode(state.mode);
// 解釈できない項目を落とした後の正しい URL に直す (履歴は増やさない)。
writeHash(false);
if (drawn) drawn.dataset.initialRenderMs = String(Date.now() - STARTED_AT);
