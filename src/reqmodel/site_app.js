/**
 * 静的サイトの表示層。DOM と Cytoscape.js に触るのはこのファイルだけ。
 *
 * 計算は `site_logic.js` の純関数に任せ、ここは「受け取った値を貼る」「イベントを
 * 繋ぐ」に徹する。`site.py` が両者をインライン化して 1 枚の HTML にする
 * (その際 import 行は落とされ、同じモジュールスコープに並ぶ)。
 */

import {
  FOCUS_DEPTHS,
  IMPACT_DEPTHS,
  LABEL_FONT,
  TABLE_COLUMNS,
  bandDefs,
  bandId,
  bandedLayout,
  createView,
  decodeHash,
  encodeHash,
  escapeHtml,
  explainCommand,
  focusSet,
  graphElements,
  graphStyle,
  impactSets,
  isNodeVisible,
  layoutOptions,
  legendGroups,
  matchesQuery,
  nextSort,
  nodeContext,
  priorityFilters,
  searchHits,
  sortRows,
  statusFilters,
  stepHit,
  tableRows,
  truncate,
} from "./site_logic.js";

const cytoscape = window.cytoscape;

const DATA = JSON.parse(document.getElementById("model-data").textContent);

/**
 * 表示状態。持ち物は `defaultState()` を参照 (絞り込みの集合・選択ノード・
 * グラフの向き・中央ペインのタブ・検索語・テーブルの並び順)。
 *
 * URL ハッシュが唯一の出典なので、初期値はハッシュから作り、以降も変更のたびに
 * `writeHash()` で書き戻す (戻る/進むは `applyHash()` で戻す)。
 */
let state = decodeHash(location.hash, DATA);

/** 絞り込みを反映した現在のグラフ。refresh() で作り直す。 */
let view = createView(DATA, state);

// --- Cytoscape.js -----------------------------------------------------------
//
// グラフは 1 度だけ構築し、以後は要素の見せ消し (display) とクラスの付け替えだけを
// 行う。フィルタや選択でレイアウトを回さないので、ノードの位置が動かない。

const graphEl = document.getElementById("graph");
const cssVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();

/** テーマ依存の色。CSS 変数から読むのでここだけ DOM に依存する。 */
const palette = () => ({
  fg: cssVar("--fg"),
  bg: cssVar("--bg"),
  border: cssVar("--border"),
  muted: cssVar("--muted"),
});

let cy = null;

/**
 * ラベル 1 行の実測幅 (px) を返す関数。ノードの外形を決めるのに使う。
 *
 * Cytoscape と同じ字体で canvas に測らせる (`LABEL_FONT` が両者の唯一の出典)。
 * canvas が使えない環境では undefined を返し、ロジック側の概算に任せる。
 * 同じ文字列を何度も測るので結果は覚えておく (152 ノードで数百回になる)。
 */
function labelMeasurer() {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return undefined;
  context.font = `${LABEL_FONT.size}px ${LABEL_FONT.family}`;
  const cache = new Map();
  return (text) => {
    let width = cache.get(text);
    if (width === undefined) {
      width = context.measureText(text).width;
      cache.set(text, width);
    }
    return width;
  };
}

function initGraph() {
  try {
    //: 初期レイアウトはコンストラクタに任せる (要素の計測が済んでから走る)。
    //: 帯枠もこの dagre に混ざるが、孤立した小さなノードなので邪魔にならず、
    //: 直後の applyBanding() が正しい位置と大きさに直す。
    cy = cytoscape({
      container: graphEl,
      elements: graphElements(DATA, labelMeasurer()),
      style: graphStyle(DATA.meta, palette()),
      layout: layoutOptions(state.direction),
      wheelSensitivity: 0.25,
      minZoom: 0.1,
      maxZoom: 3,
    });
  } catch (error) {
    graphEl.innerHTML =
      '<p class="empty">描画ライブラリ (Cytoscape.js / dagre) を読み込めなかった。図の元データは <a href="graph.mmd">graph.mmd</a> / <a href="graph.dot">graph.dot</a> にある。</p>';
    return;
  }
  for (const name of DATA.meta.dashed_edges) {
    cy.edges(`[name = "${name}"]`).addClass("dashed");
  }
  //: 帯枠は events: "no" なのでノードの tap は飛んでこない (クリックは素通り)。
  cy.on("tap", "node", (event) => selectNode(event.target.id()));
  cy.on("tap", (event) => {
    if (event.target === cy && state.selected) selectNode(state.selected);
  });
  applyBanding();
  fitInitial();
}

