(() => {
  // src/reqmodel/presentation/site_text.js
  function truncate(text, limit = 42) {
    return text.length > limit ? text.slice(0, limit - 1) + "\u2026" : text;
  }
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(text) {
    return escapeHtml(String(text)).replace(/"/g, "&quot;");
  }
  var LABEL_FONT = {
    size: 10,
    lineHeight: 1.25,
    family: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", "Segoe UI", sans-serif'
  };
  var LABEL_MAX_LENGTH = 60;
  var LABEL_WRAP_WIDTH = 160;
  var WIDE_CHAR = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;
  function estimateTextWidth(text, fontSize = LABEL_FONT.size) {
    let width = 0;
    for (const char of text) width += (WIDE_CHAR.test(char) ? 1 : 0.55) * fontSize;
    return width;
  }
  var NO_LINE_START = "\u3001\u3002\uFF0C\uFF0E,.)\uFF09\u3015\uFF3D\uFF5D\u300D\u300F\u3009\u300B!?\uFF01\uFF1F:\uFF1A;\uFF1B\u30FB\u2026\u2025\u30FC\u301C%\uFF05";
  var NO_LINE_END = "(\uFF08\u3014\uFF3B\uFF5B\u300C\u300E\u3008\u300A";
  var WORD_RUN = /^[0-9A-Za-z]+(?:[.,\-_/][0-9A-Za-z]+)*[%％]?/;
  var NUMBER = /^[0-9]+(?:[.,][0-9]+)*[%％]?$/;
  var HAS_CONTENT = /[A-Za-z\u3041-\u30ff\u3400-\u9fff]/;
  var charClass = (char) => {
    if (/\s/.test(char)) return "space";
    if (/[0-9A-Za-z]/.test(char)) return "word";
    if (/[\u3041-\u309f]/.test(char)) return "kana";
    if (/[\u30a1-\u30ff\uff66-\uff9f]/.test(char)) return "kata";
    if (/[\u3005\u3006\u3400-\u9fff]/.test(char)) return "kanji";
    return "other";
  };
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
  function joins(last, token) {
    if (!last) return true;
    if (NO_LINE_START.includes([...token.text][0])) return true;
    if (NO_LINE_END.includes(last.text.slice(-1))) return true;
    if (token.cls === "kana") return ["kanji", "kata", "word"].includes(last.cls);
    if (token.cls === "word") return ["kanji", "kata"].includes(last.cls);
    if (NUMBER.test(last.text)) return ["kanji", "kata", "word"].includes(token.cls);
    return false;
  }
  function labelChunks(text) {
    const tokens = tokenize(text);
    const chunks = [];
    let current = "";
    let last = null;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.cls === "space") {
        const next = tokens[i + 1];
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
  function hardSplit(text, maxWidth, measure) {
    let head = "";
    for (const char of text) {
      if (head && measure(head + char) > maxWidth) break;
      head += char;
    }
    return head === text ? null : { head, tail: text.slice(head.length) };
  }
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
  function wrapLabel(text, maxWidth = LABEL_WRAP_WIDTH, measure = estimateTextWidth) {
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
  var DEFAULT_FIT = { wmul: 1, wpad: 20, hmul: 1, hpad: 14 };
  function nodeSize(label, fit, measure = estimateTextWidth) {
    const lines = label.split("\n");
    const textWidth = Math.max(...lines.map((line) => measure(line)));
    const textHeight = lines.length * LABEL_FONT.size * LABEL_FONT.lineHeight;
    const box = fit || DEFAULT_FIT;
    return {
      w: Math.round(textWidth * box.wmul + box.wpad),
      h: Math.round(textHeight * box.hmul + box.hpad)
    };
  }

  // src/reqmodel/presentation/site_graph.js
  function createView(data, state2) {
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    const nodes = data.nodes.filter(
      (node) => state2.types.has(node.type) && (!state2.statuses || state2.statuses.has(node.status))
    );
    const shown = new Set(nodes.map((node) => node.id));
    const edges = data.edges.filter(
      (edge) => state2.edges.has(edge.name) && shown.has(edge.source) && shown.has(edge.target)
    );
    const order = new Map(data.nodes.map((node, index) => [node.id, index]));
    return { data, state: state2, byId, nodes, edges, order, adjacency: buildAdjacency(nodes, edges) };
  }
  function buildAdjacency(nodes, edges) {
    const adjacency = /* @__PURE__ */ new Map();
    for (const node of nodes) adjacency.set(node.id, { out: [], in: [] });
    for (const edge of edges) {
      adjacency.get(edge.source).out.push(edge.target);
      adjacency.get(edge.target).in.push(edge.source);
    }
    return adjacency;
  }
  var countBy = (nodes, keyOf) => {
    const counts = /* @__PURE__ */ new Map();
    for (const node of nodes) counts.set(keyOf(node), (counts.get(keyOf(node)) || 0) + 1);
    return counts;
  };
  var FIELD_LABELS = Object.freeze({
    source: "\u51FA\u5178",
    realized_by: "\u5B9F\u73FE\u624B\u6BB5",
    evidence: "\u8A3C\u8DE1",
    status: "\u30B9\u30C6\u30FC\u30BF\u30B9"
  });
  var fieldLabel = (name) => FIELD_LABELS[name] || name;
  var statusNames = (data) => Object.keys((data.meta || {}).statuses || {});
  function statusFilters(data) {
    const counts = countBy(data.nodes, (node) => node.status);
    return statusNames(data).map((status) => ({
      key: status,
      label: status,
      count: counts.get(status) || 0
    }));
  }
  function hiddenByDefault(data, key) {
    return ((data || {}).hidden_by_default || {})[key] || [];
  }
  function initialSelection(data, all, key) {
    const hidden = new Set(hiddenByDefault(data, key));
    return all.filter((name) => !hidden.has(name));
  }
  function edgeSelection(view2) {
    const all = view2.data.edge_names;
    const selected = all.filter((name) => view2.state.edges.has(name));
    if (selected.length === all.length) return "all";
    const initial = initialSelection(view2.data, all, "edges");
    if (selected.length === initial.length && initial.every((name) => view2.state.edges.has(name))) {
      return "default";
    }
    return selected;
  }
  function walk(view2, start, direction, depth = null) {
    const seen = /* @__PURE__ */ new Set();
    if (!view2.adjacency.has(start)) return seen;
    let frontier = [start];
    for (let step = 0; frontier.length && (depth === null || step < depth); step++) {
      const next = [];
      for (const id of frontier) {
        const links = view2.adjacency.get(id);
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
  function reach(view2, start, forward, depth = null) {
    return walk(view2, start, forward ? "out" : "in", depth);
  }
  function related(view2, start, depth = null) {
    return walk(view2, start, "both", depth);
  }
  var IMPACT_DEPTHS = [1, 2, 3, 4, 5];
  function impactScope(state2) {
    const depth = (state2 || {}).depth;
    return {
      depth: IMPACT_DEPTHS.includes(depth) ? depth : null,
      undirected: Boolean((state2 || {}).undirected)
    };
  }
  function impactSets(view2, id, scope = null) {
    const { depth, undirected } = scope || impactScope(view2.state);
    if (undirected) {
      const neighbours = related(view2, id, depth);
      return {
        upstream: /* @__PURE__ */ new Set(),
        downstream: neighbours,
        whole: /* @__PURE__ */ new Set([id, ...neighbours]),
        undirected: true
      };
    }
    const upstream = reach(view2, id, false, depth);
    const downstream = reach(view2, id, true, depth);
    return {
      upstream,
      downstream,
      whole: /* @__PURE__ */ new Set([id, ...upstream, ...downstream]),
      undirected: false
    };
  }
  var FOCUS_DEPTHS = [1, 2, 3];
  function focusSet(view2, start, depth) {
    if (!view2.adjacency.has(start)) return /* @__PURE__ */ new Set();
    return /* @__PURE__ */ new Set([start, ...related(view2, start, depth)]);
  }
  var MISSING_RANK = 10 ** 6;
  var rankOf = (view2, id) => view2.order.has(id) ? view2.order.get(id) : MISSING_RANK;
  var compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  // src/reqmodel/presentation/site_table.js
  var TABLE_COLUMNS = [
    { key: "id", label: "id" },
    { key: "type", label: "type" },
    { key: "text", label: "\u672C\u6587" },
    { key: "status", label: fieldLabel("status") },
    { key: "evidence", label: "\u6839\u62E0", numeric: true },
    { key: "findings", label: "\u6307\u6458", numeric: true }
  ];
  var SEVERITY_ORDER = ["error", "severe", "warning", "info"];
  function matchesQuery(node, query) {
    const needle = (query || "").trim().toLowerCase();
    if (!needle) return true;
    return node.id.toLowerCase().includes(needle) || node.text.toLowerCase().includes(needle);
  }
  function searchHits(view2, query) {
    if (!(query || "").trim()) return [];
    return view2.nodes.filter((node) => matchesQuery(node, query)).map((node) => node.id);
  }
  function stepHit(hits2, current, delta) {
    if (!hits2.length) return null;
    const at = hits2.indexOf(current);
    if (at < 0) return delta > 0 ? hits2[0] : hits2[hits2.length - 1];
    return hits2[(at + delta + hits2.length) % hits2.length];
  }
  function tableRows(view2, query = "") {
    const counts = /* @__PURE__ */ new Map();
    const worst = /* @__PURE__ */ new Map();
    for (const finding of view2.data.findings || []) {
      if (!finding.node_id) continue;
      counts.set(finding.node_id, (counts.get(finding.node_id) || 0) + 1);
      const rank = SEVERITY_ORDER.indexOf(finding.severity);
      const known = worst.get(finding.node_id);
      if (rank >= 0 && (known === void 0 || rank < known)) {
        worst.set(finding.node_id, rank);
      }
    }
    return view2.nodes.filter((node) => matchesQuery(node, query)).map((node) => ({
      id: node.id,
      type: node.type,
      text: node.text,
      status: node.status,
      evidence: (node.evidence || []).length,
      findings: counts.get(node.id) || 0,
      severity: worst.has(node.id) ? SEVERITY_ORDER[worst.get(node.id)] : null
    }));
  }
  var MISSING_VALUE = Number.POSITIVE_INFINITY;
  function sortValue(view2, row, key) {
    switch (key) {
      case "type":
        return view2.data.types.indexOf(row.type);
      case "status": {
        const rank = (view2.data.status_rank || {})[row.status];
        return rank === void 0 ? MISSING_VALUE : rank;
      }
      default:
        return row[key];
    }
  }
  function sortRows(view2, rows, sort) {
    const sign = sort.asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = sortValue(view2, a, sort.key);
      const right = sortValue(view2, b, sort.key);
      let diff = 0;
      if (left === MISSING_VALUE && right !== MISSING_VALUE) diff = 1;
      else if (right === MISSING_VALUE && left !== MISSING_VALUE) diff = -1;
      else diff = sign * compare(left, right);
      return diff || rankOf(view2, a.id) - rankOf(view2, b.id);
    });
  }
  function nextSort(sort, key) {
    const column = TABLE_COLUMNS.find((item) => item.key === key);
    if (!column) return sort;
    if (sort.key === key) return { key, asc: !sort.asc };
    return { key, asc: !column.numeric };
  }
  function edgeItems(view2, id) {
    const item = (edge, direction) => {
      const other = direction === "out" ? edge.target : edge.source;
      const node = view2.byId.get(other);
      return {
        id: other,
        name: edge.name,
        direction,
        arrow: direction === "out" ? `--${edge.name}-->` : `<--${edge.name}--`,
        type: node ? node.type : "",
        text: node ? node.text : ""
      };
    };
    return {
      out: view2.edges.filter((edge) => edge.source === id).map((edge) => item(edge, "out")),
      in: view2.edges.filter((edge) => edge.target === id).map((edge) => item(edge, "in"))
    };
  }
  function sourceUrl(data, location2) {
    const repo = (data || {}).repo;
    if (!repo || !repo.url || !location2) return null;
    const match = /^(.+?)(?::(\d+))?$/.exec(String(location2).trim());
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
  var ALL_SEVERITIES = "all";
  function severityTabs(findings) {
    const counts = /* @__PURE__ */ new Map();
    for (const finding of findings) {
      counts.set(finding.severity, (counts.get(finding.severity) || 0) + 1);
    }
    return [
      { key: ALL_SEVERITIES, label: "\u3059\u3079\u3066", count: findings.length },
      ...SEVERITY_ORDER.filter((severity) => counts.get(severity)).map((severity) => ({
        key: severity,
        label: severity,
        count: counts.get(severity)
      }))
    ];
  }
  function groupFindings(findings, severity = ALL_SEVERITIES) {
    const groups = /* @__PURE__ */ new Map();
    for (const finding of findings) {
      if (severity !== ALL_SEVERITIES && finding.severity !== severity) continue;
      if (!groups.has(finding.code)) groups.set(finding.code, []);
      groups.get(finding.code).push(finding);
    }
    const severityRank = (finding) => {
      const at = SEVERITY_ORDER.indexOf(finding.severity);
      return at < 0 ? SEVERITY_ORDER.length : at;
    };
    return [...groups.entries()].map(([code, items]) => ({ code, items, rank: Math.min(...items.map(severityRank)) })).sort((a, b) => a.rank - b.rank || compare(a.code, b.code)).map(({ code, items, rank }) => ({
      code,
      items,
      severity: SEVERITY_ORDER[rank] || items[0].severity
    }));
  }

  // src/reqmodel/presentation/site_state.js
  var DEFAULT_SORT = { key: "id", asc: true };
  var SET_FILTERS = [
    {
      param: "types",
      key: "types",
      all: (data) => data.types,
      initial: (data) => initialSelection(data, data.types, "types")
    },
    {
      param: "edges",
      key: "edges",
      all: (data) => data.edge_names,
      initial: (data) => initialSelection(data, data.edge_names, "edges")
    },
    { param: "status", key: "statuses", all: (data) => statusNames(data) }
  ];
  var initialOf = (filter, data) => filter.initial ? filter.initial(data) : filter.all(data);
  function defaultState(data) {
    const state2 = {
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
      sort: { ...DEFAULT_SORT }
    };
    for (const filter of SET_FILTERS) state2[filter.key] = new Set(initialOf(filter, data));
    return state2;
  }
  function encodeHash(state2, data) {
    const params = [];
    const put = (key, value) => params.push(`${key}=${value}`);
    const list = (selected, all) => all.filter((name) => selected.has(name)).map(encodeURIComponent).join(",");
    const sort = state2.sort || DEFAULT_SORT;
    const query = (state2.query || "").trim();
    if (state2.selected) put("node", encodeURIComponent(state2.selected));
    for (const filter of SET_FILTERS) {
      const selected = state2[filter.key];
      const all = filter.all(data);
      if (!selected) continue;
      const initial = initialOf(filter, data);
      if (selected.size === initial.length && initial.every((name) => selected.has(name))) {
        continue;
      }
      put(filter.param, list(selected, all));
    }
    if (state2.direction === "LR") put("dir", "LR");
    if (state2.mode === "table") put("view", "table");
    if (FOCUS_DEPTHS.includes(state2.focus)) put("focus", String(state2.focus));
    if (IMPACT_DEPTHS.includes(state2.depth)) put("depth", String(state2.depth));
    if (state2.undirected) put("undir", "1");
    if (query) put("q", encodeURIComponent(query));
    if (sort.key !== DEFAULT_SORT.key || sort.asc !== DEFAULT_SORT.asc) {
      put("sort", `${sort.key}:${sort.asc ? "asc" : "desc"}`);
    }
    return params.length ? `#${params.join("&")}` : "";
  }
  function decodeHash(hash, data) {
    const state2 = defaultState(data);
    const params = parseHash(hash);
    const subset = (raw, all) => new Set(raw.split(",").map((name) => name.trim()).filter((name) => all.includes(name)));
    const node = params.get("node");
    if (node && data.nodes.some((item) => item.id === node)) state2.selected = node;
    for (const filter of SET_FILTERS) {
      if (!params.has(filter.param)) continue;
      state2[filter.key] = subset(params.get(filter.param), filter.all(data));
    }
    if (params.get("dir") === "LR") state2.direction = "LR";
    if (params.get("view") === "table") state2.mode = "table";
    const focus = Number(params.get("focus"));
    if (FOCUS_DEPTHS.includes(focus)) state2.focus = focus;
    const depth = Number(params.get("depth"));
    if (IMPACT_DEPTHS.includes(depth)) state2.depth = depth;
    if (params.get("undir") === "1") state2.undirected = true;
    if (params.has("q")) state2.query = params.get("q");
    const sort = parseSort(params.get("sort"));
    if (sort) state2.sort = sort;
    return state2;
  }
  function parseHash(hash) {
    const params = /* @__PURE__ */ new Map();
    for (const part of (hash || "").replace(/^#/, "").split("&")) {
      if (!part) continue;
      const at = part.indexOf("=");
      try {
        params.set(
          decodeURIComponent(at < 0 ? part : part.slice(0, at)),
          at < 0 ? "" : decodeURIComponent(part.slice(at + 1))
        );
      } catch {
      }
    }
    return params;
  }
  function parseSort(raw) {
    if (!raw) return null;
    const [key, order] = raw.split(":");
    if (!TABLE_COLUMNS.some((column) => column.key === key)) return null;
    if (order !== "asc" && order !== "desc") return null;
    return { key, asc: order === "asc" };
  }
  var VIEW_STORAGE_KEY = "reqmodel:site:view";
  var THEME_STORAGE_KEY = "reqmodel:site:theme";
  function storableHash(state2, data) {
    return encodeHash({ ...state2, selected: null, query: "" }, data);
  }
  function initialHash(hash, stored) {
    return (hash || "").replace(/^#/, "") ? hash : stored || "";
  }
  var THEMES = ["auto", "light", "dark"];
  var THEME_LABELS = { auto: "\u30C6\u30FC\u30DE: \u81EA\u52D5", light: "\u30C6\u30FC\u30DE: \u660E", dark: "\u30C6\u30FC\u30DE: \u6697" };
  var normalizeTheme = (value) => THEMES.includes(value) ? value : "auto";
  function nextTheme(theme2) {
    return THEMES[(THEMES.indexOf(normalizeTheme(theme2)) + 1) % THEMES.length];
  }

  // src/reqmodel/presentation/site_context.js
  function describe(view2, id, inlineSources = true) {
    const node = view2.byId.get(id);
    const attrs = [`status=${node.status}`];
    const lines = [`- [${node.type}] ${node.id}: ${node.text}`, `    (${attrs.join(", ")})`];
    const pushReference = (label, item) => {
      lines.push(`    ${label}: ${item.title} <${item.url}>`);
      if (item.note) lines.push(`      note: ${item.note}`);
    };
    for (const item of node.source || []) pushReference("Source", item);
    for (const item of node.realized_by || []) pushReference("Realized by", item);
    for (const item of node.evidence || []) pushReference("Evidence", item);
    for (const criterion of node.acceptance_criteria || []) {
      lines.push(`    \u53D7\u3051\u5165\u308C\u57FA\u6E96: ${criterion}`);
    }
    return lines;
  }
  function allEdgeNames(data) {
    const names = [];
    for (const node of data.nodes) {
      for (const name of data.edge_names_by_type[node.type] || []) {
        if (!names.includes(name)) names.push(name);
      }
    }
    return names;
  }
  function explainCommand(view2, id, scope = null) {
    const { depth, undirected } = scope || impactScope(view2.state);
    const selection = edgeSelection(view2);
    const parts = [`req explain ${id}`];
    if (Array.isArray(selection)) parts.push(`--edges ${selection.join(",")}`);
    if (depth !== null) parts.push(`--depth ${depth}`);
    if (undirected) parts.push("--undirected");
    return parts.join(" ");
  }
  function nodeContext(view2, id, scope = null) {
    const settings = scope || impactScope(view2.state);
    const selection = edgeSelection(view2);
    const edgeFilter = Array.isArray(selection) ? selection : null;
    const includeSources = false;
    const { upstream, downstream, whole, undirected } = impactSets(view2, id, settings);
    const lines = [`# \u5F71\u97FF\u90E8\u5206\u30B0\u30E9\u30D5: ${id}`, ""];
    if (undirected) {
      lines.push(
        `\u5BFE\u8C61 ${whole.size - downstream.size} \u4EF6 / \u95A2\u9023 ${downstream.size} \u4EF6 / \u5408\u8A08 ${whole.size} \u4EF6`
      );
      lines.push("\u63A2\u7D22\u65B9\u5411: \u7121\u5411 (\u30A8\u30C3\u30B8\u306E\u5411\u304D\u3092\u7121\u8996)");
    } else {
      lines.push(
        `\u5BFE\u8C61 1 \u4EF6 / \u4E0A\u6D41 ${upstream.size} \u4EF6 / \u4E0B\u6D41 ${downstream.size} \u4EF6 / \u5408\u8A08 ${whole.size} \u4EF6`
      );
    }
    if (edgeFilter) lines.push(`\u30A8\u30C3\u30B8\u7A2E\u5225\u30D5\u30A3\u30EB\u30BF: ${edgeFilter.join(", ")}`);
    if (settings.depth !== null) lines.push(`\u63A2\u7D22\u6DF1\u3055: ${settings.depth}`);
    const block = (title, ids) => {
      const sorted = [...ids].sort((a, b) => rankOf(view2, a) - rankOf(view2, b));
      if (!sorted.length) return;
      lines.push("", `## ${title} (${sorted.length} \u4EF6)`);
      for (const nodeId of sorted) lines.push(...describe(view2, nodeId, !includeSources));
    };
    block("\u5BFE\u8C61\u30CE\u30FC\u30C9", [id]);
    if (undirected) {
      block("\u95A2\u9023\u30CE\u30FC\u30C9 (\u5411\u304D\u3092\u554F\u308F\u305A\u7E4B\u304C\u3063\u3066\u3044\u308B\u30CE\u30FC\u30C9)", downstream);
    } else {
      block("\u4E0A\u6D41 (\u3053\u306E\u5909\u66F4\u306E\u7406\u7531\u30FB\u6839\u62E0\u306B\u306A\u308B\u30CE\u30FC\u30C9)", upstream);
      block("\u4E0B\u6D41 (\u3053\u306E\u5909\u66F4\u306E\u5F71\u97FF\u3092\u53D7\u3051\u308B\u30CE\u30FC\u30C9)", downstream);
    }
    const edges = view2.data.edges.filter(
      (edge) => whole.has(edge.source) && whole.has(edge.target)
    );
    if (edges.length) {
      lines.push("", `## \u90E8\u5206\u30B0\u30E9\u30D5\u306E\u30A8\u30C3\u30B8 (${edges.length} \u4EF6)`);
      const sorted = [...edges].sort(
        (a, b) => rankOf(view2, a.source) - rankOf(view2, b.source) || compare(a.name, b.name) || compare(a.target, b.target)
      );
      for (const edge of sorted) {
        lines.push(`- ${edge.source} --${edge.name}--> ${edge.target}`);
      }
    }
    const hidden = new Set(
      edgeFilter || includeSources ? [] : hiddenByDefault(view2.data, "edges")
    );
    const unused = allEdgeNames(view2.data).filter(
      (name) => !hidden.has(name) && !edges.some((edge) => edge.name === name)
    );
    if (unused.length) {
      lines.push("", `(\u90E8\u5206\u30B0\u30E9\u30D5\u306B\u73FE\u308C\u306A\u304B\u3063\u305F\u30A8\u30C3\u30B8\u7A2E\u5225: ${unused.join(", ")})`);
    }
    return lines.join("\n") + "\n";
  }

  // src/reqmodel/presentation/site_layout.js
  var REQUIREMENT_TYPES = /* @__PURE__ */ new Set([
    "FunctionalRequirement",
    "QualityRequirement",
    "Constraint"
  ]);
  function bandDefs(data) {
    const top = ((data.meta || {}).bands || []).filter((band) => data.nodes.some((node) => node.type === band.type)).map((band) => ({ ...band, key: band.type }));
    if (!Object.prototype.hasOwnProperty.call(data, "requirement_groups")) return top;
    const groups = [...data.requirement_groups || []].sort(
      (a, b) => (a.order || 0) - (b.order || 0) || compare(a.id, b.id)
    );
    const assigned = /* @__PURE__ */ new Set();
    const requirementIds = new Set(
      data.nodes.filter((node) => REQUIREMENT_TYPES.has(node.type)).map((node) => node.id)
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
          members
        });
      }
    }
    const unclassified = [...requirementIds].filter((id) => !assigned.has(id));
    if (unclassified.length) {
      requirementBands.push({
        key: "group:__unclassified__",
        label: "\u672A\u5206\u985E",
        groupId: "__unclassified__",
        members: unclassified
      });
    }
    return [...top, ...requirementBands];
  }
  function visibleBandKeys(data, shownNodes) {
    const ids = new Set(shownNodes.map((node) => node.id));
    const types = new Set(shownNodes.map((node) => node.type));
    const keys = /* @__PURE__ */ new Set();
    for (const band of bandDefs(data)) {
      const visible = band.members ? band.members.some((id) => ids.has(id)) : types.has(band.type);
      if (visible) keys.add(band.type || band.key);
    }
    return keys;
  }
  var bandId = (key) => `band:${key}`;
  function graphElements(data, measure = estimateTextWidth) {
    const bands = bandDefs(data);
    const types = (data.meta || {}).types || {};
    return [
      ...data.nodes.map((node) => {
        const text = wrapLabel(truncate(node.text, LABEL_MAX_LENGTH), LABEL_WRAP_WIDTH, measure);
        const label = `${node.id}
${text}`;
        const size = nodeSize(label, (types[node.type] || {}).fit, measure);
        return {
          data: {
            id: node.id,
            type: node.type,
            status: node.status,
            label,
            w: size.w,
            h: size.h
          }
        };
      }),
      ...data.edges.map((edge, index) => ({
        data: {
          id: `e${index}`,
          index,
          source: edge.source,
          target: edge.target,
          name: edge.name
        }
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
          h: 10
        },
        classes: "band",
        selectable: false,
        grabbable: false
      }))
    ];
  }
  var LEGEND_MAX_BORDER = 3;
  function legendGroups(meta, colorScheme = "light") {
    const dark = colorScheme === "dark";
    const groups = [
      {
        title: "\u7A2E\u5225",
        items: Object.entries(meta.types).map(([type, typeMeta]) => ({
          label: type,
          swatch: {
            background: dark ? typeMeta.dark_fill || typeMeta.fill : typeMeta.fill,
            borderColor: dark ? typeMeta.dark_stroke || typeMeta.stroke : typeMeta.stroke,
            borderStyle: "solid",
            borderWidth: 1
          }
        }))
      }
    ];
    const statuses = Object.entries(meta.statuses || {});
    if (statuses.length) {
      groups.push({
        title: fieldLabel("status"),
        items: statuses.map(([status, statusMeta]) => ({
          label: status,
          swatch: {
            background: "transparent",
            borderColor: null,
            borderStyle: statusMeta.border_style,
            borderWidth: Math.min(statusMeta.border_width, LEGEND_MAX_BORDER)
          }
        }))
      });
    }
    return groups;
  }
  function isNodeVisible(extent, box, margin = 0) {
    const inner = {
      x1: extent.x1 + margin,
      y1: extent.y1 + margin,
      x2: extent.x2 - margin,
      y2: extent.y2 - margin
    };
    const fits = box.x2 - box.x1 <= inner.x2 - inner.x1 && box.y2 - box.y1 <= inner.y2 - inner.y1;
    if (fits) {
      return box.x1 >= inner.x1 && box.x2 <= inner.x2 && box.y1 >= inner.y1 && box.y2 <= inner.y2;
    }
    const centerX = (box.x1 + box.x2) / 2;
    const centerY = (box.y1 + box.y2) / 2;
    return centerX >= extent.x1 && centerX <= extent.x2 && centerY >= extent.y1 && centerY <= extent.y2;
  }
  function edgeControl(source, target, direction, offset = 0) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.hypot(dx, dy) || 1;
    const control = {
      x: (source.x + target.x) / 2 + -dy / length * offset,
      y: (source.y + target.y) / 2 + dx / length * offset
    };
    const sameRank = direction === "LR" ? Math.abs(dx) < 8 : Math.abs(dy) < 8;
    if (!sameRank) return control;
    const span = direction === "LR" ? Math.abs(dy) : Math.abs(dx);
    const bend = Math.min(48, Math.max(8, span * 0.12));
    if (direction === "LR") control.x -= bend;
    else control.y -= bend;
    return control;
  }
  function quadraticPath(start, control, end) {
    const coord = (value) => Math.round(value * 100) / 100;
    return `M ${coord(start.x)} ${coord(start.y)} Q ${coord(control.x)} ${coord(control.y)} ${coord(end.x)} ${coord(end.y)}`;
  }
  function quadraticPoint(start, control, end, t = 0.5) {
    const rest = 1 - t;
    return {
      x: rest * rest * start.x + 2 * rest * t * control.x + t * t * end.x,
      y: rest * rest * start.y + 2 * rest * t * control.y + t * t * end.y
    };
  }
  function layoutOptions(direction) {
    return {
      name: "dagre",
      rankDir: direction === "LR" ? "LR" : "TB",
      nodeSep: 24,
      rankSep: 56,
      edgeSep: 12,
      animate: false,
      fit: true,
      padding: 18
    };
  }
  var BAND_ROW_GAP = 30;
  var BAND_SIBLING_GAP = 26;
  var BAND_GAP = 96;
  var BAND_FRAME_PAD = 14;
  var REQUIREMENT_GROUP_MAX_WIDTH = 600;
  var REQUIREMENT_GROUP_GAP = 48;
  function bandRows(members, edges) {
    const ids = new Set(members.map((node) => node.id));
    const parents = /* @__PURE__ */ new Map();
    for (const edge of edges) {
      if (edge.name !== "refines" || !ids.has(edge.source) || !ids.has(edge.target)) continue;
      if (!parents.has(edge.source)) parents.set(edge.source, []);
      parents.get(edge.source).push(edge.target);
    }
    const depth = /* @__PURE__ */ new Map();
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
      const row = depthOf(node.id, /* @__PURE__ */ new Set());
      (rows[row] ||= []).push(node);
    }
    return rows.filter(Boolean);
  }
  function bandedLayout(bands, placed, edges, direction, options = {}) {
    const positions = /* @__PURE__ */ new Map();
    const frames = /* @__PURE__ */ new Map();
    const membersOf = bands.map((band) => {
      const ids = band.members ? new Set(band.members) : null;
      return placed.filter((node) => ids ? ids.has(node.id) : node.type === band.type);
    });
    if (!membersOf.some((members) => members.length)) return { positions, frames };
    const vertical = direction !== "LR";
    const pri = (node) => vertical ? node.y : node.x;
    const sec = (node) => vertical ? node.x : node.y;
    const priSize = (node) => vertical ? node.h : node.w;
    const secSize = (node) => vertical ? node.w : node.h;
    const at = (secValue, priValue) => vertical ? { x: secValue, y: priValue } : { x: priValue, y: secValue };
    const positionSec = (id) => {
      const position = positions.get(id);
      return vertical ? position.x : position.y;
    };
    const topOf = (nodes) => Math.min(...nodes.map((node) => pri(node) - priSize(node) / 2));
    const groupMaxWidth = Math.max(1, options.groupMaxWidth || REQUIREMENT_GROUP_MAX_WIDTH);
    const layoutGroup = (members, maxWidth) => {
      const contentLimit = Math.max(1, maxWidth - BAND_FRAME_PAD * 2);
      const positions2 = /* @__PURE__ */ new Map();
      let rowTop = 0;
      let contentWidth = 0;
      for (const depthRow of bandRows(members, edges)) {
        depthRow.sort((a, b) => sec(a) - sec(b));
        let line = [];
        let lineWidth = 0;
        const finishLine = () => {
          if (!line.length) return;
          const height = Math.max(...line.map(priSize));
          let offset = 0;
          for (const node of line) {
            const size = secSize(node);
            positions2.set(node.id, { sec: offset + size / 2, pri: rowTop + height / 2 });
            offset += size + BAND_SIBLING_GAP;
          }
          contentWidth = Math.max(contentWidth, lineWidth);
          rowTop += height + BAND_ROW_GAP;
          line = [];
          lineWidth = 0;
        };
        for (const node of depthRow) {
          const nextWidth = lineWidth + (line.length ? BAND_SIBLING_GAP : 0) + secSize(node);
          if (line.length && nextWidth > contentLimit) finishLine();
          line.push(node);
          lineWidth += (line.length > 1 ? BAND_SIBLING_GAP : 0) + secSize(node);
        }
        finishLine();
      }
      return {
        positions: positions2,
        width: contentWidth + BAND_FRAME_PAD * 2,
        height: rowTop - BAND_ROW_GAP + BAND_FRAME_PAD * 2
      };
    };
    const banded = /* @__PURE__ */ new Set();
    const spans = /* @__PURE__ */ new Map();
    let cursor2 = topOf(placed);
    let index = 0;
    while (index < bands.length) {
      if (bands[index].members) {
        const sectionFrom = cursor2;
        const sectionStart = Math.min(...placed.map((node) => sec(node) - secSize(node) / 2));
        const sectionBandIndexes = [];
        let groupLeft = sectionStart;
        let sectionTo = sectionFrom;
        while (index < bands.length && bands[index].members) {
          const members2 = membersOf[index];
          if (!members2.length) {
            index += 1;
            continue;
          }
          for (const node of members2) banded.add(node.id);
          const group = layoutGroup(members2, groupMaxWidth);
          for (const node of members2) {
            const local = group.positions.get(node.id);
            positions.set(
              node.id,
              at(
                groupLeft + BAND_FRAME_PAD + local.sec,
                sectionFrom + BAND_FRAME_PAD + local.pri
              )
            );
          }
          spans.set(index, {
            from: sectionFrom,
            to: sectionFrom + group.height,
            secMin: groupLeft,
            secMax: groupLeft + group.width
          });
          sectionBandIndexes.push(index);
          sectionTo = Math.max(sectionTo, sectionFrom + group.height);
          groupLeft += group.width + REQUIREMENT_GROUP_GAP;
          index += 1;
        }
        for (const bandIndex of sectionBandIndexes) spans.get(bandIndex).to = sectionTo;
        cursor2 = sectionTo + BAND_GAP;
        continue;
      }
      const members = membersOf[index];
      if (!members.length) {
        index += 1;
        continue;
      }
      for (const node of members) banded.add(node.id);
      const from = cursor2;
      for (const row of bandRows(members, edges)) {
        const height = Math.max(...row.map(priSize));
        row.sort((a, b) => sec(a) - sec(b));
        let occupied = Math.min(...placed.map((node) => sec(node) - secSize(node) / 2));
        for (const node of row) {
          const half = secSize(node) / 2;
          const center = occupied + half;
          positions.set(node.id, at(center, cursor2 + height / 2));
          occupied = center + half + BAND_SIBLING_GAP;
        }
        cursor2 += height + BAND_ROW_GAP;
      }
      spans.set(index, { from, to: cursor2 - BAND_ROW_GAP });
      cursor2 += BAND_GAP - BAND_ROW_GAP;
      index += 1;
    }
    const rest = placed.filter((node) => !banded.has(node.id));
    if (rest.length) {
      const shift = cursor2 - topOf(rest);
      for (const node of rest) {
        positions.set(node.id, at(sec(node), pri(node) + shift));
      }
    }
    const secCenter = (node) => positionSec(node.id);
    let secMin = Infinity;
    let secMax = -Infinity;
    for (const node of placed) {
      secMin = Math.min(secMin, secCenter(node) - secSize(node) / 2);
      secMax = Math.max(secMax, secCenter(node) + secSize(node) / 2);
    }
    let requirementSecMin = Infinity;
    let requirementSecMax = -Infinity;
    for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
      if (!bands[bandIndex].members || !spans.has(bandIndex)) continue;
      const span = spans.get(bandIndex);
      requirementSecMin = Math.min(requirementSecMin, span.secMin);
      requirementSecMax = Math.max(requirementSecMax, span.secMax);
      secMin = Math.min(secMin, span.secMin);
      secMax = Math.max(secMax, span.secMax);
    }
    const secMiddle = (secMin + secMax) / 2;
    const bandMiddle = Number.isFinite(requirementSecMin) ? (requirementSecMin + requirementSecMax) / 2 : secMiddle;
    let typeSecSize = 0;
    for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
      if (bands[bandIndex].members || !membersOf[bandIndex].length) continue;
      let min = Infinity;
      let max = -Infinity;
      for (const node of membersOf[bandIndex]) {
        min = Math.min(min, secCenter(node) - secSize(node) / 2);
        max = Math.max(max, secCenter(node) + secSize(node) / 2);
      }
      typeSecSize = Math.max(typeSecSize, max - min + BAND_FRAME_PAD * 2);
    }
    const commonSecSize = Number.isFinite(requirementSecMin) ? requirementSecMax - requirementSecMin : typeSecSize;
    for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
      const members = membersOf[bandIndex];
      if (!members.length) continue;
      const span = spans.get(bandIndex);
      if (!span) continue;
      if (bands[bandIndex].members) {
        frames.set(bands[bandIndex].key, {
          ...at((span.secMin + span.secMax) / 2, (span.from + span.to) / 2),
          w: vertical ? span.secMax - span.secMin : span.to - span.from,
          h: vertical ? span.to - span.from : span.secMax - span.secMin
        });
        continue;
      }
      let min = Infinity;
      let max = -Infinity;
      for (const node of members) {
        min = Math.min(min, secCenter(node) - secSize(node) / 2);
        max = Math.max(max, secCenter(node) + secSize(node) / 2);
      }
      const shift = bandMiddle - (min + max) / 2;
      for (const node of members) {
        const position = positions.get(node.id);
        positions.set(
          node.id,
          vertical ? { x: position.x + shift, y: position.y } : { x: position.x, y: position.y + shift }
        );
      }
      const framePriSize = span.to - span.from + BAND_FRAME_PAD * 2;
      frames.set(bands[bandIndex].type || bands[bandIndex].key, {
        ...at(bandMiddle, (span.from + span.to) / 2),
        w: vertical ? commonSecSize : framePriSize,
        h: vertical ? framePriSize : commonSecSize
      });
    }
    return { positions, frames };
  }
  var EXPORT_LABEL_LIMIT = 40;
  function collapse(text, limit) {
    const collapsed = String(text).split(/\s+/).filter(Boolean).join(" ");
    const chars = [...collapsed];
    if (limit > 0 && chars.length > limit) return chars.slice(0, limit - 1).join("") + "\u2026";
    return collapsed;
  }
  function exportIds(nodes) {
    return new Map(nodes.map((node, index) => [node.id, `n${index + 1}`]));
  }
  function mermaidEscape(text) {
    return text.replace(/\\/g, "\uFF3C").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;");
  }
  function mermaidText(view2, maxLabel = EXPORT_LABEL_LIMIT) {
    const meta = view2.data.meta || {};
    const types = meta.types || {};
    const dashed = new Set(meta.dashed_edges || []);
    const ids = exportIds(view2.nodes);
    const lines = ["flowchart TD"];
    for (const node of view2.nodes) {
      const shape = (types[node.type] || {}).mermaid || { open: "[", close: "]" };
      const label = [
        `<b>${node.id}</b> [${node.type}]`,
        mermaidEscape(collapse(node.text, maxLabel))
      ].join("<br/>");
      lines.push(`    ${ids.get(node.id)}${shape.open}"${label}"${shape.close}`);
    }
    lines.push("");
    for (const edge of view2.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
      const arrow = dashed.has(edge.name) ? "-.->" : "-->";
      lines.push(`    ${ids.get(edge.source)} ${arrow}|${edge.name}| ${ids.get(edge.target)}`);
    }
    lines.push("");
    for (const [type, typeMeta] of Object.entries(types)) {
      lines.push(`    classDef ${type} fill:${typeMeta.fill},stroke:${typeMeta.stroke}`);
    }
    for (const node of view2.nodes) lines.push(`    class ${ids.get(node.id)} ${node.type}`);
    return lines.join("\n") + "\n";
  }

  // src/reqmodel/presentation/site_app.js
  var dagre = window.dagre;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var DATA = JSON.parse(document.getElementById("model-data").textContent);
  var METRICS = { startedAt: Date.now(), initialRenderMs: null, layouts: [], filters: [] };
  function readStore(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function writeStore(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
    }
  }
  var state = decodeHash(initialHash(location.hash, readStore(VIEW_STORAGE_KEY)), DATA);
  var view = createView(DATA, state);
  var graphEl = document.getElementById("graph");
  var cssVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
  var palette = () => ({
    fg: cssVar("--fg"),
    bg: cssVar("--bg"),
    panel: cssVar("--panel"),
    border: cssVar("--border"),
    muted: cssVar("--muted"),
    dark: getComputedStyle(document.documentElement).colorScheme === "dark"
  });
  var typeColors = (typeMeta, pal) => ({
    fill: pal.dark ? typeMeta.dark_fill || typeMeta.fill : typeMeta.fill,
    stroke: pal.dark ? typeMeta.dark_stroke || typeMeta.stroke : typeMeta.stroke
  });
  var svg = null;
  var viewport = null;
  var graphLayer = null;
  var defs = null;
  var graph = null;
  var zoom = 1;
  var pan = { x: 0, y: 0 };
  var nodeItems = /* @__PURE__ */ new Map();
  var edgeItemsByKey = /* @__PURE__ */ new Map();
  var bandItems = /* @__PURE__ */ new Map();
  function svgEl(name, attrs = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== void 0 && value !== null && value !== "") element.setAttribute(key, String(value));
    }
    return element;
  }
  function setAttrs(element, attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === void 0 || value === null || value === "") element.removeAttribute(key);
      else element.setAttribute(key, String(value));
    }
  }
  function setTransform() {
    if (graphLayer) graphLayer.setAttribute("transform", `translate(${pan.x} ${pan.y}) scale(${zoom})`);
  }
  function classed(element, name, enabled) {
    element.classList.toggle(name, Boolean(enabled));
  }
  function labelMeasurer() {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return estimateTextWidth;
    context.font = `${LABEL_FONT.size}px ${LABEL_FONT.family}`;
    return (text) => context.measureText(String(text)).width;
  }
  function renderLabel(parent, label, x, y, size = LABEL_FONT.size, weight = null) {
    const lines = String(label).split("\n");
    const step = size * LABEL_FONT.lineHeight;
    const top = y - (lines.length - 1) * step / 2 + size * 0.35;
    parent.replaceChildren();
    for (const [index, line] of lines.entries()) {
      const tspan = svgEl("tspan", { x, y: top + index * step });
      tspan.textContent = line;
      parent.append(tspan);
    }
    setAttrs(parent, {
      "text-anchor": "middle",
      "font-family": LABEL_FONT.family,
      "font-size": size,
      "font-weight": weight
    });
  }
  function shapeEl(shape) {
    if (shape === "ellipse") return svgEl("ellipse");
    if (shape === "barrel") return svgEl("path");
    if (["hexagon", "rhomboid", "diamond", "tag", "cut-rectangle"].includes(shape)) return svgEl("polygon");
    return svgEl("rect");
  }
  var polygonCoords = (shape, w, h) => {
    const points = {
      hexagon: [-1, 0, -0.5, -1, 0.5, -1, 1, 0, 0.5, 1, -0.5, 1],
      rhomboid: [-1, -1, 0.333, -1, 1, 1, -0.333, 1],
      diamond: [0, -1, 1, 0, 0, 1, -1, 0],
      tag: [-1, -1, 0.25, -1, 1, 0, 0.25, 1, -1, 1]
    }[shape] || (() => {
      const x = Math.min(w, h) * 0.16 / (w / 2);
      const y = Math.min(w, h) * 0.16 / (h / 2);
      return [
        -1 + x,
        -1,
        1 - x,
        -1,
        1,
        -1 + y,
        1,
        1 - y,
        1 - x,
        1,
        -1 + x,
        1,
        -1,
        1 - y,
        -1,
        -1 + y
      ];
    })();
    const scaled = [];
    for (let index = 0; index < points.length; index += 2) {
      scaled.push({ x: points[index] * w / 2, y: points[index + 1] * h / 2 });
    }
    return scaled;
  };
  var polygonPoints = (shape, w, h) => polygonCoords(shape, w, h).map(({ x, y }) => `${x},${y}`).join(" ");
  function updateShape(element, shape, box) {
    const { w, h } = box;
    if (element.tagName === "ellipse") setAttrs(element, { cx: 0, cy: 0, rx: w / 2, ry: h / 2 });
    else if (element.tagName === "polygon") setAttrs(element, { points: polygonPoints(shape, w, h) });
    else if (element.tagName === "path") {
      const curve = Math.min(w * 0.12, h * 0.45);
      setAttrs(element, {
        d: `M ${-w / 2 + curve} ${-h / 2} L ${w / 2 - curve} ${-h / 2} C ${w / 2} ${-h / 2} ${w / 2} ${h / 2} ${w / 2 - curve} ${h / 2} L ${-w / 2 + curve} ${h / 2} C ${-w / 2} ${h / 2} ${-w / 2} ${-h / 2} ${-w / 2 + curve} ${-h / 2} Z`
      });
    } else setAttrs(element, {
      x: -w / 2,
      y: -h / 2,
      width: w,
      height: h,
      rx: shape === "round-rectangle" ? 8 : Math.min(w, h) * 0.3
    });
  }
  function initGraph() {
    if (!dagre) {
      graphEl.innerHTML = '<p class="empty">\u63CF\u753B\u30E9\u30A4\u30D6\u30E9\u30EA (dagre) \u3092\u8AAD\u307F\u8FBC\u3081\u306A\u304B\u3063\u305F\u3002\u56F3\u306E\u5143\u30C7\u30FC\u30BF\u306F <a href="graph.mmd">graph.mmd</a> / <a href="graph.dot">graph.dot</a> \u306B\u3042\u308B\u3002</p>';
      return;
    }
    graph = graphElements(DATA, labelMeasurer());
    graphEl.replaceChildren();
    svg = svgEl("svg", { class: "req-graph", tabindex: 0, role: "img", "aria-label": DATA.title });
    defs = svgEl("defs");
    viewport = svgEl("rect", { class: "graph-bg", x: -1e5, y: -1e5, width: 2e5, height: 2e5 });
    graphLayer = svgEl("g", { class: "graph-layer" });
    svg.append(defs, viewport, graphLayer);
    graphEl.append(svg);
    buildGraphDom();
    bindPanZoom();
    runLayout();
  }
  function buildGraphDom() {
    const pal = palette();
    const arrow = svgEl("marker", { id: "req-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" });
    arrow.append(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: pal.border }));
    defs.replaceChildren(arrow);
    const edgeLayer = svgEl("g", { class: "edges" });
    const bandLayer = svgEl("g", { class: "bands" });
    const nodeLayer = svgEl("g", { class: "nodes" });
    graphLayer.replaceChildren(bandLayer, edgeLayer, nodeLayer);
    const dashedEdges = new Set(DATA.meta.dashed_edges || []);
    for (const item of graph.filter((element) => element.data.source)) {
      const path = svgEl("path", { class: "edge-line", "marker-end": "url(#req-arrow)" });
      const label = svgEl("text", { class: "edge-label", "text-anchor": "middle" });
      label.textContent = item.data.name;
      const group = svgEl("g", {
        class: `edge ${dashedEdges.has(item.data.name) ? "dashed" : ""}`.trim(),
        "data-id": item.data.id,
        "data-source": item.data.source,
        "data-target": item.data.target
      });
      group.append(path, label);
      edgeLayer.append(group);
      edgeItemsByKey.set(item.data.id, { ...item.data, group, path, label, route: [] });
    }
    const types = DATA.meta.types || {};
    const statuses = DATA.meta.statuses || {};
    const impact = DATA.meta.impact_colors || {};
    graphEl.style.setProperty("--impact-selected", impact.selected || pal.fg);
    graphEl.style.setProperty("--impact-upstream", impact.upstream || pal.fg);
    graphEl.style.setProperty("--impact-downstream", impact.downstream || pal.fg);
    graphEl.style.setProperty("--impact-related", impact.related || pal.fg);
    graphEl.style.setProperty("--search-hit", (DATA.meta.search || {}).hit || pal.fg);
    for (const item of graph.filter((element) => element.classes === "band")) {
      const group = svgEl("g", { class: "node band", "data-id": item.data.id });
      const shape = svgEl("rect", { class: "node-shape", rx: 8 });
      const label = svgEl("text", { class: "node-label band-label" });
      renderLabel(label, item.data.label, 0, -11, 11, "bold");
      group.append(shape, label);
      bandLayer.append(group);
      bandItems.set(item.data.id, { ...item.data, x: 0, y: 0, w: 10, h: 10, group, shape, label });
    }
    for (const item of graph.filter((element) => !element.classes && !element.data.source)) {
      const typeMeta = types[item.data.type] || {};
      const statusMeta = statuses[item.data.status] || {};
      const group = svgEl("g", {
        class: `node status-${item.data.status || "unknown"}`,
        "data-node-id": item.data.id,
        tabindex: 0,
        role: "button",
        "aria-label": String(item.data.label).replaceAll("\n", " ")
      });
      const shape = shapeEl(typeMeta.shape);
      shape.classList.add("node-shape");
      const statusRing = shapeEl(typeMeta.shape);
      statusRing.classList.add("node-status-ring");
      const label = svgEl("text", { class: "node-label" });
      renderLabel(label, item.data.label, 0, 0);
      group.append(shape, statusRing, label);
      group.addEventListener("click", () => selectNode(item.data.id));
      group.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        chooseNode(item.data.id);
      });
      nodeLayer.append(group);
      nodeItems.set(item.data.id, { ...item.data, shapeName: typeMeta.shape, statusMeta, x: 0, y: 0, group, shape, statusRing, label });
    }
    restyleGraph();
  }
  function bindPanZoom() {
    let ignoreClick = false;
    svg.addEventListener("click", (event) => {
      if (ignoreClick) {
        ignoreClick = false;
        return;
      }
      if (event.target === svg || event.target === viewport) selectNode(state.selected);
    });
    let drag = null;
    svg.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".node:not(.band)")) return;
      drag = { x: event.clientX, y: event.clientY, pan: { ...pan }, moved: false };
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) >= 3) drag.moved = true;
      pan = { x: drag.pan.x + dx, y: drag.pan.y + dy };
      setTransform();
    });
    svg.addEventListener("pointerup", () => {
      if (drag?.moved) {
        ignoreClick = true;
        setTimeout(() => ignoreClick = false, 0);
      }
      drag = null;
    });
    svg.addEventListener("pointercancel", () => {
      drag = null;
      ignoreClick = false;
    });
    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
  }
  function focusedIds() {
    if (!state.focus || !state.selected || !view.byId.has(state.selected)) return null;
    return focusSet(view, state.selected, state.focus);
  }
  var laidOutFocus = "";
  var focusKey = () => focusedIds() ? `${state.focus}:${state.selected}` : "";
  function syncFocusLayout() {
    const key = focusKey();
    if (key === laidOutFocus) return;
    laidOutFocus = key;
    runLayout();
  }
  function shownNodeItems() {
    return [...nodeItems.values()].filter((item) => !item.group.classList.contains("hidden"));
  }
  function shownEdgeItems() {
    return [...edgeItemsByKey.values()].filter((item) => !item.group.classList.contains("hidden"));
  }
  function shownBandItems() {
    return [...bandItems.values()].filter((item) => !item.group.classList.contains("hidden"));
  }
  function moveItem(item, x, y) {
    item.x = x;
    item.y = y;
    item.group.setAttribute("transform", `translate(${x} ${y})`);
  }
  function rectangleEndpoint(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (!dx && !dy) return { x: from.x, y: from.y };
    const scale = Math.min(Math.abs(from.w / 2 / (dx || 1e-9)), Math.abs(from.h / 2 / (dy || 1e-9)));
    return { x: from.x + dx * scale, y: from.y + dy * scale };
  }
  function ellipseEndpoint(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (!dx && !dy) return { x: from.x, y: from.y };
    const rx = from.w / 2;
    const ry = from.h / 2;
    const scale = 1 / Math.sqrt(dx * dx / (rx * rx) + dy * dy / (ry * ry));
    return { x: from.x + dx * scale, y: from.y + dy * scale };
  }
  function polygonEndpoint(from, to) {
    const ray = { x: to.x - from.x, y: to.y - from.y };
    if (!ray.x && !ray.y) return { x: from.x, y: from.y };
    const vertices = polygonCoords(from.shapeName, from.w, from.h);
    const cross = (a, b) => a.x * b.y - a.y * b.x;
    let closest = Infinity;
    for (let index = 0; index < vertices.length; index += 1) {
      const a = vertices[index];
      const b = vertices[(index + 1) % vertices.length];
      const side = { x: b.x - a.x, y: b.y - a.y };
      const denominator = cross(ray, side);
      if (Math.abs(denominator) < 1e-9) continue;
      const t = cross(a, side) / denominator;
      const u = cross(a, ray) / denominator;
      if (t >= 0 && u >= 0 && u <= 1) closest = Math.min(closest, t);
    }
    if (!Number.isFinite(closest)) return rectangleEndpoint(from, to);
    return { x: from.x + ray.x * closest, y: from.y + ray.y * closest };
  }
  function edgeEndpoint(from, to) {
    if (from.shapeName === "ellipse") return ellipseEndpoint(from, to);
    if (["hexagon", "rhomboid", "diamond", "tag", "cut-rectangle"].includes(from.shapeName)) {
      return polygonEndpoint(from, to);
    }
    return rectangleEndpoint(from, to);
  }
  function updateEdges() {
    for (const edge of edgeItemsByKey.values()) {
      const source = nodeItems.get(edge.source);
      const target = nodeItems.get(edge.target);
      if (!source || !target) continue;
      const offset = edge.parallelOffset || 0;
      let control = edgeControl(source, target, state.direction, offset);
      const from = edgeEndpoint(source, control);
      const to = edgeEndpoint(target, control);
      control = edgeControl(from, to, state.direction, offset);
      setAttrs(edge.path, { d: quadraticPath(from, control, to) });
      const middle = quadraticPoint(from, control, to);
      setAttrs(edge.label, { x: middle.x, y: middle.y - 4 });
      edge.x1 = from.x;
      edge.y1 = from.y;
      edge.x2 = to.x;
      edge.y2 = to.y;
      edge.points = [from, control, to];
    }
  }
  function applyBanding() {
    if (!svg) return;
    const bands = bandDefs(DATA);
    if (!bands.length) return;
    const placed = shownNodeItems().map((item) => ({
      id: item.id,
      type: item.type,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h
    }));
    if (!placed.length) return;
    const { positions, frames } = bandedLayout(bands, placed, view.edges, state.direction, {
      groupMaxWidth: 600
    });
    for (const [id, position] of positions) {
      const item = nodeItems.get(id);
      if (item) moveItem(item, position.x, position.y);
    }
    for (const [key, frame] of frames) {
      const item = bandItems.get(bandId(key));
      if (!item) continue;
      item.w = frame.w;
      item.h = frame.h;
      updateShape(item.shape, "round-rectangle", item);
      moveItem(item, frame.x, frame.y);
      renderLabel(item.label, item.label.textContent, 0, -item.h / 2 + 7, 11, "bold");
    }
    updateEdges();
  }
  function runLayout() {
    if (!svg) return;
    const startedAt = Date.now();
    const g = new dagre.graphlib.Graph({ multigraph: true });
    const opts = layoutOptions(state.direction);
    g.setGraph({ rankdir: opts.rankDir, nodesep: opts.nodeSep, ranksep: opts.rankSep, edgesep: opts.edgeSep });
    g.setDefaultEdgeLabel(() => ({}));
    const nodes = new Set(shownNodeItems().map((item) => item.id));
    for (const item of shownNodeItems()) g.setNode(item.id, { width: item.w, height: item.h });
    const parallel = /* @__PURE__ */ new Map();
    for (const item of shownEdgeItems()) {
      const edge = DATA.edges[item.index];
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
      g.setEdge(edge.source, edge.target, { width: estimateTextWidth(edge.name), height: 12 }, item.id);
      const key = [edge.source, edge.target].sort().join("\0");
      const siblings = parallel.get(key) || [];
      siblings.push(item);
      parallel.set(key, siblings);
    }
    dagre.layout(g);
    for (const id of g.nodes()) {
      const pos = g.node(id);
      const item = nodeItems.get(id);
      if (item) moveItem(item, pos.x, pos.y);
    }
    for (const siblings of parallel.values()) {
      siblings.forEach((item, index) => {
        const orientation = item.source.localeCompare(item.target) <= 0 ? 1 : -1;
        item.parallelOffset = (index - (siblings.length - 1) / 2) * 12 * orientation;
      });
    }
    applyBanding();
    fitInitial();
    METRICS.layouts.push({
      ms: Date.now() - startedAt,
      nodes: shownNodeItems().length,
      edges: shownEdgeItems().length,
      direction: state.direction
    });
    svg.dataset.layoutMs = String(METRICS.layouts.at(-1).ms);
  }
  function applyVisibility() {
    if (!svg) return;
    const startedAt = Date.now();
    const focused = focusedIds();
    const shown = focused ? view.nodes.filter((node) => focused.has(node.id)) : view.nodes;
    const nodes = new Set(shown.map((node) => node.id));
    const edges = new Set(view.edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)));
    const visibleBands = visibleBandKeys(DATA, shown);
    for (const item of nodeItems.values()) classed(item.group, "hidden", !nodes.has(item.id));
    for (const item of bandItems.values()) classed(item.group, "hidden", !visibleBands.has(item.bandKey));
    for (const item of edgeItemsByKey.values()) classed(item.group, "hidden", !edges.has(DATA.edges[item.index]));
    METRICS.filters.push({ ms: Date.now() - startedAt, nodes: nodes.size, edges: edges.size });
    svg.dataset.filterMs = String(METRICS.filters.at(-1).ms);
  }
  function applyHighlight() {
    if (!svg) return;
    for (const item of [...nodeItems.values(), ...edgeItemsByKey.values()]) item.group.classList.remove("sel", "up", "down", "rel", "dim", "on-path");
    if (!state.selected || !view.byId.has(state.selected)) return;
    const { upstream, downstream, whole, undirected } = impactSets(view, state.selected);
    for (const item of nodeItems.values()) {
      if (item.id === state.selected) item.group.classList.add("sel");
      else if (undirected) item.group.classList.add(downstream.has(item.id) ? "rel" : "dim");
      else if (upstream.has(item.id)) item.group.classList.add("up");
      else if (downstream.has(item.id)) item.group.classList.add("down");
      else item.group.classList.add("dim");
    }
    for (const item of edgeItemsByKey.values()) {
      const linked = whole.has(item.source) && whole.has(item.target);
      item.group.classList.add(linked ? "on-path" : "dim");
    }
  }
  var cursor = null;
  var hits = () => searchHits(view, state.query);
  function applySearchHits() {
    if (!svg) return;
    const matched = new Set(hits());
    for (const item of nodeItems.values()) {
      classed(item.group, "hit", matched.has(item.id));
      classed(item.group, "hit-current", item.id === cursor);
    }
  }
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
  function relayout() {
    runLayout();
  }
  function graphBox() {
    const boxes = [...shownNodeItems(), ...shownBandItems()];
    if (!boxes.length) return { x1: 0, y1: 0, x2: 1, y2: 1 };
    return {
      x1: Math.min(...boxes.map((box) => box.x - box.w / 2)),
      y1: Math.min(...boxes.map((box) => box.y - box.h / 2)),
      x2: Math.max(...boxes.map((box) => box.x + box.w / 2)),
      y2: Math.max(...boxes.map((box) => box.y + box.h / 2))
    };
  }
  function fitToView() {
    if (!svg) return;
    const box = graphBox();
    const width = graphEl.clientWidth || 800;
    const height = graphEl.clientHeight || 480;
    zoom = Math.min((width - 36) / (box.x2 - box.x1 || 1), (height - 36) / (box.y2 - box.y1 || 1));
    pan = { x: 18 - box.x1 * zoom, y: 18 - box.y1 * zoom };
    setTransform();
  }
  var MIN_READABLE_ZOOM = 0.45;
  function fitInitial() {
    fitToView();
    if (zoom >= MIN_READABLE_ZOOM) return;
    const box = graphBox();
    zoom = MIN_READABLE_ZOOM;
    pan = { x: 18 - box.x1 * zoom, y: 18 - box.y1 * zoom };
    setTransform();
  }
  var REVEAL_MARGIN_PX = 40;
  function revealNode(id) {
    if (!svg || state.mode !== "graph") return;
    const item = nodeItems.get(id);
    if (!item || item.group.classList.contains("hidden")) return;
    const extent = { x1: -pan.x / zoom, y1: -pan.y / zoom, x2: (graphEl.clientWidth - pan.x) / zoom, y2: (graphEl.clientHeight - pan.y) / zoom };
    const box = { x1: item.x - item.w / 2, y1: item.y - item.h / 2, x2: item.x + item.w / 2, y2: item.y + item.h / 2 };
    if (isNodeVisible(extent, box, REVEAL_MARGIN_PX / zoom)) return;
    pan = { x: graphEl.clientWidth / 2 - item.x * zoom, y: graphEl.clientHeight / 2 - item.y * zoom };
    setTransform();
  }
  var revealSelected = () => revealNode(state.selected);
  function zoomBy(factor) {
    if (!svg) return;
    const next = Math.max(0.1, Math.min(3, zoom * factor));
    const cx = (graphEl.clientWidth || 800) / 2;
    const cy = (graphEl.clientHeight || 480) / 2;
    const mx = (cx - pan.x) / zoom;
    const my = (cy - pan.y) / zoom;
    zoom = next;
    pan = { x: cx - mx * zoom, y: cy - my * zoom };
    setTransform();
  }
  function pushReferenceSection(rows, title, references) {
    if (!Array.isArray(references) || references.length === 0) return;
    rows.push(`<h2>${escapeHtml(title)}</h2><ul class="sources">`);
    for (const reference of references) {
      const url = reference.url ? ` <a href="${escapeAttr(reference.url)}" target="_blank" rel="noreferrer">${escapeHtml(reference.url)}</a>` : "";
      const note = reference.note ? `<span class="text">${escapeHtml(reference.note)}</span>` : "";
      rows.push(
        `<li><span class="id">${escapeHtml(reference.title || "(untitled)")}</span>${url}${note}</li>`
      );
    }
    rows.push("</ul>");
  }
  function renderDetail() {
    const panel = document.getElementById("detail");
    if (!state.selected || !view.byId.has(state.selected)) {
      panel.innerHTML = '<p class="empty">\u30B0\u30E9\u30D5\u306E\u30CE\u30FC\u30C9\u3092\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u3068\u3001\u672C\u6587\u30FB\u6839\u62E0\u30FB\u5F71\u97FF\u7BC4\u56F2\u3092\u8868\u793A\u3059\u308B\u3002</p>';
      return;
    }
    const node = view.byId.get(state.selected);
    const impact = impactSets(view, node.id);
    const rows = [];
    rows.push(`<h3>${node.id} <span class="node-btn type">[${node.type}]</span></h3>`);
    rows.push(`<p class="text">${escapeHtml(node.text)}</p>`);
    rows.push("<dl>");
    rows.push(`<dt>${fieldLabel("status")}</dt><dd>${node.status}</dd>`);
    if (node.kind) rows.push(`<dt>kind</dt><dd>${node.kind}</dd>`);
    if (node.location) rows.push(`<dt>\u51FA\u6240</dt><dd class="loc">${locationHtml(node.location)}</dd>`);
    if (impact.undirected) {
      rows.push(`<dt>\u95A2\u9023</dt><dd>${impact.downstream.size} \u4EF6</dd>`);
    } else {
      rows.push(`<dt>\u4E0A\u6D41</dt><dd>${impact.upstream.size} \u4EF6</dd>`);
      rows.push(`<dt>\u4E0B\u6D41</dt><dd>${impact.downstream.size} \u4EF6</dd>`);
    }
    rows.push("</dl>");
    pushReferenceSection(rows, fieldLabel("source"), node.source);
    pushReferenceSection(rows, fieldLabel("realized_by"), node.realized_by);
    pushReferenceSection(rows, fieldLabel("evidence"), node.evidence);
    if ((node.acceptance_criteria || []).length) {
      rows.push("<h2>\u53D7\u3051\u5165\u308C\u57FA\u6E96</h2><ul>");
      for (const criterion of node.acceptance_criteria) rows.push(`<li>${escapeHtml(criterion)}</li>`);
      rows.push("</ul>");
    }
    if ((node.suppress || []).length) {
      rows.push("<h2>\u6291\u5236\u4E2D\u306E\u6307\u6458</h2><ul>");
      for (const [code, reason] of node.suppress) {
        rows.push(`<li><code>${escapeHtml(code)}</code>: ${escapeHtml(reason)}</li>`);
      }
      rows.push("</ul>");
    }
    const edgeList = (items) => items.map(
      (item) => `<li class="edge"><button class="node-btn" data-goto="${escapeAttr(item.id)}">
          <span class="arrow">${escapeHtml(item.arrow)}</span> <span class="id">${escapeHtml(item.id)}</span>
          <span class="type">${escapeHtml(item.type)}</span>
          <span class="text">${escapeHtml(truncate(item.text, 40))}</span></button></li>`
    ).join("");
    const links = edgeItems(view, node.id);
    if (links.out.length) rows.push(`<h2>\u51FA\u308B\u30A8\u30C3\u30B8</h2><ul class="plain">${edgeList(links.out)}</ul>`);
    if (links.in.length) rows.push(`<h2>\u5165\u308B\u30A8\u30C3\u30B8</h2><ul class="plain">${edgeList(links.in)}</ul>`);
    const nodeFindings = DATA.findings.filter((finding) => finding.node_id === node.id);
    if (nodeFindings.length) {
      rows.push('<h2 id="node-findings">\u3053\u306E\u30CE\u30FC\u30C9\u3078\u306E\u6307\u6458</h2>');
      for (const finding of nodeFindings) rows.push(findingHtml(finding, false));
    }
    rows.push('<h2>LLM \u9023\u643A</h2><button id="copy-context">\u5F71\u97FF\u90E8\u5206\u30B0\u30E9\u30D5\u3092\u30B3\u30D4\u30FC</button>');
    rows.push(
      `<p class="hint"><code>${escapeHtml(explainCommand(view, node.id))}</code> \u3068\u540C\u3058\u5185\u5BB9\u3092\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u306B\u5165\u308C\u308B\u3002</p>`
    );
    panel.innerHTML = rows.join("");
    panel.querySelectorAll("button[data-goto]").forEach((button) => {
      button.addEventListener("click", () => selectNode(button.dataset.goto));
    });
    const copyButton = document.getElementById("copy-context");
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(nodeContext(view, node.id));
        copyButton.textContent = "\u30B3\u30D4\u30FC\u3057\u305F";
      } catch {
        copyButton.textContent = "\u30B3\u30D4\u30FC\u3067\u304D\u306A\u304B\u3063\u305F";
      }
      setTimeout(() => copyButton.textContent = "\u5F71\u97FF\u90E8\u5206\u30B0\u30E9\u30D5\u3092\u30B3\u30D4\u30FC", 1600);
    });
  }
  function locationHtml(location2) {
    const url = sourceUrl(DATA, location2);
    if (!url) return escapeHtml(location2);
    return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener"
    title="GitHub \u3067\u3053\u306E\u5B9A\u7FA9\u3092\u958B\u304F">${escapeHtml(location2)} \u2197</a>`;
  }
  function findingHtml(finding, interactive = true) {
    const where = finding.node_id ? ` (${finding.node_id})` : "";
    const head = `<div class="code">${finding.severity.toUpperCase()} \xB7 L${finding.layer} \xB7 ${escapeHtml(finding.code)}${escapeHtml(where)}</div>
    <div>${escapeHtml(finding.message)}</div>`;
    if (interactive && finding.node_id) {
      const at2 = finding.location ? `<div class="loc">${escapeHtml(finding.location)}</div>` : "";
      return `<button type="button" class="finding ${finding.severity}" data-id="${escapeAttr(finding.node_id)}">
      ${head}${at2}</button>`;
    }
    const at = finding.location ? `<div class="loc">${locationHtml(finding.location)}</div>` : "";
    return `<div class="finding ${finding.severity}">${head}${at}</div>`;
  }
  function renderNodeList() {
    const list = document.getElementById("node-list");
    const matched = view.nodes.filter((node) => matchesQuery(node, state.query));
    list.innerHTML = matched.map((node) => {
      const marks = [
        node.id === state.selected ? "active" : "",
        //: ↑↓ で送っている最中の候補。図の暈しと同じものを指す。
        node.id === cursor ? "cursor" : ""
      ].join(" ");
      return `<li><button class="node-btn ${marks}" data-id="${node.id}">
        <span class="id">${node.id}</span> <span class="type">${node.type}</span><br>${escapeHtml(truncate(node.text, 34))}
      </button></li>`;
    }).join("");
    list.querySelectorAll("button[data-id]").forEach((button) => {
      button.addEventListener("click", () => selectNode(button.dataset.id));
    });
  }
  function renderToggles(containerId, attribute, items, set) {
    document.getElementById(containerId).innerHTML = items.map(
      (item) => `<label class="toggle"><input type="checkbox" data-${attribute}="${item.key}"${set.has(item.key) ? " checked" : ""}>
        ${escapeHtml(item.label)}<span class="count">${item.count}</span></label>`
    ).join("");
  }
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
  var FILTER_SETS = [
    ["type", "types"],
    ["status", "statuses"],
    ["edge", "edges"]
  ];
  function renderFilters() {
    const countBy2 = (keyOf) => {
      const counts = {};
      for (const node of DATA.nodes) counts[keyOf(node)] = (counts[keyOf(node)] || 0) + 1;
      return counts;
    };
    const typeCounts = countBy2((node) => node.type);
    const edgeCounts = {};
    for (const edge of DATA.edges) edgeCounts[edge.name] = (edgeCounts[edge.name] || 0) + 1;
    const items = {
      types: DATA.types.map((type) => ({ key: type, label: type, count: typeCounts[type] || 0 })),
      statuses: statusFilters(DATA),
      edges: DATA.edge_names.map((name) => ({
        key: name,
        label: name,
        count: edgeCounts[name] || 0
      }))
    };
    for (const [attribute, key] of FILTER_SETS) {
      renderToggles(`${attribute}-filters`, attribute, items[key], state[key]);
      bindToggles(attribute, key);
    }
  }
  function renderFocusOptions() {
    document.getElementById("focus").innerHTML = [
      '<option value="0">\u30D5\u30A9\u30FC\u30AB\u30B9: \u5207</option>',
      ...FOCUS_DEPTHS.map((depth) => `<option value="${depth}">\u8FD1\u508D ${depth} \u30DB\u30C3\u30D7</option>`)
    ].join("");
  }
  function renderImpactControls() {
    const slider = document.getElementById("depth");
    slider.min = "0";
    slider.max = String(Math.max(...IMPACT_DEPTHS));
    slider.step = "1";
  }
  var depthLabel = () => state.depth ? `${state.depth} \u30DB\u30C3\u30D7` : "\u7121\u5236\u9650";
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
      `<span class="chip">${DATA.stats.nodes} \u30CE\u30FC\u30C9</span>`,
      `<span class="chip">${DATA.stats.edges} \u30A8\u30C3\u30B8</span>`
    ];
    for (const severity of ["error", "severe", "warning", "info"]) {
      if (counts[severity]) chips.push(`<span class="chip ${severity}">${severity} ${counts[severity]}</span>`);
    }
    if (!counts.error && !counts.severe && !counts.warning && !counts.info) {
      chips.push('<span class="chip">\u6307\u6458\u306A\u3057</span>');
    }
    if (DATA.stats.suppressed) chips.push(`<span class="chip">\u6291\u5236 ${DATA.stats.suppressed} \u4EF6</span>`);
    document.getElementById("stats").innerHTML = chips.join("");
    document.getElementById("sources").textContent = DATA.generated_from.join(", ");
    renderLegend();
    renderFindings();
  }
  function renderLegend() {
    const scheme = palette().dark ? "dark" : "light";
    document.getElementById("legend").innerHTML = legendGroups(DATA.meta, scheme).map((group) => {
      const items = group.items.map(({ label, swatch }) => {
        const style = [
          `background:${swatch.background}`,
          `border-color:${swatch.borderColor || "currentColor"}`,
          `border-style:${swatch.borderStyle}`,
          `border-width:${swatch.borderWidth}px`
        ].join(";");
        return `<span><i class="swatch" style="${style}"></i>${escapeHtml(label)}</span>`;
      }).join("");
      return `<span class="legend-group"><b>${escapeHtml(group.title)}</b>${items}</span>`;
    }).join("");
  }
  var findingSeverity = ALL_SEVERITIES;
  function showSeverity(tab) {
    findingSeverity = tab.dataset.severity;
    renderFindings();
  }
  function renderFindings() {
    const tabs = severityTabs(DATA.findings);
    if (!tabs.some((tab) => tab.key === findingSeverity)) findingSeverity = ALL_SEVERITIES;
    const tabBar = document.getElementById("finding-tabs");
    const refocus = tabBar.contains(document.activeElement);
    tabBar.innerHTML = tabs.map(
      (tab) => `<button type="button" role="tab" aria-controls="findings" data-severity="${escapeAttr(tab.key)}"
        class="${tab.key === findingSeverity ? "active" : ""}"
        aria-selected="${tab.key === findingSeverity}"
        tabindex="${tab.key === findingSeverity ? 0 : -1}"
        >${escapeHtml(tab.label)}<span class="count">${tab.count}</span></button>`
    ).join("");
    tabBar.querySelectorAll("button[data-severity]").forEach((button) => {
      button.addEventListener("click", () => showSeverity(button));
    });
    bindTabKeys(tabBar, showSeverity);
    if (refocus) tabBar.querySelector("button.active")?.focus();
    const groups = groupFindings(DATA.findings, findingSeverity);
    const panel = document.getElementById("findings");
    panel.innerHTML = groups.length ? groups.map(
      (group) => `<div class="code-head"><span>${escapeHtml(group.code)}</span>
            <span>${group.items.length} \u4EF6</span></div>
            ${group.items.map((finding) => findingHtml(finding)).join("")}`
    ).join("") : '<p class="empty">\u6307\u6458\u306F\u7121\u3044\u3002</p>';
    panel.querySelectorAll("button.finding[data-id]").forEach((button) => {
      button.addEventListener("click", () => selectNode(button.dataset.id));
    });
  }
  function renderTable() {
    if (state.mode !== "table") return;
    const rows = sortRows(view, tableRows(view, state.query), state.sort);
    const head = TABLE_COLUMNS.map((column) => {
      const active = state.sort.key === column.key;
      const order = active ? state.sort.asc ? "ascending" : "descending" : "none";
      const arrow = active ? state.sort.asc ? "\u25B2" : "\u25BC" : "";
      return `<th class="${column.numeric ? "num" : ""}" aria-sort="${order}">
      <button data-key="${column.key}" title="\u3053\u306E\u5217\u3067\u4E26\u3079\u66FF\u3048\u308B">${column.label}<span class="arrow">${arrow}</span></button></th>`;
    }).join("");
    const DASH = '<td class="num dash">\u2014</td>';
    const cell = (row, key) => {
      switch (key) {
        case "text":
          return `<td class="text">${escapeHtml(row.text)}</td>`;
        case "findings":
          return row.findings ? `<td class="num"><button class="finding-count ${row.severity || ""}" data-findings="${row.id}" title="\u3053\u306E\u30CE\u30FC\u30C9\u3078\u306E\u6307\u6458\u3092\u898B\u308B">${row.findings}</button></td>` : DASH;
        case "evidence":
          return row.evidence ? `<td class="num">${row.evidence}</td>` : DASH;
        default:
          return `<td class="${key}">${escapeHtml(row[key])}</td>`;
      }
    };
    const body = rows.length ? rows.map(
      (row) => `<tr data-id="${escapeAttr(row.id)}" tabindex="0"
            class="${row.id === state.selected ? "sel" : ""}">
            ${TABLE_COLUMNS.map((column) => cell(row, column.key)).join("")}</tr>`
    ).join("") : `<tr><td class="empty" colspan="${TABLE_COLUMNS.length}">\u6761\u4EF6\u306B\u5408\u3046\u30CE\u30FC\u30C9\u306F\u7121\u3044\u3002</td></tr>`;
    const table = document.getElementById("node-table");
    table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
    document.getElementById("table-note").textContent = `${rows.length} \u4EF6\u3092\u8868\u793A\u4E2D (\u5168 ${DATA.nodes.length} \u4EF6)\u3002 \u884C\u3092\u30AF\u30EA\u30C3\u30AF (\u30AD\u30FC\u30DC\u30FC\u30C9\u306A\u3089 Enter) \u3059\u308B\u3068\u53F3\u30DA\u30A4\u30F3\u306B\u8A73\u7D30\u304C\u51FA\u308B\u3002\u5217\u898B\u51FA\u3057\u3067\u4E26\u3079\u66FF\u3048\u308B\u3002`;
    table.querySelectorAll("thead button[data-key]").forEach((button) => {
      button.addEventListener("click", () => {
        state.sort = nextSort(state.sort, button.dataset.key);
        renderTable();
        writeHash();
      });
    });
    table.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", () => selectNode(tr.dataset.id));
      tr.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectNode(tr.dataset.id);
      });
    });
    table.querySelectorAll("button[data-findings]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        showFindings(button.dataset.findings);
      });
    });
  }
  function showFindings(id) {
    if (state.selected !== id) selectNode(id);
    const heading = document.getElementById("node-findings");
    if (heading) heading.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function bindTabKeys(container, activate) {
    const keys = { ArrowLeft: -1, ArrowRight: 1 };
    container.addEventListener("keydown", (event) => {
      const buttons = [...container.querySelectorAll('[role="tab"]')];
      const at = buttons.indexOf(event.target);
      if (at < 0) return;
      let next = null;
      if (event.key in keys) next = buttons[(at + keys[event.key] + buttons.length) % buttons.length];
      else if (event.key === "Home") next = buttons[0];
      else if (event.key === "End") next = buttons[buttons.length - 1];
      if (!next) return;
      event.preventDefault();
      next.focus();
      activate(next);
    });
  }
  var VIEW_TABS = [
    ["tab-graph", "graph"],
    ["tab-table", "table"]
  ];
  function setMode(mode) {
    state.mode = mode;
    document.getElementById("graph-frame").hidden = mode !== "graph";
    document.getElementById("table-frame").hidden = mode !== "table";
    for (const element of document.querySelectorAll(".graph-only")) {
      element.hidden = mode !== "graph";
    }
    for (const [id, name] of VIEW_TABS) {
      const tab = document.getElementById(id);
      tab.classList.toggle("active", mode === name);
      tab.setAttribute("aria-selected", String(mode === name));
      tab.tabIndex = mode === name ? 0 : -1;
    }
    if (mode === "table") {
      renderTable();
      return;
    }
    revealSelected();
  }
  function writeHash(push = true) {
    const hash = encodeHash(state, DATA);
    writeStore(VIEW_STORAGE_KEY, storableHash(state, DATA));
    if (hash === location.hash) return;
    const url = hash || location.pathname + location.search;
    try {
      push ? history.pushState(null, "", url) : history.replaceState(null, "", url);
    } catch {
      location.hash = hash;
    }
  }
  function applyHash() {
    if (location.hash === encodeHash(state, DATA)) return;
    const next = decodeHash(location.hash, DATA);
    const turned = next.direction !== state.direction;
    state = next;
    syncControls();
    refresh();
    setMode(state.mode);
    if (turned) relayout();
    writeHash(false);
  }
  function selectNode(id) {
    state.selected = state.selected === id ? null : id;
    refresh();
    revealSelected();
    writeHash();
  }
  function chooseNode(id) {
    if (state.selected === id) {
      revealNode(id);
      return;
    }
    selectNode(id);
  }
  function refresh() {
    view = createView(DATA, state);
    if (cursor !== null && !hits().includes(cursor)) cursor = null;
    renderNodeList();
    renderDetail();
    renderTable();
    applyVisibility();
    applyHighlight();
    applySearchHits();
    syncFocusLayout();
  }
  function applyQuery(value) {
    state.query = value;
    document.getElementById("search").value = value;
    cursor = null;
    renderNodeList();
    renderTable();
    applySearchHits();
    writeHash(false);
  }
  for (const [id, name] of VIEW_TABS) {
    document.getElementById(id).addEventListener("click", () => {
      setMode(name);
      writeHash();
    });
  }
  bindTabKeys(document.querySelector(".tabs"), (tab) => {
    setMode(VIEW_TABS.find(([id]) => id === tab.id)[1]);
    writeHash();
  });
  document.getElementById("search").addEventListener("input", (event) => {
    applyQuery(event.target.value);
  });
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
    refresh();
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
    refresh();
    writeHash();
  });
  document.getElementById("relayout").addEventListener("click", relayout);
  document.getElementById("zoom-in").addEventListener("click", () => zoomBy(1.2));
  document.getElementById("zoom-out").addEventListener("click", () => zoomBy(1 / 1.2));
  document.getElementById("zoom-reset").addEventListener("click", () => {
    if (svg) {
      zoom = 1;
      pan = { x: 0, y: 0 };
      setTransform();
    }
  });
  document.getElementById("zoom-fit").addEventListener("click", fitToView);
  var theme = normalizeTheme(readStore(THEME_STORAGE_KEY));
  var themeButton = document.getElementById("theme");
  function applyTheme() {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
    themeButton.textContent = THEME_LABELS[theme];
    restyleGraph();
  }
  function restyleGraph() {
    if (!svg) return;
    const pal = palette();
    graphEl.style.setProperty("--graph-fg", pal.fg);
    graphEl.style.setProperty("--graph-bg", pal.bg);
    graphEl.style.setProperty("--graph-panel", pal.panel);
    graphEl.style.setProperty("--graph-border", pal.border);
    graphEl.style.setProperty("--graph-muted", pal.muted);
    const arrow = defs?.querySelector("#req-arrow path");
    if (arrow) arrow.setAttribute("fill", pal.border);
    const types = DATA.meta.types || {};
    const statuses = DATA.meta.statuses || {};
    const impact = DATA.meta.impact_colors || {};
    graphEl.style.setProperty("--impact-selected", impact.selected || pal.fg);
    graphEl.style.setProperty("--impact-upstream", impact.upstream || pal.fg);
    graphEl.style.setProperty("--impact-downstream", impact.downstream || pal.fg);
    graphEl.style.setProperty("--impact-related", impact.related || pal.fg);
    graphEl.style.setProperty("--search-hit", (DATA.meta.search || {}).hit || pal.fg);
    for (const item of nodeItems.values()) {
      const typeMeta = types[item.type] || {};
      const statusMeta = statuses[item.status] || {};
      const colors = typeColors(typeMeta, pal);
      item.shapeName = typeMeta.shape;
      updateShape(item.shape, item.shapeName, item);
      updateShape(item.statusRing, item.shapeName, item);
      setAttrs(item.shape, { fill: colors.fill, stroke: colors.stroke, "stroke-width": statusMeta.border_width || 1.5, "stroke-dasharray": statusMeta.border_style === "dashed" ? "6 4" : statusMeta.border_style === "dotted" ? "1 3" : "" });
      setAttrs(item.statusRing, { fill: "none", stroke: colors.stroke, "stroke-width": 1 });
    }
    for (const item of bandItems.values()) {
      const colors = typeColors(types[item.bandType] || {}, pal);
      setAttrs(item.shape, { fill: item.bandType === "RequirementGroup" ? pal.panel : colors.fill, stroke: colors.stroke || pal.border });
    }
    renderLegend();
  }
  themeButton.addEventListener("click", () => {
    theme = nextTheme(theme);
    writeStore(THEME_STORAGE_KEY, theme === "auto" ? null : theme);
    applyTheme();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", restyleGraph);
  var lastDownloadUrl = null;
  function download(name, text, type) {
    document.querySelector("a[data-generated-download]")?.remove();
    if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
    const url = URL.createObjectURL(new Blob([text], { type }));
    lastDownloadUrl = url;
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.hidden = true;
    link.dataset.generatedDownload = "";
    document.body.append(link);
    link.click();
  }
  function currentSvg() {
    if (!svg) return null;
    const copy = svg.cloneNode(true);
    copy.querySelectorAll(".hidden").forEach((element) => element.remove());
    copy.querySelectorAll("[tabindex], [role], [aria-label]").forEach((element) => {
      element.removeAttribute("tabindex");
      element.removeAttribute("role");
      element.removeAttribute("aria-label");
    });
    const box = graphBox();
    const padding = 24;
    const width = box.x2 - box.x1 + padding * 2;
    const height = box.y2 - box.y1 + padding * 2;
    setAttrs(copy, {
      xmlns: SVG_NS,
      viewBox: `${box.x1 - padding} ${box.y1 - padding} ${width} ${height}`,
      width,
      height
    });
    copy.querySelector(".graph-layer")?.removeAttribute("transform");
    const pal = palette();
    const background = copy.querySelector(".graph-bg");
    if (background) setAttrs(background, {
      x: box.x1 - padding,
      y: box.y1 - padding,
      width,
      height,
      fill: pal.bg
    });
    const impact = DATA.meta.impact_colors || {};
    const style = svgEl("style");
    style.textContent = `
    .node-label { fill: ${pal.fg}; font-family: ${LABEL_FONT.family}; }
    .band-label, .edge-label { fill: ${pal.muted}; }
    .edge-label { stroke: ${pal.bg}; stroke-width: 3; paint-order: stroke; font-size: 9px; }
    .edge-line { fill: none; stroke: ${pal.border}; stroke-width: 1.2; }
    .dashed .edge-line { stroke-dasharray: 6 4; }
    .node-status-ring { display: none; fill: none; transform: scale(.92); transform-box: fill-box; transform-origin: center; }
    .status-verified .node-status-ring { display: block; }
    .dim { opacity: .28; }
    .node.sel .node-shape { stroke: ${impact.selected || pal.fg}; stroke-width: 4; }
    .node.up .node-shape { stroke: ${impact.upstream || pal.fg}; stroke-width: 3; }
    .node.down .node-shape { stroke: ${impact.downstream || pal.fg}; stroke-width: 3; }
    .node.rel .node-shape { stroke: ${impact.related || pal.fg}; stroke-width: 3; }
    .edge.on-path .edge-line { stroke: ${pal.fg}; stroke-width: 2; }
    .hit .node-shape { filter: drop-shadow(0 0 8px ${(DATA.meta.search || {}).hit || pal.fg}); }
    .dim.hit { opacity: .65; }
  `;
    copy.prepend(style);
    const title = svgEl("title");
    title.textContent = DATA.title;
    copy.prepend(title);
    return `<?xml version="1.0" encoding="UTF-8"?>
${new XMLSerializer().serializeToString(copy)}`;
  }
  var exportSvg = document.getElementById("export-svg");
  exportSvg.addEventListener("click", () => {
    const text = currentSvg();
    if (!text) return;
    download("graph.svg", text, "image/svg+xml;charset=utf-8");
    exportSvg.closest("details").open = false;
  });
  var exportMmd = document.getElementById("export-mmd");
  exportMmd.addEventListener("click", () => {
    download("graph.mmd", mermaidText(view), "text/plain;charset=utf-8");
    exportMmd.closest("details").open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const typing = target instanceof HTMLElement && (target.isContentEditable || ["SELECT", "TEXTAREA"].includes(target.tagName) || target.tagName === "INPUT" && !["checkbox", "radio", "range", "button"].includes(target.type));
    if (event.key === "/" && !typing) {
      event.preventDefault();
      const search = document.getElementById("search");
      search.focus();
      search.select();
      return;
    }
    if (event.key !== "Escape") return;
    if (state.selected) {
      event.preventDefault();
      state.selected = null;
      refresh();
      writeHash();
    } else if (state.query) {
      event.preventDefault();
      applyQuery("");
    } else if (typing) {
      target.blur();
    }
  });
  var copyLink = document.getElementById("copy-link");
  copyLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      copyLink.title = "\u30EA\u30F3\u30AF\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F";
      copyLink.setAttribute("aria-label", "\u30EA\u30F3\u30AF\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F");
    } catch {
      copyLink.title = "\u30EA\u30F3\u30AF\u3092\u30B3\u30D4\u30FC\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F";
      copyLink.setAttribute("aria-label", "\u30EA\u30F3\u30AF\u3092\u30B3\u30D4\u30FC\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
    }
    setTimeout(() => {
      copyLink.title = "\u8868\u793A\u4E2D\u306E\u30DA\u30FC\u30B8\u3078\u306E\u30EA\u30F3\u30AF\u3092\u30B3\u30D4\u30FC";
      copyLink.setAttribute("aria-label", "\u8868\u793A\u4E2D\u306E\u30DA\u30FC\u30B8\u3078\u306E\u30EA\u30F3\u30AF\u3092\u30B3\u30D4\u30FC");
    }, 1600);
  });
  window.addEventListener("popstate", applyHash);
  window.addEventListener("hashchange", applyHash);
  applyTheme();
  initGraph();
  exportSvg.disabled = !svg;
  renderFilters();
  renderFocusOptions();
  renderImpactControls();
  syncControls();
  renderStats();
  refresh();
  setMode(state.mode);
  writeHash(false);
  METRICS.initialRenderMs = Date.now() - METRICS.startedAt;
  if (svg) svg.dataset.initialRenderMs = String(METRICS.initialRenderMs);
})();
