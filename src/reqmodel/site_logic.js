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

/** 1 行の上限幅 (px)。全角 11 文字ぶん。 */
export const LABEL_WRAP_WIDTH = 112;

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

// --- 優先度 ----------------------------------------------------------------
//
// priority は「小さいほど高優先」の整数か null。絞り込みと凡例では、生の数値では
// なく 3 つの区分に丸めて扱う。しきい値は Python 側 (`HIGH_PRIORITY_THRESHOLD`)
// から meta 経由で渡ってくるので、ここには焼き込まない。

/** 優先度の区分。並びがそのままチェックボックスの並びになる。 */
export const PRIORITY_BUCKETS = [
  { key: "high", label: "高優先" },
  { key: "normal", label: "その他" },
  { key: "none", label: "未設定" },
];

/** 高優先度とみなす境界 (この値以下が高優先)。 */
export function priorityThreshold(data) {
  const priority = (data.meta || {}).priority;
  return priority ? priority.threshold : 0;
}

/** ノードの優先度区分。`PRIORITY_BUCKETS` の key を返す。 */
export function priorityBucket(data, node) {
  if (node.priority === null || node.priority === undefined) return "none";
  return node.priority <= priorityThreshold(data) ? "high" : "normal";
}

// --- 表示対象 --------------------------------------------------------------

/**
 * 絞り込みを適用した「いま見えているグラフ」。
 *
 * 1 回の再描画につき 1 つ作り、以降の計算はすべてこれを介して行う。
 * state は `{ types: Set<string>, edges: Set<string>, statuses?: Set<string>,
 * priorities?: Set<string> }`。statuses / priorities は省略すると「絞り込み無し」。
 *
 * エッジは「見えているノード同士」を繋ぐものだけが残る。ノード側の条件が
 * 何であれ (種別・status・優先度) 同じ扱いになるので、絞り込みはそのまま
 * 影響範囲の計算 (`reach()`) にも効く。
 */
