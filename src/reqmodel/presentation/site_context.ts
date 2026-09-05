import { compare, activeEdgeNames, edgeSelection, hiddenByDefault, impactScope, impactSets, rankOf, reach } from "./site_graph.ts";
import type { GraphViewModel, SiteData } from "./site_types.ts";
// --- LLM 用コンテキスト -----------------------------------------------------
//
// 以下は `explain.py` の explain_text() / _describe() / _all_edge_names() の写し。
// 出力が 1 文字でもずれるとテストが落ちるので、片方を直したら両方を直すこと。

/** ノード 1 件の記述。`explain.py` の `_describe()` と同じ整形。 */
function describe(view, id) {
  const node = view.byId.get(id);
  const attrs = [`status=${node.status}`];
  const lines = [`- [${node.type}] ${node.id}: ${node.text}`, `    (${attrs.join(", ")})`];
  const pushReference = (label, item) => {
    lines.push(`    ${label}: ${item.title} <${item.url}>`);
    if (item.note) lines.push(`      note: ${item.note}`);
  };
  for (const item of node.source || []) pushReference("Source", item);
  for (const item of node.realized_by || []) pushReference("Realized by", item);
  for (const item of node.evidence || []) pushReference("Evidence", item);
  for (const criterion of node.acceptance_criteria || []) {
    lines.push(`    受け入れ基準: ${criterion}`);
  }
  return lines;
}

/**
 * グラフに現れうるエッジ種別 (`explain.py` の `_all_edge_names()`)。
 * ノードの型から機械的に決まるので、型ごとの一覧は Python 側から受け取る。
 */
export function allEdgeNames(data: SiteData): string[] {
  const names = [];
  for (const node of data.nodes) {
    for (const name of data.edge_names_by_type[node.type] || []) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * コピー本文と同じ内容を出す `req explain` のコマンド行。詳細ペインの案内に使う。
 * 画面の設定 (エッジ種別・深さ・向き) がそのまま引数になる。
 */
export function explainCommand(view: GraphViewModel, id: string, scope: { depth: number | null; undirected: boolean } | null = null): string {
  const { depth, undirected } = scope || impactScope(view.state);
  const selection = edgeSelection(view);
  const parts = [`req explain ${id}`];
  if (Array.isArray(selection)) parts.push(`--edges ${selection.join(",")}`);
  if (depth !== null) parts.push(`--depth ${depth}`);
  if (undirected) parts.push("--undirected");
  return parts.join(" ");
}

/**
 * 「影響部分グラフをコピー」の本文。`explainCommand()` が出すコマンドの
 * 出力と一致する (絞り込み無し・深さ無制限・有向なら `req explain ID` と同じ)。
 *
 * scope を省略すると view の state から取るので、画面の色分けと同じ範囲になる。
 */
export function nodeContext(view: GraphViewModel, id: string, scope: { depth: number | null; undirected: boolean } | null = null): string {
  const settings = scope || impactScope(view.state);
  const selection = edgeSelection(view);
  const edgeFilter = Array.isArray(selection) ? selection : null;
  const { upstream, downstream, whole, undirected } = impactSets(view, id, settings);

  const lines = [`# 影響部分グラフ: ${id}`, ""];
  if (undirected) {
    lines.push(
      `対象 ${whole.size - downstream.size} 件 / 関連 ${downstream.size} 件 / ` +
        `合計 ${whole.size} 件`,
    );
    lines.push("探索方向: 無向 (エッジの向きを無視)");
  } else {
    lines.push(
      `対象 1 件 / 上流 ${upstream.size} 件 / 下流 ${downstream.size} 件 / ` +
        `合計 ${whole.size} 件`,
    );
  }
  if (edgeFilter) lines.push(`エッジ種別フィルタ: ${edgeFilter.join(", ")}`);
  if (settings.depth !== null) lines.push(`探索深さ: ${settings.depth}`);

  const block = (title, ids) => {
    const sorted = [...ids].sort((a, b) => rankOf(view, a) - rankOf(view, b));
    if (!sorted.length) return;
    lines.push("", `## ${title} (${sorted.length} 件)`);
    for (const nodeId of sorted) lines.push(...describe(view, nodeId));
  };

  block("対象ノード", [id]);
  if (undirected) {
    block("関連ノード (向きを問わず繋がっているノード)", downstream);
  } else {
    block("上流 (この変更の理由・根拠になるノード)", upstream);
    block("下流 (この変更の影響を受けるノード)", downstream);
  }

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

  const hidden = new Set(edgeFilter ? [] : hiddenByDefault(view.data, "edges"));
  const unused = allEdgeNames(view.data).filter(
    (name) => !hidden.has(name) && !edges.some((edge) => edge.name === name),
  );
  if (unused.length) {
    lines.push("", `(部分グラフに現れなかったエッジ種別: ${unused.join(", ")})`);
  }

  return lines.join("\n") + "\n";
}