/**
 * いま表示している要素。絞り込みの状態はこちらが管理する `.hidden` クラスが
 * 唯一の出典なので、それを見る。`:visible` はスタイル計算が終わるまで
 * 一部の要素しか返さないことがあり (初期化直後)、レイアウト対象には使えない。
 */
const shownElements = () => cy.elements().not(".hidden");

// --- フォーカス (近傍だけを描く) --------------------------------------------
//
// 大きいグラフは全体を 1 枚に収めると横長になり、文字が読める倍率では
// 目的のノードに辿り着けない。フォーカスを入れると、図に描くのは選択ノードの
// 近傍だけになる。
//
// これは**図の描画だけの絞り込み**である。view (左の一覧・テーブル・詳細ペイン・
// 「影響部分グラフをコピー」) は全体のまま。ここを view 側で絞ると、上流/下流の
// 件数もコピー本文も近傍で切られた別物になり、`req explain` と食い違う。

/** 図に描くノードの id。フォーカス無し (または選択無し) なら null = 全部描く。 */
function focusedIds() {
  if (!state.focus || !state.selected || !view.byId.has(state.selected)) return null;
  return focusSet(view, state.selected, state.focus);
}

//: 直近のレイアウトが対象にしたフォーカス (`深さ:選択ノード`)。
let laidOutFocus = "";

const focusKey = () => (focusedIds() ? `${state.focus}:${state.selected}` : "");

/**
 * 描く範囲が変わっていれば並べ直す。
 *
 * 種別や status の絞り込みでは位置を保つ (覚えた場所が壊れないように) が、
 * フォーカスは描く範囲そのものが変わるので並べ直す。近傍だけを並べ直した
 * 結果に `fitInitial()` が掛かり、読める倍率に戻る。
 */
function syncFocusLayout() {
  const key = focusKey();
  if (key === laidOutFocus) return;
  laidOutFocus = key;
  runLayout();
}

/**
 * Goal / Need の帯を図の上 (LR なら左) に並べ直し、枠を掛け直す。
 * dagre の副軸方向の並びは保つので、「整列」のたびに図の形が大きく変わる
 * ことは無い。
 */
function applyBanding() {
  if (!cy) return;
  const bands = bandDefs(DATA);
  if (!bands.length) return;
  const placed = [];
  shownElements().nodes().not(".band").forEach((element) => {
    const position = element.position();
    placed.push({
      id: element.id(),
      type: element.data("type"),
      x: position.x,
      y: position.y,
      w: element.outerWidth(),
      h: element.outerHeight(),
    });
  });
  if (!placed.length) return;
  const { positions, frames } = bandedLayout(bands, placed, view.edges, state.direction);
  cy.batch(() => {
    for (const [id, position] of positions) cy.getElementById(id).position(position);
    for (const [type, frame] of frames) {
      const element = cy.getElementById(bandId(type));
      if (element.empty()) continue;
      element.data({ w: frame.w, h: frame.h });
      element.position({ x: frame.x, y: frame.y });
    }
  });
}

/** dagre → 帯の並べ直し → 倍率合わせ。初期表示・「整列」・向きの変更が通る。 */
function runLayout() {
  if (!cy) return;
  shownElements().not(".band").layout(layoutOptions(state.direction)).run();
  applyBanding();
  fitInitial();
}

/** 絞り込みの反映。再レイアウトはせず、表示・非表示だけを切り替える。 */
function applyVisibility() {
  if (!cy) return;
  const focused = focusedIds();
  const shown = focused ? view.nodes.filter((node) => focused.has(node.id)) : view.nodes;
  const nodes = new Set(shown.map((node) => node.id));
  //: 端点が描かれないエッジは描かない (絞り込みでの扱いと同じ)。
  const edges = new Set(
    view.edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)),
  );
  const types = new Set(shown.map((node) => node.type));
  cy.batch(() => {
    cy.nodes().not(".band").forEach((element) => {
      element.toggleClass("hidden", !nodes.has(element.id()));
    });
    //: 帯枠は、その型のノードが 1 つも見えていないときだけ隠す。
    cy.nodes(".band").forEach((element) => {
      element.toggleClass("hidden", !types.has(element.data("bandType")));
    });
    cy.edges().forEach((element) => {
      element.toggleClass("hidden", !edges.has(DATA.edges[element.data("index")]));
    });
  });
}

