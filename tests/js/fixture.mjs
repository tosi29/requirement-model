/** テスト用の埋め込みデータ。`site_data()` が出す形の最小版。 */

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
    edge_names_by_type: EDGE_NAMES_BY_TYPE,
    status_rank: STATUS_RANK,
    nodes,
    edges,
    findings: [],
    stats: { nodes: nodes.length, edges: edges.length, findings: {} },
    meta: META,
    ...overrides,
  };
}

export const META = {
  types: Object.fromEntries(
    TYPES.map((type) => [type, { shape: "ellipse", fill: "#fff", stroke: "#000" }]),
  ),
  dashed_edges: ["conflicts", "has_source"],
  impact_colors: { selected: "#d93025", upstream: "#1a73e8", downstream: "#188038" },
};

/** 既定の state (すべて表示)。 */
export function allOn(data) {
  return { types: new Set(data.types), edges: new Set(data.edge_names) };
}
