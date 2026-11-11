import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { Element } from "happy-dom";
import {
  HTMLButtonElement,
  HTMLElement,
  HTMLInputElement,
  HTMLSelectElement,
  Window,
} from "happy-dom";
import type { SiteData } from "../../src/reqmodel/presentation/site_types.ts";
import { fixture } from "./fixture.ts";

const template = await readFile(
  new URL("../../src/reqmodel/presentation/site_template.html", import.meta.url),
  "utf8",
);
const bundle = await readFile(
  new URL("../../src/reqmodel/presentation/site_bundle.js", import.meta.url),
  "utf8",
);

// Layout geometry has separate tests. Here a deterministic layout lets us detect
// unintended relayouts while exercising the real bundled DOM event handlers.
class LayoutGraph {
  items = new Map<string, { width: number; height: number; x: number; y: number }>();
  setGraph() {}
  setDefaultEdgeLabel() {}
  setNode(id: string, size: { width: number; height: number }) {
    this.items.set(id, { ...size, x: this.items.size * 220, y: 100 });
  }
  setEdge() {}
  nodes() {
    return [...this.items.keys()];
  }
  node(id: string) {
    return this.items.get(id);
  }
}

/** あるはずの要素。無ければテンプレートか bundle の食い違いなので、その場で落とす。 */
function present<T>(found: T | null, what: string): T {
  if (found === null) throw new Error(`要素が無い: ${what}`);
  return found;
}

/** 要素の種類を確かめてから使う。 */
function ofType<T extends Element>(element: Element, type: abstract new () => T): T {
  if (!(element instanceof type)) throw new Error(`${type.name} ではない: ${element.tagName}`);
  return element;
}

