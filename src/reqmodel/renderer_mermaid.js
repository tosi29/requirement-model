/* 描画バックエンド: Mermaid (UMD ビルド)。
 *
 * site_template.html に埋め込まれ、シェル側が用意した safeId / truncate /
 * isDark を使う。フィルタや選択のたびに flowchart を組み直して再描画する。
 */
const RENDERER = {
  name: "mermaid",
  seq: 0,

  async load(url) {
    await new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = url;
      tag.onload = resolve;
      tag.onerror = () => reject(new Error(`読み込めなかった: ${url}`));
      document.head.appendChild(tag);
    });
    if (!window.mermaid) throw new Error("mermaid が見つからない");
    this.mermaid = window.mermaid;
    this.mermaid.initialize(this.config());
  },

  config() {
    return {
      startOnLoad: false,
      securityLevel: "loose",
      theme: isDark() ? "dark" : "default",
      flowchart: { useMaxWidth: false, htmlLabels: true },
    };
  },

  setTheme() {
    if (this.mermaid) this.mermaid.initialize(this.config());
  },

  escapeLabel(text) {
    return text
      .replace(/\\/g, "＼")
      .replace(/"/g, "#quot;")
      .replace(/</g, "#lt;")
      .replace(/>/g, "#gt;");
  },

  /** 表示対象のノード・エッジから flowchart の定義を組み立てる。 */
  buildSource(view) {
    const meta = view.meta;
    const lines = [`flowchart ${view.direction}`];

    for (const node of view.nodes) {
      const [open, close] = meta.types[node.type].shape;
      const label = `<b>${node.id}</b> [${node.type}]<br/>${this.escapeLabel(truncate(node.text))}`;
      lines.push(`  ${safeId(node.id)}${open}"${label}"${close}`);
    }
    for (const edge of view.edges) {
      const arrow = meta.edge_arrows[edge.name] || meta.default_arrow;
      lines.push(`  ${safeId(edge.source)} ${arrow}|${edge.name}| ${safeId(edge.target)}`);
    }
    for (const [type, typeMeta] of Object.entries(meta.types)) {
      lines.push(`  classDef ${type} ${typeMeta.style}`);
    }
    for (const node of view.nodes) lines.push(`  class ${safeId(node.id)} ${node.type}`);

    if (view.selected) {
      lines.push(`  classDef sel stroke:${meta.highlight.selected},stroke-width:4px`);
      lines.push(`  classDef up stroke:${meta.highlight.upstream},stroke-width:2.5px`);
      lines.push(`  classDef down stroke:${meta.highlight.downstream},stroke-width:2.5px`);
      lines.push("  classDef dim opacity:0.35");
      for (const node of view.nodes) {
        if (node.id === view.selected) lines.push(`  class ${safeId(node.id)} sel`);
        else if (view.upstream.has(node.id)) lines.push(`  class ${safeId(node.id)} up`);
        else if (view.downstream.has(node.id)) lines.push(`  class ${safeId(node.id)} down`);
        else lines.push(`  class ${safeId(node.id)} dim`);
      }
    }
    for (const node of view.nodes) {
      lines.push(`  click ${safeId(node.id)} call selectNode("${node.id}")`);
    }
    return lines.join("\n");
  },

  async render(view, container) {
    const source = this.buildSource(view);
    const { svg, bindFunctions } = await this.mermaid.render(`svg-${++this.seq}`, source);
    container.innerHTML = svg;
    if (bindFunctions) bindFunctions(container);
    // 選択の有無にかかわらず全体を組み直すため、常に再レイアウトになる。
    return { relayout: true };
  },
};
