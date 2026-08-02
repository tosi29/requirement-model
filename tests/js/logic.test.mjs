/** site_logic.js のユニットテスト。`node --test tests/js/` で走る。 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeEdgeNames,
  allEdgeNames,
  createView,
  escapeHtml,
  graphElements,
  graphStyle,
  isNodeVisible,
  layoutOptions,
  nodeContext,
  reach,
  truncate,
  wrapLabel,
} from "../../src/reqmodel/site_logic.js";
import { allOn, fixture } from "./fixture.mjs";

const viewOf = (state) => {
  const data = fixture();
  return createView(data, { ...allOn(data), ...state });
};

// --- 絞り込み --------------------------------------------------------------

test("既定ではすべてのノードとエッジが見える", () => {
  const view = viewOf();
  assert.equal(view.nodes.length, 5);
  assert.equal(view.edges.length, 6);
});

test("ノード種別を外すと、その端点を持つエッジも消える", () => {
  const data = fixture();
  const types = new Set(data.types);
  types.delete("Source");
  const view = createView(data, { ...allOn(data), types });

  assert.deepEqual(
    view.nodes.map((n) => n.id),
    ["G-1", "N-1", "FR-1", "QR-1"],
  );
  assert.ok(!view.edges.some((e) => e.name === "has_source"));
});

test("エッジ種別を外すと、そのエッジだけが消える", () => {
  const data = fixture();
  const edges = new Set(data.edge_names);
  edges.delete("satisfies");
  const view = createView(data, { ...allOn(data), edges });

  assert.equal(view.nodes.length, 5);
  assert.ok(!view.edges.some((e) => e.name === "satisfies"));
  assert.ok(view.edges.some((e) => e.name === "motivates"));
});

test("全種別が選ばれているうちは「絞り込み無し」扱い", () => {
  assert.equal(activeEdgeNames(viewOf()), null);
});

test("絞り込み中は edge_names の並びで選択中の種別を返す", () => {
  const data = fixture();
  const edges = new Set(["satisfies", "has_source"]);
  const view = createView(data, { ...allOn(data), edges });

  assert.deepEqual(activeEdgeNames(view), ["has_source", "satisfies"]);
});

// --- 影響範囲 --------------------------------------------------------------

test("下流は辿れる先すべて、上流は辿り着ける元すべて", () => {
  const view = viewOf();

  assert.deepEqual([...reach(view, "FR-1", true)].sort(), ["N-1", "SRC-1"]);
  assert.deepEqual([...reach(view, "FR-1", false)].sort(), ["QR-1"]);
  assert.deepEqual([...reach(view, "N-1", false)].sort(), ["FR-1", "G-1", "QR-1"]);
});

test("始点は結果に含まれない", () => {
  const view = viewOf();
  for (const forward of [true, false]) {
    assert.ok(!reach(view, "FR-1", forward).has("FR-1"));
  }
});

test("エッジの絞り込みは影響範囲の計算にも効く", () => {
  const data = fixture();
  const edges = new Set(data.edge_names);
  edges.delete("qualifies");
  const view = createView(data, { ...allOn(data), edges });

  assert.deepEqual([...reach(view, "FR-1", false)], []);
});

test("閉路があっても止まる", () => {
  const data = fixture();
  data.edges.push(
    { source: "N-1", name: "has_source", target: "FR-1" },
    { source: "FR-1", name: "satisfies", target: "N-1" },
  );
  const view = createView(data, allOn(data));

  assert.ok(reach(view, "FR-1", true).has("N-1"));
  assert.ok(!reach(view, "FR-1", true).has("FR-1"));
});

// --- ラベル整形 ------------------------------------------------------------

test("truncate は末尾を省略記号に置き換える", () => {
  assert.equal(truncate("あいうえお", 10), "あいうえお");
  assert.equal(truncate("あいうえおかきくけこ", 5), "あいうえ…");
  assert.equal(truncate("あいうえお", 5), "あいうえお");
});

test("wrapLabel は日本語を桁数で折り返す", () => {
  assert.equal(wrapLabel("あいうえおかきくけこさ", 5), "あいうえお\nかきくけこ\nさ");
});

test("wrapLabel は空白があればそこで折り返す", () => {
  assert.equal(wrapLabel("abc defg hij", 5), "abc\ndefg\nhij");
});

test("wrapLabel は割り切れるとき空行を作らない", () => {
  assert.equal(wrapLabel("あいうえおかきくけこ", 5), "あいうえお\nかきくけこ");
  assert.equal(wrapLabel("", 5), "");
});

test("escapeHtml は < & > だけを潰す", () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href="x"&gt;&amp;&lt;/a&gt;');
});

// --- コピー本文 ------------------------------------------------------------
//
// `req explain` との一致は tests/test_site_js.py が Python 側と突き合わせる。
// ここでは絞り込みの反映など、サイト固有の振る舞いだけを見る。

test("nodeContext は対象・上流・下流・エッジを並べる", () => {
  const text = nodeContext(viewOf(), "FR-1");

  assert.match(text, /^# 影響部分グラフ: FR-1\n/);
  assert.match(text, /対象 1 件 \/ 上流 1 件 \/ 下流 2 件 \/ 合計 4 件/);
  assert.match(text, /## 対象ノード \(1 件\)\n- \[FunctionalRequirement\] FR-1: /);
  assert.match(text, /    受け入れ基準: 正解率が 95% 以上である/);
  assert.match(text, /## 上流 \(この変更の理由・根拠になるノード\) \(1 件\)/);
  assert.match(text, /## 下流 \(この変更の影響を受けるノード\) \(2 件\)/);
  assert.match(text, /- FR-1 --satisfies--> N-1/);
  assert.ok(text.endsWith("\n"));
});

test("nodeContext は priority / kind / decomposition を属性行に出す", () => {
  const text = nodeContext(viewOf(), "G-1");

  assert.match(text, /- \[Goal\] G-1: .*\n {4}\(status=approved, priority=1\)/);
  assert.match(text, /- \[Source\] SRC-1: .*\n {4}\(status=proposed, kind=stakeholder\)/);
  // G-1 は誰からも refines されていないので decomposition は出ない。
  assert.ok(!text.includes("decomposition="));
});

test("子から refines されている Goal にだけ decomposition が付く", () => {
  const data = fixture();
  data.nodes.push({
    type: "Goal",
    id: "G-2",
    text: "承認を速くする",
    status: "proposed",
    priority: null,
    has_source: [],
    decomposition: "AND",
    refines: ["G-1"],
    motivates: [],
  });
  data.edges.push({ source: "G-2", name: "refines", target: "G-1" });
  const view = createView(data, allOn(data));

  assert.match(nodeContext(view, "G-2"), /G-1: .*\n {4}\(status=approved, priority=1, decomposition=AND\)/);
});

test("エッジを絞ると nodeContext にフィルタ行が出る", () => {
  const data = fixture();
  const edges = new Set(["satisfies", "motivates"]);
  const view = createView(data, { ...allOn(data), edges });
  const text = nodeContext(view, "FR-1");

  assert.match(text, /エッジ種別フィルタ: motivates, satisfies/);
  assert.ok(!text.includes("SRC-1"));
});

test("絞り込みが無ければフィルタ行は出ない", () => {
  assert.ok(!nodeContext(viewOf(), "FR-1").includes("エッジ種別フィルタ"));
});

test("部分グラフに現れなかったエッジ種別を末尾に並べる", () => {
  const text = nodeContext(viewOf(), "FR-1");

  assert.match(text, /\(部分グラフに現れなかったエッジ種別: refines, motivates, conflicts\)\n$/);
});

test("allEdgeNames はノード型から現れうるエッジ種別を数える", () => {
  assert.deepEqual(allEdgeNames(fixture()), [
    "has_source",
    "refines",
    "motivates",
    "satisfies",
    "conflicts",
    "qualifies",
  ]);
});

// --- Cytoscape に渡す値 -----------------------------------------------------

test("graphElements はノードとエッジをそのまま要素にする", () => {
  const elements = graphElements(fixture());

  assert.equal(elements.length, 11);
  assert.equal(elements[0].data.id, "G-1");
  assert.equal(elements[0].data.type, "Goal");
  assert.match(elements[0].data.label, /^G-1\n/);
  assert.deepEqual(elements[5].data, {
    id: "e0",
    index: 0,
    source: "G-1",
    target: "SRC-1",
    name: "has_source",
  });
});

test("graphStyle は render_meta の形状・配色をそのまま使う", () => {
  const meta = fixture().meta;
  meta.types.Goal = { shape: "hexagon", fill: "#e8f0fe", stroke: "#3b6fd4" };
  const style = graphStyle(meta, {
    fg: "#111",
    bg: "#fff",
    border: "#ddd",
    muted: "#666",
  });

  const goal = style.find((rule) => rule.selector === 'node[type = "Goal"]');
  assert.deepEqual(goal.style, {
    shape: "hexagon",
    "background-color": "#e8f0fe",
    "border-color": "#3b6fd4",
  });

  const selected = style.find((rule) => rule.selector === "node.sel");
  assert.equal(selected.style["border-color"], meta.impact_colors.selected);

  const edge = style.find((rule) => rule.selector === "edge");
  assert.equal(edge.style["line-color"], "#ddd");
  assert.equal(edge.style.color, "#666");
});

test("layoutOptions は TD / LR を dagre の rankDir に写す", () => {
  assert.equal(layoutOptions("TD").rankDir, "TB");
  assert.equal(layoutOptions("LR").rankDir, "LR");
  assert.equal(layoutOptions("TD").animate, false);
});

// --- 選択ノードの追従 -------------------------------------------------------

const EXTENT = { x1: 0, y1: 0, x2: 400, y2: 300 };
const box = (x1, y1, width = 60, height = 30) => ({
  x1,
  y1,
  x2: x1 + width,
  y2: y1 + height,
});

test("表示範囲の内側にあるノードは見えている扱い", () => {
  assert.equal(isNodeVisible(EXTENT, box(100, 100)), true);
});

test("表示範囲の外にあるノードは見えていない扱い", () => {
  assert.equal(isNodeVisible(EXTENT, box(500, 100)), false);
  assert.equal(isNodeVisible(EXTENT, box(-100, 100)), false);
  assert.equal(isNodeVisible(EXTENT, box(100, 400)), false);
  assert.equal(isNodeVisible(EXTENT, box(100, -50)), false);
});

test("端に掛かっているノードは余白の分だけ外側と見なす", () => {
  const edge = box(350, 100); // x2 = 410 で右端 (400) をはみ出す
  assert.equal(isNodeVisible(EXTENT, edge), false);

  const inside = box(300, 100); // x2 = 360。余白 40 でちょうど収まる
  assert.equal(isNodeVisible(EXTENT, inside, 40), true);
  assert.equal(isNodeVisible(EXTENT, box(310, 100), 40), false);
});

test("視野より大きいノードは中心が見えていれば十分", () => {
  const huge = box(-100, -50, 600, 400);
  assert.equal(isNodeVisible(EXTENT, huge), true);

  const offCenter = box(300, -50, 600, 400); // 中心 x=600 は右端の外
  assert.equal(isNodeVisible(EXTENT, offCenter), false);
});
