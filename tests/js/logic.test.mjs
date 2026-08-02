/** site_logic.js のユニットテスト。`node --test tests/js/` で走る。 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PRIORITY_BUCKETS,
  TABLE_COLUMNS,
  activeEdgeNames,
  allEdgeNames,
  createView,
  escapeHtml,
  graphElements,
  graphStyle,
  isNodeVisible,
  layoutOptions,
  legendGroups,
  matchesQuery,
  nextSort,
  nodeContext,
  priorityBucket,
  priorityFilters,
  reach,
  sortRows,
  statusFilters,
  tableRows,
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

test("status を外すと、そのノードとそこに繋がるエッジが消える", () => {
  const data = fixture();
  const statuses = new Set(["approved"]); // proposed の FR-1 / QR-1 / SRC-1 が消える
  const view = createView(data, { ...allOn(data), statuses });

  assert.deepEqual(
    view.nodes.map((n) => n.id),
    ["G-1", "N-1"],
  );
  assert.deepEqual(
    view.edges.map((e) => e.name),
    ["motivates"],
  );
});

test("優先度の区分を外すと、その区分のノードが消える", () => {
  const data = fixture();
  const priorities = new Set(["high"]); // priority <= 2 の G-1 / FR-1 だけ残る
  const view = createView(data, { ...allOn(data), priorities });

  assert.deepEqual(
    view.nodes.map((n) => n.id),
    ["G-1", "FR-1"],
  );
  // 端点が消えたので、両者を繋がないエッジは 1 本も残らない。
  assert.equal(view.edges.length, 0);
});

test("status / 優先度の絞り込みは影響範囲の計算にも効く", () => {
  const data = fixture();
  const all = createView(data, allOn(data));
  assert.ok(reach(all, "QR-1", true).has("N-1")); // QR-1 → FR-1 → N-1

  // 中継点の FR-1 (proposed かつ high) を落とすと、その先へは辿れなくなる。
  const statuses = new Set(["approved", "verified", "implemented"]);
  const view = createView(data, { ...allOn(data), statuses });
  assert.equal(reach(view, "QR-1", true).size, 0);
});

test("statuses / priorities を渡さない state は絞り込み無し扱い", () => {
  const data = fixture();
  const view = createView(data, {
    types: new Set(data.types),
    edges: new Set(data.edge_names),
  });

  assert.equal(view.nodes.length, 5);
  assert.equal(view.edges.length, 6);
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

// --- status / 優先度 --------------------------------------------------------

test("priorityBucket はしきい値で高優先とその他を分け、null は未設定にする", () => {
  const data = fixture(); // meta.priority.threshold === 2
  assert.equal(priorityBucket(data, { priority: 0 }), "high");
  assert.equal(priorityBucket(data, { priority: 2 }), "high");
  assert.equal(priorityBucket(data, { priority: 3 }), "normal");
  assert.equal(priorityBucket(data, { priority: null }), "none");
  assert.equal(priorityBucket(data, {}), "none");
});

test("statusFilters は成熟度の順に、絞り込み前の件数を添えて返す", () => {
  assert.deepEqual(statusFilters(fixture()), [
    { key: "proposed", label: "proposed", count: 3 },
    { key: "approved", label: "approved", count: 2 },
    { key: "implemented", label: "implemented", count: 0 },
    { key: "verified", label: "verified", count: 0 },
  ]);
});

test("priorityFilters は区分ごとの件数を返し、高優先にはしきい値を添える", () => {
  assert.deepEqual(priorityFilters(fixture()), [
    { key: "high", label: "高優先 (≤ 2)", count: 2 },
    { key: "normal", label: "その他", count: 0 },
    { key: "none", label: "未設定", count: 3 },
  ]);
});

test("PRIORITY_BUCKETS は絞り込みの全区分を覆う", () => {
  const data = fixture();
  const keys = new Set(PRIORITY_BUCKETS.map((bucket) => bucket.key));
  for (const node of data.nodes) assert.ok(keys.has(priorityBucket(data, node)));
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

// --- テーブル --------------------------------------------------------------

const FINDINGS = [
  { code: "structure.orphan_qr", severity: "warning", layer: 1, node_id: "QR-1", message: "x" },
  { code: "structure.missing_source", severity: "error", layer: 1, node_id: "QR-1", message: "y" },
  { code: "text.vague", severity: "info", layer: 2, node_id: "FR-1", message: "z" },
  { code: "graph.cycle", severity: "severe", layer: 1, node_id: null, message: "全体" },
];

const rowsOf = (state, query) => {
  const data = fixture({ findings: FINDINGS });
  const view = createView(data, { ...allOn(data), ...state });
  return { view, rows: tableRows(view, query) };
};

const idsSortedBy = (key, asc) => {
  const { view, rows } = rowsOf();
  return sortRows(view, rows, { key, asc }).map((row) => row.id);
};

test("tableRows は 1 ノード 1 行にし、受け入れ基準と指摘を数える", () => {
  const { rows } = rowsOf();

  assert.equal(rows.length, 5);
  assert.deepEqual(rows.find((row) => row.id === "FR-1"), {
    id: "FR-1",
    type: "FunctionalRequirement",
    text: "領収書画像から金額を抽出すること",
    status: "proposed",
    priority: 2,
    criteria: 1,
    findings: 1,
    severity: "info",
  });
  // 受け入れ基準を持たない型は 0 件、指摘の無いノードは 0 件。
  const source = rows.find((row) => row.id === "SRC-1");
  assert.equal(source.criteria, 0);
  assert.equal(source.findings, 0);
  assert.equal(source.severity, null);
});

test("行の severity は最も重い指摘のもの", () => {
  const { rows } = rowsOf();
  const qr = rows.find((row) => row.id === "QR-1");

  assert.equal(qr.findings, 2);
  assert.equal(qr.severity, "error");
});

test("ノードに紐づかない指摘はどの行にも数えない", () => {
  const { rows } = rowsOf();
  assert.equal(rows.reduce((total, row) => total + row.findings, 0), 3);
});

test("テーブルは絞り込み後のノードだけを出す", () => {
  const types = new Set(fixture().types);
  types.delete("Source");
  const { rows } = rowsOf({ types });

  assert.ok(!rows.some((row) => row.id === "SRC-1"));
});

test("検索語は id と本文の部分一致で効く", () => {
  assert.deepEqual(rowsOf({}, "fr-").rows.map((row) => row.id), ["FR-1"]);
  assert.deepEqual(rowsOf({}, "領収書").rows.map((row) => row.id), ["N-1", "FR-1"]);
  assert.equal(rowsOf({}, "  ").rows.length, 5);
});

test("matchesQuery は空の検索語をすべて通す", () => {
  const node = { id: "FR-1", text: "領収書画像から金額を抽出すること" };
  assert.equal(matchesQuery(node, ""), true);
  assert.equal(matchesQuery(node, "金額"), true);
  assert.equal(matchesQuery(node, "見積"), false);
});

test("文字の列は素直に昇順・降順", () => {
  assert.deepEqual(idsSortedBy("id", true), ["FR-1", "G-1", "N-1", "QR-1", "SRC-1"]);
  assert.deepEqual(idsSortedBy("id", false), ["SRC-1", "QR-1", "N-1", "G-1", "FR-1"]);
});

test("type は種別の定義順に並ぶ (辞書順ではない)", () => {
  assert.deepEqual(idsSortedBy("type", true), ["G-1", "N-1", "FR-1", "QR-1", "SRC-1"]);
});

test("status は成熟度の順に並ぶ (辞書順ではない)", () => {
  assert.deepEqual(idsSortedBy("status", true), ["FR-1", "QR-1", "SRC-1", "G-1", "N-1"]);
});

test("値の無い行は向きに関わらず末尾に置く", () => {
  assert.deepEqual(idsSortedBy("priority", true), ["G-1", "FR-1", "N-1", "QR-1", "SRC-1"]);
  assert.deepEqual(idsSortedBy("priority", false), ["FR-1", "G-1", "N-1", "QR-1", "SRC-1"]);
});

test("指摘の多い順に並べられる", () => {
  assert.deepEqual(idsSortedBy("findings", false), ["QR-1", "FR-1", "G-1", "N-1", "SRC-1"]);
});

test("同値の行は正規化 JSON の並び (型順 → id 順) で決まる", () => {
  // 指摘 0 件の 3 行は、昇順でも降順でも常にこの並びになる。
  const ascending = idsSortedBy("findings", true).slice(0, 3);
  assert.deepEqual(ascending, ["G-1", "N-1", "SRC-1"]);
});

test("sortRows は渡された配列を書き換えない", () => {
  const { view, rows } = rowsOf();
  const before = rows.map((row) => row.id);
  sortRows(view, rows, { key: "id", asc: false });

  assert.deepEqual(rows.map((row) => row.id), before);
});

test("同じ列を押すと向きが反転する", () => {
  assert.deepEqual(nextSort({ key: "id", asc: true }, "id"), { key: "id", asc: false });
  assert.deepEqual(nextSort({ key: "id", asc: false }, "id"), { key: "id", asc: true });
});

test("別の列を押すと、数の列は多い順・文字の列は昇順から始まる", () => {
  assert.deepEqual(nextSort({ key: "id", asc: true }, "findings"), {
    key: "findings",
    asc: false,
  });
  assert.deepEqual(nextSort({ key: "findings", asc: false }, "status"), {
    key: "status",
    asc: true,
  });
});

test("知らない列を押しても並び順は変わらない", () => {
  const sort = { key: "id", asc: true };
  assert.equal(nextSort(sort, "unknown"), sort);
});

test("列の定義には issue の求める項目が揃っている", () => {
  assert.deepEqual(
    TABLE_COLUMNS.map((column) => column.key),
    ["id", "type", "text", "status", "priority", "criteria", "findings"],
  );
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

test("graphElements は status と優先度区分をデータに載せる", () => {
  const elements = graphElements(fixture());

  assert.equal(elements[0].data.status, "approved"); // G-1
  assert.equal(elements[0].data.priorityClass, "high"); // priority = 1
  assert.equal(elements[1].data.status, "approved"); // N-1
  assert.equal(elements[1].data.priorityClass, "none"); // priority 無し
  assert.equal(elements[3].data.priorityClass, "none"); // QR-1
});

test("graphStyle は status を線種に、高優先度を outline に写す", () => {
  const style = graphStyle(fixture().meta, {
    fg: "#111",
    bg: "#fff",
    border: "#ddd",
    muted: "#666",
  });

  const proposed = style.find((rule) => rule.selector === 'node[status = "proposed"]');
  assert.deepEqual(proposed.style, { "border-style": "dotted", "border-width": 1.5 });
  const verified = style.find((rule) => rule.selector === 'node[status = "verified"]');
  assert.deepEqual(verified.style, { "border-style": "double", "border-width": 4 });

  // 線種だけで 4 つの status を区別できること (太さは影響範囲に奪われるため)。
  const lines = Object.keys(fixture().meta.statuses).map(
    (status) =>
      style.find((rule) => rule.selector === `node[status = "${status}"]`).style[
        "border-style"
      ],
  );
  assert.equal(new Set(lines).size, lines.length);

  const high = style.find((rule) => rule.selector === 'node[priorityClass = "high"]');
  assert.equal(high.style["outline-color"], "#f9ab00");
  assert.ok(high.style["outline-width"] > 0);
});

test("影響範囲の規則は型・status より後に置かれる (後勝ちなので上書きできる)", () => {
  const style = graphStyle(fixture().meta, {
    fg: "#111",
    bg: "#fff",
    border: "#ddd",
    muted: "#666",
  });
  const at = (selector) => style.findIndex((rule) => rule.selector === selector);

  assert.ok(at('node[type = "Goal"]') < at('node[status = "proposed"]'));
  assert.ok(at('node[status = "proposed"]') < at("node.sel"));
  assert.ok(at('node[priorityClass = "high"]') < at("node.sel"));
  assert.ok(at("node.sel") < at("node.up") && at("node.up") < at("node.down"));

  // 影響範囲が奪うのは色と太さだけ。線種と outline は強調中も残る。
  for (const selector of ["node.sel", "node.up", "node.down"]) {
    const keys = Object.keys(style.find((rule) => rule.selector === selector).style);
    assert.ok(!keys.includes("border-style"));
    assert.ok(!keys.some((key) => key.startsWith("outline-")));
  }
});

test("legendGroups は実際のスタイル (配色・線種・輪) から凡例を作る", () => {
  const groups = legendGroups(fixture().meta);

  assert.deepEqual(
    groups.map((group) => group.title),
    ["種別", "status", "優先度"],
  );
  assert.equal(groups[0].items.length, fixture().types.length);

  const statuses = groups[1];
  assert.deepEqual(
    statuses.items.map((item) => item.label),
    ["proposed", "approved", "implemented", "verified"],
  );
  assert.equal(statuses.items[0].swatch.borderStyle, "dotted");
  // 見本は小さいので、太い枠は頭打ちにする (double の 4px はそのままでは潰れる)。
  assert.equal(statuses.items[3].swatch.borderStyle, "double");
  assert.equal(statuses.items[3].swatch.borderWidth, 3);

  assert.equal(groups[2].items[0].label, "高優先 (≤ 2)");
  assert.equal(groups[2].items[0].swatch.borderColor, "#f9ab00");
});

test("status / 優先度の定義が無い meta でも凡例と描画は壊れない", () => {
  const meta = { types: fixture().meta.types, impact_colors: {} };
  const style = graphStyle(meta, { fg: "#111", bg: "#fff", border: "#ddd", muted: "#666" });

  assert.ok(!style.some((rule) => rule.selector.startsWith("node[status")));
  assert.deepEqual(
    legendGroups(meta).map((group) => group.title),
    ["種別"],
  );
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
