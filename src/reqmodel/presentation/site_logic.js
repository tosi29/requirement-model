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

export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 属性値に入れる文字列。引用符まで潰す。 */
export function escapeAttr(text) {
  return escapeHtml(String(text)).replace(/"/g, "&quot;");
}

// --- ラベルの折り返し ------------------------------------------------------
//
// Cytoscape の text-wrap は空白でしか折り返さず、日本語には効かない。かといって
// 文字数で機械的に折ると「24 / 時間」のように数値と単位が離れる。ここでは
//
//   1. 文を「文節らしいまとまり」(chunk) に切り、
//   2. 実測幅で入るだけ 1 行に詰める
//
// の 2 段でやる。切る位置の判断は 1. に閉じているので、幅の決め方 (2.) を
// 変えても組み方の癖は変わらない。

/** ラベルの字体。canvas での実測と Cytoscape のスタイルで同じものを使う。 */
export const LABEL_FONT = {
  size: 10,
  lineHeight: 1.25,
  family:
    '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", "Segoe UI", sans-serif',
};

/** ノード本文として表示する最大文字数。極端に長い本文だけ省略する。 */
export const LABEL_MAX_LENGTH = 60;

/** 1 行の上限幅 (px)。全角 16 文字ぶん。 */
export const LABEL_WRAP_WIDTH = 160;

//: 全角幅で数える文字 (CJK と全角記号)。
const WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;

/**
 * 幅の概算 (px)。ブラウザでは canvas の実測を渡す (`measure` 引数) ので、これは
 * その代わり。全角を 1em・半角を 0.55em として数えるだけ。
 */
export function estimateTextWidth(text, fontSize = LABEL_FONT.size) {
  let width = 0;
  for (const char of text) width += (WIDE_CHAR.test(char) ? 1 : 0.55) * fontSize;
  return width;
}

//: 行頭に置かない文字 (句読点・閉じ括弧・長音など)。前の行の末尾に残す。
const NO_LINE_START = "、。，．,.)）〕］｝」』〉》!?！？:：;；・…‥ー〜%％";
//: 行末に置かない文字 (開き括弧)。次の行の先頭へ送る。
const NO_LINE_END = "(（〔［｛「『〈《";
//: 半角の語。数値の中の区切り (99.9) は割らない。
const WORD_RUN = /^[0-9A-Za-z]+(?:[.,\-_/][0-9A-Za-z]+)*[%％]?/;
//: 単位を後ろに従える「数値」。"24" → "24 時間"、"99.9%" → "99.9% 以上"。
const NUMBER = /^[0-9]+(?:[.,][0-9]+)*[%％]?$/;
//: 仮名・漢字・ラテン文字のいずれか。1 つも無い行は数字か記号だけの行。
const HAS_CONTENT = /[A-Za-z\u3041-\u30ff\u3400-\u9fff]/;

const charClass = (char) => {
  if (/\s/.test(char)) return "space";
  if (/[0-9A-Za-z]/.test(char)) return "word";
  if (/[\u3041-\u309f]/.test(char)) return "kana";
  if (/[\u30a1-\u30ff\uff66-\uff9f]/.test(char)) return "kata";
  if (/[\u3005\u3006\u3400-\u9fff]/.test(char)) return "kanji";
  return "other";
};

/** 文字種の続く限りをひとまとまりにする。約物は 1 文字ずつ。 */
function tokenize(text) {
  const tokens = [];
  let rest = text;
  while (rest) {
    const word = rest.match(WORD_RUN);
    if (word) {
      tokens.push({ cls: "word", text: word[0] });
      rest = rest.slice(word[0].length);
      continue;
    }
    const char = [...rest][0];
    rest = rest.slice(char.length);
    const cls = charClass(char);
    const last = tokens[tokens.length - 1];
    if (last && last.cls === cls && cls !== "other") last.text += char;
    else tokens.push({ cls, text: char });
  }
  return tokens;
}

/** 前のまとまりに続けて置く (= ここでは折らない) か。 */
function joins(last, token) {
  if (!last) return true;
  if (NO_LINE_START.includes([...token.text][0])) return true;
  if (NO_LINE_END.includes(last.text.slice(-1))) return true;
  //: 送り仮名と助詞は、直前の語から離さない。
  if (token.cls === "kana") return ["kanji", "kata", "word"].includes(last.cls);
  //: 空白を挟まず続く半角の語 ("第4版" の 4) も同じ語の一部として扱う。
  if (token.cls === "word") return ["kanji", "kata"].includes(last.cls);
  //: 数値は単位を連れていく。
  if (NUMBER.test(last.text)) return ["kanji", "kata", "word"].includes(token.cls);
  return false;
}

/**
 * 折り返し候補で切ったまとまり。区切りの空白は、その手前のまとまりの末尾に
 * 付けたまま返す (行末に来たら落とし、行の途中なら空白として残すため)。
 */
export function labelChunks(text) {
  const tokens = tokenize(text);
  const chunks = [];
  let current = "";
  let last = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.cls === "space") {
      const next = tokens[i + 1];
      //: 数値と単位の間の空白 ("24 時間") では切らない。
      if (last && NUMBER.test(last.text) && next && joins(last, next)) {
        current += token.text + next.text;
        last = next;
        i += 1;
        continue;
      }
      if (current) chunks.push(current + token.text);
      current = "";
      last = null;
      continue;
    }
    if (joins(last, token)) current += token.text;
    else {
      chunks.push(current);
      current = token.text;
    }
    last = token;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** 幅に入るところまでを 1 文字単位で切る。1 つのまとまりが長すぎるときの最後の手段。 */
function hardSplit(text, maxWidth, measure) {
  let head = "";
  for (const char of text) {
    if (head && measure(head + char) > maxWidth) break;
    head += char;
  }
  return head === text ? null : { head, tail: text.slice(head.length) };
}

/** 数字と記号だけの行を無くす。単独で落ちた数値は隣の行に戻す。 */
function mergeLonelyNumbers(lines) {
  const merged = [];
  for (const line of lines) {
    if (merged.length && !HAS_CONTENT.test(line)) merged[merged.length - 1] += line;
    else merged.push(line);
  }
  if (merged.length > 1 && !HAS_CONTENT.test(merged[0])) {
    merged[1] = merged[0] + merged[1];
    merged.shift();
  }
  return merged;
}

/**
 * ラベル 1 つぶんの折り返し。返すのは "\n" で繋いだ 1 つの文字列。
 *
 * measure は 1 行の幅 (px) を返す関数。ブラウザでは canvas の実測を渡す。
 */
export function wrapLabel(
  text,
  maxWidth = LABEL_WRAP_WIDTH,
  measure = estimateTextWidth,
) {
  const lines = [];
  let line = "";
  for (const chunk of labelChunks(text)) {
    if (line && measure((line + chunk).trimEnd()) > maxWidth) {
      lines.push(line.trimEnd());
      line = "";
    }
    line += chunk;
    while (measure(line.trimEnd()) > maxWidth) {
      const cut = hardSplit(line.trimEnd(), maxWidth, measure);
      if (!cut) break;
      lines.push(cut.head);
      line = cut.tail;
    }
  }
  if (line.trimEnd()) lines.push(line.trimEnd());
  return mergeLonelyNumbers(lines).join("\n");
}

//: meta.types[].fit が無いとき (旧いデータ) の既定。矩形として扱う。
const DEFAULT_FIT = { wmul: 1, wpad: 20, hmul: 1, hpad: 14 };

/**
 * ラベル (改行入り) を内側に収めるノードの外形。
 *
 * fit は `render_meta()` の `types[].fit`。図形ごとの係数の由来は Python 側
 * (`_SHAPE_FIT`) に書いてある。ここでは表を持たない。
 */
export function nodeSize(label, fit, measure = estimateTextWidth) {
  const lines = label.split("\n");
  const textWidth = Math.max(...lines.map((line) => measure(line)));
  const textHeight = lines.length * LABEL_FONT.size * LABEL_FONT.lineHeight;
  const box = fit || DEFAULT_FIT;
  return {
    w: Math.round(textWidth * box.wmul + box.wpad),
    h: Math.round(textHeight * box.hmul + box.hpad),
  };
}

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

/** status の一覧。並びは成熟度 (`meta.statuses` の順 = `STATUS_RANK`)。 */
const statusNames = (data) => Object.keys((data.meta || {}).statuses || {});

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
 * - `"all"`     … 源泉エッジも含めて全部 → `--with-sources`
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
  { key: "evidence", label: "根拠", numeric: true },
  { key: "findings", label: "指摘", numeric: true },
];