/**
 * 影響範囲の色分け。クラスの付け替えだけで済む。
 *
 * 範囲は state の深さ・向きの設定 (`impactSets()`) で決まる。設定を変えても
 * 描く要素は変わらないので、再レイアウトは走らない。
 */
function applyHighlight() {
  if (!cy) return;
  cy.batch(() => {
    cy.elements().removeClass("sel up down rel dim on-path");
    if (!state.selected || !view.byId.has(state.selected)) return;
    const { upstream, downstream, whole, undirected } = impactSets(view, state.selected);
    //: 帯枠は減光の対象にしない (子の強調が読めるよう、枠は常に薄いまま)。
    cy.nodes().not(".band").forEach((element) => {
      const id = element.id();
      if (id === state.selected) element.addClass("sel");
      //: 無向のときは上流/下流を分けない (CLI と同じく 1 つの「関連」)。
      else if (undirected) element.addClass(downstream.has(id) ? "rel" : "dim");
      else if (upstream.has(id)) element.addClass("up");
      else if (downstream.has(id)) element.addClass("down");
      else element.addClass("dim");
    });
    cy.edges().forEach((element) => {
      const linked =
        whole.has(element.data("source")) && whole.has(element.data("target"));
      element.addClass(linked ? "on-path" : "dim");
    });
  });
}

// --- 検索のグラフ連動 -------------------------------------------------------
//
// 検索は左の一覧を絞るだけでは足りない。ヒットしたノードが図のどこにあるかが
// 分からないと、1 件ずつ選んで確かめることになる。図の上でも暈し (underlay) で
// 示し、↑↓ で候補を送れるようにする。
//
// 暈しは影響範囲の色分け (枠線) とは別の視覚チャンネルなので、両方が同時に
// 点いても読み分けられる。

//: ↑↓ で送っている最中の候補。URL には載せない (選択とは別で、履歴に残す
//: ほどの状態ではない)。検索語が変わると先頭に戻る。
let cursor = null;

/** いまの検索語にヒットするノードの id (一覧と同じ並び)。 */
const hits = () => searchHits(view, state.query);

/** 検索ヒットの暈し。影響範囲のクラスとは独立に付け外しする。 */
function applySearchHits() {
  if (!cy) return;
  const matched = new Set(hits());
  cy.batch(() => {
    cy.nodes().not(".band").forEach((element) => {
      const id = element.id();
      element.toggleClass("hit", matched.has(id));
      element.toggleClass("hit-current", id === cursor);
    });
  });
}

/**
 * ↑↓ で候補を送る。図では現在の候補を強く出し、画面外ならそこまでパンする。
 * 選択 (state.selected) は動かさない。決めるのは Enter。
 */
function moveCursor(delta) {
  const next = stepHit(hits(), cursor, delta);
  if (next === null) return;
  cursor = next;
  renderNodeList();
  applySearchHits();
  revealNode(cursor);
  const active = document.querySelector("#node-list .node-btn.cursor");
  if (active) active.scrollIntoView({ block: "nearest" });
}

/** 表示中のノードだけで並べ直す。方向を変えたときと「整列」ボタンから呼ぶ。 */
function relayout() {
  runLayout();
}

function fitToView() {
  if (cy) cy.fit(shownElements(), 18);
}

//: これ以上縮めると文字が読めなくなる倍率。
const MIN_READABLE_ZOOM = 0.45;

/** 全体表示。ただし極端に横長のグラフでは縮めすぎず、左上から見せる。 */
function fitInitial() {
  if (!cy) return;
  fitToView();
  if (cy.zoom() >= MIN_READABLE_ZOOM) return;
  const box = shownElements().boundingBox();
  cy.zoom(MIN_READABLE_ZOOM);
  cy.pan({ x: 18 - box.x1 * MIN_READABLE_ZOOM, y: 18 - box.y1 * MIN_READABLE_ZOOM });
}

//: 選択ノードの周りに最低限空けておきたい余白 (画面 px)。端に半分掛かっている
//: 状態を「見えている」と扱わないための遊び。
const REVEAL_MARGIN_PX = 40;

//: パン先が分かる程度に短いアニメーション。
const REVEAL_DURATION_MS = 180;

