/** Python の正規化モデルと Web UI の間にある読み取り専用データ境界。 */
export type NodeId = string;
export type EdgeKey = string;
export type Severity = "error" | "warning" | "info";

export interface SourceLocation { path: string; line?: number; column?: number }
export interface Reference { label?: string; url?: string; node?: NodeId }
export interface NormalizedNode {
  id: NodeId;
  type: string;
  title?: string;
  description?: string;
  status?: string;
  group?: string;
  location?: SourceLocation;
  references?: readonly Reference[];
  [field: string]: unknown;
}
export interface NormalizedEdge {
  source: NodeId;
  target: NodeId;
  type: string;
  key?: EdgeKey;
  [field: string]: unknown;
}
export interface RequirementGroup {
  id: string;
  title?: string;
  requirements: readonly NodeId[];
  [field: string]: unknown;
}
export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  node_id?: NodeId;
  location?: SourceLocation;
  [field: string]: unknown;
}
export interface RenderTypeMetadata {
  label: string;
  fill: string;
  stroke: string;
  dark_fill?: string;
  dark_stroke?: string;
  shape?: string;
}
export interface RenderMetadata {
  types: Readonly<Record<string, RenderTypeMetadata>>;
  [field: string]: unknown;
}
export interface SiteData {
  nodes: readonly NormalizedNode[];
  edges: readonly NormalizedEdge[];
  requirement_groups: readonly RequirementGroup[];
  findings: readonly Finding[];
  meta: RenderMetadata;
  [field: string]: unknown;
}
export interface ViewState {
  selected: NodeId | null;
  query: string;
  mode: "graph" | "table";
  focus: string;
  depth: number;
  [field: string]: unknown;
}
export interface Point { x: number; y: number }
export interface LayoutNode extends Point { width: number; height: number }
export interface LayoutResult {
  nodes: ReadonlyMap<NodeId, LayoutNode>;
  width: number;
  height: number;
}
export interface GraphNodeElement { id: NodeId; group: SVGGElement; shape: SVGElement }
export interface GraphEdgeElement { key: EdgeKey; group: SVGGElement; path: SVGPathElement }