/** 重い順。行の指摘数に色を付けるときの「最も重い指摘」を決めるのに使う。 */
const SEVERITY_ORDER = ["error", "severe", "warning", "info"];

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
 * 検索にヒットしたノードの id。並びは左サイドバーの一覧と同じ (正規化 JSON の順)。
 * 検索語が空なら「ヒット無し」= 空配列 (全件ではない)。ハイライトもキーボード
 * 選択も「絞り込んだ結果を送る」ためのものなので、空欄で全件を送っても意味が無い。
 */
export function searchHits(view, query) {
  if (!(query || "").trim()) return [];
  return view.nodes.filter((node) => matchesQuery(node, query)).map((node) => node.id);
}

/**
 * ↑↓ で候補を送ったときの次の id。delta は +1 (下) か -1 (上)。
 * 端では巻き戻す。候補が無ければ null、現在位置が候補に無ければ端から始める。
 */
export function stepHit(hits, current, delta) {
  if (!hits.length) return null;
  const at = hits.indexOf(current);
  if (at < 0) return delta > 0 ? hits[0] : hits[hits.length - 1];
  return hits[(at + delta + hits.length) % hits.length];
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
      evidence: (node.evidence || []).length,
      findings: counts.get(node.id) || 0,
      severity: worst.has(node.id) ? SEVERITY_ORDER[worst.get(node.id)] : null,
    }));
}

//: 値を持たない行 (status が meta に無い等) の並び。向きに関わらず末尾に置く。
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

// --- 詳細ペイン ------------------------------------------------------------

/**
 * 詳細ペインに出す出入りのエッジ。**相手ノードの本文まで持たせる**。
 *
 * id だけを並べても、クリックして飛ぶまで何に繋がっているのか分からない。
 * 並びは正規化 JSON の順 (`view.edges` の順) のまま。両端が見えているエッジしか
 * view に無いので、相手ノードは必ず引ける。
 */
export function edgeItems(view, id) {
  const item = (edge, direction) => {
    const other = direction === "out" ? edge.target : edge.source;
    const node = view.byId.get(other);
    return {
      id: other,
      name: edge.name,
      direction,
      arrow: direction === "out" ? `--${edge.name}-->` : `<--${edge.name}--`,
      type: node ? node.type : "",
      text: node ? node.text : "",
    };
  };
  return {
    out: view.edges.filter((edge) => edge.source === id).map((edge) => item(edge, "out")),
    in: view.edges.filter((edge) => edge.target === id).map((edge) => item(edge, "in")),
  };
}

/**
 * 出所 (`examples/sample.py:42`) を GitHub の blob URL にする。
 *
 * repo は `site_data()` の `repo` (`req site --repo-url / --repo-ref` で入る)。
 * 渡されていなければ null を返し、呼び出し側はただの文字列として出す。
 *
 * 出所は生成時の作業ディレクトリからの相対パスなので、絶対パスのときは
 * リポジトリ内の位置が決まらない。黙って null にする (誤ったリンクは出さない)。
 */
export function sourceUrl(data, location) {
  const repo = (data || {}).repo;
  if (!repo || !repo.url || !location) return null;
  const match = /^(.+?)(?::(\d+))?$/.exec(String(location).trim());
  if (!match) return null;
  const path = match[1].replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.startsWith("../") || /^[A-Za-z]:/.test(path)) {
    return null;
  }
  const base = repo.url.replace(/\/+$/, "");
  const ref = encodeURIComponent(repo.ref || "main");
  const url = `${base}/blob/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
  return match[2] ? `${url}#L${match[2]}` : url;
}

// --- 指摘一覧 --------------------------------------------------------------
//
// 指摘は数が増えるほど「重い順に 1 本の帯」では読めなくなる。重大度で絞り、
// 残ったものをチェックコードごとにまとめる。同じ規則の違反はまとめて片付ける
// (あるいはまとめて抑制する) ものなので、コードが読む単位になる。

/** 重大度タブの「すべて」の key。 */
export const ALL_SEVERITIES = "all";

/**
 * 重大度タブ。件数が 0 の重大度は出さない (押しても何も起きないタブを並べない)。
 * 「すべて」は指摘が 1 件も無くても出す。
 */
export function severityTabs(findings) {
  const counts = new Map();
  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) || 0) + 1);
  }
  return [
    { key: ALL_SEVERITIES, label: "すべて", count: findings.length },
    ...SEVERITY_ORDER.filter((severity) => counts.get(severity)).map((severity) => ({
      key: severity,
      label: severity,
      count: counts.get(severity),
    })),
  ];
}

/**
 * 指摘をチェックコードごとにまとめる。severity を渡すとその重大度だけに絞る。
 *
 * 群の並びは「その群で最も重い指摘」の重大度 → コード名。群の中は渡された順
 * (Python 側が重い順に並べたもの) のまま。
 */
export function groupFindings(findings, severity = ALL_SEVERITIES) {
  const groups = new Map();
  for (const finding of findings) {
    if (severity !== ALL_SEVERITIES && finding.severity !== severity) continue;
    if (!groups.has(finding.code)) groups.set(finding.code, []);
    groups.get(finding.code).push(finding);
  }
  //: 知らない重大度は最も軽いものとして扱う (並びが未定義にならないように)。
  const severityRank = (finding) => {
    const at = SEVERITY_ORDER.indexOf(finding.severity);
    return at < 0 ? SEVERITY_ORDER.length : at;
  };
  return [...groups.entries()]
    .map(([code, items]) => ({ code, items, rank: Math.min(...items.map(severityRank)) }))
    .sort((a, b) => a.rank - b.rank || compare(a.code, b.code))
    .map(({ code, items, rank }) => ({
      code,
      items,
      severity: SEVERITY_ORDER[rank] || items[0].severity,
    }));
}

// --- URL ハッシュ ----------------------------------------------------------
//
// 表示状態を URL に載せ、「この FR を見て」と URL だけ渡せば相手にも同じ画面が
// 出るようにする (`#node=FR-3&types=Goal,Need&dir=LR`)。
//
// 既定値は書かない。初期表示のままなら URL にハッシュは付かず、載っている項目が
// そのまま「既定と違うところ」の一覧になる。読めるように、値の区切りには
// パーセントエンコードしない `,` と `:` を使う。

//: テーブルの既定の並び順。
const DEFAULT_SORT = { key: "id", asc: true };

/**
 * 集合で持つ絞り込みの軸。ハッシュのキー・state のキー・取りうる値の全体を
 * 1 か所で対応付ける。軸を足すときはここに 1 行足せば、既定値・URL への
 * 書き出し・復元の 3 つが揃って増える。
 *
 * `initial` は初期状態で選ばれているもの。`all` と違うのは種別とエッジで、
 * Source と源泉エッジは既定で外れている (`site_data()` の `hidden_by_default`)。
 * 「既定と違うところだけ URL に載せる」という規則はこの `initial` が基準になる。
 */
