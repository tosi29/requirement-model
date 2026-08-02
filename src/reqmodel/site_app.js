/**
 * 静的サイトの表示層。DOM と Cytoscape.js に触るのはこのファイルだけ。
 *
 * 計算は `site_logic.js` の純関数に任せ、ここは「受け取った値を貼る」「イベントを
 * 繋ぐ」に徹する。`site.py` が両者をインライン化して 1 枚の HTML にする
 * (その際 import 行は落とされ、同じモジュールスコープに並ぶ)。
 */

import {
  PRIORITY_BUCKETS,
  TABLE_COLUMNS,
  activeEdgeNames,
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
  priorityFilters,
  reach,
  sortRows,
  statusFilters,
  tableRows,
  truncate,
} from "./site_logic.js";

const cytoscape = window.cytoscape;

const DATA = JSON.parse(document.getElementById("model-data").textContent);
const state = {
  types: new Set(DATA.types),
  edges: new Set(DATA.edge_names),
  //: status と優先度区分の絞り込み。種別・エッジと同じく、影響範囲の計算にも効く。
  statuses: new Set(Object.keys(DATA.meta.statuses)),
  priorities: new Set(PRIORITY_BUCKETS.map((bucket) => bucket.key)),
  selected: null,
  direction: "TD",
  //: 中央ペインに出しているもの。"graph" か "table"。
  mode: "graph",
  //: 検索語。左の一覧とテーブルの両方に効く。
  query: "",
  //: テーブルの並び順。
  sort: { key: "id", asc: true },
};

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

