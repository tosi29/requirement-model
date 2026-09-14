import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createView, defaultState, decodeHash, encodeHash, focusedNodes, focusTrail,
  analysisBandLayout, impactScope, selectNodeState, storableHash,
} from "../../src/reqmodel/presentation/site_logic.ts";
import { fixture } from "./fixture.mjs";

const viewFor = (overrides = {}, data = fixture()) =>
  createView(data, { ...defaultState(data), selected: "FR-1", mode: "analysis", ...overrides });
const ids = (set) => [...set].sort();

test("分析の上流・下流は向きを反転して兄弟へ広がらない", () => {
  assert.deepEqual(ids(focusedNodes(viewFor())), ["FR-1", "Need-1", "QR-1"]);
  assert.deepEqual(ids(focusedNodes(viewFor({ mode: "graph", focus: 2 }))), ["FR-1", "Goal-1", "Need-1", "QR-1"]);
});

test("分析の深さ・種別・エッジの絞り込みを探索にも適用する", () => {
  assert.deepEqual(ids(focusedNodes(viewFor({ selected: "QR-1", depth: 1 }))), ["FR-1", "QR-1"]);
  assert.deepEqual(ids(focusedNodes(viewFor({ edges: new Set(["qualifies"]) }))), ["FR-1", "QR-1"]);
  const view = viewFor({ types: new Set(["QualityRequirement", "Need"]), selected: "QR-1" });
  assert.deepEqual(ids(focusedNodes(view)), ["QR-1"]);
  assert.equal(focusedNodes(viewFor({ statuses: new Set(["approved"]) })).size, 0);
});

test("起点がフィルタで消えたら空の図を保ち、選択なし・切では全体を表示する", () => {
  assert.equal(focusedNodes(viewFor({ types: new Set() })).size, 0);
  assert.equal(focusedNodes(viewFor({ selected: null })).size, 0);
  assert.equal(focusedNodes(viewFor({ mode: "graph", focus: 0 })), null);
});

test("分析中は有向、近傍と通常表示では元の向き設定を使う", () => {
  assert.equal(impactScope(viewFor({ undirected: true }).state).undirected, false);
  assert.equal(impactScope(viewFor({ mode: "graph", focus: 2, undirected: true }).state).undirected, true);
});

test("フォーカス中のクリック・再クリックは起点と表示範囲を固定する", () => {
  for (const focus of [0, 1, 2, 3]) {
    const view = viewFor({ focus });
    const before = focusedNodes(view);
    const next = selectNodeState(view.state, "QR-1");
    assert.equal(next.selected, "FR-1");
    assert.equal(next.detail, "QR-1");
    assert.equal(view.state.detail, null);
    assert.deepEqual(focusedNodes(createView(view.data, next)), before);
    assert.deepEqual(selectNodeState(next, "QR-1"), next);
    assert.equal(selectNodeState(next, "FR-1").detail, null);
  }
});

test("起点未選択なら最初のクリックで固定し、通常モードでは選択をトグルする", () => {
  let state = viewFor({ selected: null }).state;
  state = selectNodeState(state, "FR-1");
  assert.equal(state.selected, "FR-1");
  state = selectNodeState({ ...state, mode: "graph" }, "FR-1");
  assert.equal(state.selected, null);
  assert.equal(state.detail, null);
});

test("detail の経路は実際に辿ったエッジだけを含む", () => {
  const view = viewFor({ selected: "QR-1", detail: "Need-1" });
  const trail = focusTrail(view);
  assert.deepEqual(ids(trail.nodes), ["FR-1", "Need-1", "QR-1"]);
  assert.deepEqual([...trail.edges].map((edge) => edge.name).sort(), ["qualifies", "satisfies"]);
  assert.equal(focusTrail(viewFor({ detail: "Goal-1" })).nodes.size, 0);
  assert.equal(focusTrail(viewFor({ focus: 1, detail: "Goal-1" })).nodes.size, 0);
  assert.equal(focusTrail(viewFor({ mode: "graph", focus: 2, detail: "Goal-1" })).edges.size, 0);
});

test("循環・複数経路・平行エッジを落とさず全経路を強調する", () => {
  const data = fixture();
  data.edges.push(
    { source: "QR-1", target: "Need-1", name: "qualifies" },
    { source: "Need-1", target: "QR-1", name: "motivates" },
    { source: "QR-1", target: "Need-1", name: "constrains" },
  );
  const view = viewFor({ selected: "QR-1", detail: "Need-1" }, data);
  const trail = focusTrail(view);
  assert.deepEqual(ids(trail.nodes), ["FR-1", "Need-1", "QR-1"]);
  assert.equal(trail.edges.size, 5);
  assert.deepEqual(focusTrail(view), trail);
});