const SET_FILTERS = [
  {
    param: "types",
    key: "types",
    all: (data) => data.types,
    initial: (data) => initialSelection(data, data.types, "types"),
  },
  {
    param: "edges",
    key: "edges",
    all: (data) => data.edge_names,
    initial: (data) => initialSelection(data, data.edge_names, "edges"),
  },
  { param: "status", key: "statuses", all: (data) => statusNames(data) },
];

/** 軸の初期選択。`initial` を持たない軸は全選択。 */
const initialOf = (filter, data) =>
  filter.initial ? filter.initial(data) : filter.all(data);

/** ハッシュが無いときの状態。ページの初期 state でもある。 */
export function defaultState(data) {
  const state = {
    selected: null,
    direction: "TD",
    mode: "graph",
    query: "",
    //: 近傍の深さ。0 ならフォーカス無し (全体を描く)。
    focus: 0,
    //: 影響範囲の探索の深さ。0 なら無制限 (`req explain` に --depth を渡さない)。
    depth: 0,
    //: 影響範囲をエッジの向きを無視して辿るか (`req explain --undirected`)。
    undirected: false,
    sort: { ...DEFAULT_SORT },
  };
  for (const filter of SET_FILTERS) state[filter.key] = new Set(initialOf(filter, data));
  return state;
}

/** 状態を `#...` にする。既定のままなら空文字 (ハッシュ無し)。 */
export function encodeHash(state, data) {
  const params = [];
  const put = (key, value) => params.push(`${key}=${value}`);
  //: 選択の順ではなく定義順で並べる。同じ絞り込みなら常に同じ URL になる。
  const list = (selected, all) =>
    all.filter((name) => selected.has(name)).map(encodeURIComponent).join(",");
  const sort = state.sort || DEFAULT_SORT;
  const query = (state.query || "").trim();

  if (state.selected) put("node", encodeURIComponent(state.selected));
  for (const filter of SET_FILTERS) {
    const selected = state[filter.key];
    const all = filter.all(data);
    // 持っていない軸は createView() と同じく「絞り込み無し」として扱う。
    if (!selected) continue;
    // 既定と同じなら書かない。基準は「全選択」ではなく初期選択なので、既定で
    // 隠している Source を出した状態は (全選択であっても) URL に載る。
    const initial = initialOf(filter, data);
    if (selected.size === initial.length && initial.every((name) => selected.has(name))) {
      continue;
    }
    put(filter.param, list(selected, all));
  }
  if (state.direction === "LR") put("dir", "LR");
  if (state.mode === "table") put("view", "table");
  if (FOCUS_DEPTHS.includes(state.focus)) put("focus", String(state.focus));
  if (IMPACT_DEPTHS.includes(state.depth)) put("depth", String(state.depth));
  if (state.undirected) put("undir", "1");
  if (query) put("q", encodeURIComponent(query));
  if (sort.key !== DEFAULT_SORT.key || sort.asc !== DEFAULT_SORT.asc) {
    put("sort", `${sort.key}:${sort.asc ? "asc" : "desc"}`);
  }
  return params.length ? `#${params.join("&")}` : "";
}

/**
 * `#...` から状態を復元する。書かれていない項目は既定のまま。
 *
 * 手で書き換えられる場所なので、解釈できない値は黙って捨てる (知らないノード
 * 種別・存在しないノード id・壊れたエスケープ)。ただし `types=` のように
 * 「空を選んでいる」状態は URL に出せる以上そのまま復元する。
 */
export function decodeHash(hash, data) {
  const state = defaultState(data);
  const params = parseHash(hash);
  const subset = (raw, all) =>
    new Set(raw.split(",").map((name) => name.trim()).filter((name) => all.includes(name)));

  const node = params.get("node");
  if (node && data.nodes.some((item) => item.id === node)) state.selected = node;
  for (const filter of SET_FILTERS) {
    if (!params.has(filter.param)) continue;
    state[filter.key] = subset(params.get(filter.param), filter.all(data));
  }
  if (params.get("dir") === "LR") state.direction = "LR";
  if (params.get("view") === "table") state.mode = "table";
  const focus = Number(params.get("focus"));
  if (FOCUS_DEPTHS.includes(focus)) state.focus = focus;
  const depth = Number(params.get("depth"));
  if (IMPACT_DEPTHS.includes(depth)) state.depth = depth;
  if (params.get("undir") === "1") state.undirected = true;
  if (params.has("q")) state.query = params.get("q");
  const sort = parseSort(params.get("sort"));
  if (sort) state.sort = sort;
  return state;
}