function initGraph() {
  try {
    cy = cytoscape({
      container: graphEl,
      elements: graphElements(DATA),
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
  cy.on("tap", "node", (event) => selectNode(event.target.id()));
  cy.on("tap", (event) => {
    if (event.target === cy && state.selected) selectNode(state.selected);
  });
  fitInitial();
}

/** 絞り込みの反映。再レイアウトはせず、表示・非表示だけを切り替える。 */
function applyVisibility() {
  if (!cy) return;
  const nodes = new Set(view.nodes.map((node) => node.id));
  const edges = new Set(view.edges);
  cy.batch(() => {
    cy.nodes().forEach((element) => {
      element.toggleClass("hidden", !nodes.has(element.id()));
    });
    cy.edges().forEach((element) => {
      element.toggleClass("hidden", !edges.has(DATA.edges[element.data("index")]));
    });
  });
}

/** 影響範囲の色分け。クラスの付け替えだけで済む。 */
function applyHighlight() {
  if (!cy) return;
  cy.batch(() => {
    cy.elements().removeClass("sel up down dim on-path");
    if (!state.selected || !view.byId.has(state.selected)) return;
    const up = reach(view, state.selected, false);
    const down = reach(view, state.selected, true);
    const inScope = new Set([state.selected, ...up, ...down]);
    cy.nodes().forEach((element) => {
      const id = element.id();
      if (id === state.selected) element.addClass("sel");
      else if (up.has(id)) element.addClass("up");
      else if (down.has(id)) element.addClass("down");
      else element.addClass("dim");
    });
    cy.edges().forEach((element) => {
      const linked =
        inScope.has(element.data("source")) && inScope.has(element.data("target"));
      element.addClass(linked ? "on-path" : "dim");
    });
  });
}

/** 表示中のノードだけで並べ直す。方向を変えたときと「整列」ボタンから呼ぶ。 */
function relayout() {
  if (!cy) return;
  cy.elements(":visible").layout(layoutOptions(state.direction)).run();
  fitInitial();
}

function fitToView() {
  if (cy) cy.fit(cy.elements(":visible"), 18);
}

//: これ以上縮めると文字が読めなくなる倍率。
const MIN_READABLE_ZOOM = 0.45;

/** 全体表示。ただし極端に横長のグラフでは縮めすぎず、左上から見せる。 */
function fitInitial() {
  if (!cy) return;
  fitToView();
  if (cy.zoom() >= MIN_READABLE_ZOOM) return;
  const box = cy.elements(":visible").boundingBox();
  cy.zoom(MIN_READABLE_ZOOM);
  cy.pan({ x: 18 - box.x1 * MIN_READABLE_ZOOM, y: 18 - box.y1 * MIN_READABLE_ZOOM });
}

//: 選択ノードの周りに最低限空けておきたい余白 (画面 px)。端に半分掛かっている
//: 状態を「見えている」と扱わないための遊び。
const REVEAL_MARGIN_PX = 40;

//: パン先が分かる程度に短いアニメーション。
const REVEAL_DURATION_MS = 180;

/**
 * 選択ノードが表示範囲の外にあるときだけ、そこまでパンする。
 * 倍率は変えない。既に見えているノードを選び直しても動かない
 * (グラフ上のノードを直接クリックしたときはこちらに来る)。
 */
function revealSelected() {
  if (!cy || state.mode !== "graph") return;
  if (!state.selected || !view.byId.has(state.selected)) return;
  const node = cy.getElementById(state.selected);
  if (node.empty() || node.hasClass("hidden")) return;
  if (isNodeVisible(cy.extent(), node.boundingBox(), REVEAL_MARGIN_PX / cy.zoom())) return;
  cy.stop();
  cy.animate({ center: { eles: node } }, { duration: REVEAL_DURATION_MS });
}

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
  const up = [...reach(view, node.id, false)];
  const down = [...reach(view, node.id, true)];
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
  rows.push(`<dt>上流</dt><dd>${up.length} 件</dd>`);
  rows.push(`<dt>下流</dt><dd>${down.length} 件</dd>`);
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

  const filtered = activeEdgeNames(view);
  rows.push('<h2>LLM 連携</h2><button id="copy-context">影響部分グラフをコピー</button>');
  rows.push(
    `<p class="hint"><code>req explain ${node.id}` +
      (filtered ? ` --edges ${filtered.join(",")}` : "") +
      "</code> と同じ内容をクリップボードに入れる。</p>",
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
    .map(
      (node) => `<li><button class="node-btn ${node.id === state.selected ? "active" : ""}" data-id="${node.id}">
        <span class="id">${node.id}</span> <span class="type">${node.type}</span><br>${escapeHtml(truncate(node.text, 34))}
      </button></li>`,
    )
    .join("");
  list.querySelectorAll("button[data-id]").forEach((button) => {
    button.addEventListener("click", () => selectNode(button.dataset.id));
  });
}

/** チェックボックス 1 群。`items` は `{ key, label, count }` の配列。 */
function renderToggles(containerId, attribute, items) {
  document.getElementById(containerId).innerHTML = items
    .map(
      (item) => `<label class="toggle"><input type="checkbox" data-${attribute}="${item.key}" checked>
        ${escapeHtml(item.label)}<span class="count">${item.count}</span></label>`,
    )
    .join("");
}

/** チェックの付け外しを state の集合に写す。 */
function bindToggles(attribute, set) {
  document.querySelectorAll(`input[data-${attribute}]`).forEach((input) => {
    const key = input.dataset[attribute];
    input.addEventListener("change", () => {
      input.checked ? set.add(key) : set.delete(key);
      refresh();
    });
  });
}

function renderFilters() {
  const countBy = (keyOf) => {
    const counts = {};
    for (const node of DATA.nodes) counts[keyOf(node)] = (counts[keyOf(node)] || 0) + 1;
    return counts;
  };

  const typeCounts = countBy((node) => node.type);
  renderToggles(
    "type-filters",
    "type",
    DATA.types.map((type) => ({ key: type, label: type, count: typeCounts[type] || 0 })),
  );

  renderToggles("status-filters", "status", statusFilters(DATA));
  renderToggles("priority-filters", "priority", priorityFilters(DATA));

  const edgeCounts = {};
  for (const edge of DATA.edges) edgeCounts[edge.name] = (edgeCounts[edge.name] || 0) + 1;
  renderToggles(
    "edge-filters",
    "edge",
    DATA.edge_names.map((name) => ({
      key: name,
      label: name,
      count: edgeCounts[name] || 0,
    })),
  );

  bindToggles("type", state.types);
  bindToggles("status", state.statuses);
  bindToggles("priority", state.priorities);
  bindToggles("edge", state.edges);
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

// --- 操作 ------------------------------------------------------------------

function selectNode(id) {
  state.selected = state.selected === id ? null : id;
  refresh();
  revealSelected();
}

function refresh() {
  view = createView(DATA, state);
  renderNodeList();
  renderDetail();
  renderTable();
  applyVisibility();
  applyHighlight();
}

document.getElementById("tab-graph").addEventListener("click", () => setMode("graph"));
document.getElementById("tab-table").addEventListener("click", () => setMode("table"));
document.getElementById("search").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderNodeList();
  renderTable();
});
document.getElementById("clear").addEventListener("click", () => {
  state.selected = null;
  refresh();
});
document.getElementById("direction").addEventListener("change", (event) => {
  state.direction = event.target.value;
  relayout();
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

initGraph();
renderFilters();
renderStats();
refresh();
