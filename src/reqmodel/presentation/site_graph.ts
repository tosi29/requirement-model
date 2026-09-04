// @ts-nocheck
import { labelChunks, nodeSize, estimateTextWidth } from "./site_text.ts";
// --- 表示対象 --------------------------------------------------------------

/**
 * 絞り込みを適用した「いま見えているグラフ」。
 *
 * 1 回の再描画につき 1 つ作り、以降の計算はすべてこれを介して行う。
 * state は `{ types: Set<string>, edges: Set<string>, statuses?: Set<string> }`。
 * statuses は省略すると「絞り込み無し」。
 *
 * エッジは「見えているノード同士」を繋ぐものだけが残る。ノード側の条件が
 * 何であれ (種別・status) 同じ扱いになるので、絞り込みはそのまま
 * 影響範囲の計算 (`reach()`) にも効く。
 */
export function createView(data, state) {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const nodes = data.nodes.filter(
    (node) =>
      state.types.has(node.type) &&
      (!state.statuses || state.statuses.has(node.status)),
  );
  const shown = new Set(nodes.map((node) => node.id));
  const edges = data.edges.filter(
    (edge) =>
      state.edges.has(edge.name) && shown.has(edge.source) && shown.has(edge.target),
  );
  const order = new Map(data.nodes.map((node, index) => [node.id, index]));
  return { data, state, byId, nodes, edges, order, adjacency: buildAdjacency(nodes, edges) };
}

/**
 * 見えているグラフの隣接マップ。id → `{ out: [id...], in: [id...] }`。
 *
 * 探索 (`reach()` / `focusSet()`) はこれだけを見る。探索のたびに全エッジを
 * 走査すると 1 回が O(V×E) になり、深さ指定や近傍描画のように呼び出しが
 * 増えるほど効いてくる。組み立ては view 1 つにつき 1 回で O(V+E)。
 *
 * `createView()` がエッジの両端が見えていることを保証しているので、
 * ここでは端点の欠落を考えない。
 */
function buildAdjacency(nodes, edges) {
  const adjacency = new Map();
  for (const node of nodes) adjacency.set(node.id, { out: [], in: [] });
  for (const edge of edges) {
    adjacency.get(edge.source).out.push(edge.target);
    adjacency.get(edge.target).in.push(edge.source);
  }
  return adjacency;
}

// --- 絞り込みの選択肢 ------------------------------------------------------
//
// 左サイドバーのチェックボックス 1 群ぶん。件数は絞り込み前の全ノードで数える
// (チェックを外しても数字が動かないほうが、何を外したか分かる)。

const countBy = (nodes, keyOf) => {
  const counts = new Map();
  for (const node of nodes) counts.set(keyOf(node), (counts.get(keyOf(node)) || 0) + 1);
  return counts;
};

/** 利用者向けに表示するフィールド名。内部フィールド名は変えない。 */
export const FIELD_LABELS = Object.freeze({
  source: "出典",
  realized_by: "実現手段",
  evidence: "証跡",
  status: "ステータス",
});

/** 内部フィールド名を画面表示用ラベルに変換する。 */
export const fieldLabel = (name) => FIELD_LABELS[name] || name;

/** status の一覧。並びは成熟度 (`meta.statuses` の順 = `STATUS_RANK`)。 */
export const statusNames = (data) => Object.keys((data.meta || {}).statuses || {});

/** status の選択肢。 */
export function statusFilters(data) {
  const counts = countBy(data.nodes, (node) => node.status);
  return statusNames(data).map((status) => ({
    key: status,
    label: status,
    count: counts.get(status) || 0,
  }));
}

/** 図に既定で描かないもの (`site_data()` の `hidden_by_default`)。 */
export function hiddenByDefault(data, key) {
  return ((data || {}).hidden_by_default || {})[key] || [];
}

/** ある軸の既定の選択。全体から「既定で隠すもの」を引いたもの。 */
export function initialSelection(data, all, key) {
  const hidden = new Set(hiddenByDefault(data, key));
  return all.filter((name) => !hidden.has(name));
}

/**
 * 選択中のエッジ種別が `req explain` のどの呼び方に当たるか。
 *
 * - `"default"` … 既定のまま (源泉エッジだけ外れている) → 引数なし
 * - `"all"`     … 全エッジ選択。外部参照はエッジではないので CLI 引数は不要
 * - 配列        … それ以外 → `--edges a,b,c`
 *
 * CLI 側 (`explain.traversed_edges()`) と対応が崩れると、ページが配る
 * コンテキストとコマンドの出力が食い違う。
 */
export function edgeSelection(view) {
  const all = view.data.edge_names;
  const selected = all.filter((name) => view.state.edges.has(name));
  if (selected.length === all.length) return "all";
  const initial = initialSelection(view.data, all, "edges");
  if (selected.length === initial.length && initial.every((name) => view.state.edges.has(name))) {
    return "default";
  }
  return selected;
}

/**
 * 選択中のエッジ種別。`--edges` に渡す値で、渡さなくてよいなら null。
 */