test("起点・向き・detail を URL から復元し、次回訪問にはノードを持ち越さない", () => {
  const view = viewFor({ detail: "QR-1", depth: 2 });
  const hash = encodeHash(view.state, view.data);
  assert.equal(hash, "#node=FR-1&view=analysis&detail=QR-1&depth=2");
  assert.deepEqual(decodeHash(hash, view.data), view.state);
  assert.equal(storableHash(view.state, view.data), "#depth=2");
  for (const hash of ["#detail=QR-1", "#node=FR-1&detail=QR-1", "#node=FR-1&view=analysis&detail=NOPE"]) {
    assert.equal(decodeHash(hash, view.data).detail, null);
  }
  assert.equal(decodeHash("#focus=bogus", view.data).focus, 0);
});

test("経路の途中で向きを反転する短絡を分析では採用しない", () => {
  const data = fixture();
  data.edges = [
    { source: "QR-1", target: "FR-1", name: "qualifies" },
    { source: "FR-1", target: "Need-1", name: "satisfies" },
    { source: "Need-1", target: "Goal-1", name: "motivates" },
    { source: "Need-1", target: "QR-1", name: "constrains" },
  ];
  const view = viewFor({ selected: "QR-1", detail: "Goal-1" }, data);
  assert.equal(focusTrail(view).edges.size, 4);
  assert.equal(focusTrail(viewFor({ ...view.state, mode: "graph", focus: 3 }, data)).edges.size, 0);
});

test("通常グラフの近傍表示は選択を固定せず、分析タブだけで固定する", () => {
  const view = viewFor({ mode: "graph", focus: 2 });
  const next = selectNodeState(view.state, "QR-1");
  assert.equal(next.selected, "QR-1");
  assert.equal(next.detail, null);
});

test("分析は型や要求グループに関係なく上流・起点・下流を順に配置する", () => {
  const view = viewFor();
  const placed = view.nodes.filter(n => focusedNodes(view).has(n.id))
    .map((n, i) => ({ ...n, x: i * 80, y: i * 60, w: 50, h: 30 }));
  for (const direction of ["TD", "LR"]) {
    const { positions, frames } = analysisBandLayout(view, placed, direction);
    assert.deepEqual([...frames.keys()], ["analysis:upstream", "analysis:downstream"]);
    const axis = direction === "TD" ? "y" : "x";
    assert(positions.get("QR-1")[axis] < positions.get("FR-1")[axis]);
    assert(positions.get("FR-1")[axis] < positions.get("Need-1")[axis]);
    for (const [id, key] of [["QR-1", "analysis:upstream"], ["Need-1", "analysis:downstream"]]) {
      const box = frames.get(key), point = positions.get(id);
      assert(point.x - 25 >= box.x - box.w / 2);
      assert(point.x + 25 <= box.x + box.w / 2);
      assert(point.y - 15 >= box.y - box.h / 2);
      assert(point.y + 15 <= box.y + box.h / 2);
    }
  }
});

test("循環で両方向に属するノードも重複させず配置する", () => {
  const data = fixture();
  data.edges.push({ source: "Need-1", target: "FR-1", name: "motivates" });
  const view = viewFor({}, data);
  const placed = view.nodes.filter(n => focusedNodes(view).has(n.id))
    .map((n, i) => ({ ...n, x: i * 80, y: i * 60, w: 50, h: 30 }));
  const layout = analysisBandLayout(view, placed, "TD");
  assert(layout.frames.has("analysis:shared"));
  assert.equal(layout.positions.size, placed.length);
});

test("Need-4 から FR-18 を確認すると直結と FR-10 経由の両方を強調する", () => {
  const base = fixture();
  const node = (id) => ({ ...base.nodes[2], id });
  const data = fixture({
    nodes: ["Need-4", "FR-18", "FR-10", "Goal-2", "Constraint-1"].map(node),
    edges: [
      { source: "FR-18", target: "Need-4", name: "satisfies" },
      { source: "FR-18", target: "FR-10", name: "refines" },
      { source: "FR-10", target: "Need-4", name: "satisfies" },
      { source: "Goal-2", target: "Need-4", name: "motivates" },
      { source: "Constraint-1", target: "FR-10", name: "constrains" },
    ],
  });
  const view = viewFor({ selected: "Need-4", detail: "FR-18" }, data);
  const trail = focusTrail(view);
  assert.deepEqual(ids(trail.nodes), ["FR-10", "FR-18", "Need-4"]);
  assert.deepEqual(new Set(trail.edges), new Set(data.edges.slice(0, 3)));
  const filtered = viewFor({ ...view.state, edges: new Set(["satisfies"]) }, data);
  assert.deepEqual([...focusTrail(filtered).edges], [data.edges[0]]);
});