/**
 * 指定ノードが表示範囲の外にあるときだけ、そこまでパンする。
 * 倍率は変えない。既に見えているノードなら動かない
 * (グラフ上のノードを直接クリックしたときはこちらに来る)。
 */
function revealNode(id) {
  if (!cy || state.mode !== "graph") return;
  if (!id || !view.byId.has(id)) return;
  const node = cy.getElementById(id);
  if (node.empty() || node.hasClass("hidden")) return;
  if (isNodeVisible(cy.extent(), node.boundingBox(), REVEAL_MARGIN_PX / cy.zoom())) return;
  cy.stop();
  cy.animate({ center: { eles: node } }, { duration: REVEAL_DURATION_MS });
}

/** 選択ノードを表示範囲に入れる。選択が変わったときの追従。 */
const revealSelected = () => revealNode(state.selected);

function zoomBy(factor) {
  if (!cy) return;
  cy.zoom({
    level: cy.zoom() * factor,
    renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
  });
}

// --- 詳細パネル ------------------------------------------------------------

function renderDetail() {
  const panel = document.getElementById("detail");
  if (!state.selected || !view.byId.has(state.selected)) {
    panel.innerHTML =
      '<p class="empty">グラフのノードをクリックすると、本文・受け入れ基準・影響範囲を表示する。</p>';
    return;
  }
  const node = view.byId.get(state.selected);
  const impact = impactSets(view, node.id);
  const outgoing = view.edges.filter((edge) => edge.source === node.id);
  const incoming = view.edges.filter((edge) => edge.target === node.id);

  const rows = [];
  rows.push(`<h3>${node.id} <span class="node-btn type">[${node.type}]</span></h3>`);
  rows.push(`<p class="text">${escapeHtml(node.text)}</p>`);
  rows.push("<dl>");
  rows.push(`<dt>status</dt><dd>${node.status}</dd>`);
  if (node.priority !== null && node.priority !== undefined) rows.push(`<dt>priority</dt><dd>${node.priority}</dd>`);
  if (node.kind) rows.push(`<dt>kind</dt><dd>${node.kind}</dd>`);
  if (node.decomposition) rows.push(`<dt>分解</dt><dd>${node.decomposition}</dd>`);
  if (node.location) rows.push(`<dt>出所</dt><dd class="loc">${escapeHtml(node.location)}</dd>`);
  //: 件数は影響範囲の設定 (深さ・向き) に従う。図の色分けと同じ範囲を数える。
  if (impact.undirected) {
    rows.push(`<dt>関連</dt><dd>${impact.downstream.size} 件</dd>`);
  } else {
    rows.push(`<dt>上流</dt><dd>${impact.upstream.size} 件</dd>`);
    rows.push(`<dt>下流</dt><dd>${impact.downstream.size} 件</dd>`);
  }
  rows.push("</dl>");

  if ((node.acceptance_criteria || []).length) {
    rows.push("<h2>受け入れ基準</h2><ul>");
    for (const criterion of node.acceptance_criteria) rows.push(`<li>${escapeHtml(criterion)}</li>`);
    rows.push("</ul>");
  }

  if ((node.suppress || []).length) {
    rows.push("<h2>抑制中の指摘</h2><ul>");
    for (const [code, reason] of node.suppress) {
      rows.push(`<li><code>${escapeHtml(code)}</code>: ${escapeHtml(reason)}</li>`);
    }
    rows.push("</ul>");
  }

  const edgeList = (edges, direction) =>
    edges
      .map((edge) => {
        const other = direction === "out" ? edge.target : edge.source;
        const arrow = direction === "out" ? `--${edge.name}-->` : `<--${edge.name}--`;
        return `<li class="edge"><button class="node-btn" data-id="${other}">${arrow} ${other}</button></li>`;
      })
      .join("");

  if (outgoing.length) rows.push(`<h2>出るエッジ</h2><ul class="plain">${edgeList(outgoing, "out")}</ul>`);
  if (incoming.length) rows.push(`<h2>入るエッジ</h2><ul class="plain">${edgeList(incoming, "in")}</ul>`);

  const nodeFindings = DATA.findings.filter((finding) => finding.node_id === node.id);
  if (nodeFindings.length) {
    rows.push('<h2 id="node-findings">このノードへの指摘</h2>');
    for (const finding of nodeFindings) rows.push(findingHtml(finding));
  }

  rows.push('<h2>LLM 連携</h2><button id="copy-context">影響部分グラフをコピー</button>');
  rows.push(
    `<p class="hint"><code>${escapeHtml(explainCommand(view, node.id))}</code>` +
      " と同じ内容をクリップボードに入れる。</p>",
  );
  panel.innerHTML = rows.join("");

  panel.querySelectorAll("button[data-id]").forEach((button) => {
    button.addEventListener("click", () => selectNode(button.dataset.id));
  });
  const copyButton = document.getElementById("copy-context");
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(nodeContext(view, node.id));
      copyButton.textContent = "コピーした";
    } catch {
      copyButton.textContent = "コピーできなかった";
    }
    setTimeout(() => (copyButton.textContent = "影響部分グラフをコピー"), 1600);
  });
}