export function activeEdgeNames(view) {
  const selection = edgeSelection(view);
  return Array.isArray(selection) ? selection : null;
}

/**
 * start から辿れるノード (start 自身は含まない)。
 *
 * direction は `"out"` / `"in"` / `"both"` ("both" は向きを無視する)。depth は
 * ホップ数の上限で、null なら無制限。`graph.py` の `_reach()` / `related()` と
 * 同じ数え方 (start からの距離が depth 以下のノードまで) にしてある。
 *
 * 距離で切るために段 (frontier) ごとに進める。見えているグラフの隣接マップだけを
 * 見るので、絞り込みはそのまま探索にも効く。
 */
function walk(view, start, direction, depth = null) {
  const seen = new Set();
  if (!view.adjacency.has(start)) return seen;
  let frontier = [start];
  for (let step = 0; frontier.length && (depth === null || step < depth); step++) {
    const next = [];
    for (const id of frontier) {
      const links = view.adjacency.get(id);
      const neighbours = direction === "both" ? [...links.out, ...links.in] : links[direction];
      for (const other of neighbours) {
        if (other === start || seen.has(other)) continue;
        seen.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * start から辿れるノード (start 自身は含まない)。forward=false なら向きを逆に辿る。
 * depth はホップ数の上限 (null なら無制限)。
 * 見えているエッジだけを使うので、絞り込みは影響範囲の計算にも効く。
 */
export function reach(view, start, forward, depth = null) {
  return walk(view, start, forward ? "out" : "in", depth);
}

/**
 * 向きを無視して辿れるノード (`req explain --undirected` と同じ)。
 * 「この FR はなぜ作るのか (Goal)」のように、有向では繋がらない文脈を集める。
 */
export function related(view, start, depth = null) {
  return walk(view, start, "both", depth);
}

// --- 影響範囲 --------------------------------------------------------------
//
// 影響範囲の切り出しは `explain.py` の `impact_set()` と同じにする。ここが
// 画面の色分けと「影響部分グラフをコピー」の両方の出典なので、片方だけが
// 深さや向きの設定を見ている状態を作らない。

/** 選べる探索の深さ (ホップ数)。0 は無制限で、この一覧には入れない。 */
export const IMPACT_DEPTHS = [1, 2, 3, 4, 5];

/**
 * state から探索設定を取り出す。`{ depth: number|null, undirected: boolean }`。
 * state.depth の 0 (既定) は「無制限」なので null に写す。
 */
export function impactScope(state) {
  const depth = (state || {}).depth;
  return {
    depth: IMPACT_DEPTHS.includes(depth) ? depth : null,
    undirected: Boolean((state || {}).undirected),
  };
}

/**
 * 影響範囲。`explain.py` の `impact_set()` と同じ切り分けで
 * `{ upstream, downstream, whole, undirected }` を返す。
 *
 * undirected のときは上流/下流の区別が付かないので、CLI と同じく全件を
 * downstream 側に入れる (呼び出し側は 1 つの「関連ノード」として扱う)。
 * scope を省略すると view の state から取る。
 */
export function impactSets(view, id, scope = null) {
  const { depth, undirected } = scope || impactScope(view.state);
  if (undirected) {
    const neighbours = related(view, id, depth);
    return {
      upstream: new Set(),
      downstream: neighbours,
      whole: new Set([id, ...neighbours]),
      undirected: true,
    };
  }
  const upstream = reach(view, id, false, depth);
  const downstream = reach(view, id, true, depth);
  return {
    upstream,
    downstream,
    whole: new Set([id, ...upstream, ...downstream]),
    undirected: false,
  };
}

// --- フォーカス (近傍だけを描く) --------------------------------------------
//
// 要求グラフは同じ段に FR が何十個も並ぶため、全体を 1 枚に収めると横長になり
// 文字が読めない (詳細は docs/design/site.md「大きいグラフでの表示戦略」)。選んだノードの
// 近傍だけを描けば、規模に関わらず読める倍率のまま中身を確認できる。

/** 選べる近傍の深さ (ホップ数)。0 はフォーカス無し。 */
export const FOCUS_DEPTHS = [1, 2, 3];

/**
 * start から depth ホップ以内のノード (start 自身を含む)。
 *
 * **エッジの向きは無視する**。フォーカスは「その要求の周りに何があるか」を
 * 見るためのもので、上流 (Goal 側) と下流 (FR 側) のどちらが欠けても
 * 文脈にならないため (`req explain --undirected` と同じ考え方)。
 *
 * 見えているグラフの隣接マップだけを見るので、絞り込みはそのまま効く。
 */
export function focusSet(view, start, depth) {
  if (!view.adjacency.has(start)) return new Set();
  return new Set([start, ...related(view, start, depth)]);
}

// --- 並びの土台 ------------------------------------------------------------

const MISSING_RANK = 10 ** 6;

/** ノードが現れる順 (正規化 JSON の並び = 型順 → id 順)。 */
export const rankOf = (view, id) =>
  view.order.has(id) ? view.order.get(id) : MISSING_RANK;

export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

