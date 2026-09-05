/** Python の正規化モデルと Web UI の間にある読み取り専用データ境界。 */
export type NodeId = string;
export type Direction = "TD" | "LR";
export type ViewMode = "graph" | "table";
export type Theme = "auto" | "light" | "dark";
export type Severity = "error" | "severe" | "warning" | "info";

export type SourceLocation = string;
export interface ExternalReference { title: string; url?: string | null; note?: string | null }

export interface NormalizedNode {
  id: NodeId;
  type: string;
  text: string;
  status: string;
  kind?: string | null;
  location?: SourceLocation | null;
  source?: readonly ExternalReference[];
  realized_by?: readonly ExternalReference[];
  evidence?: readonly ExternalReference[];
  acceptance_criteria?: readonly string[];
  suppress?: readonly (readonly [string, string])[];
  [field: string]: unknown;
}

export interface NormalizedEdge { source: NodeId; target: NodeId; name: string }
export interface RequirementGroup { id: string; label: string; order: number; members: readonly NodeId[] }
export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  layer: number;
  node_id?: NodeId | null;
  location?: SourceLocation | null;
}

export interface RenderTypeMetadata {
  fill?: string;
  stroke?: string;
  dark_fill?: string;
  dark_stroke?: string;
  shape?: string;
  fit?: { wmul: number; wpad: number; hmul: number; hpad: number };
  mermaid?: { open: string; close: string };
}
export interface RenderStatusMetadata { border_style: string; border_width: number }
export interface RenderMetadata {
  types: Readonly<Record<string, RenderTypeMetadata>>;
  statuses: Readonly<Record<string, RenderStatusMetadata>>;
  bands?: readonly { type: string; label: string }[];
  dashed_edges?: readonly string[];
  impact_colors?: Readonly<Record<"selected" | "upstream" | "downstream" | "related", string>>;
  search?: { hit?: string };
}

export interface SiteStats {
  nodes: number;
  edges: number;
  findings: Readonly<Record<Severity, number>>;
  suppressed: number;
}
export interface SiteData {
  title: string;
  generated_from: readonly string[];
  repo: { url: string; ref: string } | null;
  schema_version: number;
  types: readonly string[];
  edge_names: readonly string[];
  hidden_by_default: { types: readonly string[]; edges: readonly string[] };
  status_rank: Readonly<Record<string, number>>;
  edge_names_by_type: Readonly<Record<string, readonly string[]>>;
  requirement_groups: readonly RequirementGroup[];
  nodes: readonly NormalizedNode[];
  edges: readonly NormalizedEdge[];
  findings: readonly Finding[];
  stats: SiteStats;
  meta: RenderMetadata;
}

export interface SortState { key: string; asc: boolean }
export interface ViewState {
  types: Set<string>;
  edges: Set<string>;
  statuses: Set<string>;
  selected: NodeId | null;
  direction: Direction;
  mode: ViewMode;
  query: string;
  focus: number;
  depth: number;
  undirected: boolean;
  sort: SortState;
}

export interface Adjacency { out: NodeId[]; in: NodeId[] }
export interface GraphViewModel {
  data: SiteData;
  state: ViewState;
  byId: Map<NodeId, NormalizedNode>;
  nodes: NormalizedNode[];
  edges: NormalizedEdge[];
  order: Map<NodeId, number>;
  adjacency: Map<NodeId, Adjacency>;
}

export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
export interface Box extends Point, Size {}
export interface Extent { x1: number; y1: number; x2: number; y2: number }
export interface LayoutResult { positions: Map<NodeId, Point>; frames: Map<string, Box> }

export interface GraphNodeElement extends Box {
  id: NodeId;
  type: string;
  status: string;
  shapeName?: string;
  group: SVGGElement;
  shape: SVGGraphicsElement;
  statusRing: SVGGraphicsElement;
  label: SVGTextElement;
}
export interface GraphBandElement extends Box {
  id: string;
  bandType?: string;
  bandKey?: string;
  label: SVGTextElement;
  group: SVGGElement;
  shape: SVGRectElement;
}
export interface GraphEdgeElement {
  id: string;
  index: number;
  source: NodeId;
  target: NodeId;
  name: string;
  group: SVGGElement;
  path: SVGPathElement;
  label: SVGTextElement;
  parallelOffset?: number;
  points: Point[];
  route?: Point[];
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

export interface GraphElementDefinition {
  data: {
    id: string;
    type?: string;
    status?: string;
    label?: string;
    w?: number;
    h?: number;
    index?: number;
    source?: string;
    target?: string;
    name?: string;
    band?: boolean;
    bandType?: string;
    bandKey?: string;
  };
  classes?: string;
  selectable?: boolean;
  grabbable?: boolean;
}

export interface DagreGraph {
  setGraph(options: Record<string, unknown>): void;
  setDefaultEdgeLabel(factory: () => Record<string, unknown>): void;
  setNode(id: string, value: { width: number; height: number }): void;
  setEdge(source: string, target: string, value: { width: number; height: number }, name: string): void;
  nodes(): string[];
  node(id: string): Point;
}

declare global {
  interface Window {
    dagre?: {
      graphlib: { Graph: new (options: { multigraph: boolean }) => DagreGraph };
      layout(graph: DagreGraph): void;
    };
  }
}