function findingHtml(finding) {
  const where = finding.node_id ? ` (${finding.node_id})` : "";
  const at = finding.location
    ? `<div class="loc">${escapeHtml(finding.location)}</div>`
    : "";
  return `<div class="finding ${finding.severity}" data-id="${finding.node_id || ""}">
    <div class="code">${finding.severity.toUpperCase()} · L${finding.layer} · ${finding.code}${where}</div>
    <div>${escapeHtml(finding.message)}</div>
    ${at}
  </div>`;
}

// --- 左サイドバー ----------------------------------------------------------

function renderNodeList() {
  const list = document.getElementById("node-list");
  const matched = view.nodes.filter((node) => matchesQuery(node, state.query));
  list.innerHTML = matched
    .map((node) => {
      const marks = [
        node.id === state.selected ? "active" : "",
        //: ↑↓ で送っている最中の候補。図の暈しと同じものを指す。
        node.id === cursor ? "cursor" : "",
      ].join(" ");
      return `<li><button class="node-btn ${marks}" data-id="${node.id}">
        <span class="id">${node.id}</span> <span class="type">${node.type}</span><br>${escapeHtml(truncate(node.text, 34))}
      </button></li>`;
    })
    .join("");
  list.querySelectorAll("button[data-id]").forEach((button) => {
    button.addEventListener("click", () => selectNode(button.dataset.id));
  });
}

/**
 * チェックボックス 1 群。`items` は `{ key, label, count }` の配列。
 * チェックの有無は state の集合から取る (ハッシュ付きの URL で開いたとき用)。
 */
function renderToggles(containerId, attribute, items, set) {
  document.getElementById(containerId).innerHTML = items
    .map(
      (item) => `<label class="toggle"><input type="checkbox" data-${attribute}="${item.key}"${set.has(item.key) ? " checked" : ""}>
        ${escapeHtml(item.label)}<span class="count">${item.count}</span></label>`,
    )
    .join("");
}

/**
 * チェックの付け外しを state の集合に写す。集合は押されたときに引き直す
 * (`applyHash()` が state ごと差し替えるので、ここで掴んでおくと古い集合が残る)。
 */
function bindToggles(attribute, key) {
  document.querySelectorAll(`input[data-${attribute}]`).forEach((input) => {
    const value = input.dataset[attribute];
    input.addEventListener("change", () => {
      input.checked ? state[key].add(value) : state[key].delete(value);
      refresh();
      writeHash();
    });
  });
}

//: 絞り込み 1 群の [チェックボックスの属性名, state のキー]。置き場所は
//: `<属性名>-filters`。描画・イベント・URL からの復元がこの並びを共有する。
const FILTER_SETS = [
  ["type", "types"],
  ["status", "statuses"],
  ["priority", "priorities"],
  ["edge", "edges"],
];

function renderFilters() {
  const countBy = (keyOf) => {
    const counts = {};
    for (const node of DATA.nodes) counts[keyOf(node)] = (counts[keyOf(node)] || 0) + 1;
    return counts;
  };

  const typeCounts = countBy((node) => node.type);
  const edgeCounts = {};
  for (const edge of DATA.edges) edgeCounts[edge.name] = (edgeCounts[edge.name] || 0) + 1;
  const items = {
    types: DATA.types.map((type) => ({ key: type, label: type, count: typeCounts[type] || 0 })),
    statuses: statusFilters(DATA),
    priorities: priorityFilters(DATA),
    edges: DATA.edge_names.map((name) => ({
      key: name,
      label: name,
      count: edgeCounts[name] || 0,
    })),
  };

  for (const [attribute, key] of FILTER_SETS) {
    renderToggles(`${attribute}-filters`, attribute, items[key], state[key]);
    bindToggles(attribute, key);
  }
}

