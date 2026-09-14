import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createView, defaultState, decodeHash, encodeHash, focusedNodes, focusTrail,
  impactScope, selectNodeState, storableHash,
} from "../../src/reqmodel/presentation/site_logic.ts";
import { fixture } from "./fixture.mjs";

const viewFor = (overrides = {}, data = fixture()) =>
  createView(data, { ...defaultState(data), selected: "FR-1", focus: "impact", ...overrides });
const ids = (set) => [...set].sort();

test("分析の上流・下流は向きを反転して兄弟へ広がらない", () => {
  assert.deepEqual(ids(focusedNodes(viewFor())), ["FR-1", "Need-1", "QR-1"]);
  assert.deepEqual(ids(focusedNodes(viewFor({ focus: "upstream" }))), ["FR-1", "QR-1"]);
  assert.deepEqual(ids(focusedNodes(viewFor({ focus: "downstream" }))), ["FR-1", "Need-1"]);
  assert.deepEqual(ids(focusedNodes(viewFor({ focus: 2 }))), ["FR-1", "Goal-1", "Need-1", "QR-1"]);
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
  assert.equal(focusedNodes(viewFor({ selected: null })), null);
  assert.equal(focusedNodes(viewFor({ focus: 0 })), null);
});

test("分析中は有向、近傍と通常表示では元の向き設定を使う", () => {
  assert.equal(impactScope(viewFor({ undirected: true }).state).undirected, false);
  assert.equal(impactScope(viewFor({ focus: 2, undirected: true }).state).undirected, true);
});

test("フォーカス中のクリック・再クリックは起点と表示範囲を固定する", () => {
  for (const focus of [1, 2, 3, "impact", "upstream", "downstream"]) {
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
  state = selectNodeState({ ...state, focus: 0 }, "FR-1");
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
  assert.equal(focusTrail(viewFor({ focus: 2, detail: "Goal-1" })).edges.size, 2);
});

test("循環・複数経路があっても最短の有向経路を安定して選ぶ", () => {
  const data = fixture();
  data.edges.push(
    { source: "QR-1", target: "Need-1", name: "qualifies" },
    { source: "Need-1", target: "QR-1", name: "motivates" },
    { source: "QR-1", target: "Need-1", name: "constrains" },
  );
  const view = viewFor({ selected: "QR-1", detail: "Need-1", focus: "downstream" }, data);
  const trail = focusTrail(view);
  assert.deepEqual(ids(trail.nodes), ["Need-1", "QR-1"]);
  assert.deepEqual([...trail.edges], [data.edges[3]]);
  assert.deepEqual(focusTrail(view), trail);
});

test("起点・向き・detail を URL から復元し、次回訪問にはノードを持ち越さない", () => {
  const view = viewFor({ detail: "QR-1", depth: 2 });
  const hash = encodeHash(view.state, view.data);
  assert.equal(hash, "#node=FR-1&focus=impact&detail=QR-1&depth=2");
  assert.deepEqual(decodeHash(hash, view.data), view.state);
  assert.equal(storableHash(view.state, view.data), "#focus=impact&depth=2");
  for (const hash of ["#detail=QR-1", "#node=FR-1&detail=QR-1", "#node=FR-1&focus=impact&detail=NOPE"]) {
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
  const view = viewFor({ selected: "QR-1", detail: "Goal-1", focus: "downstream" }, data);
  assert.equal(focusTrail(view).edges.size, 3);
  assert.equal(focusTrail(viewFor({ ...view.state, focus: 3 }, data)).edges.size, 2);
});
