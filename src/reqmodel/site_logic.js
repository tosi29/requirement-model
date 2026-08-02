/**
 * 静的サイトのロジック層。
 *
 * DOM にも Cytoscape.js にも一切触れない純関数だけを置く。ここに置いたものは
 * Node からそのまま import してテストできる (`tests/js/`)。ページに載せるときは
 * `site.py` が `site_app.js` と一緒に 1 枚の HTML へインライン化する。
 *
 * `nodeContext()` の出力は CLI の `req explain` (`explain.py`) と一致させる。
 * ここを崩すと「サイトからコピーしたコンテキスト」と「CLI が出すコンテキスト」が
 * 食い違うので、`tests/test_site_js.py` で両者を突き合わせている。
 */

// --- 文字列 ----------------------------------------------------------------

/** 表示用に長い本文を切り詰める。 */
export function truncate(text, limit = 42) {
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

/** Cytoscape の text-wrap は空白でしか折り返さず日本語に効かないので、自前で折る。 */
export function wrapLabel(text, perLine = 9) {
  const lines = [];
  let line = "";
  for (const char of text) {
    line += char;
    if (line.length < perLine) continue;
    const space = line.lastIndexOf(" ");
    if (space > 0) {
      lines.push(line.slice(0, space));
      line = line.slice(space + 1);
    } else {
      lines.push(line);
      line = "";
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- 表示対象 --------------------------------------------------------------

/**
 * 絞り込みを適用した「いま見えているグラフ」。
 *
 * 1 回の再描画につき 1 つ作り、以降の計算はすべてこれを介して行う。
 * state は `{ types: Set<string>, edges: Set<string> }`。
 */
export function createView(data, state) {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const nodes = data.nodes.filter((node) => state.types.has(node.type));
  const edges = data.edges.filter(
    (edge) =>
      state.edges.has(edge.name) &&
      state.types.has(byId.get(edge.source).type) &&
      state.types.has(byId.get(edge.target).type),
  );
  const order = new Map(data.nodes.map((node, index) => [node.id, index]));
  return { data, state, byId, nodes, edges, order };
}

/**
 * 選択中のエッジ種別。全部選ばれていれば「絞り込み無し」として null を返す
 * (`req explain` に `--edges` を渡さないのと同じ状態)。
 */
export function activeEdgeNames(view) {
  const selected = view.data.edge_names.filter((name) => view.state.edges.has(name));
  return selected.length === view.data.edge_names.length ? null : selected;
}

/**
 * start から辿れるノード (start 自身は含まない)。forward=false なら向きを逆に辿る。
 * 見えているエッジだけを使うので、絞り込みは影響範囲の計算にも効く。
 */
export function reach(view, start, forward) {
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

// --- 並びの土台 ------------------------------------------------------------

const MISSING_RANK = 10 ** 6;

/** ノードが現れる順 (正規化 JSON の並び = 型順 → id 順)。 */
const rankOf = (view, id) =>
  view.order.has(id) ? view.order.get(id) : MISSING_RANK;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// --- テーブル --------------------------------------------------------------
//
// 棚卸し (全件を順に確認する作業) 用の一覧。グラフと同じ view から作るので、
// 種別・エッジ種別の絞り込みはそのまま効く。

/** 表の列。並びがそのまま左からの列順になる。 */
export const TABLE_COLUMNS = [
  { key: "id", label: "id" },
  { key: "type", label: "type" },
  { key: "text", label: "本文" },
  { key: "status", label: "status" },
  { key: "priority", label: "優先度", numeric: true },
  { key: "criteria", label: "受入基準", numeric: true },
  { key: "findings", label: "指摘", numeric: true },
];

/** 重い順。行の指摘数に色を付けるときの「最も重い指摘」を決めるのに使う。 */
export const SEVERITY_ORDER = ["error", "severe", "warning", "info"];

/** 検索欄の絞り込み。id と本文の部分一致 (大文字小文字は区別しない)。 */
export function matchesQuery(node, query) {
  const needle = (query || "").trim().toLowerCase();
  if (!needle) return true;
  return (
    node.id.toLowerCase().includes(needle) ||
    node.text.toLowerCase().includes(needle)
  );
}

/**
 * 表に出す行。view に見えているノードだけを、検索語で更に絞る。
 * 指摘は「そのノードに紐づくもの」だけを数え、色付け用に最も重い severity を添える。
 */
export function tableRows(view, query = "") {
  const counts = new Map();
  const worst = new Map();
  for (const finding of view.data.findings || []) {
    if (!finding.node_id) continue;
    counts.set(finding.node_id, (counts.get(finding.node_id) || 0) + 1);
    const rank = SEVERITY_ORDER.indexOf(finding.severity);
    const known = worst.get(finding.node_id);
    if (rank >= 0 && (known === undefined || rank < known)) {
      worst.set(finding.node_id, rank);
    }
  }
  return view.nodes
    .filter((node) => matchesQuery(node, query))
    .map((node) => ({
      id: node.id,
      type: node.type,
      text: node.text,
      status: node.status,
      priority: node.priority ?? null,
      criteria: (node.acceptance_criteria || []).length,
      findings: counts.get(node.id) || 0,
      severity: worst.has(node.id) ? SEVERITY_ORDER[worst.get(node.id)] : null,
    }));
}

//: 値を持たない行 (priority 無し等) の並び。向きに関わらず末尾に置く。
const MISSING_VALUE = Number.POSITIVE_INFINITY;

/**
 * 並び替えに使う値。type は種別の定義順、status は成熟度 (`STATUS_RANK`) で、
 * どちらも Python 側から渡ってきた並びを唯一の出典とする。
 */
function sortValue(view, row, key) {
  switch (key) {
    case "type":
      return view.data.types.indexOf(row.type);
    case "status": {
      const rank = (view.data.status_rank || {})[row.status];
      return rank === undefined ? MISSING_VALUE : rank;
    }
    case "priority":
      return row.priority === null ? MISSING_VALUE : row.priority;
    default:
      return row[key];
  }
}

/**
 * 行の並び替え。同値のときは正規化 JSON の並び (型順 → id 順) で決めるので、
 * 何度押しても結果が揺れない。
 */
export function sortRows(view, rows, sort) {
  const sign = sort.asc ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(view, a, sort.key);
    const right = sortValue(view, b, sort.key);
    let diff = 0;
    if (left === MISSING_VALUE && right !== MISSING_VALUE) diff = 1;
    else if (right === MISSING_VALUE && left !== MISSING_VALUE) diff = -1;
    else diff = sign * compare(left, right);
    return diff || rankOf(view, a.id) - rankOf(view, b.id);
  });
}

/**
 * 列見出しを押したときの新しい並び順。同じ列なら向きを反転し、別の列なら
 * その列の既定の向き (数の列は多い順、文字の列は昇順) から始める。
 */
export function nextSort(sort, key) {
  const column = TABLE_COLUMNS.find((item) => item.key === key);
  if (!column) return sort;
  if (sort.key === key) return { key, asc: !sort.asc };
  return { key, asc: !column.numeric };
}

// --- LLM 用コンテキスト -----------------------------------------------------
//
// 以下は `explain.py` の explain_text() / _describe() / _all_edge_names() の写し。
// 出力が 1 文字でもずれるとテストが落ちるので、片方を直したら両方を直すこと。

/** ノード 1 件の記述。`explain.py` の `_describe()` と同じ整形。 */
function describe(view, id) {
  const node = view.byId.get(id);
  const attrs = [`status=${node.status}`];
  if (node.priority !== null && node.priority !== undefined) {
    attrs.push(`priority=${node.priority}`);
  }
  if (node.type === "Source") attrs.push(`kind=${node.kind}`);
  // decomposition は「子から refines されている Goal」にだけ意味がある。
  // CLI 側と揃えるため、ここだけは絞り込み前の全エッジを見る。
  if (
    node.decomposition !== null &&
    node.decomposition !== undefined &&
    view.data.edges.some((edge) => edge.name === "refines" && edge.target === id)
  ) {
    attrs.push(`decomposition=${node.decomposition}`);
  }
  const lines = [`- [${node.type}] ${node.id}: ${node.text}`, `    (${attrs.join(", ")})`];
  for (const criterion of node.acceptance_criteria || []) {
    lines.push(`    受け入れ基準: ${criterion}`);
  }
  return lines;
}

/**
 * グラフに現れうるエッジ種別 (`explain.py` の `_all_edge_names()`)。
 * ノードの型から機械的に決まるので、型ごとの一覧は Python 側から受け取る。
 */
export function allEdgeNames(data) {
  const names = [];
  for (const node of data.nodes) {
    for (const name of data.edge_names_by_type[node.type] || []) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * 「影響部分グラフをコピー」の本文。`req explain ID` の出力と一致する
 * (エッジ種別を絞っていれば `req explain ID --edges ...` と一致する)。
 */
export function nodeContext(view, id) {
  const edgeFilter = activeEdgeNames(view);
  const upstream = reach(view, id, false);
  const downstream = reach(view, id, true);
  const whole = new Set([id, ...upstream, ...downstream]);

  const lines = [`# 影響部分グラフ: ${id}`, ""];
  lines.push(
    `対象 1 件 / 上流 ${upstream.size} 件 / 下流 ${downstream.size} 件 / ` +
      `合計 ${whole.size} 件`,
  );
  if (edgeFilter) lines.push(`エッジ種別フィルタ: ${edgeFilter.join(", ")}`);

  const block = (title, ids) => {
    const sorted = [...ids].sort((a, b) => rankOf(view, a) - rankOf(view, b));
    if (!sorted.length) return;
    lines.push("", `## ${title} (${sorted.length} 件)`);
    for (const nodeId of sorted) lines.push(...describe(view, nodeId));
  };

  block("対象ノード", [id]);
  block("上流 (この変更の理由・根拠になるノード)", upstream);
  block("下流 (この変更の影響を受けるノード)", downstream);

  // 部分グラフのエッジは種別で絞らない (CLI の subgraph_edges と同じ)。
  const edges = view.data.edges.filter(
    (edge) => whole.has(edge.source) && whole.has(edge.target),
  );
  if (edges.length) {
    lines.push("", `## 部分グラフのエッジ (${edges.length} 件)`);
    const sorted = [...edges].sort(
      (a, b) =>
        rankOf(view, a.source) - rankOf(view, b.source) ||
        compare(a.name, b.name) ||
        compare(a.target, b.target),
    );
    for (const edge of sorted) {
      lines.push(`- ${edge.source} --${edge.name}--> ${edge.target}`);
    }
  }

  const unused = allEdgeNames(view.data).filter(
    (name) => !edges.some((edge) => edge.name === name),
  );
  if (unused.length) {
    lines.push("", `(部分グラフに現れなかったエッジ種別: ${unused.join(", ")})`);
  }

  return lines.join("\n") + "\n";
}

// --- Cytoscape.js に渡す値 --------------------------------------------------
//
// 生成するのはただのオブジェクトなので、ライブラリを読み込まなくてもテストできる。

/** 図の要素定義。ノードとエッジの全件を一度だけ作る。 */
export function graphElements(data) {
  return [
    ...data.nodes.map((node) => ({
      data: {
        id: node.id,
        type: node.type,
        label: `${node.id}\n${wrapLabel(truncate(node.text, 30))}`,
      },
    })),
    ...data.edges.map((edge, index) => ({
      data: {
        id: `e${index}`,
        index,
        source: edge.source,
        target: edge.target,
        name: edge.name,
      },
    })),
  ];
}

/**
 * スタイル定義。形状・配色は `render_meta()` から来た meta が唯一の出典で、
 * テーマ依存の色 (fg / bg / border / muted) だけ palette で受け取る。
 */
export function graphStyle(meta, palette) {
  const impact = meta.impact_colors;
  const style = [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "text-wrap": "wrap",
        "text-max-width": "160px",
        "text-valign": "center",
        "font-size": 10,
        "line-height": 1.25,
        color: "#1f2328",
        width: "label",
        height: "label",
        padding: "7px",
        "border-width": 1.5,
        "transition-property": "opacity, border-width, border-color",
        "transition-duration": "120ms",
      },
    },
    {
      selector: "edge",
      style: {
        label: "data(name)",
        "font-size": 9,
        color: palette.muted,
        "text-background-color": palette.bg,
        "text-background-opacity": 0.85,
        "text-background-padding": "1px",
        width: 1.2,
        "line-color": palette.border,
        "target-arrow-color": palette.border,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.8,
        "curve-style": "bezier",
      },
    },
    { selector: "edge.dashed", style: { "line-style": "dashed" } },
    { selector: ".hidden", style: { display: "none" } },
    { selector: ".dim", style: { opacity: 0.28 } },
    {
      selector: "node.sel",
      style: { "border-width": 4, "border-color": impact.selected, "z-index": 10 },
    },
    {
      selector: "node.up",
      style: { "border-width": 3, "border-color": impact.upstream },
    },
    {
      selector: "node.down",
      style: { "border-width": 3, "border-color": impact.downstream },
    },
    {
      selector: "edge.on-path",
      style: { width: 2, "line-color": palette.fg, "target-arrow-color": palette.fg },
    },
  ];
  for (const [type, typeMeta] of Object.entries(meta.types)) {
    style.push({
      selector: `node[type = "${type}"]`,
      style: {
        shape: typeMeta.shape,
        "background-color": typeMeta.fill,
        "border-color": typeMeta.stroke,
      },
    });
  }
  return style;
}

/**
 * ノードが表示範囲に収まっているか。extent (`cy.extent()`) も box
 * (`node.boundingBox()`) も Cytoscape のモデル座標 `{x1, y1, x2, y2}`。
 *
 * margin は端に貼り付いた状態を「見えている」と扱わないための余白。
 * ノードが視野より大きくて収めようが無いときは、中心が見えていれば十分とする
 * (そうしないと選ぶたびに毎回パンすることになる)。
 */
export function isNodeVisible(extent, box, margin = 0) {
  const inner = {
    x1: extent.x1 + margin,
    y1: extent.y1 + margin,
    x2: extent.x2 - margin,
    y2: extent.y2 - margin,
  };
  const fits =
    box.x2 - box.x1 <= inner.x2 - inner.x1 && box.y2 - box.y1 <= inner.y2 - inner.y1;
  if (fits) {
    return (
      box.x1 >= inner.x1 && box.x2 <= inner.x2 && box.y1 >= inner.y1 && box.y2 <= inner.y2
    );
  }
  const centerX = (box.x1 + box.x2) / 2;
  const centerY = (box.y1 + box.y2) / 2;
  return (
    centerX >= extent.x1 &&
    centerX <= extent.x2 &&
    centerY >= extent.y1 &&
    centerY <= extent.y2
  );
}

/** dagre のレイアウト設定。direction は "TD" か "LR"。 */
export function layoutOptions(direction) {
  return {
    name: "dagre",
    rankDir: direction === "LR" ? "LR" : "TB",
    nodeSep: 24,
    rankSep: 56,
    edgeSep: 12,
    animate: false,
    fit: true,
    padding: 18,
  };
}
