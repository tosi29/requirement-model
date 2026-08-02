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

// --- LLM 用コンテキスト -----------------------------------------------------
//
// 以下は `explain.py` の explain_text() / _describe() / _all_edge_names() の写し。
// 出力が 1 文字でもずれるとテストが落ちるので、片方を直したら両方を直すこと。

const MISSING_RANK = 10 ** 6;

/** ノードが現れる順 (正規化 JSON の並び = 型順 → id 順)。 */
const rankOf = (view, id) =>
  view.order.has(id) ? view.order.get(id) : MISSING_RANK;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

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
