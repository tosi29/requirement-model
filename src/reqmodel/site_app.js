/**
 * 静的サイトの表示層。DOM と Cytoscape.js に触るのはこのファイルだけ。
 *
 * 計算は `site_logic.js` の純関数に任せ、ここは「受け取った値を貼る」「イベントを
 * 繋ぐ」に徹する。`site.py` が両者をインライン化して 1 枚の HTML にする
 * (その際 import 行は落とされ、同じモジュールスコープに並ぶ)。
 */

import {
  activeEdgeNames,
  createView,
  escapeHtml,
  graphElements,
  graphStyle,
  layoutOptions,
  nodeContext,
  reach,
  truncate,
} from "./site_logic.js";

const cytoscape = window.cytoscape;

const DATA = JSON.parse(document.getElementById("model-data").textContent);
const state = {
  types: new Set(DATA.types),
  edges: new Set(DATA.edge_names),
  selected: null,
  direction: "TD",
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
    rows.push("<h2>このノードへの指摘</h2>");
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
  const query = document.getElementById("search").value.trim().toLowerCase();
  const list = document.getElementById("node-list");
  const matched = view.nodes.filter(
    (node) =>
      !query ||
      node.id.toLowerCase().includes(query) ||
      node.text.toLowerCase().includes(query),
  );
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

function renderFilters() {
  const typeCounts = {};
  for (const node of DATA.nodes) typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
  document.getElementById("type-filters").innerHTML = DATA.types
    .map(
      (type) => `<label class="toggle"><input type="checkbox" data-type="${type}" checked>
        ${type}<span class="count">${typeCounts[type] || 0}</span></label>`,
    )
    .join("");

  const edgeCounts = {};
  for (const edge of DATA.edges) edgeCounts[edge.name] = (edgeCounts[edge.name] || 0) + 1;
  document.getElementById("edge-filters").innerHTML = DATA.edge_names
    .map(
      (name) => `<label class="toggle"><input type="checkbox" data-edge="${name}" checked>
        ${name}<span class="count">${edgeCounts[name] || 0}</span></label>`,
    )
    .join("");

  document.querySelectorAll("input[data-type]").forEach((input) => {
    input.addEventListener("change", () => {
      input.checked ? state.types.add(input.dataset.type) : state.types.delete(input.dataset.type);
      refresh();
    });
  });
  document.querySelectorAll("input[data-edge]").forEach((input) => {
    input.addEventListener("change", () => {
      input.checked ? state.edges.add(input.dataset.edge) : state.edges.delete(input.dataset.edge);
      refresh();
    });
  });
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
  document.getElementById("stats").innerHTML = chips.join("");
  document.getElementById("sources").textContent = DATA.generated_from.join(", ");
  document.getElementById("legend").innerHTML = DATA.types
    .map((type) => {
      const meta = DATA.meta.types[type];
      return `<span><i class="swatch" style="background:${meta.fill};border-color:${meta.stroke}"></i>${type}</span>`;
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

// --- 操作 ------------------------------------------------------------------

function selectNode(id) {
  state.selected = state.selected === id ? null : id;
  refresh();
}

function refresh() {
  view = createView(DATA, state);
  renderNodeList();
  renderDetail();
  applyVisibility();
  applyHighlight();
}

document.getElementById("search").addEventListener("input", renderNodeList);
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