export function createView(data, state) {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const nodes = data.nodes.filter(
    (node) =>
      state.types.has(node.type) &&
      (!state.statuses || state.statuses.has(node.status)) &&
      (!state.priorities || state.priorities.has(priorityBucket(data, node))),
  );
  const shown = new Set(nodes.map((node) => node.id));
  const edges = data.edges.filter(
    (edge) =>
      state.edges.has(edge.name) && shown.has(edge.source) && shown.has(edge.target),
  );
  const order = new Map(data.nodes.map((node, index) => [node.id, index]));
  return { data, state, byId, nodes, edges, order };
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

/** 優先度の選択肢。高優先の表示名にはしきい値を添える。 */
export function priorityFilters(data) {
  const counts = countBy(data.nodes, (node) => priorityBucket(data, node));
  const threshold = priorityThreshold(data);
  return PRIORITY_BUCKETS.map(({ key, label }) => ({
    key,
    label: key === "high" ? `${label} (≤ ${threshold})` : label,
    count: counts.get(key) || 0,
  }));
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
 */
const SET_FILTERS = [
  { param: "types", key: "types", all: (data) => data.types },
  { param: "edges", key: "edges", all: (data) => data.edge_names },
  { param: "status", key: "statuses", all: (data) => statusNames(data) },
  { param: "priority", key: "priorities", all: () => PRIORITY_BUCKETS.map((b) => b.key) },
];

/** ハッシュが無いときの状態。ページの初期 state でもある。 */
export function defaultState(data) {
  const state = {
    selected: null,
    direction: "TD",
    mode: "graph",
    query: "",
    sort: { ...DEFAULT_SORT },
  };
  for (const filter of SET_FILTERS) state[filter.key] = new Set(filter.all(data));
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
    if (!selected || selected.size === all.length) continue;
    put(filter.param, list(selected, all));
  }
  if (state.direction === "LR") put("dir", "LR");
  if (state.mode === "table") put("view", "table");
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

/** 帯 (枠) の定義。meta に無ければ空。 */
export function bandDefs(data) {
  return ((data.meta || {}).bands || []).filter((band) =>
    data.nodes.some((node) => node.type === band.type),
  );
}

/** 帯枠ノードの id。ノード id と衝突しない接頭辞を付ける。 */
export const bandId = (type) => `band:${type}`;

/**
 * 図の要素定義。ノードとエッジの全件を一度だけ作る。
 *
 * status と優先度区分をデータに載せておくと、スタイル側は属性セレクタ
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
      const text = wrapLabel(truncate(node.text, 30), LABEL_WRAP_WIDTH, measure);
      const label = `${node.id}\n${text}`;
      const size = nodeSize(label, (types[node.type] || {}).fit, measure);
      return {
        data: {
          id: node.id,
          type: node.type,
          status: node.status,
          //: 生の priority ではなく `PRIORITY_BUCKETS` の key。
          priorityClass: priorityBucket(data, node),
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
        id: bandId(band.type),
        band: true,
        bandType: band.type,
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
 * 4 段に重ねる。この順序が「どの表現がどれを上書きするか」の決定そのもの:
 *
 *   1. 基本   … ノード / エッジ共通
 *   2. 型     … 形 (shape) と 色 (background-color / border-color)
 *   3. status … 線種 (border-style) と、その補強の太さ (border-width)
 *   4. 優先度 … 枠の外側の輪 (outline-*)
 *   5. 状態   … 影響範囲の色分けと見せ消し (border-color / border-width / opacity)
 *
 * 影響範囲のハイライトが奪うのは border-color と border-width だけなので、
 * status の **線種** と高優先度の **輪** は強調中も残る。status を線種だけで
 * 区別できるようにしてあるのは、このためである (`_STATUS_BORDER` を参照)。
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
  //      status / priorityClass を持たないので 3. 以降の規則には掛からない。
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

  // 4. 優先度
  if (meta.priority) {
    style.push({
      selector: 'node[priorityClass = "high"]',
      //: 枠線から離して描く。verified の太い二重線と地続きに見えないようにするため。
      style: {
        "outline-width": 3,
        "outline-style": "solid",
        "outline-color": meta.priority.outline,
        "outline-offset": 3,
        "outline-opacity": 0.9,
      },
    });
  }

  // 5. 状態
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
    {
      selector: "edge.on-path",
      style: { width: 2, "line-color": palette.fg, "target-arrow-color": palette.fg },
    },
  );
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

  if (meta.priority) {
    groups.push({
      title: "優先度",
      items: [
        {
          label: `高優先 (≤ ${meta.priority.threshold})`,
          swatch: {
            background: "transparent",
            borderColor: meta.priority.outline,
            borderStyle: "solid",
            borderWidth: 2,
          },
        },
      ],
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
  const membersOf = bands.map((band) =>
    placed.filter((node) => node.type === band.type),
  );
  if (!membersOf.some((members) => members.length)) return { positions, frames };

  //: TD では y が主軸 (帯の積み方向)・x が副軸。LR では逆になる。
  const vertical = direction !== "LR";
  const pri = (node) => (vertical ? node.y : node.x);
  const sec = (node) => (vertical ? node.x : node.y);
  const priSize = (node) => (vertical ? node.h : node.w);
  const secSize = (node) => (vertical ? node.w : node.h);
  const at = (secValue, priValue) =>
    vertical ? { x: secValue, y: priValue } : { x: priValue, y: secValue };
  const topOf = (nodes) => Math.min(...nodes.map((node) => pri(node) - priSize(node) / 2));

  // 1. 帯ごとに行へ分けて積む。主軸方向の占有範囲 (spans) を控えておく。
  const banded = new Set();
  const spans = new Map();
  let cursor = topOf(placed);
  for (let index = 0; index < bands.length; index++) {
    const members = membersOf[index];
    if (!members.length) continue;
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
  }

  // 2. 帯に入らないノードは、形を保ったまま帯の下へ送る。
  const rest = placed.filter((node) => !banded.has(node.id));
  if (rest.length) {
    const shift = cursor - topOf(rest);
    for (const node of rest) {
      positions.set(node.id, at(sec(node), pri(node) + shift));
    }
  }

  // 3. 図の全幅 (副軸方向の範囲) を測る。枠の幅と、中身を寄せる中心になる。
  const secCenter = (node) => {
    const position = positions.get(node.id);
    return vertical ? position.x : position.y;
  };
  let secMin = Infinity;
  let secMax = -Infinity;
  for (const node of placed) {
    secMin = Math.min(secMin, secCenter(node) - secSize(node) / 2);
    secMax = Math.max(secMax, secCenter(node) + secSize(node) / 2);
  }
  const secMiddle = (secMin + secMax) / 2;
  const frameSecSize = secMax - secMin + BAND_FRAME_PAD * 2;

  // 4. 帯の中身を中央へ寄せ、全幅の枠を掛ける。
  for (let index = 0; index < bands.length; index++) {
    const members = membersOf[index];
    if (!members.length) continue;
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
    const span = spans.get(index);
    const framePriSize = span.to - span.from + BAND_FRAME_PAD * 2;
    frames.set(bands[index].type, {
      ...at(secMiddle, (span.from + span.to) / 2),
      w: vertical ? frameSecSize : framePriSize,
      h: vertical ? framePriSize : frameSecSize,
    });
  }
  return { positions, frames };
}
