/* 描画バックエンド: Graphviz (@hpcc-js/wasm-graphviz)。
 *
 * site_template.html に埋め込まれ、シェル側が用意した safeId / truncate /
 * isDark を使う。表示対象から DOT を組み立て、WASM の dot レイアウトで
 * SVG を得る。形状・配色は render.py の render_meta() が出典。
 *
 * DOT には選択状態を入れない。選択ハイライトは描画済み SVG への class 付与
 * だけで行うので、フィルタが変わらない限り再レイアウトは走らない。
 */
const RENDERER = {
  name: "graphviz",

  /** 本文の文字サイズ (pt)。Graphviz の SVG は 72dpi なので px と同値。 */
  fontSize: 11,
  typeSize: 9,
  fontFamily: "sans-serif",
  lineHeight: 15,

  /** 形状ごとの箱の大きさ (pt)。ラベルの実測値 (w, h) から外形を決める。
   *  六角形・楕円・菱形はラベルが角に当たるので、単純な余白では足りない。 */
  sizers: {
    box: (w, h) => [w + 24, h + 20],
    note: (w, h) => [w + 36, h + 28],
    box3d: (w, h) => [w + 40, h + 32],
    cylinder: (w, h) => [w + 40, h + 52],
    parallelogram: (w, h) => [w + 60, h + 20],
    hexagon: (w, h) => [w + h * 1.2 + 24, h + 20],
    ellipse: (w, h) => [w * 1.42 + 20, h * 1.5 + 10],
    diamond: (w, h) => [w * 1.9 + 20, h * 2.2 + 10],
  },

  async load(url) {
    const { Graphviz } = await import(new URL(url, document.baseURI).href);
    this.graphviz = await Graphviz.load();
  },

  setTheme() {
    this.lastDot = null; // 配色が変わるので組み直す
  },

  // --- ラベルの寸法 --------------------------------------------------------

  /** キャンバスで実測する。WASM の Graphviz は日本語の字幅を過小に見積もる。 */
  measure(text, size, bold) {
    if (!this.ruler) this.ruler = document.createElement("canvas").getContext("2d");
    this.ruler.font = `${bold ? "bold " : ""}${size}px ${this.fontFamily}`;
    return this.ruler.measureText(text).width;
  },

  /** 本文を折り返す。横に長い箱ばかりになるとレイアウトが平たく潰れる。 */
  wrap(text, perLine = 18) {
    const lines = [];
    let rest = text;
    while (rest.length > perLine) {
      // 半角の語の途中では切らない。日本語は語境界が無いので文字数で切る。
      const head = rest.slice(0, perLine);
      const space = head.lastIndexOf(" ");
      const cut = space > perLine * 0.5 ? space : perLine;
      lines.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    lines.push(rest);
    return lines;
  },

  /** ノードの箱の大きさ (インチ)。fixedsize=true と合わせて使う。 */
  boxSize(node, head, bodyLines, shape) {
    const labelWidth = Math.max(
      this.measure(`${node.id} `, this.fontSize, true) +
        this.measure(head, this.typeSize, false),
      ...bodyLines.map((line) => this.measure(line, this.fontSize, false)),
    );
    const labelHeight = this.lineHeight * (bodyLines.length + 1);
    const sizer = this.sizers[shape] || this.sizers.box;
    return sizer(labelWidth, labelHeight).map((size) => (size / 72).toFixed(3));
  },

  // --- DOT の組み立て ------------------------------------------------------

  escape(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  },

  buildDot(view) {
    const meta = view.meta;
    const ink = view.dark ? "#c9d1d9" : "#1f2328";
    const lines = [
      "digraph requirements {",
      `  rankdir=${view.direction === "LR" ? "LR" : "TB"};`,
      "  bgcolor=transparent; pad=0.15; nodesep=0.35; ranksep=0.6; splines=true;",
      `  node [fontname="${this.fontFamily}", fontsize=${this.fontSize},` +
        ' style=filled, fixedsize=true, fontcolor="#1f2328", penwidth=1.2];',
      `  edge [fontname="${this.fontFamily}", fontsize=9,` +
        ` color="${ink}", fontcolor="${ink}"];`,
    ];

    this.index = new Map();
    for (const node of view.nodes) {
      const key = safeId(node.id);
      this.index.set(key, node.id);
      const typeMeta = meta.types[node.type];
      const head = `[${node.type}]`;
      const body = this.wrap(truncate(node.text));
      const [width, height] = this.boxSize(node, head, body, typeMeta.dot_shape);
      const label =
        `<<B>${this.escape(node.id)}</B> ` +
        `<FONT POINT-SIZE="${this.typeSize}">${this.escape(head)}</FONT>` +
        body.map((line) => `<BR/>${this.escape(line)}`).join("") +
        ">";
      lines.push(
        `  ${key} [shape=${typeMeta.dot_shape}, fillcolor="${typeMeta.fill}",` +
          ` color="${typeMeta.stroke}", width=${width}, height=${height},` +
          ` label=${label}];`,
      );
    }

    for (const edge of view.edges) {
      const attrs = [`label=" ${edge.name} "`];
      if (meta.dashed_edges.includes(edge.name)) attrs.push("style=dashed");
      lines.push(
        `  ${safeId(edge.source)} -> ${safeId(edge.target)} [${attrs.join(", ")}];`,
      );
    }
    lines.push("}");
    return lines.join("\n");
  },

  // --- SVG の差し込みと後処理 ----------------------------------------------

  styleSheet(meta) {
    const { selected, upstream, downstream } = meta.highlight;
    const stroke = (color, width) =>
      `{ stroke: ${color}; stroke-width: ${width}; }`;
    return [
      "g.node { cursor: pointer; }",
      "g.node.dim, g.edge.dim { opacity: 0.3; }",
      `g.node.sel :is(polygon, ellipse, path) ${stroke(selected, 3)}`,
      `g.node.up :is(polygon, ellipse, path) ${stroke(upstream, 2.5)}`,
      `g.node.down :is(polygon, ellipse, path) ${stroke(downstream, 2.5)}`,
    ].join("\n");
  },

  insert(svgText, container, meta) {
    const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svg = document.importNode(parsed.documentElement, true);
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = this.styleSheet(meta);
    svg.insertBefore(style, svg.firstChild);
    container.replaceChildren(svg);
  },

  titleOf(element) {
    const title = element.querySelector(":scope > title");
    return title ? title.textContent : "";
  },

  /** 選択ノード・上流・下流を class で塗り分ける (再レイアウト無し)。 */
  applyHighlight(container, view) {
    const svg = container.querySelector("svg");
    if (!svg) return;
    const inScope = (id) =>
      id === view.selected || view.upstream.has(id) || view.downstream.has(id);

    for (const group of svg.querySelectorAll("g.node")) {
      const id = this.index.get(this.titleOf(group));
      group.classList.remove("sel", "up", "down", "dim");
      if (!view.selected) continue;
      if (id === view.selected) group.classList.add("sel");
      else if (view.upstream.has(id)) group.classList.add("up");
      else if (view.downstream.has(id)) group.classList.add("down");
      else group.classList.add("dim");
    }
    for (const group of svg.querySelectorAll("g.edge")) {
      const [from, to] = this.titleOf(group).split("->");
      const linked =
        inScope(this.index.get(from)) && inScope(this.index.get(to));
      group.classList.toggle("dim", Boolean(view.selected) && !linked);
    }
  },

  bindClicks(container, onSelect) {
    if (this.bound === container) return;
    this.bound = container;
    container.addEventListener("click", (event) => {
      const group = event.target.closest("g.node");
      if (!group) return;
      const id = this.index.get(this.titleOf(group));
      if (id) onSelect(id);
    });
  },

  async render(view, container) {
    const dot = this.buildDot(view);
    let relayout = false;
    if (dot !== this.lastDot || !container.querySelector("svg")) {
      this.insert(this.graphviz.layout(dot, "svg", "dot"), container, view.meta);
      this.lastDot = dot;
      relayout = true;
    }
    this.applyHighlight(container, view);
    this.bindClicks(container, view.onSelect);
    return { relayout };
  },
};