/** 近傍の深さの選択肢。深さの一覧は `FOCUS_DEPTHS` を唯一の出典とする。 */
function renderFocusOptions() {
  document.getElementById("focus").innerHTML = [
    '<option value="0">フォーカス: 切</option>',
    ...FOCUS_DEPTHS.map((depth) => `<option value="${depth}">近傍 ${depth} ホップ</option>`),
  ].join("");
}

/**
 * 影響範囲の探索設定。深さの上限は `IMPACT_DEPTHS` を唯一の出典とする。
 *
 * ここはグラフの描画ではなく**影響範囲そのもの**の設定なので、図のツールバー
 * (フォーカス) ではなく絞り込みと同じ左サイドバーに置く。色分け・詳細ペインの
 * 件数・コピー本文の 3 つに同じだけ効く。
 */
function renderImpactControls() {
  const slider = document.getElementById("depth");
  slider.min = "0";
  slider.max = String(Math.max(...IMPACT_DEPTHS));
  slider.step = "1";
}

/** 深さスライダの現在値の表示。0 は上限無し。 */
const depthLabel = () => (state.depth ? `${state.depth} ホップ` : "無制限");

/** 入力欄・チェック・タブを state に合わせ直す。ハッシュから復元したとき用。 */
function syncControls() {
  document.getElementById("search").value = state.query;
  document.getElementById("direction").value = state.direction;
  document.getElementById("focus").value = String(state.focus);
  document.getElementById("depth").value = String(state.depth);
  document.getElementById("depth-value").textContent = depthLabel();
  document.getElementById("undirected").checked = state.undirected;
  for (const [attribute, key] of FILTER_SETS) {
    document.querySelectorAll(`input[data-${attribute}]`).forEach((input) => {
      input.checked = state[key].has(input.dataset[attribute]);
    });
  }
}

function renderStats() {
  const counts = DATA.stats.findings;
  const chips = [
    `<span class="chip">${DATA.stats.nodes} ノード</span>`,
    `<span class="chip">${DATA.stats.edges} エッジ</span>`,
  ];
  for (const severity of ["error", "severe", "warning", "info"]) {
    if (counts[severity]) chips.push(`<span class="chip ${severity}">${severity} ${counts[severity]}</span>`);
  }
  if (!counts.error && !counts.severe && !counts.warning && !counts.info) {
    chips.push('<span class="chip">指摘なし</span>');
  }
  if (DATA.stats.suppressed) chips.push(`<span class="chip">抑制 ${DATA.stats.suppressed} 件</span>`);
  document.getElementById("stats").innerHTML = chips.join("");
  document.getElementById("sources").textContent = DATA.generated_from.join(", ");
  document.getElementById("legend").innerHTML = legendGroups(DATA.meta)
    .map((group) => {
      const items = group.items
        .map(({ label, swatch }) => {
          const style = [
            `background:${swatch.background}`,
            `border-color:${swatch.borderColor || "currentColor"}`,
            `border-style:${swatch.borderStyle}`,
            `border-width:${swatch.borderWidth}px`,
          ].join(";");
          return `<span><i class="swatch" style="${style}"></i>${escapeHtml(label)}</span>`;
        })
        .join("");
      return `<span class="legend-group"><b>${escapeHtml(group.title)}</b>${items}</span>`;
    })
    .join("");

  const panel = document.getElementById("findings");
  panel.innerHTML = DATA.findings.length
    ? DATA.findings.map(findingHtml).join("")
    : '<p class="empty">指摘は無い。</p>';
  panel.querySelectorAll(".finding[data-id]").forEach((element) => {
    if (!element.dataset.id) return;
    element.addEventListener("click", () => selectNode(element.dataset.id));
  });
}

// --- テーブルビュー --------------------------------------------------------
//
// グラフと同じ view / state を見るので、絞り込みも選択もそのまま共有される。
// 中央ペインの表示を差し替えるだけで、グラフ側は作り直さない。

