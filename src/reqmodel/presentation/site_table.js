import { truncate } from "./site_text.js";
import { compare, fieldLabel, rankOf, reach } from "./site_graph.js";
// --- テーブル --------------------------------------------------------------
//
// 棚卸し (全件を順に確認する作業) 用の一覧。グラフと同じ view から作るので、
// 種別・エッジ種別の絞り込みはそのまま効く。

/** 表の列。並びがそのまま左からの列順になる。 */
export const TABLE_COLUMNS = [
  { key: "id", label: "id" },
  { key: "type", label: "type" },
  { key: "text", label: "本文" },
  { key: "status", label: fieldLabel("status") },
  { key: "evidence", label: "根拠", numeric: true },
  { key: "findings", label: "指摘", numeric: true },
];

/** 重い順。行の指摘数に色を付けるときの「最も重い指摘」を決めるのに使う。 */
const SEVERITY_ORDER = ["error", "severe", "warning", "info"];

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
 * 検索にヒットしたノードの id。並びは左サイドバーの一覧と同じ (正規化 JSON の順)。
 * 検索語が空なら「ヒット無し」= 空配列 (全件ではない)。ハイライトもキーボード
 * 選択も「絞り込んだ結果を送る」ためのものなので、空欄で全件を送っても意味が無い。
 */
export function searchHits(view, query) {
  if (!(query || "").trim()) return [];
  return view.nodes.filter((node) => matchesQuery(node, query)).map((node) => node.id);
}

/**
 * ↑↓ で候補を送ったときの次の id。delta は +1 (下) か -1 (上)。
 * 端では巻き戻す。候補が無ければ null、現在位置が候補に無ければ端から始める。
 */
export function stepHit(hits, current, delta) {
  if (!hits.length) return null;
  const at = hits.indexOf(current);
  if (at < 0) return delta > 0 ? hits[0] : hits[hits.length - 1];
  return hits[(at + delta + hits.length) % hits.length];
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
      evidence: (node.evidence || []).length,
      findings: counts.get(node.id) || 0,
      severity: worst.has(node.id) ? SEVERITY_ORDER[worst.get(node.id)] : null,
    }));
}

//: 値を持たない行 (status が meta に無い等) の並び。向きに関わらず末尾に置く。
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

// --- 詳細ペイン ------------------------------------------------------------

/**
 * 詳細ペインに出す出入りのエッジ。**相手ノードの本文まで持たせる**。
 *
 * id だけを並べても、クリックして飛ぶまで何に繋がっているのか分からない。
 * 並びは正規化 JSON の順 (`view.edges` の順) のまま。両端が見えているエッジしか
 * view に無いので、相手ノードは必ず引ける。
 */
export function edgeItems(view, id) {
  const item = (edge, direction) => {
    const other = direction === "out" ? edge.target : edge.source;
    const node = view.byId.get(other);
    return {
      id: other,
      name: edge.name,
      direction,
      arrow: direction === "out" ? `--${edge.name}-->` : `<--${edge.name}--`,
      type: node ? node.type : "",
      text: node ? node.text : "",
    };
  };
  return {
    out: view.edges.filter((edge) => edge.source === id).map((edge) => item(edge, "out")),
    in: view.edges.filter((edge) => edge.target === id).map((edge) => item(edge, "in")),
  };
}

/**
 * 出所 (`examples/sample.py:42`) を GitHub の blob URL にする。
 *
 * repo は `site_data()` の `repo` (`req site --repo-url / --repo-ref` で入る)。
 * 渡されていなければ null を返し、呼び出し側はただの文字列として出す。
 *
 * 出所は生成時の作業ディレクトリからの相対パスなので、絶対パスのときは
 * リポジトリ内の位置が決まらない。黙って null にする (誤ったリンクは出さない)。
 */
export function sourceUrl(data, location) {
  const repo = (data || {}).repo;
  if (!repo || !repo.url || !location) return null;
  const match = /^(.+?)(?::(\d+))?$/.exec(String(location).trim());
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

// --- 指摘一覧 --------------------------------------------------------------
//
// 指摘は数が増えるほど「重い順に 1 本の帯」では読めなくなる。重大度で絞り、
// 残ったものをチェックコードごとにまとめる。同じ規則の違反はまとめて片付ける
// (あるいはまとめて抑制する) ものなので、コードが読む単位になる。

/** 重大度タブの「すべて」の key。 */
export const ALL_SEVERITIES = "all";

/**
 * 重大度タブ。件数が 0 の重大度は出さない (押しても何も起きないタブを並べない)。
 * 「すべて」は指摘が 1 件も無くても出す。
 */
export function severityTabs(findings) {
  const counts = new Map();
  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) || 0) + 1);
  }
  return [
    { key: ALL_SEVERITIES, label: "すべて", count: findings.length },
    ...SEVERITY_ORDER.filter((severity) => counts.get(severity)).map((severity) => ({
      key: severity,
      label: severity,
      count: counts.get(severity),
    })),
  ];
}

/**
 * 指摘をチェックコードごとにまとめる。severity を渡すとその重大度だけに絞る。
 *
 * 群の並びは「その群で最も重い指摘」の重大度 → コード名。群の中は渡された順
 * (Python 側が重い順に並べたもの) のまま。
 */
export function groupFindings(findings, severity = ALL_SEVERITIES) {
  const groups = new Map();
  for (const finding of findings) {
    if (severity !== ALL_SEVERITIES && finding.severity !== severity) continue;
    if (!groups.has(finding.code)) groups.set(finding.code, []);
    groups.get(finding.code).push(finding);
  }
  //: 知らない重大度は最も軽いものとして扱う (並びが未定義にならないように)。
  const severityRank = (finding) => {
    const at = SEVERITY_ORDER.indexOf(finding.severity);
    return at < 0 ? SEVERITY_ORDER.length : at;
  };
  return [...groups.entries()]
    .map(([code, items]) => ({ code, items, rank: Math.min(...items.map(severityRank)) }))
    .sort((a, b) => a.rank - b.rank || compare(a.code, b.code))
    .map(({ code, items, rank }) => ({
      code,
      items,
      severity: SEVERITY_ORDER[rank] || items[0].severity,
    }));
}

