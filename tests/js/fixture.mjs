/** テスト用の埋め込みデータ。`site_data()` が出す形の最小版。 */

import { initialSelection } from "../../src/reqmodel/presentation/site_logic.ts";

export const EDGE_NAMES = [
  "refines",
  "motivates",
  "satisfies",
  "qualifies",
  "constrains",
];

export const EDGE_NAMES_BY_TYPE = {
  Goal: ["refines", "motivates"],
  Need: [],
  FunctionalRequirement: ["satisfies", "refines"],
  QualityRequirement: ["qualifies"],
  Constraint: ["constrains"],
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
];

//: 図に既定で描かないもの (`site_data()` の hidden_by_default と同じ形)。
export const HIDDEN_BY_DEFAULT = {
  types: [],
  edges: [],
};

/**
 * Goal-1 --motivates--> Need-1 <--satisfies-- FR-1 <--qualifies-- QR-1
 * 外部参照は source / evidence の Reference 値としてノードに直接持つ。
 */
export function fixture(overrides = {}) {
  const nodes = [
    {
      type: "Goal",
      id: "Goal-1",
      text: "経費精算を速くする",
      status: "approved",
      source: [{ title: "申請者となる一般社員", url: "https://example.com/interviews/employee", note: "申請者ヒアリング" }],
      refines: [],
      motivates: ["Need-1"],
    },
    {
      type: "Need",
      id: "Need-1",
      text: "領収書を撮影するだけで申請したい",
      status: "approved",
      source: [{ title: "申請者となる一般社員", url: "https://example.com/interviews/employee", note: "申請者ヒアリング" }],
    },
    {
      type: "FunctionalRequirement",
      id: "FR-1",
      text: "領収書画像から金額を抽出すること",
      status: "proposed",
      source: [{ title: "申請者となる一般社員", url: "https://example.com/interviews/employee", note: "申請者ヒアリング" }],
      evidence: [{ title: "受入テスト第 1 回", url: "https://example.com/tests/receipt-ocr", note: "正解率 96%" }],
      acceptance_criteria: ["正解率が 95% 以上である"],
      satisfies: ["Need-1"],
      refines: [],
    },
    {
      type: "QualityRequirement",
      id: "QR-1",
      text: "抽出は 3 秒以内に終わること",
      status: "proposed",
      source: [],
      evidence: [],
      acceptance_criteria: [],
      qualifies: ["FR-1"],
    },
  ];

  const edges = [
    { source: "Goal-1", name: "motivates", target: "Need-1" },
    { source: "FR-1", name: "satisfies", target: "Need-1" },
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
export function largeFixture({ goals = 12, needs = 24, frs = 200, qrs = 60 } = {}) {
  const nodes = [];
  const edges = [];
  const link = (source, name, target) => edges.push({ source, name, target });
  const pick = (index, count) => (index % count) + 1;
  const reference = (index) => ({ title: `源泉 ${index}`, url: `https://example.com/source/${index}`, note: "合成データ" });

  for (let i = 1; i <= goals; i++) {
    const id = `G-${i}`;
    nodes.push({
      type: "Goal",
      id,
      text: `ゴール ${i}`,
      status: "approved",
    });
    //: 二分木にして、Goal を何段かの refines で積む。
    if (i > 1) link(id, "refines", `G-${Math.floor(i / 2)}`);
  }

  for (let i = 1; i <= needs; i++) {
    const id = `N-${i}`;
    nodes.push({ type: "Need", id, text: `ニーズ ${i} を満たしたい`, status: "approved", source: [reference(pick(i, 3))] });
    //: 葉に近い Goal (後半) から動機づける。
    link(`G-${goals - (i % Math.max(1, Math.floor(goals / 2)))}`, "motivates", id);
  }

  for (let i = 1; i <= frs; i++) {
    const id = `FR-${i}`;
    nodes.push({
      type: "FunctionalRequirement",
      id,
      text: `機能 ${i} を提供すること`,
      status: i % 3 === 0 ? "implemented" : "approved",
      source: [reference(pick(i, 3))],
      evidence: [{ title: `機能 ${i} の受入テスト結果`, url: `https://example.com/tests/fr-${i}` }],
      acceptance_criteria: [`機能 ${i} の受け入れ基準`],
    });
    link(id, "satisfies", `N-${pick(i, needs)}`);
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
      source: [reference(pick(i, 3))],
      evidence: [{ title: `品質 ${i} の計測結果`, url: `https://example.com/tests/qr-${i}` }],
      acceptance_criteria: [`品質 ${i} の受け入れ基準`],
    });
    link(id, "qualifies", `FR-${pick(i, frs)}`);
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
  bands: [
    { type: "Goal", label: "Goal (最上位)" },
    { type: "Need", label: "Need (上位)" },
  ],
  dashed_edges: [],
  impact_colors: {
    selected: "#d93025",
    upstream: "#1a73e8",
    downstream: "#188038",
    related: "#8430ce",
  },
  search: { hit: "#00b8d4" },
};

/** すべて表示した state。 */
export function allOn(data) {
  return {
    types: new Set(data.types),
    edges: new Set(data.edge_names),
    statuses: new Set(Object.keys(data.meta.statuses)),
  };
}

/**
 * ページの初期 state (`defaultState()` と同じ選択)。
 * 既定の振る舞いを見るテストはこちらを使う。
 */
export function defaultOn(data) {
  return {
    ...allOn(data),
    types: new Set(initialSelection(data, data.types, "types")),
    edges: new Set(initialSelection(data, data.edge_names, "edges")),
  };
}
