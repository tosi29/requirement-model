/** テスト用の埋め込みデータ。`site_data()` が出す形の最小版。 */

import { initialSelection } from "../../src/reqmodel/site_logic.js";

export const EDGE_NAMES = [
  "has_source",
  "refines",
  "motivates",
  "satisfies",
  "conflicts",
  "qualifies",
  "constrains",
  "resolves",
];

export const EDGE_NAMES_BY_TYPE = {
  Goal: ["has_source", "refines", "motivates"],
  Need: ["has_source"],
  FunctionalRequirement: ["has_source", "satisfies", "refines", "conflicts"],
  QualityRequirement: ["has_source", "qualifies", "conflicts"],
  Constraint: ["has_source", "constrains"],
  Decision: ["resolves"],
  System: [],
  Source: [],
};

export const STATUS_RANK = {
  proposed: 0,
  approved: 1,
  implemented: 2,
  verified: 3,
};

export const TYPES = [
  "Goal",
  "Need",
  "FunctionalRequirement",
  "QualityRequirement",
  "Constraint",
  "Decision",
  "System",
  "Source",
];

//: 図に既定で描かないもの (`site_data()` の hidden_by_default と同じ形)。
export const HIDDEN_BY_DEFAULT = {
  types: ["Source"],
  edges: ["has_source", "part_of"],
};

/**
 * G-1 --motivates--> N-1 <--satisfies-- FR-1 <--qualifies-- QR-1
 * 全ノードが SRC-1 を has_source で参照する。
 */
export function fixture(overrides = {}) {
  const nodes = [
    {
      type: "Goal",
      id: "G-1",
      text: "経費精算を速くする",
      status: "approved",
      priority: 1,
      has_source: ["SRC-1"],
      decomposition: "AND",
      refines: [],
      motivates: ["N-1"],
    },
    {
      type: "Need",
      id: "N-1",
      text: "領収書を撮影するだけで申請したい",
      status: "approved",
      priority: null,
      has_source: ["SRC-1"],
    },
    {
      type: "FunctionalRequirement",
      id: "FR-1",
      text: "領収書画像から金額を抽出すること",
      status: "proposed",
      priority: 2,
      has_source: ["SRC-1"],
      acceptance_criteria: ["正解率が 95% 以上である"],
      satisfies: ["N-1"],
      refines: [],
      conflicts: [],
    },
    {
      type: "QualityRequirement",
      id: "QR-1",
      text: "抽出は 3 秒以内に終わること",
      status: "proposed",
      priority: null,
      has_source: [],
      acceptance_criteria: [],
      qualifies: ["FR-1"],
      conflicts: [],
    },
    {
      type: "Source",
      id: "SRC-1",
      text: "申請者となる一般社員",
      status: "proposed",
      priority: null,
      kind: "stakeholder",
    },
  ];

  const edges = [
    { source: "G-1", name: "has_source", target: "SRC-1" },
    { source: "G-1", name: "motivates", target: "N-1" },
    { source: "N-1", name: "has_source", target: "SRC-1" },
    { source: "FR-1", name: "has_source", target: "SRC-1" },
    { source: "FR-1", name: "satisfies", target: "N-1" },
    { source: "QR-1", name: "qualifies", target: "FR-1" },
  ];

  return {
    title: "テスト",
    generated_from: ["t.py"],
    types: TYPES,
    edge_names: EDGE_NAMES,
    hidden_by_default: HIDDEN_BY_DEFAULT,
    edge_names_by_type: EDGE_NAMES_BY_TYPE,
    status_rank: STATUS_RANK,
    nodes,
    edges,
    findings: [],
    stats: { nodes: nodes.length, edges: edges.length, findings: {} },
    //: 呼ぶたびに複製する。META をそのまま渡すと、書き換えるテストの影響が
    //: 後続のテストに漏れる (実行順で結果が変わる)。
    meta: structuredClone(META),
    ...overrides,
  };
}

//: 外形の係数 (render_meta の types[].fit)。ここでは全型を ellipse で代表させる。
export const ELLIPSE_FIT = { wmul: 1.42, wpad: 14, hmul: 1.42, hpad: 10 };

/**
 * 大きい合成グラフ。`examples/bench.py` と同じ形 (1 本の Goal 木 → Need →
 * 同じ段に大量に並ぶ FR → QR) を JS 側だけで組む。
 *
 * スケール時の振る舞い (探索の計算量・フォーカスの効き) を、Python を通さずに
 * テストとベンチから使うためのもの。件数を渡せば任意の規模になる。
 */
