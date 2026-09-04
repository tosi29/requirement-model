// @ts-nocheck
import { TABLE_COLUMNS } from "./site_table.ts";
import { FOCUS_DEPTHS, IMPACT_DEPTHS, initialSelection, statusFilters, statusNames } from "./site_graph.ts";
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