/** `#a=1&b=2` を Map にする。壊れている組はその組だけ捨てる。 */
function parseHash(hash) {
  const params = new Map();
  for (const part of (hash || "").replace(/^#/, "").split("&")) {
    if (!part) continue;
    const at = part.indexOf("=");
    try {
      params.set(
        decodeURIComponent(at < 0 ? part : part.slice(0, at)),
        at < 0 ? "" : decodeURIComponent(part.slice(at + 1)),
      );
    } catch {
      // 壊れたパーセントエンコード。
    }
  }
  return params;
}

/** `findings:desc` を並び順にする。知らない列や向きは null (既定のまま)。 */
function parseSort(raw) {
  if (!raw) return null;
  const [key, order] = raw.split(":");
  if (!TABLE_COLUMNS.some((column) => column.key === key)) return null;
  if (order !== "asc" && order !== "desc") return null;
  return { key, asc: order === "asc" };
}

// --- 次回訪問時の復元 (localStorage) ----------------------------------------
//
// パーマリンク (URL) は「いまの画面を人に渡す」ためのもので、次に自分が開いた
// ときには効かない。絞り込みを毎回引き直すのは棚卸しの邪魔なので、**絞り込みと
// 表示だけ**を localStorage に置く。選択ノードと検索語は持ち越さない (前回見て
// いた 1 件が復活しても嬉しくない)。
//
// URL のハッシュが最優先。ハッシュ付きの URL を渡された側で、その人の前回の
// 絞り込みが混ざってはならない。

//: 保存先のキー。表示状態とテーマで分ける (テーマはモデルに依らない好み)。
export const VIEW_STORAGE_KEY = "reqmodel:site:view";
export const THEME_STORAGE_KEY = "reqmodel:site:theme";

/** 次回に持ち越す状態を `#...` にしたもの。既定のままなら空文字。 */
export function storableHash(state, data) {
  return encodeHash({ ...state, selected: null, query: "" }, data);
}

/** 開いたときに適用するハッシュ。URL に何か載っていればそれ、無ければ保存。 */
export function initialHash(hash, stored) {
  return (hash || "").replace(/^#/, "") ? hash : stored || "";
}

// --- テーマ ------------------------------------------------------------------
//
// 既定は OS 設定への追従 (auto)。プロジェクタや明るい部屋で開いたときのために
// 手で固定できるようにする。固定した選択は localStorage に残す。

/** 選べるテーマ。押すたびにこの順で回る。 */
const THEMES = ["auto", "light", "dark"];

/** ボタンの表示。いま何が効いているかがそのまま読めるようにする。 */
export const THEME_LABELS = { auto: "テーマ: 自動", light: "テーマ: 明", dark: "テーマ: 暗" };

/** 保存値や属性値をテーマに直す。知らない値は auto。 */
export const normalizeTheme = (value) => (THEMES.includes(value) ? value : "auto");

/** 次のテーマ。 */
export function nextTheme(theme) {
  return THEMES[(THEMES.indexOf(normalizeTheme(theme)) + 1) % THEMES.length];
}

// --- LLM 用コンテキスト -----------------------------------------------------
//
// 以下は `explain.py` の explain_text() / _describe() / _all_edge_names() の写し。
// 出力が 1 文字でもずれるとテストが落ちるので、片方を直したら両方を直すこと。

//: 源泉の索引 (has_source / part_of) を data ごとに 1 回だけ作る。詳細ペインと
//: コンテキスト生成の両方が使い、どちらも全ノードを走るので、呼ぶたびに
//: data.edges を舐めると O(ノード数 × エッジ数) になる。
//: 埋め込みデータはページ読み込み後は変わらない前提で、最初の 1 回を使い回す。
const SOURCE_INDEX = new WeakMap();

function sourceIndex(data) {
  let index = SOURCE_INDEX.get(data);
  if (index) return index;
  index = { has: new Map(), partOf: new Map() };
  for (const edge of data.edges) {
    if (edge.name === "has_source") {
      if (!index.has.has(edge.source)) index.has.set(edge.source, []);
      index.has.get(edge.source).push(edge.target);
    } else if (edge.name === "part_of" && !index.partOf.has(edge.source)) {
      index.partOf.set(edge.source, edge.target);
    }
  }
  SOURCE_INDEX.set(data, index);
  return index;
}

/**
 * 源泉 1 件の表示 (`explain.py` の `source_label()` と同じ整形)。
 * `SRC-A (本文) [位置] < 親の源泉` の形で、`part_of` の鎖を 1 行に畳む。
 *
 * 絞り込みで Source が消えていても引けるように、view ではなく data を見る。
 */
export function sourceLabel(data, sourceId) {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  return sourceLabelFrom(byId, sourceIndex(data), sourceId);
}

function sourceLabelFrom(byId, index, sourceId) {
  const parts = [];
  const seen = new Set();
  let current = sourceId;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const node = byId.get(current);
    if (!node) {
      parts.push(current);
      break;
    }
    let label = `${node.id} (${node.text})`;
    if (node.locator) label += ` [${node.locator}]`;
    parts.push(label);
    current = index.partOf.get(current);
  }
  return parts.join(" < ");
}

/**
 * ノードの源泉一覧。詳細ペインの「源泉」欄に使う。
 * 絞り込みに関係なく出す (図から外しても属性としては読める、が要点)。
 */
export function sourceItems(data, id) {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const index = sourceIndex(data);
  return (index.has.get(id) || []).map((sourceId) => {
    const node = byId.get(sourceId);
    //: 引用は part_of で親の文書・人にぶら下がる。図に出さない以上、辿れる
    //: のはここだけなので鎖を畳んで一緒に返す (親から順に並べる)。
    const parents = [];
    const seen = new Set([sourceId]);
    let current = index.partOf.get(sourceId);
    while (current !== undefined && current !== null && !seen.has(current)) {
      seen.add(current);
      const parent = byId.get(current);
      parents.push({ id: current, text: parent ? parent.text : "" });
      current = index.partOf.get(current);
    }
    return {
      id: sourceId,
      text: node ? node.text : "",
      kind: node ? node.kind : "",
      locator: node && node.locator ? node.locator : "",
      parents,
      label: sourceLabelFrom(byId, index, sourceId),
    };
  });
}

/** ノード 1 件の記述。`explain.py` の `_describe()` と同じ整形。 */
function describe(view, id, inlineSources = true) {
  const node = view.byId.get(id);
  const attrs = [`status=${node.status}`];
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
  for (const item of node.evidence || []) {
    lines.push(`    根拠: ${item}`);
  }
  for (const criterion of node.acceptance_criteria || []) {
    lines.push(`    受け入れ基準: ${criterion}`);
  }
  // 源泉は辿らない代わりに属性として書き出す。ここも絞り込み前の全エッジを見る。
  if (inlineSources) {
    const byId = new Map(view.data.nodes.map((item) => [item.id, item]));
    const index = sourceIndex(view.data);
    for (const sourceId of index.has.get(id) || []) {
      lines.push(`    源泉: ${sourceLabelFrom(byId, index, sourceId)}`);
    }
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
 * コピー本文と同じ内容を出す `req explain` のコマンド行。詳細ペインの案内に使う。
 * 画面の設定 (エッジ種別・深さ・向き) がそのまま引数になる。
 */
export function explainCommand(view, id, scope = null) {
  const { depth, undirected } = scope || impactScope(view.state);
  const selection = edgeSelection(view);
  const parts = [`req explain ${id}`];
  if (Array.isArray(selection)) parts.push(`--edges ${selection.join(",")}`);
  else if (selection === "all") parts.push("--with-sources");
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
export function nodeContext(view, id, scope = null) {
  const settings = scope || impactScope(view.state);
  const selection = edgeSelection(view);
  const edgeFilter = Array.isArray(selection) ? selection : null;
  //: 源泉を辿ったときは Source 自身がブロックで出るので、畳んだ表示はしない
  //: (`explain.py` の include_sources / inline_sources と同じ対応)。
  const includeSources = selection === "all";
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
  else if (!includeSources) {
    lines.push(
      `源泉エッジ (${[...hiddenByDefault(view.data, "edges")].sort().join(", ")}) は` +
        "辿っていない。源泉は各ノードの「源泉:」行に畳んである",
    );
  }
  if (settings.depth !== null) lines.push(`探索深さ: ${settings.depth}`);

  const block = (title, ids) => {
    const sorted = [...ids].sort((a, b) => rankOf(view, a) - rankOf(view, b));
    if (!sorted.length) return;
    lines.push("", `## ${title} (${sorted.length} 件)`);
    for (const nodeId of sorted) lines.push(...describe(view, nodeId, !includeSources));
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

  //: 既定で外した源泉エッジは「現れなかった」に混ぜない (`explain.py` と同じ)。
  //: --edges 相当を明示しているときは書き手の指定なので畳まない。
  const hidden = new Set(
    edgeFilter || includeSources ? [] : hiddenByDefault(view.data, "edges"),
  );
  const unused = allEdgeNames(view.data).filter(
    (name) => !hidden.has(name) && !edges.some((edge) => edge.name === name),
  );
  if (unused.length) {
    lines.push("", `(部分グラフに現れなかったエッジ種別: ${unused.join(", ")})`);
  }

  return lines.join("\n") + "\n";
}

// --- Cytoscape.js に渡す値 --------------------------------------------------
//
// 生成するのはただのオブジェクトなので、ライブラリを読み込まなくてもテストできる。

/** Requirements 段に入る型。 */
const REQUIREMENT_TYPES = new Set([
  "FunctionalRequirement",
  "QualityRequirement",
  "Constraint",
]);

/** 帯 (枠) の定義。Goal / Need は型ごと、Requirements は表示用グループごとに作る。 */
export function bandDefs(data) {
  const top = ((data.meta || {}).bands || [])
    .filter((band) => data.nodes.some((node) => node.type === band.type))
    .map((band) => ({ ...band, key: band.type }));

  if (!Object.prototype.hasOwnProperty.call(data, "requirement_groups")) return top;

  const groups = [...(data.requirement_groups || [])].sort(
    (a, b) => (a.order || 0) - (b.order || 0) || compare(a.id, b.id),
  );
  const assigned = new Set();
  const requirementIds = new Set(
    data.nodes.filter((node) => REQUIREMENT_TYPES.has(node.type)).map((node) => node.id),
  );
  const requirementBands = [];
  for (const group of groups) {
    const members = [];
    for (const id of group.members || []) {
      if (!requirementIds.has(id) || assigned.has(id)) continue;
      assigned.add(id);
      members.push(id);
    }
    if (members.length) {
      requirementBands.push({
        key: `group:${group.id}`,
        label: group.label,
        groupId: group.id,
        members,
      });
    }
  }
  const unclassified = [...requirementIds].filter((id) => !assigned.has(id));
  if (unclassified.length) {
    requirementBands.push({
      key: "group:__unclassified__",
      label: "未分類",
      groupId: "__unclassified__",
      members: unclassified,
    });
  }
  return [...top, ...requirementBands];
}

/** 表示中ノードに対して可視にする帯枠の key。 */
export function visibleBandKeys(data, shownNodes) {
  const ids = new Set(shownNodes.map((node) => node.id));
  const types = new Set(shownNodes.map((node) => node.type));
  const keys = new Set();
  for (const band of bandDefs(data)) {
    const visible = band.members
      ? band.members.some((id) => ids.has(id))
      : types.has(band.type);
    if (visible) keys.add(band.type || band.key);
  }
  return keys;
}

/** 帯枠ノードの id。ノード id と衝突しない接頭辞を付ける。 */
export const bandId = (key) => `band:${key}`;

/**
 * 図の要素定義。ノードとエッジの全件を一度だけ作る。
 *
 * status をデータに載せておくと、スタイル側は属性セレクタ
 * (`node[status = "..."]`) で拾える。絞り込みで作り直す必要が無い。
 *
 * meta.bands に挙がった型 (Goal / Need) には帯枠を 1 つずつ足す。compound node
 * は使わない (cytoscape-dagre は子ノードを見ると dagre を compound モードに
 * してしまい、レイアウトが壊れる)。枠はただの背面ノードで、位置と大きさは
 * `bandedLayout()` の結果 (frames) から与える。
 *
 * ノードの外形 (w / h) もここで決める。Cytoscape に `width: "label"` を任せると
 * ラベルの外接矩形になり、六角形や菱形では文字が図形の外に出る。measure は
 * ラベル 1 行の幅 (px) を返す関数で、省略すると概算 (`estimateTextWidth`) を使う。
 */
export function graphElements(data, measure = estimateTextWidth) {
  const bands = bandDefs(data);
  const types = (data.meta || {}).types || {};
  return [
    ...data.nodes.map((node) => {
      const text = wrapLabel(truncate(node.text, LABEL_MAX_LENGTH), LABEL_WRAP_WIDTH, measure);
      const label = `${node.id}\n${text}`;
      const size = nodeSize(label, (types[node.type] || {}).fit, measure);
      return {
        data: {
          id: node.id,
          type: node.type,
          status: node.status,
          label,
          w: size.w,
          h: size.h,
        },
      };
    }),
    ...data.edges.map((edge, index) => ({
      data: {
        id: `e${index}`,
        index,
        source: edge.source,
        target: edge.target,
        name: edge.name,
      },
    })),
    ...bands.map((band) => ({
      //: w / h は applyBanding が実測で入れ直すまでの仮の値。
      data: {
        id: bandId(band.key),
        band: true,
        bandType: band.type || "RequirementGroup",
        bandKey: band.type || band.key,
        label: band.label,
        w: 10,
        h: 10,
      },
      classes: "band",
      selectable: false,
      grabbable: false,
    })),
  ];
}

/**
 * スタイル定義。形状・配色・線種は `render_meta()` から来た meta が唯一の出典で、
 * テーマ依存の色 (fg / bg / border / muted) だけ palette で受け取る。
 *
 * Cytoscape のスタイルは **並び順で解決される** (後に置いた規則が勝つ) ので、
 * 5 段に重ねる。この順序が「どの表現がどれを上書きするか」の決定そのもの:
 *
 *   1. 基本   … ノード / エッジ共通
 *   2. 型     … 形 (shape) と 色 (background-color / border-color)
 *   3. status … 線種 (border-style) と、その補強の太さ (border-width)
 *   4. 状態   … 影響範囲の色分けと見せ消し (border-color / border-width / opacity)
 *   5. 検索   … ヒットの暈し (underlay-*)
 *
 * 影響範囲のハイライトが奪うのは border-color と border-width だけなので、
 * status の **線種** は強調中も残る。status を線種だけで区別できるように
 * してあるのは、このためである (`_STATUS_BORDER` を参照)。
 *
 * 検索ヒットは枠線をまったく使わず、ノードの下に敷く暈し (underlay) で示す。
 * 影響範囲と同時に点いても、どちらが何を言っているか読み分けられる。
 */
export function graphStyle(meta, palette) {
  const impact = meta.impact_colors;

  // 1. 基本
  const style = [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "text-wrap": "wrap",
        //: 折り返しは `wrapLabel()` が済ませてある。Cytoscape 側で更に折られると
        //: 行数が変わり、外形の計算 (`nodeSize()`) と食い違うので効かせない。
        "text-max-width": "1000px",
        "text-valign": "center",
        "font-family": LABEL_FONT.family,
        "font-size": LABEL_FONT.size,
        "line-height": LABEL_FONT.lineHeight,
        color: "#1f2328",
        //: ラベルではなく `graphElements()` が測った外形に合わせる。
        width: "data(w)",
        height: "data(h)",
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
  ];

  // 2. 型
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

  // 2.5. 帯 (枠)。ノード・エッジの下に敷く背面ノードで、型の配色を薄く使う。
  //      events: "no" なのでクリックは素通りし、選択や影響範囲には関わらない。
  //      status を持たないので 3. 以降の規則には掛からない。
  for (const band of meta.bands || []) {
    const typeMeta = meta.types[band.type] || {};
    style.push({
      selector: `node.band[bandType = "${band.type}"]`,
      style: {
        shape: "round-rectangle",
        width: "data(w)",
        height: "data(h)",
        padding: "0px",
        "background-color": typeMeta.fill || palette.bg,
        "background-opacity": 0.3,
        "border-color": typeMeta.stroke || palette.border,
        "border-width": 1,
        "border-style": "dashed",
        //: ラベルは枠の上辺の外に出す。中に置くと最上段のノードと重なる。
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -2,
        "font-size": 11,
        "font-weight": "bold",
        color: typeMeta.stroke || palette.muted,
        "z-compound-depth": "bottom",
        events: "no",
      },
    });
  }


  style.push({
    selector: 'node.band[bandType = "RequirementGroup"]',
    style: {
      shape: "round-rectangle",
      width: "data(w)",
      height: "data(h)",
      padding: "0px",
      "background-color": palette.bg,
      "background-opacity": 0.15,
      "border-color": palette.border,
      "border-width": 1,
      "border-style": "solid",
      "text-valign": "top",
      "text-halign": "center",
      "text-margin-y": -2,
      "font-size": 11,
      "font-weight": "bold",
      color: palette.muted,
      "z-compound-depth": "bottom",
      events: "no",
    },
  });

  // 3. status
  for (const [status, statusMeta] of Object.entries(meta.statuses || {})) {
    style.push({
      selector: `node[status = "${status}"]`,
      style: {
        "border-style": statusMeta.border_style,
        "border-width": statusMeta.border_width,
      },
    });
  }

  // 4. 状態
  style.push(
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
    //: 無向で辿ったときは上流/下流の区別が付かない (CLI の --undirected と同じ)。
    {
      selector: "node.rel",
      style: { "border-width": 3, "border-color": impact.related },
    },
    {
      selector: "edge.on-path",
      style: { width: 2, "line-color": palette.fg, "target-arrow-color": palette.fg },
    },
  );

  // 5. 検索
  if (meta.search) {
    style.push(
      {
        selector: "node.hit",
        style: {
          "underlay-color": meta.search.hit,
          "underlay-opacity": 0.3,
          "underlay-padding": 8,
        },
      },
      //: ↑↓ で送っている最中の 1 件。他のヒットより強く出す。
      {
        selector: "node.hit-current",
        style: { "underlay-opacity": 0.55, "underlay-padding": 12, "z-index": 9 },
      },
      //: 影響範囲の外にあるヒットも、暈しが読める程度には残す。
      { selector: "node.dim.hit", style: { opacity: 0.65 } },
    );
  }
  return style;
}

// --- 凡例 ------------------------------------------------------------------

//: 凡例の見本は小さいので、太い枠 (verified の double 等) はここで頭打ちにする。
const LEGEND_MAX_BORDER = 3;

/**
 * 凡例に出す項目。図に効いているスタイルと同じ meta から作るので、
 * `render_meta()` に定義を足せば凡例にもそのまま並ぶ。
 *
 * 各 swatch は CSS の border 指定にそのまま写せる形にしてある
 * (`borderColor` が null ならテーマの文字色を使う、の意味)。
 */
export function legendGroups(meta) {
  const groups = [
    {
      title: "種別",
      items: Object.entries(meta.types).map(([type, typeMeta]) => ({
        label: type,
        swatch: {
          background: typeMeta.fill,
          borderColor: typeMeta.stroke,
          borderStyle: "solid",
          borderWidth: 1,
        },
      })),
    },
  ];

  const statuses = Object.entries(meta.statuses || {});
  if (statuses.length) {
    groups.push({
      title: "status",
      items: statuses.map(([status, statusMeta]) => ({
        label: status,
        swatch: {
          background: "transparent",
          borderColor: null,
          borderStyle: statusMeta.border_style,
          borderWidth: Math.min(statusMeta.border_width, LEGEND_MAX_BORDER),
        },
      })),
    });
  }

  return groups;
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

// --- 帯レイアウト -----------------------------------------------------------
//
// エッジの向きが混在している (motivates は Goal→Need と下向き、satisfies は
// FR→Need と上向き) ため、dagre に任せるだけでは Goal と FR が同じ高さに並ぶ。
// meta.bands に挙がった型 (Goal / Need) を主軸方向の帯にまとめ、常に図の上
// (LR なら左) に出す。dagre の結果の副軸方向の並びは保つので、交差の少なさは
// おおむね引き継がれる。

//: 帯の中の行間 (refines で親子になった Goal の段差)。
const BAND_ROW_GAP = 30;
//: 帯の中の横の間隔。dagre の nodeSep (24) に合わせる。
const BAND_SIBLING_GAP = 26;
//: 帯と帯・帯とその他の間隔。枠の余白とラベルのぶん広めに取る。
const BAND_GAP = 96;
//: ノードの外接矩形から枠までの余白。
const BAND_FRAME_PAD = 14;

/**
 * 帯の中の行分け。refines (子 → 親) で親を上の行に置く。
 * 親子が無い型 (Need) は 1 行になる。閉路は validate が指摘するので、
 * ここでは無限ループしないことだけを保証する。
 */
function bandRows(members, edges) {
  const ids = new Set(members.map((node) => node.id));
  const parents = new Map();
  for (const edge of edges) {
    if (edge.name !== "refines" || !ids.has(edge.source) || !ids.has(edge.target)) continue;
    if (!parents.has(edge.source)) parents.set(edge.source, []);
    parents.get(edge.source).push(edge.target);
  }
  const depth = new Map();
  const depthOf = (id, trail) => {
    if (depth.has(id)) return depth.get(id);
    if (trail.has(id)) return 0;
    trail.add(id);
    const above = (parents.get(id) || []).map((parent) => depthOf(parent, trail));
    const value = above.length ? Math.max(...above) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  const rows = [];
  for (const node of members) {
    const row = depthOf(node.id, new Set());
    (rows[row] ||= []).push(node);
  }
  return rows.filter(Boolean);
}

/**
 * dagre の結果を帯に並べ直した位置と、帯を囲む枠。
 *
 * bands は `bandDefs()` の並び (上からの帯の順)、placed は表示中の (帯枠以外の)
 * ノードと寸法 `{ id, type, x, y, w, h }`、edges は表示中のエッジ。
 *
 * 返り値は `{ positions, frames }`。positions は id → `{ x, y }` の Map で、
 * 全ノードぶん返す (帯に入らないノードは形を保ったまま帯の下へ平行移動する)。
 * frames は型 → `{ x, y, w, h }` (枠の中心と大きさ) の Map。
 * 帯のノードが 1 つも無ければ両方とも空。
 *
 * **枠は図の全幅に揃える**。帯ごとに中身の外接矩形を掛けると幅も左端もばらばらに
 * なり、「上に積んだ層」に見えない。等幅・同位置の枠が縦に並ぶ形にし、中身は
 * その中央に寄せる (帯の中の相対位置は変えない)。
 */
export function bandedLayout(bands, placed, edges, direction) {
  const positions = new Map();
  const frames = new Map();
  const membersOf = bands.map((band) => {
    const ids = band.members ? new Set(band.members) : null;
    return placed.filter((node) => (ids ? ids.has(node.id) : node.type === band.type));
  });
  if (!membersOf.some((members) => members.length)) return { positions, frames };

  //: TD では y が主軸 (帯の積み方向)・x が副軸。LR では逆になる。
  const vertical = direction !== "LR";
  const pri = (node) => (vertical ? node.y : node.x);
  const sec = (node) => (vertical ? node.x : node.y);
  const priSize = (node) => (vertical ? node.h : node.w);
  const secSize = (node) => (vertical ? node.w : node.h);
  const at = (secValue, priValue) =>
    vertical ? { x: secValue, y: priValue } : { x: priValue, y: secValue };
  const positionSec = (id) => {
    const position = positions.get(id);
    return vertical ? position.x : position.y;
  };
  const topOf = (nodes) => Math.min(...nodes.map((node) => pri(node) - priSize(node) / 2));

  // 1. 型帯は縦に積み、RequirementGroup は同じ Requirements 段の中で横に並べる。
  const banded = new Set();
  const spans = new Map();
  let cursor = topOf(placed);
  let index = 0;
  while (index < bands.length) {
    if (bands[index].members) {
      const sectionFrom = cursor;
      let sectionTo = sectionFrom;
      let groupCursor = Math.min(
        ...placed.map((node) => sec(node) - secSize(node) / 2),
      );
      while (index < bands.length && bands[index].members) {
        const members = membersOf[index];
        if (!members.length) {
          index += 1;
          continue;
        }
        for (const node of members) banded.add(node.id);

        let groupTo = sectionFrom;
        let groupMin = Infinity;
        let groupMax = -Infinity;
        for (const row of bandRows(members, edges)) {
          const height = Math.max(...row.map(priSize));
          row.sort((a, b) => sec(a) - sec(b));
          let occupied = groupCursor;
          for (const node of row) {
            const half = secSize(node) / 2;
            const center = Math.max(sec(node), occupied + BAND_SIBLING_GAP + half);
            positions.set(node.id, at(center, groupTo + height / 2));
            occupied = center + half;
            groupMin = Math.min(groupMin, center - half);
            groupMax = Math.max(groupMax, center + half);
          }
          groupTo += height + BAND_ROW_GAP;
        }
        const to = groupTo - BAND_ROW_GAP;
        spans.set(index, { from: sectionFrom, to, secMin: groupMin, secMax: groupMax });
        sectionTo = Math.max(sectionTo, to);
        groupCursor = groupMax + BAND_GAP;
        index += 1;
      }
      cursor = sectionTo + BAND_GAP;
      continue;
    }

    const members = membersOf[index];
    if (!members.length) {
      index += 1;
      continue;
    }
    for (const node of members) banded.add(node.id);
    const from = cursor;
    for (const row of bandRows(members, edges)) {
      const height = Math.max(...row.map(priSize));
      //: 副軸は dagre の並びを保ち、重なりだけを右 (下) に押して解消する。
      row.sort((a, b) => sec(a) - sec(b));
      let occupied = -Infinity;
      for (const node of row) {
        const half = secSize(node) / 2;
        const center = Math.max(sec(node), occupied + BAND_SIBLING_GAP + half);
        positions.set(node.id, at(center, cursor + height / 2));
        occupied = center + half;
      }
      cursor += height + BAND_ROW_GAP;
    }
    spans.set(index, { from, to: cursor - BAND_ROW_GAP });
    cursor += BAND_GAP - BAND_ROW_GAP;
    index += 1;
  }

  // 2. 帯に入らないノードは、形を保ったまま帯の下へ送る。
  const rest = placed.filter((node) => !banded.has(node.id));
  if (rest.length) {
    const shift = cursor - topOf(rest);
    for (const node of rest) {
      positions.set(node.id, at(sec(node), pri(node) + shift));
    }
  }

  // 3. 図の全幅 (副軸方向の範囲) を測る。型帯の枠幅と、中身を寄せる中心になる。
  const secCenter = (node) => positionSec(node.id);
  let secMin = Infinity;
  let secMax = -Infinity;
  for (const node of placed) {
    secMin = Math.min(secMin, secCenter(node) - secSize(node) / 2);
    secMax = Math.max(secMax, secCenter(node) + secSize(node) / 2);
  }
  const secMiddle = (secMin + secMax) / 2;
  const frameSecSize = secMax - secMin + BAND_FRAME_PAD * 2;

  // 4. 型帯は全幅の中央へ寄せ、RequirementGroup 枠は各グループの外接矩形に掛ける。
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
    const members = membersOf[bandIndex];
    if (!members.length) continue;
    const span = spans.get(bandIndex);
    if (!span) continue;

    if (bands[bandIndex].members) {
      frames.set(bands[bandIndex].key, {
        ...at((span.secMin + span.secMax) / 2, (span.from + span.to) / 2),
        w: vertical
          ? span.secMax - span.secMin + BAND_FRAME_PAD * 2
          : span.to - span.from + BAND_FRAME_PAD * 2,
        h: vertical
          ? span.to - span.from + BAND_FRAME_PAD * 2
          : span.secMax - span.secMin + BAND_FRAME_PAD * 2,
      });
      continue;
    }

    let min = Infinity;
    let max = -Infinity;
    for (const node of members) {
      min = Math.min(min, secCenter(node) - secSize(node) / 2);
      max = Math.max(max, secCenter(node) + secSize(node) / 2);
    }
    const shift = secMiddle - (min + max) / 2;
    for (const node of members) {
      const position = positions.get(node.id);
      positions.set(
        node.id,
        vertical
          ? { x: position.x + shift, y: position.y }
          : { x: position.x, y: position.y + shift },
      );
    }
    const framePriSize = span.to - span.from + BAND_FRAME_PAD * 2;
    frames.set(bands[bandIndex].type || bands[bandIndex].key, {
      ...at(secMiddle, (span.from + span.to) / 2),
      w: vertical ? frameSecSize : framePriSize,
      h: vertical ? framePriSize : frameSecSize,
    });
  }
  return { positions, frames };
}

// --- 書き出し (Mermaid / SVG) ------------------------------------------------
//
// 出力先に置かれる `graph.mmd` / `graph.dot` は**全体**のグラフである。画面で
// 絞り込んだ図をそのまま PR や資料に持っていけるよう、いま見えているぶんだけを
// ページ側で書き出す。
//
// Mermaid は `render.py` の `render_mermaid()` と同じ書式で組む。絞り込みが無い
// ときは一字一句同じになり、`tests/test_site_js.py` が両者を突き合わせる。
// 形状・配色は meta が唯一の出典なので、ここには表を持たない。

//: ラベルの上限文字数 (`render.py` の max_label と同じ既定)。
const EXPORT_LABEL_LIMIT = 40;

/** `render.py` の `_truncate()`。空白を潰してから切る。 */
function collapse(text, limit) {
  const collapsed = String(text).split(/\s+/).filter(Boolean).join(" ");
  const chars = [...collapsed];
  if (limit > 0 && chars.length > limit) return chars.slice(0, limit - 1).join("") + "…";
  return collapsed;
}

/**
 * `render.py` の `_ids()`。ノード id → Mermaid の識別子 (`n1`, `n2`, …)。
 *
 * 元の id から作ると、記号を潰した結果が衝突する (`FR-1` と `FR_1` が同じ
 * 識別子になり、図の上で 1 ノードに融合する)。描く順の索引で連番を振れば
 * 衝突は起こり得ず、元の id はラベルに出るので情報も失われない。
 */
function exportIds(nodes) {
  return new Map(nodes.map((node, index) => [node.id, `n${index + 1}`]));
}

/** `render.py` の `_mermaid_escape()`。 */
function mermaidEscape(text) {
  return text
    .replace(/\\/g, "＼")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;");
}

/**
 * いま見えているグラフの Mermaid。`render_mermaid()` と同じ書式。
 *
 * 形状は `meta.types[].mermaid`、配色は `meta.types[].fill / stroke`、破線に
 * するエッジ種別は `meta.dashed_edges` から取る (どれも `render.py` が出典)。
 * classDef は全型ぶん出す (絞り込みで消えている型も含む) ので、絞り込みの
 * 有無で classDef の並びは変わらない。
 */
export function mermaidText(view, maxLabel = EXPORT_LABEL_LIMIT) {
  const meta = view.data.meta || {};
  const types = meta.types || {};
  const dashed = new Set(meta.dashed_edges || []);
  const ids = exportIds(view.nodes);
  const lines = ["flowchart TD"];

  for (const node of view.nodes) {
    const shape = (types[node.type] || {}).mermaid || { open: "[", close: "]" };
    const label = [
      `<b>${node.id}</b> [${node.type}]`,
      mermaidEscape(collapse(node.text, maxLabel)),
    ].join("<br/>");
    lines.push(`    ${ids.get(node.id)}${shape.open}"${label}"${shape.close}`);
  }

  lines.push("");
  for (const edge of view.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    const arrow = dashed.has(edge.name) ? "-.->" : "-->";
    lines.push(`    ${ids.get(edge.source)} ${arrow}|${edge.name}| ${ids.get(edge.target)}`);
  }

  lines.push("");
  for (const [type, typeMeta] of Object.entries(types)) {
    lines.push(`    classDef ${type} fill:${typeMeta.fill},stroke:${typeMeta.stroke}`);
  }
  for (const node of view.nodes) lines.push(`    class ${ids.get(node.id)} ${node.type}`);

  return lines.join("\n") + "\n";
}

// --- SVG --------------------------------------------------------------------
//
// 図の見た目 (位置・大きさ・折り返し済みのラベル) は Cytoscape が持っているので、
// 表示層が実測値を集めて scene として渡し、ここは**組み立てだけ**を行う。
//
// 形状は Cytoscape の描画そのものではなく**近似**である。書き出しの用途 (資料に
// 貼る) では、位置関係とラベルと配色が保たれていれば足りる。近似の範囲は
// 各定数のコメントに書く。

//: 図の周りに空ける余白 (px)。
export const SVG_PADDING = 24;

//: Cytoscape の多角形を、外形の矩形に内接する頂点 (-1..1 の座標) で写したもの。
const SVG_POLYGONS = {
  hexagon: [-1, 0, -0.5, -1, 0.5, -1, 1, 0, 0.5, 1, -0.5, 1],
  rhomboid: [-1, -1, 0.333, -1, 1, 1, -0.333, 1],
  diamond: [0, -1, 1, 0, 0, 1, -1, 0],
  tag: [-1, -1, 0.25, -1, 1, 0, 0.25, 1, -1, 1],
};

//: 角を落とす比率 (cut-rectangle)。Cytoscape は固定長で落とすが、書き出しでは
//: 大きさに対する比で近似する。
const SVG_CUT_RATIO = 0.16;
//: 角の丸め (round-rectangle) と、樽の膨らみ (barrel) の代わりの丸め。
const SVG_CORNER = 8;
const SVG_BARREL_RATIO = 0.3;

//: status の線種 → SVG の stroke-dasharray。二重線 (verified) は SVG に無いので
//: 実線で近似する (太さは meta の border_width が残るので区別は付く)。
const SVG_DASH = { dotted: "1 3", dashed: "6 4", solid: "", double: "" };

const attrs = (values) =>
  Object.entries(values)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([name, value]) => `${name}="${escapeAttr(value)}"`)
    .join(" ");

const element = (name, values, children) => {
  const head = [name, attrs(values)].filter(Boolean).join(" ");
  return children === undefined ? `<${head}/>` : `<${head}>${children}</${name}>`;
};

const round = (value) => Math.round(value * 100) / 100;

/** 図形 1 つぶんの要素。box は中心と外形 `{ x, y, w, h }`。 */
function shapeElement(shape, box, style) {
  const { x, y, w, h } = box;
  const polygon = (points) =>
    element("polygon", {
      points: points
        .map((value, index) => round(index % 2 ? y + (value * h) / 2 : x + (value * w) / 2))
        .join(" "),
      ...style,
    });

  if (shape === "ellipse") {
    return element("ellipse", { cx: round(x), cy: round(y), rx: round(w / 2), ry: round(h / 2), ...style });
  }
  if (SVG_POLYGONS[shape]) return polygon(SVG_POLYGONS[shape]);
  if (shape === "cut-rectangle") {
    const cut = Math.min(w, h) * SVG_CUT_RATIO;
    const cx = cut / (w / 2);
    const cy = cut / (h / 2);
    return polygon([
      -1 + cx, -1, 1 - cx, -1, 1, -1 + cy, 1, 1 - cy, 1 - cx, 1, -1 + cx, 1, -1, 1 - cy, -1, -1 + cy,
    ]);
  }
  const radius = shape === "barrel" ? Math.min(w, h) * SVG_BARREL_RATIO : SVG_CORNER;
  return element("rect", {
    x: round(x - w / 2),
    y: round(y - h / 2),
    width: round(w),
    height: round(h),
    rx: round(Math.min(radius, Math.min(w, h) / 2)),
    ...style,
  });
}

/** 改行入りのラベル。中心 (x, y) に上下中央で置く。 */
function labelElement(label, x, y, { size = LABEL_FONT.size, fill, weight } = {}) {
  const lines = String(label).split("\n");
  const step = size * LABEL_FONT.lineHeight;
  const top = y - ((lines.length - 1) * step) / 2 + size * 0.35;
  const spans = lines
    .map((line, index) =>
      element("tspan", { x: round(x), y: round(top + index * step) }, escapeHtml(line)),
    )
    .join("");
  return element(
    "text",
    {
      "text-anchor": "middle",
      "font-family": LABEL_FONT.family,
      "font-size": size,
      "font-weight": weight,
      fill,
    },
    spans,
  );
}

/**
 * いま図に描かれているものを SVG 1 枚にする。
 *
 * scene は表示層 (`site_app.js`) が Cytoscape から集めた実測値:
 *
 * - `nodes`: `{ id, type, status, label, x, y, w, h }`
 * - `edges`: `{ name, dashed, x1, y1, x2, y2 }` (端点はノードの縁の座標)
 * - `bands`: `{ type, label, x, y, w, h }` (Goal / Need の帯枠)
 * - `meta`: `render_meta()` の内容、`palette`: テーマ依存の色
 *
 * ノードが 1 つも無ければ空の図 (背景だけ) を返す。
 */
export function graphSvg(scene) {
  const nodes = scene.nodes || [];
  const edges = scene.edges || [];
  const bands = scene.bands || [];
  const meta = scene.meta || {};
  const palette = scene.palette || {};
  const types = meta.types || {};
  const statuses = meta.statuses || {};

  const xs = [];
  const ys = [];
  for (const box of [...nodes, ...bands]) {
    xs.push(box.x - box.w / 2, box.x + box.w / 2);
    ys.push(box.y - box.h / 2, box.y + box.h / 2);
  }
  for (const edge of edges) {
    xs.push(edge.x1, edge.x2);
    ys.push(edge.y1, edge.y2);
  }
  const minX = (xs.length ? Math.min(...xs) : 0) - SVG_PADDING;
  const minY = (ys.length ? Math.min(...ys) : 0) - SVG_PADDING;
  const width = (xs.length ? Math.max(...xs) : 0) + SVG_PADDING - minX;
  const height = (ys.length ? Math.max(...ys) : 0) + SVG_PADDING - minY;

  const body = [];

  body.push(
    element("rect", {
      x: round(minX),
      y: round(minY),
      width: round(width),
      height: round(height),
      fill: palette.bg || "#ffffff",
    }),
  );

  //: 帯枠はノード・エッジの下に敷く (画面と同じ重なり順)。
  for (const band of bands) {
    const typeMeta = types[band.type] || {};
    body.push(
      shapeElement("round-rectangle", band, {
        fill: typeMeta.fill || "none",
        "fill-opacity": 0.3,
        stroke: typeMeta.stroke || palette.border,
        "stroke-width": 1,
        "stroke-dasharray": SVG_DASH.dashed,
      }),
    );
    body.push(
      labelElement(band.label, band.x, band.y - band.h / 2 - 6, {
        size: 11,
        weight: "bold",
        fill: typeMeta.stroke || palette.muted,
      }),
    );
  }

  for (const edge of edges) {
    body.push(
      element("line", {
        x1: round(edge.x1),
        y1: round(edge.y1),
        x2: round(edge.x2),
        y2: round(edge.y2),
        stroke: palette.border,
        "stroke-width": 1.2,
        "stroke-dasharray": edge.dashed ? SVG_DASH.dashed : "",
        "marker-end": "url(#req-arrow)",
      }),
    );
    //: エッジ名は線の上に置く。背景を敷けないので、縁取り (paint-order) で抜く。
    body.push(
      element(
        "text",
        {
          x: round((edge.x1 + edge.x2) / 2),
          y: round((edge.y1 + edge.y2) / 2),
          "text-anchor": "middle",
          "font-family": LABEL_FONT.family,
          "font-size": 9,
          fill: palette.muted,
          stroke: palette.bg,
          "stroke-width": 3,
          "paint-order": "stroke",
        },
        escapeHtml(edge.name),
      ),
    );
  }

  for (const node of nodes) {
    const typeMeta = types[node.type] || {};
    const statusMeta = statuses[node.status] || {};
    body.push(
      shapeElement(typeMeta.shape, node, {
        fill: typeMeta.fill || "#ffffff",
        stroke: typeMeta.stroke || palette.fg,
        "stroke-width": statusMeta.border_width || 1.5,
        "stroke-dasharray": SVG_DASH[statusMeta.border_style] || "",
      }),
    );
    //: ラベルの色は図の塗り (明るい固定色) に対して読める色。テーマには従わない。
    body.push(labelElement(node.label, node.x, node.y, { fill: "#1f2328" }));
  }

  const defs = element(
    "defs",
    {},
    element(
      "marker",
      {
        id: "req-arrow",
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: "auto-start-reverse",
      },
      element("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: palette.border }),
    ),
  );

  return (
    element(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: `${round(minX)} ${round(minY)} ${round(width)} ${round(height)}`,
        width: round(width),
        height: round(height),
      },
      `\n${element("title", {}, escapeHtml(scene.title || "要求グラフ"))}\n${defs}\n${body.join("\n")}\n`,
    ) + "\n"
  );
}