function renderTable() {
  // 隠れている間は作らない。テーブルに切り替えたときに setMode() が作り直す。
  if (state.mode !== "table") return;
  const rows = sortRows(view, tableRows(view, state.query), state.sort);
  const head = TABLE_COLUMNS.map((column) => {
    const active = state.sort.key === column.key;
    const order = active ? (state.sort.asc ? "ascending" : "descending") : "none";
    const arrow = active ? (state.sort.asc ? "▲" : "▼") : "";
    return `<th class="${column.numeric ? "num" : ""}" aria-sort="${order}">
      <button data-key="${column.key}" title="この列で並べ替える">${column.label}<span class="arrow">${arrow}</span></button></th>`;
  }).join("");

  //: 値が無いこと (priority 無し・受け入れ基準 0 件) を空欄と区別して見せる。
  const DASH = '<td class="num dash">—</td>';
  const cell = (row, key) => {
    switch (key) {
      case "text":
        return `<td class="text">${escapeHtml(row.text)}</td>`;
      case "findings":
        return row.findings
          ? `<td class="num"><button class="finding-count ${row.severity || ""}" data-findings="${row.id}" title="このノードへの指摘を見る">${row.findings}</button></td>`
          : DASH;
      // priority は 0 も有効な値なので、null だけを空欄にする。
      case "priority":
        return row.priority === null ? DASH : `<td class="num">${row.priority}</td>`;
      case "criteria":
        return row.criteria ? `<td class="num">${row.criteria}</td>` : DASH;
      default:
        return `<td class="${key}">${escapeHtml(row[key])}</td>`;
    }
  };

  const body = rows.length
    ? rows
        .map(
          (row) => `<tr data-id="${row.id}" class="${row.id === state.selected ? "sel" : ""}">
            ${TABLE_COLUMNS.map((column) => cell(row, column.key)).join("")}</tr>`,
        )
        .join("")
    : `<tr><td class="empty" colspan="${TABLE_COLUMNS.length}">条件に合うノードは無い。</td></tr>`;

  const table = document.getElementById("node-table");
  table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  document.getElementById("table-note").textContent =
    `${rows.length} 件を表示中 (全 ${DATA.nodes.length} 件)。` +
    " 行をクリックすると右ペインに詳細が出る。列見出しで並べ替える。";

  table.querySelectorAll("thead button[data-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sort = nextSort(state.sort, button.dataset.key);
      renderTable();
      writeHash();
    });
  });
  table.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", () => selectNode(tr.dataset.id));
  });
  table.querySelectorAll("button[data-findings]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      showFindings(button.dataset.findings);
    });
  });
}

