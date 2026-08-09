/** site_logic.js のユニットテスト。`node --test tests/js/` で走る。 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FOCUS_DEPTHS,
  LABEL_FONT,
  LABEL_MAX_LENGTH,
  LABEL_WRAP_WIDTH,
  TABLE_COLUMNS,
  ALL_SEVERITIES,
  activeEdgeNames,
  allEdgeNames,
  bandDefs,
  bandId,
  bandedLayout,
  createView,
  decodeHash,
  defaultState,
  edgeControl,
  edgeItems,
  encodeHash,
  escapeHtml,
  estimateTextWidth,
  explainCommand,
  focusSet,
  graphElements,
  graphSvg,
  groupFindings,
  impactScope,
  impactSets,
  initialHash,
  isNodeVisible,
  labelChunks,
  layoutOptions,
  legendGroups,
  matchesQuery,
  mermaidText,
  nextSort,
  nextTheme,
  nodeContext,
  nodeSize,
  normalizeTheme,
  reach,
  quadraticPath,
  quadraticPoint,
  related,
  searchHits,
  severityTabs,
  sortRows,
  sourceItems,
  sourceLabel,
  sourceUrl,
  statusFilters,
  stepHit,
  storableHash,
  tableRows,
  truncate,
  visibleBandKeys,
  wrapLabel,
} from "../../src/reqmodel/presentation/site_logic.js";
import { ELLIPSE_FIT, allOn, defaultOn, fixture, largeFixture } from "./fixture.mjs";

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
    ["Goal-1", "Need-1", "FR-1", "QR-1"],
  );
  assert.ok(!view.edges.some((e) => e.name === "has_source"));
});

test("status を外すと、そのノードとそこに繋がるエッジが消える", () => {
  const data = fixture();
  const statuses = new Set(["approved"]); // proposed の FR-1 / QR-1 / SRC-1 が消える
  const view = createView(data, { ...allOn(data), statuses });

  assert.deepEqual(
    view.nodes.map((n) => n.id),
    ["Goal-1", "Need-1"],
  );
  assert.deepEqual(
    view.edges.map((e) => e.name),
    ["motivates"],
  );
});

test("status の絞り込みは影響範囲の計算にも効く", () => {
  const data = fixture();
  const all = createView(data, allOn(data));
  assert.ok(reach(all, "QR-1", true).has("Need-1")); // QR-1 → FR-1 → Need-1

  // 中継点の FR-1 (proposed) を落とすと、その先へは辿れなくなる。
  const statuses = new Set(["approved", "verified", "implemented"]);
  const view = createView(data, { ...allOn(data), statuses });
  assert.equal(reach(view, "QR-1", true).size, 0);
});

test("statuses を渡さない state は絞り込み無し扱い", () => {
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

  assert.deepEqual([...reach(view, "FR-1", true)].sort(), ["Need-1", "SRC-1"]);
  assert.deepEqual([...reach(view, "FR-1", false)].sort(), ["QR-1"]);
  assert.deepEqual([...reach(view, "Need-1", false)].sort(), ["FR-1", "Goal-1", "QR-1"]);
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
    { source: "Need-1", name: "has_source", target: "FR-1" },
    { source: "FR-1", name: "satisfies", target: "Need-1" },
  );
  const view = createView(data, allOn(data));

  assert.ok(reach(view, "FR-1", true).has("Need-1"));
  assert.ok(!reach(view, "FR-1", true).has("FR-1"));
});

test("知らない id からは何も辿れない", () => {
  const view = viewOf();

  assert.equal(reach(view, "NOPE", true).size, 0);
  assert.equal(reach(view, "NOPE", false).size, 0);
});

// --- 深さ / 無向 (req explain --depth / --undirected 相当) --------------------

test("深さを指定すると、そのホップ数までしか辿らない", () => {
  const view = viewOf();

  // QR-1 → FR-1 → Need-1 → (SRC-1)
  assert.deepEqual([...reach(view, "QR-1", true, 1)], ["FR-1"]);
  assert.deepEqual([...reach(view, "QR-1", true, 2)].sort(), ["FR-1", "Need-1", "SRC-1"]);
  assert.deepEqual(
    [...reach(view, "QR-1", true, 5)].sort(),
    [...reach(view, "QR-1", true)].sort(),
  );
});

test("深さ null は無制限 (既定)", () => {
  const view = viewOf();

  assert.deepEqual([...reach(view, "QR-1", true, null)].sort(), ["FR-1", "Need-1", "SRC-1"]);
});

test("無向で辿ると向きを問わず集まる", () => {
  const view = viewOf();

  // 有向では FR-1 の上流は QR-1 だけだが、無向なら Goal 側の文脈まで届く。
  assert.deepEqual([...related(view, "FR-1", 1)].sort(), ["Need-1", "QR-1", "SRC-1"]);
  assert.ok(related(view, "FR-1", 2).has("Goal-1"));
  assert.ok(!related(view, "FR-1").has("FR-1"));
});

test("無向の探索は焦点 (focusSet) と同じ範囲になる", () => {
  const view = viewOf();

  assert.deepEqual(
    [...focusSet(view, "FR-1", 2)].sort(),
    ["FR-1", ...related(view, "FR-1", 2)].sort(),
  );
});

test("impactSets は上流・下流・全体を返す", () => {
  const view = viewOf();
  const impact = impactSets(view, "FR-1", { depth: null, undirected: false });

  assert.deepEqual([...impact.upstream], ["QR-1"]);
  assert.deepEqual([...impact.downstream].sort(), ["Need-1", "SRC-1"]);
  assert.deepEqual([...impact.whole].sort(), ["FR-1", "Need-1", "QR-1", "SRC-1"]);
  assert.equal(impact.undirected, false);
});

test("無向のときは全件を下流側に入れる (impact_set と同じ切り分け)", () => {
  const view = viewOf();
  const impact = impactSets(view, "FR-1", { depth: 1, undirected: true });

  assert.equal(impact.upstream.size, 0);
  assert.deepEqual([...impact.downstream].sort(), ["Need-1", "QR-1", "SRC-1"]);
  assert.equal(impact.undirected, true);
});

test("scope を省略すると view の state から取る", () => {
  const data = fixture();
  const view = createView(data, { ...allOn(data), depth: 1, undirected: true });

  assert.deepEqual(
    [...impactSets(view, "FR-1").downstream].sort(),
    ["Need-1", "QR-1", "SRC-1"],
  );
});

test("impactScope は深さ 0 と知らない値を無制限に倒す", () => {
  assert.deepEqual(impactScope({ depth: 0 }), { depth: null, undirected: false });
  assert.deepEqual(impactScope({ depth: 9 }), { depth: null, undirected: false });
  assert.deepEqual(impactScope({}), { depth: null, undirected: false });
  assert.deepEqual(impactScope({ depth: 2, undirected: true }), {
    depth: 2,
    undirected: true,
  });
});

test("深さ・向きの設定は絞り込みと重ねて効く", () => {
  const data = fixture();
  const edges = new Set(data.edge_names);
  edges.delete("has_source");
  const view = createView(data, { ...allOn(data), edges });

  // has_source を外したので、無向 1 ホップからも SRC-1 が消える。
  assert.deepEqual([...impactSets(view, "FR-1", { depth: 1, undirected: true }).downstream].sort(), [
    "Need-1",
    "QR-1",
  ]);
});

/** 隣接マップを使わない素朴な実装 (書き換え前の reach())。突き合わせ用。 */
function reachByScan(view, start, forward) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of view.edges) {
      const from = forward ? edge.source : edge.target;
      const to = forward ? edge.target : edge.source;
      if (from !== current || to === start || seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

test("隣接マップの探索は、全エッジを走査する素朴な実装と同じ結果になる", () => {
  const data = largeFixture();
  const view = createView(data, allOn(data));

  for (const node of view.nodes) {
    for (const forward of [true, false]) {
      assert.deepEqual(
        [...reach(view, node.id, forward)].sort(),
        [...reachByScan(view, node.id, forward)].sort(),
        `${node.id} (forward=${forward})`,
      );
    }
  }
});

// --- フォーカス ------------------------------------------------------------

test("深さ 1 の近傍は、自分と直接繋がる相手 (向きは問わない)", () => {
  const view = viewOf();

  assert.deepEqual([...focusSet(view, "FR-1", 1)].sort(), ["FR-1", "Need-1", "QR-1", "SRC-1"]);
});

test("深さを増やすと 1 ホップずつ広がる", () => {
  const view = viewOf();

  //: FR-1 の 1 ホップ先 Need-1 の隣に Goal-1 がいる。
  assert.ok(!focusSet(view, "FR-1", 1).has("Goal-1"));
  assert.ok(focusSet(view, "FR-1", 2).has("Goal-1"));
});

test("近傍は始点自身を含む", () => {
  assert.ok(focusSet(viewOf(), "Need-1", 1).has("Need-1"));
});

test("絞り込みで消えたノードは近傍にも出ない", () => {
  const data = fixture();
  const types = new Set(data.types);
  types.delete("Source");
  const view = createView(data, { ...allOn(data), types });

  assert.deepEqual([...focusSet(view, "FR-1", 1)].sort(), ["FR-1", "Need-1", "QR-1"]);
});

test("見えていないノードを始点にすると空になる", () => {
  const view = viewOf();

  assert.equal(focusSet(view, "NOPE", 3).size, 0);
});

test("大きいグラフでも 1 ホップの近傍は読める規模に収まる", () => {
  const data = largeFixture();
  const view = createView(data, allOn(data));

  assert.ok(view.nodes.length > 250);
  assert.ok(focusSet(view, "FR-40", 1).size < 10);
});

test("ハブ (Source) を経由すると近傍は一気に広がる", () => {
  const data = largeFixture();
  const view = createView(data, allOn(data));
  //: 同じ源泉を参照する要求が全部 2 ホップ以内に入ってくる。
  assert.ok(focusSet(view, "FR-40", 2).size > view.nodes.length / 4);

  //: has_source を外せば要求どうしの繋がりだけが残り、深さを増やしても広がらない。
  const edges = new Set(data.edge_names);
  edges.delete("has_source");
  const trimmed = createView(data, { ...allOn(data), edges });

  assert.ok(focusSet(trimmed, "FR-40", 3).size < view.nodes.length / 4);
});

test("FOCUS_DEPTHS は 0 (フォーカス無し) を選択肢に含めない", () => {
  assert.ok(!FOCUS_DEPTHS.includes(0));
  assert.ok(FOCUS_DEPTHS.every((depth) => Number.isInteger(depth) && depth > 0));
});

// --- status ----------------------------------------------------------------

test("statusFilters は成熟度の順に、絞り込み前の件数を添えて返す", () => {
  assert.deepEqual(statusFilters(fixture()), [
    { key: "proposed", label: "proposed", count: 3 },
    { key: "approved", label: "approved", count: 2 },
    { key: "implemented", label: "implemented", count: 0 },
    { key: "verified", label: "verified", count: 0 },
  ]);
});

// --- ラベル整形 ------------------------------------------------------------

test("ラベル表示定数は本文を読みやすい上限にする", () => {
  assert.equal(LABEL_MAX_LENGTH, 60);
  assert.equal(LABEL_WRAP_WIDTH, 160);
});

test("truncate は末尾を省略記号に置き換える", () => {
  assert.equal(truncate("あいうえお", 10), "あいうえお");
  assert.equal(truncate("あいうえおかきくけこ", 5), "あいうえ…");
  assert.equal(truncate("あいうえお", 5), "あいうえお");
});

//: 全角 1 文字ぶんの幅 (概算では font-size と同じ)。折り返し幅は文字数で指定する。
const EM = LABEL_FONT.size;

test("wrapLabel は幅に入るところまで詰めて折る", () => {
  assert.equal(wrapLabel("あいうえおかきくけこさ", 5 * EM), "あいうえお\nかきくけこ\nさ");
  assert.equal(wrapLabel("あいうえおかきくけこ", 5 * EM), "あいうえお\nかきくけこ");
  assert.equal(wrapLabel("", 5 * EM), "");
});

test("wrapLabel は空白で折り、行末に空白を残さない", () => {
  assert.equal(wrapLabel("abc defg hij", 4 * EM), "abc\ndefg\nhij");
  //: 1 行に収まるなら語の間の空白はそのまま。
  assert.equal(wrapLabel("abc defg", 10 * EM), "abc defg");
});

test("wrapLabel は数値と単位を離さない", () => {
  //: 「24 / 時間」と切れると読めない。空白ごと 1 つの塊として扱う。
  const wrapped = wrapLabel("承認待ちのまま 24 時間を超えた申請を 1 日 1 回リマインド");
  for (const line of wrapped.split("\n")) {
    assert.doesNotMatch(line, /[0-9]$/, wrapped);
  }
  assert.ok(wrapped.includes("24 時間"), wrapped);
});

test("wrapLabel は数字だけの行を作らない", () => {
  //: 幅を極端に狭めても、数値が単独の行に落ちることは無い。
  for (const width of [2 * EM, 3 * EM, 4 * EM, 6 * EM]) {
    const wrapped = wrapLabel("稼働率を 99.9% 以上とし 5 分で復旧すること", width);
    for (const line of wrapped.split("\n")) {
      assert.match(line, /[A-Za-z\u3041-\u30ff\u3400-\u9fff]/, `幅 ${width}: ${wrapped}`);
    }
  }
});

test("wrapLabel は句読点を行頭に落とさない", () => {
  const wrapped = wrapLabel("金額を抽出し、初期値として表示する。", 5 * EM);
  for (const line of wrapped.split("\n")) {
    assert.doesNotMatch(line, /^[、。]/, wrapped);
  }
});

test("wrapLabel は幅を超える塊も行に収まるところで切る", () => {
  //: 助詞まで含めた塊が幅より長いときは、諦めて幅で切る (溢れさせない)。
  const wrapped = wrapLabel("領収書画像から金額を抽出すること", 3 * EM);
  for (const line of wrapped.split("\n")) {
    assert.ok(estimateTextWidth(line) <= 3 * EM, `${line} / ${wrapped}`);
  }
});

test("labelChunks は文節らしいまとまりに切る", () => {
  assert.deepEqual(labelChunks("申請を 1 日 1 回リマインドする"), [
    "申請を ",
    "1 日 ",
    "1 回",
    "リマインドする",
  ]);
});

test("nodeSize は図形ごとの係数でラベルの外形を決める", () => {
  //: 全角 3 文字 2 行 = 30 x 25px。ellipse は √2 倍して余白を足す。
  const size = nodeSize("あいう\nかきく", ELLIPSE_FIT);

  assert.equal(size.w, Math.round(30 * 1.42 + 14));
  assert.equal(size.h, Math.round(2 * EM * LABEL_FONT.lineHeight * 1.42 + 10));
});

test("nodeSize は fit が無ければ矩形として扱う", () => {
  //: 倍率は掛けず、余白を足すだけ (旧いデータを読んでも図が壊れない)。
  const size = nodeSize("あいう", undefined);

  assert.equal(size.w, 3 * EM + 20);
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

test("tableRows は 1 ノード 1 行にし、根拠と指摘を数える", () => {
  const { rows } = rowsOf();

  assert.equal(rows.length, 5);
  assert.deepEqual(rows.find((row) => row.id === "FR-1"), {
    id: "FR-1",
    type: "FunctionalRequirement",
    text: "領収書画像から金額を抽出すること",
    status: "proposed",
    evidence: 1,
    findings: 1,
    severity: "info",
  });
  // 根拠を持たない型は 0 件、指摘の無いノードは 0 件。
  const source = rows.find((row) => row.id === "SRC-1");
  assert.equal(source.evidence, 0);
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
  assert.deepEqual(rowsOf({}, "領収書").rows.map((row) => row.id), ["Need-1", "FR-1"]);
  assert.equal(rowsOf({}, "  ").rows.length, 5);
});

test("matchesQuery は空の検索語をすべて通す", () => {
  const node = { id: "FR-1", text: "領収書画像から金額を抽出すること" };
  assert.equal(matchesQuery(node, ""), true);
  assert.equal(matchesQuery(node, "金額"), true);
  assert.equal(matchesQuery(node, "見積"), false);
});

// --- 検索ヒット (グラフのハイライトとキーボード選択) -------------------------

test("searchHits は一覧と同じ並びでヒットした id を返す", () => {
  assert.deepEqual(searchHits(viewOf(), "領収書"), ["Need-1", "FR-1"]);
});

test("検索語が空ならヒット無し (全件ではない)", () => {
  assert.deepEqual(searchHits(viewOf(), ""), []);
  assert.deepEqual(searchHits(viewOf(), "   "), []);
});

test("絞り込みで消えたノードはヒットに入らない", () => {
  const data = fixture();
  const types = new Set(data.types);
  types.delete("Need");

  assert.deepEqual(searchHits(createView(data, { ...allOn(data), types }), "領収書"), [
    "FR-1",
  ]);
});

test("↑↓ は候補を送り、端で巻き戻す", () => {
  const hits = ["Need-1", "FR-1", "QR-1"];

  assert.equal(stepHit(hits, "Need-1", 1), "FR-1");
  assert.equal(stepHit(hits, "QR-1", 1), "Need-1");
  assert.equal(stepHit(hits, "Need-1", -1), "QR-1");
});

test("位置が無いときは端から始める", () => {
  const hits = ["Need-1", "FR-1"];

  assert.equal(stepHit(hits, null, 1), "Need-1");
  assert.equal(stepHit(hits, null, -1), "FR-1");
  //: 絞り込みで候補から外れた id も「位置が無い」扱い。
  assert.equal(stepHit(hits, "SRC-1", 1), "Need-1");
  assert.equal(stepHit([], null, 1), null);
});

test("文字の列は素直に昇順・降順", () => {
  assert.deepEqual(idsSortedBy("id", true), ["FR-1", "Goal-1", "Need-1", "QR-1", "SRC-1"]);
  assert.deepEqual(idsSortedBy("id", false), ["SRC-1", "QR-1", "Need-1", "Goal-1", "FR-1"]);
});

test("type は種別の定義順に並ぶ (辞書順ではない)", () => {
  assert.deepEqual(idsSortedBy("type", true), ["Goal-1", "Need-1", "FR-1", "QR-1", "SRC-1"]);
});

test("status は成熟度の順に並ぶ (辞書順ではない)", () => {
  assert.deepEqual(idsSortedBy("status", true), ["FR-1", "QR-1", "SRC-1", "Goal-1", "Need-1"]);
});

test("値の無い行は向きに関わらず末尾に置く", () => {
  //: 成熟度 (status_rank) に無い status は「値が無い」扱い。
  //: statuses を渡さない (絞り込み無しの) state でないと、その行自体が消える。
  const data = fixture();
  data.nodes.find((node) => node.id === "Need-1").status = "unknown";
  const view = createView(data, { ...allOn(data), statuses: null });
  const sorted = (asc) =>
    sortRows(view, tableRows(view), { key: "status", asc }).map((row) => row.id);

  assert.deepEqual(sorted(true), ["FR-1", "QR-1", "SRC-1", "Goal-1", "Need-1"]);
  assert.deepEqual(sorted(false), ["Goal-1", "FR-1", "QR-1", "SRC-1", "Need-1"]);
});

test("指摘の多い順に並べられる", () => {
  assert.deepEqual(idsSortedBy("findings", false), ["QR-1", "FR-1", "Goal-1", "Need-1", "SRC-1"]);
});

test("同値の行は正規化 JSON の並び (型順 → id 順) で決まる", () => {
  // 指摘 0 件の 3 行は、昇順でも降順でも常にこの並びになる。
  const ascending = idsSortedBy("findings", true).slice(0, 3);
  assert.deepEqual(ascending, ["Goal-1", "Need-1", "SRC-1"]);
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
    ["id", "type", "text", "status", "evidence", "findings"],
  );
});

// --- URL ハッシュ ----------------------------------------------------------

const hashOf = (overrides) => {
  const data = fixture();
  return encodeHash({ ...defaultState(data), ...overrides }, data);
};

const stateOf = (hash) => decodeHash(hash, fixture());

test("既定の表示状態では URL にハッシュを付けない", () => {
  assert.equal(hashOf({}), "");
  assert.equal(hashOf({ query: "   " }), "");
});

test("選択・種別の絞り込み・方向がハッシュに載る", () => {
  assert.equal(
    hashOf({ selected: "FR-1", types: new Set(["Need", "Goal"]), direction: "LR" }),
    "#node=FR-1&types=Goal,Need&dir=LR",
  );
});

test("status の絞り込みも載る", () => {
  assert.equal(
    hashOf({ statuses: new Set(["approved", "proposed"]) }),
    "#status=proposed,approved",
  );
});

test("エッジ絞り込み・表示中のタブ・検索語・並び順も載る", () => {
  assert.equal(
    hashOf({
      edges: new Set(["satisfies"]),
      mode: "table",
      query: "領収書",
      sort: { key: "findings", asc: false },
    }),
    `#edges=satisfies&view=table&q=${encodeURIComponent("領収書")}&sort=findings:desc`,
  );
});

test("フォーカスの深さも載る (切のときは書かない)", () => {
  assert.equal(hashOf({ selected: "FR-1", focus: 2 }), "#node=FR-1&focus=2");
  assert.equal(hashOf({ focus: 0 }), "");
});

test("影響範囲の深さ・向きも載る (既定のときは書かない)", () => {
  assert.equal(hashOf({ depth: 2 }), "#depth=2");
  assert.equal(hashOf({ undirected: true }), "#undir=1");
  assert.equal(hashOf({ depth: 0, undirected: false }), "");
});

test("知らない深さ・向きの値は既定に倒す", () => {
  assert.equal(stateOf("#depth=9").depth, 0);
  assert.equal(stateOf("#depth=x").depth, 0);
  assert.equal(stateOf("#undir=0").undirected, false);
  assert.equal(stateOf("#depth=3&undir=1").depth, 3);
  assert.equal(stateOf("#depth=3&undir=1").undirected, true);
});

test("ハッシュが無ければ既定の状態", () => {
  const data = fixture();
  assert.deepEqual(decodeHash("", data), defaultState(data));
  assert.deepEqual(decodeHash("#", data), defaultState(data));
});

test("状態 → ハッシュ → 状態で元に戻る", () => {
  const data = fixture();
  const state = {
    types: new Set(["Goal", "FunctionalRequirement"]),
    edges: new Set(["satisfies", "qualifies"]),
    statuses: new Set(["approved"]),
    selected: "FR-1",
    direction: "LR",
    mode: "table",
    query: "領収書 画像",
    focus: 2,
    depth: 3,
    undirected: true,
    sort: { key: "evidence", asc: false },
  };

  assert.deepEqual(decodeHash(encodeHash(state, data), data), state);
});

test("ハッシュ → 状態 → ハッシュでも元に戻る", () => {
  const data = fixture();
  const hash =
    "#node=QR-1&types=Goal,QualityRequirement&edges=qualifies&status=proposed" +
    "&dir=LR&view=table&focus=1&depth=2&undir=1" +
    `&q=${encodeURIComponent("3 秒")}&sort=evidence:desc`;

  assert.equal(encodeHash(decodeHash(hash, data), data), hash);
});

test("絞り込みの軸を持たない state は、その軸を書かない", () => {
  const data = fixture();
  //: createView() が statuses 省略を「絞り込み無し」と見るのに合わせる。
  const state = { ...defaultState(data), statuses: undefined };

  assert.equal(encodeHash(state, data), "");
});

test("解釈できない値は捨てて既定に倒す", () => {
  const state = stateOf("#node=NOPE&dir=YZ&view=nope&focus=9&sort=bogus:asc&sort2&other=1");

  assert.equal(state.selected, null);
  assert.equal(state.direction, "TD");
  assert.equal(state.mode, "graph");
  assert.equal(state.focus, 0);
  assert.deepEqual(state.sort, { key: "id", asc: true });
});

test("知らない種別は落とし、知っているものだけを選ぶ", () => {
  assert.deepEqual([...stateOf("#types=Goal,Nope").types], ["Goal"]);
  assert.deepEqual([...stateOf("#edges=nope").edges], []);
  assert.deepEqual([...stateOf("#status=approved,nope").statuses], ["approved"]);
});

test("何も選んでいない絞り込みも URL に出せる", () => {
  const data = fixture();

  assert.equal(encodeHash({ ...defaultState(data), types: new Set() }, data), "#types=");
  assert.equal(stateOf("#types=").types.size, 0);
});

test("初期状態では Source と源泉エッジが外れている", () => {
  const state = defaultState(fixture());

  assert.ok(!state.types.has("Source"));
  assert.ok(!state.edges.has("has_source"));
  //: 型・エッジとも、外れているのは源泉まわりだけ。
  assert.ok(state.types.has("FunctionalRequirement"));
  assert.ok(state.edges.has("satisfies"));
});

test("源泉を出した状態は既定ではないので URL に載る", () => {
  const data = fixture();
  //: 「既定と違うところだけ URL に出す」の基準は全選択ではなく初期選択。
  //: 全選択のときに空ハッシュを返すと、Source を出した状態が共有できなくなる。
  const hash = encodeHash({ ...defaultState(data), ...allOn(data) }, data);

  assert.ok(hash.includes("Source"));
  assert.ok(hash.includes("has_source"));
  assert.deepEqual(decodeHash(hash, data).types, new Set(data.types));
});

test("壊れたエスケープはその組だけ捨てる", () => {
  const state = stateOf("#q=%E3%81&node=FR-1");

  assert.equal(state.query, "");
  assert.equal(state.selected, "FR-1");
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
  assert.match(text, /- FR-1 --satisfies--> Need-1/);
  assert.ok(text.endsWith("\n"));
});

test("nodeContext は kind を属性行に出す", () => {
  const text = nodeContext(viewOf(), "Goal-1");

  assert.match(text, /- \[Goal\] Goal-1: .*\n {4}\(status=approved\)/);
  assert.match(text, /- \[Source\] SRC-1: .*\n {4}\(status=proposed, kind=stakeholder\)/);
});

test("エッジを絞ると nodeContext にフィルタ行が出る", () => {
  const data = fixture();
  const edges = new Set(["satisfies", "motivates"]);
  const view = createView(data, { ...allOn(data), edges });
  const text = nodeContext(view, "FR-1");

  assert.match(text, /エッジ種別フィルタ: motivates, satisfies/);
  //: has_source は辿っていないので Source はブロックとしては出ない。
  //: 源泉は属性行に畳まれる (--edges 指定は --with-sources ではない)。
  assert.ok(!text.includes("- [Source] SRC-1"));
  assert.match(text, / {4}源泉: SRC-1 \(/);
});

test("絞り込みが無ければフィルタ行は出ない", () => {
  assert.ok(!nodeContext(viewOf(), "FR-1").includes("エッジ種別フィルタ"));
});

test("深さを指定すると探索深さの行が出て、範囲もそこで切れる", () => {
  const text = nodeContext(viewOf(), "QR-1", { depth: 1, undirected: false });

  assert.match(text, /対象 1 件 \/ 上流 0 件 \/ 下流 1 件 \/ 合計 2 件/);
  assert.match(text, /探索深さ: 1/);
  assert.ok(!text.includes("SRC-1"));
});

test("無向のときは関連ノードを 1 ブロックにまとめる", () => {
  const text = nodeContext(viewOf(), "FR-1", { depth: null, undirected: true });

  //: 無向なら FR-1 から Goal 側 (Goal-1) まで届く (有向の上流は QR-1 だけ)。
  assert.match(text, /対象 1 件 \/ 関連 4 件 \/ 合計 5 件/);
  assert.match(text, /探索方向: 無向 \(エッジの向きを無視\)/);
  assert.match(text, /## 関連ノード \(向きを問わず繋がっているノード\) \(4 件\)/);
  assert.ok(!text.includes("## 上流"));
  assert.ok(!text.includes("## 下流"));
});

test("nodeContext は scope を省略すると view の state を見る", () => {
  const data = fixture();
  const view = createView(data, { ...allOn(data), depth: 1, undirected: true });

  assert.equal(nodeContext(view, "FR-1"), nodeContext(view, "FR-1", { depth: 1, undirected: true }));
  assert.match(nodeContext(view, "FR-1"), /探索深さ: 1/);
});

test("explainCommand は画面の設定をそのまま引数にする", () => {
  const data = fixture();
  const edges = new Set(["satisfies", "motivates"]);

  //: 初期状態 (源泉エッジが外れている) が `req explain ID` の既定と同じ。
  assert.equal(explainCommand(createView(data, defaultOn(data)), "FR-1"), "req explain FR-1");
  //: 源泉も出している状態は既定ではないので、フラグとして現れる。
  assert.equal(explainCommand(viewOf(), "FR-1"), "req explain FR-1 --with-sources");
  assert.equal(
    explainCommand(createView(data, { ...allOn(data), edges, depth: 2, undirected: true }), "FR-1"),
    "req explain FR-1 --edges motivates,satisfies --depth 2 --undirected",
  );
});

test("部分グラフに現れなかったエッジ種別を末尾に並べる", () => {
  const text = nodeContext(viewOf(), "FR-1");

  assert.match(text, /\(部分グラフに現れなかったエッジ種別: refines, motivates\)\n$/);
});

test("allEdgeNames はノード型から現れうるエッジ種別を数える", () => {
  assert.deepEqual(allEdgeNames(fixture()), [
    "has_source",
    "refines",
    "motivates",
    "satisfies",
    "qualifies",
  ]);
});

// --- SVG 描画に渡す値 -------------------------------------------------------

test("graphElements はノードとエッジをそのまま要素にする", () => {
  const elements = graphElements(fixture());

  // ノード 5 + エッジ 6 + 帯枠 2 (Goal / Need)。枠は末尾に足す。
  assert.equal(elements.length, 13);
  assert.equal(elements[0].data.id, "Goal-1");
  assert.equal(elements[0].data.type, "Goal");
  assert.match(elements[0].data.label, /^Goal-1\n/);
  assert.deepEqual(elements[5].data, {
    id: "e0",
    index: 0,
    source: "Goal-1",
    target: "SRC-1",
    name: "has_source",
  });
});

test("graphElements はラベルを測って外形をデータに載せる", () => {
  const elements = graphElements(fixture());
  const goal = elements[0];

  //: ラベル (id + 折り返した本文) を測った結果が w / h。
  assert.deepEqual(
    { w: goal.data.w, h: goal.data.h },
    nodeSize(goal.data.label, ELLIPSE_FIT),
  );
  //: 折り返しは上限幅を超えない。
  for (const line of goal.data.label.split("\n")) {
    assert.ok(estimateTextWidth(line) <= LABEL_WRAP_WIDTH, line);
  }
});

test("graphElements は 30 文字を超える本文を 60 文字まで表示する", () => {
  const data = fixture();
  const longText = "あ".repeat(59) + "い".repeat(10);
  data.nodes = [{ ...data.nodes[0], text: longText }];
  data.edges = [];
  data.meta = { ...data.meta };
  delete data.meta.bands;

  const [node] = graphElements(data, () => 5);
  const body = node.data.label.split("\n").slice(1).join("");

  assert.equal(body.length, LABEL_MAX_LENGTH);
  assert.equal(body, `${"あ".repeat(59)}…`);
});

test("graphElements は広げた折り返し幅で日本語本文の行数を抑える", () => {
  const data = fixture();
  data.nodes = [{ ...data.nodes[0], text: "あ".repeat(16) }];
  data.edges = [];
  data.meta = { ...data.meta };
  delete data.meta.bands;

  const [node] = graphElements(data);
  const bodyLines = node.data.label.split("\n").slice(1);

  assert.deepEqual(bodyLines, ["あ".repeat(16)]);
  assert.ok(estimateTextWidth(bodyLines[0]) <= LABEL_WRAP_WIDTH);
});

test("graphElements は渡された実測関数でラベルを測る", () => {
  //: ブラウザでは canvas の実測を渡す。1 文字 = 20px として測らせると倍になる。
  const wide = graphElements(fixture(), (text) => [...text].length * 20);
  const narrow = graphElements(fixture(), (text) => [...text].length * 10);

  assert.ok(wide[0].data.w > narrow[0].data.w);
});

test("graphElements は status をデータに載せる", () => {
  const elements = graphElements(fixture());

  assert.equal(elements[0].data.status, "approved"); // Goal-1
  assert.equal(elements[1].data.status, "approved"); // Need-1
  assert.equal(elements[2].data.status, "proposed"); // FR-1
});

test("legendGroups は実際のスタイル (配色・線種) から凡例を作る", () => {
  const groups = legendGroups(fixture().meta);

  assert.deepEqual(
    groups.map((group) => group.title),
    ["種別", "status"],
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
});

test("legendGroups はダークテーマ用のノード配色を使う", () => {
  const meta = fixture().meta;
  meta.types.Goal.dark_fill = "#17233a";
  meta.types.Goal.dark_stroke = "#6ea8fe";
  const groups = legendGroups(meta, "dark");
  const goal = groups[0].items.find((item) => item.label === "Goal");

  assert.equal(goal.swatch.background, "#17233a");
  assert.equal(goal.swatch.borderColor, "#6ea8fe");
});

// --- 帯 (Goal / Need の枠) ---------------------------------------------------

test("graphElements は帯の枠ノードを末尾に足す (compound は使わない)", () => {
  const elements = graphElements(fixture());
  const byId = new Map(elements.map((element) => [element.data.id, element]));

  //: 枠はグループ化ノードではなく独立した背面描画なので、どのノードも parent を持たない。
  assert.ok(elements.every((element) => !("parent" in element.data)));

  const goalBand = byId.get(bandId("Goal"));
  assert.deepEqual(goalBand.data, {
    id: "band:Goal",
    band: true,
    bandType: "Goal",
    bandKey: "Goal",
    label: "Goal (最上位)",
    w: 10,
    h: 10,
  });
  assert.equal(goalBand.classes, "band");
  assert.equal(goalBand.selectable, false);
  assert.equal(goalBand.grabbable, false);
  assert.ok(byId.has(bandId("Need")));
});

test("その型のノードが無い帯は枠を作らない", () => {
  const data = fixture();
  data.nodes = data.nodes.filter((node) => node.type !== "Need");
  const elements = graphElements(data);

  assert.ok(elements.some((element) => element.data.id === "band:Goal"));
  assert.ok(!elements.some((element) => element.data.id === "band:Need"));
});

test("meta に bands が無ければ従来どおりの要素になる", () => {
  const data = fixture();
  data.meta = { ...data.meta }; // 共有の META を書き換えない
  delete data.meta.bands;
  const elements = graphElements(data);

  assert.equal(elements.length, 11);
  assert.ok(elements.every((element) => !("parent" in element.data)));
  assert.equal(bandDefs(data).length, 0);
});


test("bandDefs は RequirementGroup から要求枠を order 順に作り未分類を残す", () => {
  const data = fixture({
    requirement_groups: [
      { id: "notify", label: "通知", order: 20, members: ["QR-1", "FR-1"] },
      { id: "capture", label: "入力", order: 10, members: ["FR-1"] },
    ],
  });
  const bands = bandDefs(data);

  assert.deepEqual(
    bands.map((band) => [band.key, band.label, band.members || null]),
    [
      ["Goal", "Goal (最上位)", null],
      ["Need", "Need (上位)", null],
      ["group:capture", "入力", ["FR-1"]],
      ["group:notify", "通知", ["QR-1"]],
    ],
  );
});

test("graphElements は RequirementGroup の枠を追加する", () => {
  const data = fixture({
    requirement_groups: [{ id: "capture", label: "入力", order: 10, members: ["FR-1"] }],
  });
  const elements = graphElements(data);
  const group = elements.find((element) => element.data.id === bandId("group:capture"));
  const unclassified = elements.find(
    (element) => element.data.id === bandId("group:__unclassified__"),
  );

  assert.equal(group.data.label, "入力");
  assert.equal(group.data.bandType, "RequirementGroup");
  assert.equal(group.data.bandKey, "group:capture");
  assert.equal(unclassified.data.label, "未分類");
  assert.equal(unclassified.data.bandKey, "group:__unclassified__");
});

test("visibleBandKeys は表示中メンバーを持つ RequirementGroup 枠だけを残す", () => {
  const data = fixture({
    requirement_groups: [
      { id: "capture", label: "入力", order: 10, members: ["FR-1"] },
      { id: "quality", label: "品質", order: 20, members: ["QR-1"] },
    ],
  });

  assert.deepEqual(
    [...visibleBandKeys(data, data.nodes.filter((node) => node.id !== "QR-1"))],
    ["Goal", "Need", "group:capture"],
  );
  assert.deepEqual(
    [...visibleBandKeys(data, data.nodes.filter((node) => node.id === "QR-1"))],
    ["group:quality"],
  );
});

//: 幅 60 / 高さ 30 のノードを (x, y) 中心に置いた placed 1 件。
const placedNode = (id, type, x, y) => ({ id, type, x, y, w: 60, h: 30 });

const BANDS = [
  { type: "Goal", label: "Goal (最上位)" },
  { type: "Need", label: "Need (上位)" },
];

test("bandedLayout は Goal 帯 → Need 帯 → その他 の順に上から並べる", () => {
  // dagre が Goal と FR を同じ高さ (y=0) に置いてしまった状態。
  const placed = [
    placedNode("Goal-1", "Goal", 0, 0),
    placedNode("FR-1", "FunctionalRequirement", 100, 0),
    placedNode("Need-1", "Need", 50, 80),
  ];
  const { positions } = bandedLayout(BANDS, placed, [], "TD");

  const goal = positions.get("Goal-1");
  const need = positions.get("Need-1");
  const fr = positions.get("FR-1");
  assert.ok(goal.y < need.y, "Goal は Need より上");
  assert.ok(need.y < fr.y, "Need は FR より上");
  // 帯に入らない FR は副軸 (x) を動かさない。
  assert.equal(fr.x, 100);
});

test("bandedLayout は帯の中の並び順を保って不要な空白を詰める", () => {
  const placed = [
    placedNode("Goal-1", "Goal", 0, 0),
    placedNode("Goal-2", "Goal", 100, 0),
    placedNode("FR-1", "FunctionalRequirement", 400, 60),
  ];
  const { positions } = bandedLayout([BANDS[0]], placed, [], "TD");

  const first = positions.get("Goal-1");
  const second = positions.get("Goal-2");
  assert.ok(first.x < second.x, "帯の中の左右の並びは変わらない");
  assert.equal(second.x - first.x, 86, "ノード幅と一定間隔まで詰める");
  // 図の全幅の中心 200 に、詰め直した 2 件を寄せる。
  assert.equal((first.x + second.x) / 2, 200);
});

test("bandedLayout の Goal・Need 枠は中身に必要な共通幅で縦に並ぶ", () => {
  const placed = [
    placedNode("Goal-1", "Goal", 0, 0),
    placedNode("Need-1", "Need", 50, 80),
    placedNode("FR-1", "FunctionalRequirement", 300, 160),
  ];
  const { positions, frames } = bandedLayout(BANDS, placed, [], "TD");

  const goal = frames.get("Goal");
  const need = frames.get("Need");
  // 共通幅 = 最も広い Goal / Need の中身 60 + 余白 14 × 2。
  assert.equal(goal.w, 88);
  assert.equal(need.w, goal.w, "2 つの枠は等幅");
  assert.equal(need.x, goal.x, "左端も揃う");
  assert.ok(goal.y < need.y, "縦に並ぶ");
  // 高さは中身 1 行ぶん (30) + 余白。枠は中身の上下に掛かる。
  assert.equal(goal.h, 30 + 28);
  assert.equal(goal.y, positions.get("Goal-1").y);
});

test("bandedLayout は refines の親 Goal を子 Goal より上の行に置く", () => {
  const placed = [
    placedNode("Goal-1", "Goal", 0, 100), // 親 (dagre は下に置いた)
    placedNode("Goal-2", "Goal", 0, 0), // 子
  ];
  const edges = [{ source: "Goal-2", name: "refines", target: "Goal-1" }];
  const { positions } = bandedLayout([BANDS[0]], placed, edges, "TD");

  assert.ok(positions.get("Goal-1").y < positions.get("Goal-2").y);
});

test("bandedLayout は帯の中の重なりを副軸方向へ押して解消する", () => {
  const placed = [
    placedNode("Need-1", "Need", 0, 0),
    placedNode("Need-2", "Need", 10, 40), // 幅 60 なので Need-1 と重なる
  ];
  const { positions } = bandedLayout([BANDS[1]], placed, [], "TD");

  const left = positions.get("Need-1");
  const right = positions.get("Need-2");
  assert.equal(left.y, right.y, "同じ行に並ぶ");
  assert.ok(right.x - left.x >= 60, "ノード幅ぶん以上離れる");
});

test("bandedLayout は多数の Goal も同じ階層なら折り返さない", () => {
  const placed = Array.from({ length: 6 }, (_, index) =>
    placedNode(`Goal-${index}`, "Goal", index * 1000, 0),
  );
  const { positions } = bandedLayout([BANDS[0]], placed, [], "TD");
  assert.equal(new Set([...positions.values()].map((position) => position.y)).size, 1);
  const xs = [...positions.values()].map((position) => position.x);
  assert.equal(Math.max(...xs) - Math.min(...xs), 86 * 5, "不要な空白だけを詰める");
});

test("bandedLayout の LR は帯を左に積み、縦の並びを保つ", () => {
  const placed = [
    placedNode("Goal-1", "Goal", 0, 0),
    placedNode("FR-1", "FunctionalRequirement", 0, 100),
  ];
  const { positions } = bandedLayout(BANDS, placed, [], "LR");

  assert.ok(positions.get("Goal-1").x < positions.get("FR-1").x, "Goal は FR より左");
  assert.equal(positions.get("FR-1").y, 100, "副軸 (y) は動かさない");
});

test("bandedLayout は帯のノードが無ければ何も返さない", () => {
  const placed = [placedNode("FR-1", "FunctionalRequirement", 0, 0)];
  const { positions, frames } = bandedLayout(BANDS, placed, [], "TD");

  assert.equal(positions.size, 0);
  assert.equal(frames.size, 0);
});

test("bandedLayout は RequirementGroup を Requirements 段の中で横に並べる", () => {
  const bands = [
    ...BANDS,
    { key: "group:capture", label: "入力", members: ["FR-1", "Constraint-1"] },
    { key: "group:notify", label: "通知", members: ["QR-1"] },
  ];
  const placed = [
    placedNode("Goal-1", "Goal", 0, 0),
    placedNode("Need-1", "Need", 0, 80),
    placedNode("FR-1", "FunctionalRequirement", 0, 160),
    placedNode("Constraint-1", "Constraint", 10, 200),
    placedNode("QR-1", "QualityRequirement", 300, 180),
  ];
  const { positions, frames } = bandedLayout(bands, placed, [], "TD");

  assert.ok(positions.get("Need-1").y < positions.get("FR-1").y);
  assert.equal(positions.get("FR-1").y, positions.get("QR-1").y);
  assert.ok(positions.get("FR-1").x < positions.get("QR-1").x);
  assert.ok(frames.get("group:capture").x < frames.get("group:notify").x);
  assert.ok(frames.get("group:capture").w !== frames.get("Goal").w,
    "Requirements 枠を Goal / Need の共通幅へ引き延ばさない");
  assert.equal(frames.get("group:capture").h, frames.get("group:notify").h);
  assert.equal(frames.get("group:capture").y, frames.get("group:notify").y);
});

test("bandedLayout は表示中の RequirementGroup だけで枠の高さを再計算する", () => {
  const bands = [
    { key: "group:capture", label: "入力", members: ["FR-1", "Constraint-1"] },
    { key: "group:notify", label: "通知", members: ["QR-1"] },
    { key: "group:hidden", label: "非表示", members: ["FR-hidden"] },
  ];
  const placed = [
    placedNode("FR-1", "FunctionalRequirement", 0, 0),
    placedNode("Constraint-1", "Constraint", 0, 80),
    placedNode("QR-1", "QualityRequirement", 300, 0),
  ];
  const { positions, frames } = bandedLayout(bands, placed, [], "TD");

  assert.equal(frames.get("group:capture").h, frames.get("group:notify").h);
  assert.equal(frames.get("group:capture").y, frames.get("group:notify").y);
  assert.equal(positions.get("FR-1").y, positions.get("QR-1").y);
  assert.ok(frames.get("group:capture").w !== frames.get("group:notify").w);
  assert.equal(frames.has("group:hidden"), false);
});

test("bandedLayout は多数の RequirementGroup を折り返さず同じ段に並べる", () => {
  const bands = Array.from({ length: 8 }, (_, group) => ({
    key: `group:${group}`,
    label: String(group),
    members: Array.from({ length: 4 }, (_, node) => `FR-${group}-${node}`),
  }));
  const placed = bands.flatMap((band, group) =>
    band.members.map((id, node) => placedNode(id, "FunctionalRequirement", group * 1000 + node * 200, 0)),
  );
  const { positions, frames } = bandedLayout(bands, placed, [], "TD", {
    groupMaxWidth: 250,
  });
  const boxes = [...frames.values()];
  assert.equal(new Set(boxes.map((frame) => frame.y)).size, 1, "全グループが同じ段に残る");
  assert.equal(positions.size, 32);
  for (const band of bands) {
    assert.ok(new Set(band.members.map((id) => positions.get(id).x)).size > 1,
      "各グループを 1 ノード幅まで潰さない");
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]; const b = boxes[j];
    assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2);
  }
});

test("bandedLayout は単一グループ内の同階層ノードを詰めて折り返す", () => {
  const members = Array.from({ length: 12 }, (_, index) => `FR-${index}`);
  const placed = members.map((id, index) => placedNode(id, "FunctionalRequirement", index * 500, 0));
  const { positions, frames } = bandedLayout(
    [{ key: "group:many", label: "多数", members }], placed, [], "TD",
    { groupMaxWidth: 250 },
  );
  assert.ok(new Set([...positions.values()].map((position) => position.y)).size > 1);
  assert.ok(frames.get("group:many").w <= 250);
  assert.ok(Math.max(...[...positions.values()].map((position) => position.x)) < 250,
    "dagre の大きな絶対座標を引き継がない");
});

test("bandedLayout は Goal・Need を全 RequirementGroup の横幅へ揃える", () => {
  const bands = [
    ...BANDS,
    { key: "group:requirements", members: ["FR-1", "FR-2", "FR-3"] },
    { key: "group:other", members: ["FR-4"] },
  ];
  const placed = [
    placedNode("Goal-1", "Goal", 0, 0),
    placedNode("Goal-2", "Goal", 500, 0),
    placedNode("Need-1", "Need", 250, 80),
    placedNode("FR-1", "FunctionalRequirement", 0, 160),
    placedNode("FR-2", "FunctionalRequirement", 10, 200),
    placedNode("FR-3", "FunctionalRequirement", 20, 240),
    placedNode("FR-4", "FunctionalRequirement", 800, 160),
  ];
  const { frames } = bandedLayout(bands, placed, [], "TD", { groupMaxWidth: 300 });
  const goal = frames.get("Goal");
  const need = frames.get("Need");
  const requirements = frames.get("group:requirements");
  const other = frames.get("group:other");
  assert.equal(goal.x - goal.w / 2, need.x - need.w / 2);
  assert.equal(goal.x + goal.w / 2, need.x + need.w / 2);
  const requirementsLeft = requirements.x - requirements.w / 2;
  const requirementsRight = other.x + other.w / 2;
  const requirementsMiddle = (
    requirementsLeft + requirementsRight
  ) / 2;
  assert.equal(goal.x, requirementsMiddle, "全 Requirements の中心へ揃える");
  assert.equal(goal.x - goal.w / 2, requirementsLeft);
  assert.equal(goal.x + goal.w / 2, requirementsRight);
});

test("bandedLayout の枠内折り返しは refines 階層と LR の非重複を保つ", () => {
  const members = ["FR-parent", "FR-child", "FR-peer"];
  const placed = members.map((id, index) => placedNode(id, "FunctionalRequirement", 0, index * 500));
  const edges = [{ source: "FR-child", name: "refines", target: "FR-parent" }];
  const { positions, frames } = bandedLayout(
    [{ key: "group:tree", members }], placed, edges, "LR",
    { groupMaxWidth: 150 },
  );
  assert.ok(positions.get("FR-parent").x < positions.get("FR-child").x);
  assert.ok(frames.get("group:tree").h <= 150);
  const nodes = members.map((id) => ({ ...positions.get(id), w: 60, h: 30 }));
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i]; const b = nodes[j];
    assert.ok(Math.abs(a.x - b.x) >= 60 || Math.abs(a.y - b.y) >= 30);
  }
});

test("bandedLayout は帯以外のノードの相対位置を保ったまま平行移動する", () => {
  const placed = [
    placedNode("Goal-1", "Goal", 0, 50),
    placedNode("FR-1", "FunctionalRequirement", 20, 0),
    placedNode("QR-1", "QualityRequirement", 80, 90),
  ];
  const { positions } = bandedLayout([BANDS[0]], placed, [], "TD");

  const fr = positions.get("FR-1");
  const qr = positions.get("QR-1");
  assert.equal(qr.x - fr.x, 60);
  assert.equal(qr.y - fr.y, 90);
  assert.ok(positions.get("Goal-1").y < fr.y);
});

test("layoutOptions は TD / LR を dagre の rankDir に写す", () => {
  assert.equal(layoutOptions("TD").rankDir, "TB");
  assert.equal(layoutOptions("LR").rankDir, "LR");
  assert.equal(layoutOptions("TD").animate, false);
});

test("edgeControl は異なるランク間を端点の中間で結ぶ", () => {
  assert.deepEqual(edgeControl({ x: 0, y: 0 }, { x: 100, y: 100 }, "TD"), { x: 50, y: 50 });
});

test("edgeControl は TD の同一ランクを上側へ短く膨らませる", () => {
  assert.deepEqual(edgeControl({ x: 0, y: 0 }, { x: 100, y: 0 }, "TD"), { x: 50, y: -12 });
});

test("edgeControl は LR の同一ランクを左側へ短く膨らませる", () => {
  assert.deepEqual(edgeControl({ x: 0, y: 0 }, { x: 0, y: 100 }, "LR"), { x: -12, y: 50 });
});

test("edgeControl は複数エッジを端点間の法線方向へずらす", () => {
  assert.deepEqual(edgeControl({ x: 0, y: 0 }, { x: 100, y: 0 }, "LR", 12), { x: 50, y: 12 });
});

test("quadraticPath は端点と制御点から短い曲線を作る", () => {
  assert.equal(
    quadraticPath({ x: 0, y: 0 }, { x: 50, y: -12 }, { x: 100, y: 0 }),
    "M 0 0 Q 50 -12 100 0",
  );
});

test("quadraticPoint は描画と同じ曲線上のラベル位置を返す", () => {
  assert.deepEqual(
    quadraticPoint({ x: 0, y: 0 }, { x: 50, y: -24 }, { x: 100, y: 0 }),
    { x: 50, y: -12 },
  );
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

// --- 詳細ペインのエッジ一覧 --------------------------------------------------

test("エッジ一覧は相手の id と本文を持つ", () => {
  const view = viewOf();
  const { out, in: incoming } = edgeItems(view, "FR-1");

  assert.deepEqual(
    out.map((item) => [item.arrow, item.id, item.text]),
    [
      ["--has_source-->", "SRC-1", "申請者となる一般社員"],
      ["--satisfies-->", "Need-1", "領収書を撮影するだけで申請したい"],
    ],
  );
  assert.deepEqual(
    incoming.map((item) => [item.arrow, item.id, item.type]),
    [["<--qualifies--", "QR-1", "QualityRequirement"]],
  );
});

test("絞り込みで消えたエッジは一覧にも出ない", () => {
  const data = fixture();
  const edges = new Set(data.edge_names);
  edges.delete("has_source");
  const view = createView(data, { ...allOn(data), edges });

  assert.deepEqual(
    edgeItems(view, "FR-1").out.map((item) => item.id),
    ["Need-1"],
  );
});

// --- 詳細ペインの源泉欄 ------------------------------------------------------

test("源泉は絞り込みに関係なく引ける", () => {
  //: 図から Source を外すのが既定なので、view ではなく data から引けないと
  //: 詳細ペインから源泉が消える。ここが源泉の唯一の出口になる。
  const items = sourceItems(fixture(), "FR-1");

  assert.deepEqual(
    items.map((item) => [item.id, item.text, item.kind]),
    [["SRC-1", "申請者となる一般社員", "stakeholder"]],
  );
  assert.deepEqual(items[0].parents, []);
});

test("源泉を持たないノードでは空になる", () => {
  assert.deepEqual(sourceItems(fixture(), "QR-1"), []);
});

test("引用は part_of の鎖を親から順に持つ", () => {
  const data = fixture();
  data.nodes.push(
    { type: "Source", id: "SRC-DOC", text: "経費精算規程", status: "approved", kind: "document" },
    {
      type: "Source",
      id: "SRC-DOC-A12",
      text: "領収書の添付を要する",
      status: "approved",
      kind: "document",
      locator: "第12条第3項",
    },
  );
  data.edges.push(
    { source: "SRC-DOC-A12", name: "part_of", target: "SRC-DOC" },
    { source: "QR-1", name: "has_source", target: "SRC-DOC-A12" },
  );

  const [item] = sourceItems(data, "QR-1");

  assert.equal(item.locator, "第12条第3項");
  assert.deepEqual(item.parents, [{ id: "SRC-DOC", text: "経費精算規程" }]);
  //: 畳んだ表示は `explain.py` の source_label() と同じ形。
  assert.equal(
    sourceLabel(data, "SRC-DOC-A12"),
    "SRC-DOC-A12 (領収書の添付を要する) [第12条第3項] < SRC-DOC (経費精算規程)",
  );
});

// --- 出所のリンク (GitHub の blob URL) ---------------------------------------

const withRepo = (repo) => fixture({ repo });

test("repo が渡っていれば出所は blob URL + 行番号になる", () => {
  const data = withRepo({ url: "https://github.com/owner/repo", ref: "main" });

  assert.equal(
    sourceUrl(data, "examples/sample.py:42"),
    "https://github.com/owner/repo/blob/main/examples/sample.py#L42",
  );
});

test("行番号が無い出所はファイルまでのリンクになる", () => {
  const data = withRepo({ url: "https://github.com/owner/repo/", ref: "abc123" });

  assert.equal(
    sourceUrl(data, "examples/sample.py"),
    "https://github.com/owner/repo/blob/abc123/examples/sample.py",
  );
});

test("repo が無ければリンクにしない", () => {
  assert.equal(sourceUrl(fixture(), "examples/sample.py:42"), null);
  assert.equal(sourceUrl(withRepo({ url: "" }), "examples/sample.py:42"), null);
});

test("リポジトリ内の位置が決まらない出所はリンクにしない", () => {
  const data = withRepo({ url: "https://github.com/owner/repo", ref: "main" });

  assert.equal(sourceUrl(data, "/tmp/sample.py:42"), null);
  assert.equal(sourceUrl(data, "../外/sample.py:42"), null);
  assert.equal(sourceUrl(data, "C:\\work\\sample.py:42"), null);
  assert.equal(sourceUrl(data, ""), null);
});

test("パスと参照はエスケープする", () => {
  const data = withRepo({ url: "https://github.com/owner/repo", ref: "feature/x y" });

  assert.equal(
    sourceUrl(data, "./要求 定義/a.py:7"),
    "https://github.com/owner/repo/blob/feature%2Fx%20y/%E8%A6%81%E6%B1%82%20%E5%AE%9A%E7%BE%A9/a.py#L7",
  );
});

// --- 指摘一覧 (重大度タブ / コード別のまとめ) --------------------------------

const FINDING_LIST = [
  { code: "structure.edge_type", severity: "error", layer: 2, message: "型違反", node_id: "FR-1" },
  { code: "structure.orphan_fr", severity: "warning", layer: 2, message: "孤立", node_id: "FR-1" },
  { code: "structure.orphan_fr", severity: "warning", layer: 2, message: "孤立", node_id: "FR-2" },
  { code: "structure.unused_source", severity: "info", layer: 2, message: "未使用", node_id: "SRC-1" },
];

test("重大度タブは件数のあるものだけ (すべては常に出る)", () => {
  assert.deepEqual(
    severityTabs(FINDING_LIST).map((tab) => [tab.key, tab.count]),
    [
      [ALL_SEVERITIES, 4],
      ["error", 1],
      ["warning", 2],
      ["info", 1],
    ],
  );
  assert.deepEqual(
    severityTabs([]).map((tab) => [tab.key, tab.count]),
    [[ALL_SEVERITIES, 0]],
  );
});

test("指摘はコードごとにまとまり、重い群から並ぶ", () => {
  assert.deepEqual(
    groupFindings(FINDING_LIST).map((group) => [group.code, group.severity, group.items.length]),
    [
      ["structure.edge_type", "error", 1],
      ["structure.orphan_fr", "warning", 2],
      ["structure.unused_source", "info", 1],
    ],
  );
});

test("重大度で絞ると、その重大度の群だけが残る", () => {
  assert.deepEqual(
    groupFindings(FINDING_LIST, "warning").map((group) => group.code),
    ["structure.orphan_fr"],
  );
  assert.deepEqual(groupFindings(FINDING_LIST, "severe"), []);
});

// --- テーマ ------------------------------------------------------------------

test("テーマは 自動 → 明 → 暗 で回る", () => {
  assert.equal(nextTheme("auto"), "light");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "auto");
});

test("知らない保存値は自動として扱う", () => {
  assert.equal(normalizeTheme("sepia"), "auto");
  assert.equal(normalizeTheme(null), "auto");
  assert.equal(nextTheme("sepia"), "light");
});

// --- 次回訪問時の復元 --------------------------------------------------------

test("保存するのは絞り込みと表示だけ。選択と検索語は持ち越さない", () => {
  const data = fixture();
  const state = { ...defaultState(data), selected: "FR-1", query: "領収書", direction: "LR" };

  assert.equal(storableHash(state, data), "#dir=LR");
  assert.equal(encodeHash(state, data).includes("node=FR-1"), true);
});

test("URL のハッシュが保存より優先される", () => {
  assert.equal(initialHash("#node=FR-1", "#dir=LR"), "#node=FR-1");
  assert.equal(initialHash("", "#dir=LR"), "#dir=LR");
  assert.equal(initialHash("#", "#dir=LR"), "#dir=LR");
  assert.equal(initialHash("", null), "");
});

// --- 書き出し (Mermaid) ------------------------------------------------------
//
// `render_mermaid()` と一字一句同じであることは tests/test_site_js.py が
// examples/sample.py で突き合わせる。ここでは絞り込みの効き方を見る。

test("Mermaid は見えているノードとエッジだけを出す", () => {
  const data = fixture();
  const types = new Set(data.types);
  types.delete("Source");
  const text = mermaidText(createView(data, { ...allOn(data), types }));

  //: 識別子は描く順の連番 (Goal-1, Need-1, FR-1, QR-1 の 4 件)。
  assert.ok(text.startsWith("flowchart TD\n"));
  assert.ok(text.includes('n1("<b>Goal-1</b> [Goal]<br/>経費精算を速くする")'));
  assert.ok(!text.includes("SRC-1"));
  assert.ok(!text.includes("has_source"));
  assert.ok(text.includes("    n1 -->|motivates| n2"));
  //: classDef は全型ぶん出す (絞り込みで並びが変わらない)。
  assert.ok(text.includes("    classDef Source fill:#fff,stroke:#000"));
  assert.ok(!/ {4}class n\d+ Source$/m.test(text));
});

test("Mermaid のラベルは空白を潰して切り詰め、記号を逃がす", () => {
  const data = fixture();
  data.nodes[0].text = 'A  B <c> "d" \\e';
  data.nodes[1].text = "長".repeat(60);
  const [, first, second] = mermaidText(createView(data, allOn(data))).split("\n");

  assert.ok(first.includes("A B #lt;c#gt; #quot;d#quot; ＼e"));
  //: 本文は 40 文字で切る (末尾は …)。id と型の行は数に入れない。
  const body = second.split("<br/>")[1].replace('")', "");
  assert.equal([...body].length, 40);
  assert.ok(body.endsWith("…"));
});

test("破線にするエッジ種別は meta が決める", () => {
  const view = viewOf();
  const text = mermaidText(view);

  //: Goal-1 = n1, Need-1 = n2, FR-1 = n3, QR-1 = n4, SRC-1 = n5。
  assert.ok(text.includes("n1 -.->|has_source| n5"));
  assert.ok(text.includes("n3 -->|satisfies| n2"));
});

test("記号だけが異なる id でもノードは融合しない", () => {
  const data = fixture();
  //: `FR-1` の記号違い。元の id から識別子を作ると両者が同じになる。
  data.nodes.push({ ...data.nodes[2], id: "FR_1", text: "金額を表示すること" });
  data.edges.push({ source: "FR_1", name: "satisfies", target: "Need-1" });
  const text = mermaidText(createView(data, allOn(data)));

  const declared = [...text.matchAll(/^ {4}(\w+)\("<b>(.+?)<\/b>/gm)];
  assert.equal(declared.length, 6);
  assert.equal(new Set(declared.map(([, id]) => id)).size, 6);
  //: 2 つの FR が別々の端点から Need-1 を指す。
  const [, dash] = declared.find(([, , nodeId]) => nodeId === "FR-1");
  const [, under] = declared.find(([, , nodeId]) => nodeId === "FR_1");
  assert.notEqual(dash, under);
  assert.ok(text.includes(`    ${dash} -->|satisfies| `));
  assert.ok(text.includes(`    ${under} -->|satisfies| `));
});

// --- 書き出し (SVG) ----------------------------------------------------------

const scene = (overrides = {}) => ({
  nodes: [
    {
      id: "Goal-1",
      type: "Goal",
      status: "approved",
      label: "Goal-1\n経費精算",
      x: 0,
      y: 0,
      w: 100,
      h: 40,
    },
    {
      id: "Need-1",
      type: "Need",
      status: "proposed",
      label: "Need-1\n撮影するだけ",
      x: 0,
      y: 120,
      w: 100,
      h: 40,
    },
  ],
  edges: [{ name: "motivates", dashed: false, x1: 0, y1: 20, x2: 0, y2: 100 }],
  bands: [],
  meta: fixture().meta,
  palette: { fg: "#000", bg: "#fff", panel: "#f7f8fa", border: "#ccc", muted: "#666" },
  title: "テスト",
  ...overrides,
});

test("SVG は図の全体が収まる viewBox を持つ", () => {
  const svg = graphSvg(scene());

  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  //: 余白 (SVG_PADDING = 24) のぶんだけ外に広がる。
  assert.ok(svg.includes('viewBox="-74 -44 148 208"'));
  assert.ok(svg.trimEnd().endsWith("</svg>"));
});

test("SVG にはノードのラベル・配色・エッジ名が入る", () => {
  const svg = graphSvg(scene());

  assert.ok(svg.includes(">経費精算</tspan>"));
  assert.ok(svg.includes(">motivates</text>"));
  //: 型の配色 (meta.types) と status の線種 (meta.statuses) が効く。
  assert.equal(svg.match(/fill="#fff"/g).length >= 2, true);
  assert.ok(svg.includes('stroke-dasharray="1 3"')); // proposed = 点線
});

test("ノードが 1 つも無くても SVG は壊れない", () => {
  const svg = graphSvg({ ...scene(), nodes: [], edges: [], bands: [] });

  assert.ok(svg.startsWith("<svg "));
  assert.ok(svg.includes('viewBox="-24 -24 48 48"'));
});

test("SVG に入る文字列はエスケープされる", () => {
  const nodes = [{ ...scene().nodes[0], label: '<script>&"' }];
  const svg = graphSvg({ ...scene(), nodes, title: "<b>題</b>" });

  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;&amp;"));
  assert.ok(svg.includes("<title>&lt;b&gt;題&lt;/b&gt;</title>"));
});