export function largeFixture({ goals = 12, needs = 24, frs = 200, qrs = 60, sources = 3 } = {}) {
  const nodes = [];
  const edges = [];
  const link = (source, name, target) => edges.push({ source, name, target });
  const pick = (index, count) => (index % count) + 1;

  for (let i = 1; i <= goals; i++) {
    const id = `G-${i}`;
    nodes.push({
      type: "Goal",
      id,
      text: `ゴール ${i}`,
      status: "approved",
      priority: i <= 2 ? 1 : null,
      decomposition: "AND",
    });
    //: 二分木にして、Goal を何段かの refines で積む。
    if (i > 1) link(id, "refines", `G-${Math.floor(i / 2)}`);
    link(id, "has_source", `SRC-${pick(i, sources)}`);
  }

  for (let i = 1; i <= needs; i++) {
    const id = `N-${i}`;
    nodes.push({ type: "Need", id, text: `ニーズ ${i} を満たしたい`, status: "approved", priority: null });
    //: 葉に近い Goal (後半) から動機づける。
    link(`G-${goals - (i % Math.max(1, Math.floor(goals / 2)))}`, "motivates", id);
    link(id, "has_source", `SRC-${pick(i, sources)}`);
  }

  for (let i = 1; i <= frs; i++) {
    const id = `FR-${i}`;
    nodes.push({
      type: "FunctionalRequirement",
      id,
      text: `機能 ${i} を提供すること`,
      status: i % 3 === 0 ? "implemented" : "approved",
      priority: i % 11 === 0 ? 1 : null,
      acceptance_criteria: [`機能 ${i} の受け入れ基準`],
    });
    link(id, "satisfies", `N-${pick(i, needs)}`);
    link(id, "has_source", `SRC-${pick(i, sources)}`);
    //: 一部は FR どうしで詳細化する (同じ段に並びきらない枝を作る)。
    if (i % 5 === 0) link(id, "refines", `FR-${i - 1}`);
  }

  for (let i = 1; i <= qrs; i++) {
    const id = `QR-${i}`;
    nodes.push({
      type: "QualityRequirement",
      id,
      text: `品質 ${i} を保つこと`,
      status: "proposed",
      priority: null,
      acceptance_criteria: [`品質 ${i} の受け入れ基準`],
    });
    link(id, "qualifies", `FR-${pick(i, frs)}`);
    link(id, "has_source", `SRC-${pick(i, sources)}`);
  }

  for (let i = 1; i <= sources; i++) {
    nodes.push({
      type: "Source",
      id: `SRC-${i}`,
      text: `源泉 ${i}`,
      status: "approved",
      priority: null,
      kind: "stakeholder",
    });
  }

  return {
    title: "大きいテスト",
    generated_from: ["bench.py"],
    types: TYPES,
    edge_names: EDGE_NAMES,
    hidden_by_default: HIDDEN_BY_DEFAULT,
    edge_names_by_type: EDGE_NAMES_BY_TYPE,
    status_rank: STATUS_RANK,
    nodes,
    edges,
    findings: [],
    stats: { nodes: nodes.length, edges: edges.length, findings: {} },
    meta: structuredClone(META),
  };
}

export const META = {
  types: Object.fromEntries(
    TYPES.map((type) => [
      type,
      {
        shape: "ellipse",
        fill: "#fff",
        stroke: "#000",
        fit: ELLIPSE_FIT,
        //: Mermaid の形状。ここも全型を楕円 "( )" で代表させる。
        mermaid: { open: "(", close: ")" },
      },
    ]),
  ),
  //: 並びは成熟度 (STATUS_RANK) の順。線種だけで 4 つを区別できるようにしてある。
  statuses: {
    proposed: { border_style: "dotted", border_width: 1.5 },
    approved: { border_style: "dashed", border_width: 1.5 },
    implemented: { border_style: "solid", border_width: 2 },
    verified: { border_style: "double", border_width: 4 },
  },
  priority: { threshold: 2, outline: "#f9ab00" },
  bands: [
    { type: "Goal", label: "Goal (最上位)" },
    { type: "Need", label: "Need (上位)" },
  ],
  dashed_edges: ["conflicts", "has_source"],
  impact_colors: {
    selected: "#d93025",
    upstream: "#1a73e8",
    downstream: "#188038",
    related: "#8430ce",
  },
  search: { hit: "#00b8d4" },
};

/** すべて表示した state (Source と源泉エッジも出す)。 */
export function allOn(data) {
  return {
    types: new Set(data.types),
    edges: new Set(data.edge_names),
    statuses: new Set(Object.keys(data.meta.statuses)),
    priorities: new Set(["high", "normal", "none"]),
  };
}

/**
 * ページの初期 state。`allOn()` との違いは Source と源泉エッジが外れていること
 * (`defaultState()` と同じ選択)。既定の振る舞いを見るテストはこちらを使う。
 */
export function defaultOn(data) {
  return {
    ...allOn(data),
    types: new Set(initialSelection(data, data.types, "types")),
    edges: new Set(initialSelection(data, data.edge_names, "edges")),
  };
}