function page(hash = "", dataOverride: SiteData | null = null) {
  const window = new Window({ url: `http://localhost/${hash}` });
  const data = dataOverride || fixture();
  data.findings = [
    { code: "W001", severity: "warning", message: "影響範囲内", layer: 1, node_id: "QR-1" },
    { code: "W002", severity: "warning", message: "影響範囲外", layer: 1, node_id: "Goal-1" },
  ];
  window.document.write(
    template
      .replaceAll("__TITLE__", "テスト")
      .replace("__DATA__", JSON.stringify(data))
      .replace("__SCRIPTS__", "")
      .replace("__APP_JS__", ""),
  );
  let layouts = 0;
  Object.assign(window, {
    dagre: {
      graphlib: { Graph: LayoutGraph },
      layout: () => {
        layouts++;
      },
    },
  });
  window.eval(bundle);
  const document = window.document;
  //: 無いことを確かめる用。あるはずの要素は el() で引く。
  const find = (id: string) => document.getElementById(id);
  const el = (id: string) => ofType(present(find(id), `#${id}`), HTMLElement);
  const button = (id: string) => ofType(el(id), HTMLButtonElement);
  const input = (id: string) => ofType(el(id), HTMLInputElement);
  const query = (selector: string, root: Element = document.documentElement) =>
    present(root.querySelector(selector), selector);
  const node = (id: string) => query(`[data-node-id="${id}"]`);
  const clickNode = (id: string) =>
    node(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const change = (id: string, value: string) => {
    const target = ofType(el(id), HTMLSelectElement);
    target.value = value;
    target.dispatchEvent(new window.Event("change"));
  };
  const attribute = (element: Element, name: string) =>
    present(element.getAttribute(name), `${element.tagName}[${name}]`);
  const visible = () =>
    [...document.querySelectorAll("[data-node-id]:not(.hidden)")]
      .map((n) => attribute(n, "data-node-id"))
      .sort();
  const list = () =>
    [...el("node-list").querySelectorAll("button[data-id]")]
      .map((n) => attribute(n, "data-id"))
      .sort();
  const positions = () =>
    [...document.querySelectorAll("[data-node-id]")].map((n) => n.getAttribute("transform"));
  const htmlQuery = (selector: string, root?: Element) =>
    ofType(query(selector, root), HTMLElement);
  const camera = () => query(".graph-layer").getAttribute("transform");
  const text = (element: Element) => element.textContent ?? "";
  return {
    window,
    document,
    find,
    el,
    button,
    input,
    query,
    htmlQuery,
    text,
    node,
    clickNode,
    change,
    visible,
    list,
    positions,
    camera,
    layouts: () => layouts,
  };
}

test("初期描画でノードの図形に配色と寸法が入る", async () => {
  const p = page();
  try {
    //: 図の DOM を組む時点でテーマ適用が効いていないと、ラベルだけが描かれクリックできない。
    const shape = p.query(".node-shape", p.node("Goal-1"));
    assert.ok(shape.getAttribute("fill"));
    assert.ok(Number(shape.getAttribute("rx")) > 0);
  } finally {
    await p.window.happyDOM.close();
  }
});

test("分析タブは図だけを上流・下流に絞り、一覧から起点を変更できる", async () => {
  const p = page();
  try {
    assert(p.button("tab-analysis").disabled);
    p.clickNode("FR-1");
    p.change("focus", "2");
    assert(p.visible().includes("Goal-1"));
    p.el("tab-analysis").click();
    assert.equal(p.el("tab-analysis").getAttribute("aria-selected"), "true");
    assert(p.el("focus-control").hidden);
    assert.deepEqual(p.visible(), ["FR-1", "Need-1", "QR-1"]);
    assert.equal(p.list().length, 4);
    assert.equal(p.find("analysis-direction"), null);
    assert.equal(p.find("focus-status-text"), null);
    assert(!p.text(p.el("legend")).includes("フォーカス"));
    assert.deepEqual(
      [...p.document.querySelectorAll(".band:not(.hidden)")].map((n) => n.textContent),
      ["上流", "下流"],
    );
    p.htmlQuery('[data-id="Goal-1"]', p.el("node-list")).click();
    assert(p.node("Goal-1").classList.contains("sel"));
    assert.deepEqual(p.visible(), ["Goal-1", "Need-1"]);
    assert.equal(p.list().length, 4);
    assert.deepEqual(
      [...p.document.querySelectorAll(".band:not(.hidden)")].map((n) => n.textContent),
      ["下流"],
    );
    p.input("search").value = "QR-1";
    p.el("search").dispatchEvent(new p.window.Event("input"));
    p.el("search").dispatchEvent(
      new p.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    assert(p.node("QR-1").classList.contains("sel"));
    assert.deepEqual(p.visible(), ["FR-1", "Need-1", "QR-1"]);
  } finally {
    await p.window.happyDOM.close();
  }
});

test("分析中のクリックは起点と範囲・配置・倍率を維持し detail と経路だけを変える", async () => {
  const p = page();
  try {
    p.clickNode("FR-1");
    p.el("tab-analysis").click();
    p.el("zoom-in").click();
    const before = {
      visible: p.visible(),
      positions: p.positions(),
      camera: p.camera(),
      layouts: p.layouts(),
    };
    p.clickNode("QR-1");
    assert(p.text(p.query("h3", p.el("detail"))).startsWith("QR-1"));
    assert(p.node("FR-1").classList.contains("sel"));
    assert(p.node("QR-1").classList.contains("detail-target"));
    assert.equal(p.document.querySelectorAll(".edge.detail-path").length, 1);
    assert.deepEqual(
      { visible: p.visible(), positions: p.positions(), camera: p.camera(), layouts: p.layouts() },
      before,
    );
    p.query("#graph svg").dispatchEvent(new p.window.MouseEvent("click", { bubbles: true }));
    assert(p.text(p.query("h3", p.el("detail"))).startsWith("QR-1"));
    assert.equal(p.find("exit-focus"), null);
    p.el("tab-graph").click();
    assert.equal(p.el("tab-graph").getAttribute("aria-selected"), "true");
    assert(p.node("FR-1").classList.contains("sel"));
    assert.equal(p.visible().length, 4);
    assert.equal(p.list().length, 4);
    p.el("tab-analysis").click();
    p.document.dispatchEvent(
      new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(p.el("tab-graph").getAttribute("aria-selected"), "true");
  } finally {
    await p.window.happyDOM.close();
  }
});

test("URL から分析タブと detail を復元し、範囲外の detail は起点へ戻す", async () => {
  for (const detail of ["QR-1", "Goal-1"]) {
    const p = page(`#node=FR-1&view=analysis&detail=${detail}`);
    try {
      assert.equal(p.el("tab-analysis").getAttribute("aria-selected"), "true");
      assert.deepEqual(p.visible(), ["FR-1", "Need-1", "QR-1"]);
      const expected = detail === "Goal-1" ? "FR-1" : detail;
      assert(p.text(p.query("h3", p.el("detail"))).startsWith(expected));
      if (detail === "Goal-1") assert(!p.window.location.hash.includes("detail="));
    } finally {
      await p.window.happyDOM.close();
    }
  }
});

test("図内でノードを選ぶと直結経路と中間ノードを経由する経路が両方強調される", async () => {
  const data = fixture();
  data.edges = [...data.edges, { source: "QR-1", target: "Need-1", name: "satisfies" }];
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
  } finally {
    await p.window.happyDOM.close();
  }
});
