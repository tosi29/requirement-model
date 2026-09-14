import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Window } from "happy-dom";
import { fixture } from "./fixture.mjs";

const template = await readFile(new URL("../../src/reqmodel/presentation/site_template.html", import.meta.url), "utf8");
const bundle = await readFile(new URL("../../src/reqmodel/presentation/site_bundle.js", import.meta.url), "utf8");

// Layout geometry has separate tests. Here a deterministic layout lets us detect
// unintended relayouts while exercising the real bundled DOM event handlers.
class LayoutGraph {
  items = new Map();
  setGraph() {}
  setDefaultEdgeLabel() {}
  setNode(id, size) { this.items.set(id, { ...size, x: this.items.size * 220, y: 100 }); }
  setEdge() {}
  nodes() { return [...this.items.keys()]; }
  node(id) { return this.items.get(id); }
}
function page(hash = "", dataOverride = null) {
  const window = new Window({ url: `http://localhost/${hash}` });
  const data = dataOverride || fixture();
  data.findings = [
    { code: "W001", severity: "warning", message: "影響範囲内", layer: 1, node_id: "QR-1" },
    { code: "W002", severity: "warning", message: "影響範囲外", layer: 1, node_id: "Goal-1" },
  ];
  window.document.write(template.replaceAll("__TITLE__", "テスト")
    .replace("__DATA__", JSON.stringify(data)).replace("__SCRIPTS__", "").replace("__APP_JS__", ""));
  let layouts = 0;
  window.dagre = { graphlib: { Graph: LayoutGraph }, layout: () => { layouts++; } };
  window.eval(bundle);
  const document = window.document;
  const el = (id) => document.getElementById(id);
  const node = (id) => document.querySelector(`[data-node-id="${id}"]`);
  const clickNode = (id) => node(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const change = (id, value) => { el(id).value = value; el(id).dispatchEvent(new window.Event("change")); };
  const visible = () => [...document.querySelectorAll("[data-node-id]:not(.hidden)")].map(n => n.dataset.nodeId).sort();
  const list = () => [...el("node-list").querySelectorAll("button[data-id]")].map(n => n.dataset.id).sort();
  const positions = () => [...document.querySelectorAll("[data-node-id]")].map(n => n.getAttribute("transform"));
  const camera = () => document.querySelector(".graph-layer").getAttribute("transform");
  return { window, document, el, node, clickNode, change, visible, list, positions, camera, layouts: () => layouts };
}

test("分析タブは図だけを上流・下流に絞り、一覧から起点を変更できる", async () => {
  const p = page();
  try {
    assert(p.el("tab-analysis").disabled);
    p.clickNode("FR-1");
    p.change("focus", "2");
    assert(p.visible().includes("Goal-1"));
    p.el("tab-analysis").click();
    assert.equal(p.el("tab-analysis").getAttribute("aria-selected"), "true");
    assert(p.el("focus-control").hidden);
    assert.deepEqual(p.visible(), ["FR-1", "Need-1", "QR-1"]);
    assert.equal(p.list().length, 4);
    assert.equal(p.el("analysis-direction"), null);
    assert.equal(p.el("focus-status-text"), null);
    assert(!p.el("legend").textContent.includes("フォーカス"));
    assert.deepEqual([...p.document.querySelectorAll(".band:not(.hidden)")].map(n => n.textContent), ["上流", "下流"]);
    p.el("node-list").querySelector('[data-id="Goal-1"]').click();
    assert(p.node("Goal-1").classList.contains("sel"));
    assert.deepEqual(p.visible(), ["Goal-1", "Need-1"]);
    assert.equal(p.list().length, 4);
    assert.deepEqual([...p.document.querySelectorAll(".band:not(.hidden)")].map(n => n.textContent), ["下流"]);
    p.el("search").value = "QR-1";
    p.el("search").dispatchEvent(new p.window.Event("input"));
    p.el("search").dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert(p.node("QR-1").classList.contains("sel"));
    assert.deepEqual(p.visible(), ["FR-1", "Need-1", "QR-1"]);
  } finally { await p.window.happyDOM.close(); }
});

test("分析中のクリックは起点と範囲・配置・倍率を維持し detail と経路だけを変える", async () => {
  const p = page();
  try {
    p.clickNode("FR-1");
    p.el("tab-analysis").click();
    p.el("zoom-in").click();
    const before = { visible: p.visible(), positions: p.positions(), camera: p.camera(), layouts: p.layouts() };
    p.clickNode("QR-1");
    assert(p.el("detail").querySelector("h3").textContent.startsWith("QR-1"));
    assert(p.node("FR-1").classList.contains("sel"));
    assert(p.node("QR-1").classList.contains("detail-target"));
    assert.equal(p.document.querySelectorAll(".edge.detail-path").length, 1);
    assert.deepEqual({ visible: p.visible(), positions: p.positions(), camera: p.camera(), layouts: p.layouts() }, before);
    p.document.querySelector("#graph svg").dispatchEvent(new p.window.MouseEvent("click", { bubbles: true }));
    assert(p.el("detail").querySelector("h3").textContent.startsWith("QR-1"));
    assert.equal(p.el("exit-focus"), null);
    p.el("tab-graph").click();
    assert.equal(p.el("tab-graph").getAttribute("aria-selected"), "true");
    assert(p.node("FR-1").classList.contains("sel"));
    assert.equal(p.visible().length, 4);
    assert.equal(p.list().length, 4);
    p.el("tab-analysis").click();
    p.document.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(p.el("tab-graph").getAttribute("aria-selected"), "true");
  } finally { await p.window.happyDOM.close(); }
});

test("URL から分析タブと detail を復元し、範囲外の detail は起点へ戻す", async () => {
  for (const detail of ["QR-1", "Goal-1"]) {
    const p = page(`#node=FR-1&view=analysis&detail=${detail}`);
    try {
      assert.equal(p.el("tab-analysis").getAttribute("aria-selected"), "true");
      assert.deepEqual(p.visible(), ["FR-1", "Need-1", "QR-1"]);
      const expected = detail === "Goal-1" ? "FR-1" : detail;
      assert(p.el("detail").querySelector("h3").textContent.startsWith(expected));
      if (detail === "Goal-1") assert(!p.window.location.hash.includes("detail="));
    } finally { await p.window.happyDOM.close(); }
  }
});

test("図内でノードを選ぶと直結経路と中間ノードを経由する経路が両方強調される", async () => {
  const data = fixture();
  data.edges.push({ source: "QR-1", target: "Need-1", name: "satisfies" });
  const p = page("", data);
  try {
    p.clickNode("Need-1");
    p.el("tab-analysis").click();
    p.clickNode("QR-1");
    assert.equal(p.document.querySelectorAll(".edge.detail-path").length, 3);
    assert(p.node("FR-1").classList.contains("detail-path"));
    assert(!p.node("FR-1").classList.contains("trail-muted"));
    assert(p.node("Goal-1").classList.contains("trail-muted"));
    assert(!p.node("Goal-1").classList.contains("detail-path"));
  } finally { await p.window.happyDOM.close(); }
});
