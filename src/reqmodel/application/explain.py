"""影響部分グラフの抽出とテキスト化 (LLM コンテキスト生成)。"""

from __future__ import annotations

from typing import Iterable, Sequence

from ..core.graph import RequirementGraph
from ..core.metamodel import edge_specs_for
from ..core.projection import DEFAULT_GRAPH_EDGE_NAMES
from ..definition import Reference

__all__ = ["impact_set", "explain_text", "subgraph_edges", "traversed_edges"]


def traversed_edges(edge_names: Iterable[str] | None) -> list[str] | None:
    """実際に辿るエッジ種別。``None`` は「全種別」。"""
    if edge_names is not None:
        return list(edge_names)
    return list(DEFAULT_GRAPH_EDGE_NAMES)


def impact_set(
    graph: RequirementGraph,
    targets: Sequence[str],
    edge_names: Iterable[str] | None = None,
    depth: int | None = None,
    undirected: bool = False,
) -> tuple[set[str], set[str], set[str]]:
    """(上流, 下流, 全体) を返す。全体には対象ノード自身を含む。"""
    names = traversed_edges(edge_names)
    known = set(targets) & set(graph.nodes)

    if undirected:
        related: set[str] = set()
        for target in targets:
            related |= graph.related(target, names, depth)
        related -= known
        return set(), related, related | known

    ancestors: set[str] = set()
    descendants: set[str] = set()
    for target in targets:
        ancestors |= graph.ancestors(target, names, depth)
        descendants |= graph.descendants(target, names, depth)
    ancestors -= known
    descendants -= known
    return ancestors, descendants, ancestors | descendants | known


def subgraph_edges(graph: RequirementGraph, node_ids: set[str]) -> list:
    """両端が部分グラフに含まれるエッジ。"""
    return [
        edge
        for edge in graph.edges
        if edge.source in node_ids and edge.target in node_ids
    ]


def _reference_line(label: str, reference: Reference) -> list[str]:
    suffix = f" <{reference.url}>" if reference.url else ""
    lines = [f"    {label}: {reference.title}{suffix}"]
    if reference.note:
        lines.append(f"      note: {reference.note}")
    return lines


def _describe(graph: RequirementGraph, node_id: str) -> list[str]:
    node = graph.nodes[node_id]
    type_name = type(node).__name__
    lines = [f"- [{type_name}] {node.id}: {node.text}", f"    (status={node.status})"]
    for reference in getattr(node, "source", []) or []:
        lines.extend(_reference_line("Source", reference))
    for reference in getattr(node, "realized_by", []) or []:
        lines.extend(_reference_line("Realized by", reference))
    for reference in getattr(node, "evidence", []) or []:
        lines.extend(_reference_line("Evidence", reference))
    for criterion in getattr(node, "acceptance_criteria", []) or []:
        lines.append(f"    受け入れ基準: {criterion}")
    return lines


def explain_text(
    graph: RequirementGraph,
    targets: Sequence[str],
    edge_names: Iterable[str] | None = None,
    depth: int | None = None,
    undirected: bool = False,
) -> str:
    """影響部分グラフを LLM に渡せる形に整形する。"""
    missing = [t for t in targets if t not in graph.nodes]
    ancestors, descendants, whole = impact_set(
        graph, targets, edge_names, depth, undirected
    )

    lines: list[str] = []
    lines.append("# 影響部分グラフ: " + ", ".join(targets))
    if missing:
        lines.append("")
        lines.append("存在しないノード: " + ", ".join(missing))
    lines.append("")
    if undirected:
        lines.append(
            f"対象 {len(whole) - len(descendants)} 件 / "
            f"関連 {len(descendants)} 件 / 合計 {len(whole)} 件"
        )
        lines.append("探索方向: 無向 (エッジの向きを無視)")
    else:
        lines.append(
            f"対象 {len([t for t in targets if t in graph.nodes])} 件 / "
            f"上流 {len(ancestors)} 件 / 下流 {len(descendants)} 件 / "
            f"合計 {len(whole)} 件"
        )
    if edge_names is not None:
        lines.append("エッジ種別フィルタ: " + ", ".join(edge_names))
    if depth is not None:
        lines.append(f"探索深さ: {depth}")

    order = {node.id: i for i, node in enumerate(graph.ordered_nodes())}

    def block(title: str, ids: Iterable[str]) -> None:
        sorted_ids = sorted(ids, key=lambda i: order.get(i, 10**6))
        if not sorted_ids:
            return
        lines.append("")
        lines.append(f"## {title} ({len(sorted_ids)} 件)")
        for node_id in sorted_ids:
            lines.extend(_describe(graph, node_id))

    block("対象ノード", [t for t in targets if t in graph.nodes])
    if undirected:
        block("関連ノード (向きを問わず繋がっているノード)", descendants)
    else:
        block("上流 (この変更の理由・根拠になるノード)", ancestors)
        block("下流 (この変更の影響を受けるノード)", descendants)

    edges = subgraph_edges(graph, whole)
    if edges:
        lines.append("")
        lines.append(f"## 部分グラフのエッジ ({len(edges)} 件)")
        for edge in sorted(
            edges, key=lambda e: (order.get(e.source, 10**6), e.name, e.target)
        ):
            lines.append(f"- {edge.source} --{edge.name}--> {edge.target}")

    unused = [
        name
        for name in _all_edge_names(graph)
        if not any(e.name == name for e in edges)
    ]
    if unused:
        lines.append("")
        lines.append("(部分グラフに現れなかったエッジ種別: " + ", ".join(unused) + ")")

    return "\n".join(lines) + "\n"


def _all_edge_names(graph: RequirementGraph) -> list[str]:
    names: list[str] = []
    for node in graph.ordered_nodes():
        for name in edge_specs_for(type(node)):
            if name not in names:
                names.append(name)
    return names