/** 指摘数から検証結果へ辿る。そのノードを選び、右ペインの指摘まで送る。 */
function showFindings(id) {
  if (state.selected !== id) selectNode(id);
  const heading = document.getElementById("node-findings");
  if (heading) heading.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** 中央ペインの表示切り替え。グラフは消さず、隠すだけ。 */
function setMode(mode) {
  state.mode = mode;
  document.getElementById("graph-frame").hidden = mode !== "graph";
  document.getElementById("table-frame").hidden = mode !== "table";
  for (const element of document.querySelectorAll(".graph-only")) {
    element.hidden = mode !== "graph";
  }
  for (const [id, name] of [["tab-graph", "graph"], ["tab-table", "table"]]) {
    const tab = document.getElementById(id);
    tab.classList.toggle("active", mode === name);
    tab.setAttribute("aria-selected", String(mode === name));
  }
  if (mode === "table") {
    renderTable();
    return;
  }
  // 隠している間にコンテナの大きさが変わっているので、測り直してから追従する。
  if (cy) cy.resize();
  revealSelected();
}

// --- URL ハッシュ ----------------------------------------------------------
//
// 表示状態と URL を両向きに繋ぐ。書くのは writeHash()、読むのは applyHash() だけ。

/**
 * いまの状態を URL に書き戻す。
 *
 * push=true なら履歴に積む (戻る/進むで辿れる)。検索語のように 1 打鍵ごとに
 * 変わるものは push=false で最後のエントリを置き換え、履歴を埋めない。
 */
function writeHash(push = true) {
  const hash = encodeHash(state, DATA);
  if (hash === location.hash) return;
  // ハッシュが空になるときは "#" 自体を落とす。
  const url = hash || location.pathname + location.search;
  try {
    push ? history.pushState(null, "", url) : history.replaceState(null, "", url);
  } catch {
    // file:// で開いていると pushState が使えないことがある。履歴の粒度は
    // 諦めて、URL だけは合わせる (この代入は hashchange を起こす)。
    location.hash = hash;
  }
}

/**
 * URL のハッシュから表示状態を作り直す。戻る/進む (popstate) と、URL を手で
 * 書き換えたとき (hashchange) の入口。既に一致していれば何もしない。
 */
function applyHash() {
  if (location.hash === encodeHash(state, DATA)) return;
  const next = decodeHash(location.hash, DATA);
  const turned = next.direction !== state.direction;
  state = next;
  syncControls();
  refresh();
  setMode(state.mode);
  if (turned) relayout();
  // 手で書かれた URL はここで正しい形に直す。履歴は増やさない。
  writeHash(false);
}

// --- 操作 ------------------------------------------------------------------

function selectNode(id) {
  state.selected = state.selected === id ? null : id;
  refresh();
  revealSelected();
  writeHash();
}

/** 選択を決める (トグルしない)。キーボードの Enter から呼ぶ。 */
function chooseNode(id) {
  if (state.selected === id) {
    revealNode(id);
    return;
  }
  selectNode(id);
}

function refresh() {
  view = createView(DATA, state);
  //: 絞り込みや検索語の変更で候補から外れた位置は捨てる。
  if (cursor !== null && !hits().includes(cursor)) cursor = null;
  renderNodeList();
  renderDetail();
  renderTable();
  applyVisibility();
  applyHighlight();
  applySearchHits();
  //: 選択の変更・フォーカスの入切・URL からの復元がすべてここを通る。
  syncFocusLayout();
}

document.getElementById("tab-graph").addEventListener("click", () => {
  setMode("graph");
  writeHash();
});
document.getElementById("tab-table").addEventListener("click", () => {
  setMode("table");
  writeHash();
});
document.getElementById("search").addEventListener("input", (event) => {
  state.query = event.target.value;
  //: 語が変われば候補も変わる。位置は先頭から数え直す。
  cursor = null;
  renderNodeList();
  renderTable();
  applySearchHits();
  writeHash(false);
});
//: ↑↓ で候補を送り、Enter で決める。入力欄から手を離さずに図を辿れるようにする。
document.getElementById("search").addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveCursor(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  const target = cursor === null ? hits()[0] : cursor;
  if (target) chooseNode(target);
});
document.getElementById("depth").addEventListener("input", (event) => {
  state.depth = Number(event.target.value);
  document.getElementById("depth-value").textContent = depthLabel();
  //: 描く要素は変わらないので再レイアウトは走らない (色分けと本文だけが変わる)。
  refresh();
  //: つまみを動かしている間の 1 段ごとに履歴を積まない。
  writeHash(false);
});
document.getElementById("undirected").addEventListener("change", (event) => {
  state.undirected = event.target.checked;
  refresh();
  writeHash();
});
document.getElementById("clear").addEventListener("click", () => {
  state.selected = null;
  refresh();
  writeHash();
});
document.getElementById("direction").addEventListener("change", (event) => {
  state.direction = event.target.value;
  relayout();
  writeHash();
});
document.getElementById("focus").addEventListener("change", (event) => {
  state.focus = Number(event.target.value);
  //: 描く範囲が変わるので、refresh() の中の syncFocusLayout() が並べ直す。
  refresh();
  writeHash();
});
document.getElementById("relayout").addEventListener("click", relayout);
document.getElementById("zoom-in").addEventListener("click", () => zoomBy(1.2));
document.getElementById("zoom-out").addEventListener("click", () => zoomBy(1 / 1.2));
document.getElementById("zoom-reset").addEventListener("click", () => {
  if (cy) cy.zoom(1);
});
document.getElementById("zoom-fit").addEventListener("click", fitToView);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (cy) cy.style(graphStyle(DATA.meta, palette()));
});

const copyLink = document.getElementById("copy-link");
copyLink.addEventListener("click", async () => {
  //: URL は writeHash() が常に最新にしているので、そのまま渡せばよい。
  try {
    await navigator.clipboard.writeText(location.href);
    copyLink.textContent = "コピーした";
  } catch {
    copyLink.textContent = "コピーできなかった";
  }
  setTimeout(() => (copyLink.textContent = "リンクをコピー"), 1600);
});

window.addEventListener("popstate", applyHash);
window.addEventListener("hashchange", applyHash);

initGraph();
renderFilters();
renderFocusOptions();
renderImpactControls();
syncControls();
renderStats();
refresh();
setMode(state.mode);
// 解釈できない項目を落とした後の正しい URL に直す (履歴は増やさない)。
writeHash(false);
