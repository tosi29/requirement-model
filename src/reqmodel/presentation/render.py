"""グラフ出力 (Mermaid / DOT)。"""

from __future__ import annotations

from typing import Any, Iterable

from ..core.graph import Edge, RequirementGraph
from ..core.metamodel import TYPE_ORDER
from ..definition import (
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    Node,
    QualityRequirement,
)
from ..definition.nodes import STATUS_RANK

__all__ = ["render_mermaid", "render_dot", "render_meta", "FORMATS"]

FORMATS = ("mermaid", "dot")

from .styles import (
    _DOT_SHAPE,
    _EDGE_STYLE_MERMAID,
    _MERMAID_CLASSDEF,
    _MERMAID_SHAPE,
    _mermaid_shape_of_type,
    render_meta,
)
from .view import RequirementGroup


def _truncate(text: str, limit: int) -> str:
    text = " ".join(text.split())
    if limit > 0 and len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def _ids(nodes: Iterable[Node]) -> dict[str, str]:
    """ノード id → Mermaid / DOT の識別子 (``n1``, ``n2``, …)。

    元の id から識別子を作ると、記号を潰した結果が衝突する。``FR-1`` と ``FR_1``
    はモデルとしては別ノードだが、非英数字を ``_`` に置き換えると同じ識別子になり、
    図の上で 1 ノードに融合してしまう (ラベルは後勝ち、エッジも合流する)。
    黙って壊れるのを避けるため、``ordered_nodes()`` の索引で連番を振る。

    - 衝突が構造的に起こり得ない (エスケープ規則を設計・検証しなくてよい)
    - Mermaid / DOT の識別子として常に安全
    - 元の id はラベルに出るので、表示上の情報は失われない

    並びは ``ordered_nodes()`` (型順 → id 順) が唯一の出典なので、同じモデルから
    は常に同じ識別子が出る。
    """
    return {node.id: f"n{index}" for index, node in enumerate(nodes, 1)}


def _drawn(
    graph: RequirementGraph, include_sources: bool
) -> tuple[list[Node], list[Edge]]:
    """図に出すノードとエッジ。

    ``include_sources`` は旧 CLI オプションとの内部互換のため受け取るが、
    Source ノードはメタモデルから無くなったので描画対象は常に同じである。
    """
    _ = include_sources
    return graph.ordered_nodes(), list(graph.edges)


def _mermaid_shape(node: Node) -> tuple[str, str]:
    for node_type, shape in _MERMAID_SHAPE.items():
        if isinstance(node, node_type):
            return shape
    raise KeyError(type(node).__name__)  # pragma: no cover


def _dot_shape_of(node: Node) -> str:
    for node_type, shape in _DOT_SHAPE.items():
        if isinstance(node, node_type):
            return shape
    raise KeyError(type(node).__name__)  # pragma: no cover


def _mermaid_escape(text: str) -> str:
    return (
        text.replace("\\", "＼")
        .replace('"', "#quot;")
        .replace("<", "#lt;")
        .replace(">", "#gt;")
    )


def _requirement_group_members(
    nodes: Iterable[Node], requirement_groups: Iterable[RequirementGroup]
) -> tuple[list[tuple[str, str, list[str]]], list[str]]:
    """表示用グループごとの主所属と未分類要求。

    同じ要求が複数グループに書かれても、描くのは最初のグループだけにする。
    """
    requirement_ids = {
        node.id
        for node in nodes
        if isinstance(node, (FunctionalRequirement, QualityRequirement, Constraint))
    }
    assigned: set[str] = set()
    groups: list[tuple[str, str, list[str]]] = []
    for group in sorted(requirement_groups, key=lambda item: (item.order, item.id)):
        members: list[str] = []
        for member in group.members:
            node_id = str(member)
            if node_id not in requirement_ids or node_id in assigned:
                continue
            assigned.add(node_id)
            members.append(node_id)
        if members:
            groups.append((group.id, group.label, members))
    return groups, sorted(requirement_ids - assigned)


def render_mermaid(
    graph: RequirementGraph,
    max_label: int = 40,
    highlight: Iterable[str] | None = None,
    include_sources: bool = False,
    requirement_groups: Iterable[RequirementGroup] = (),
) -> str:
    lines = ["flowchart TD"]
    highlighted = set(highlight or ())
    nodes, drawn_edges = _drawn(graph, include_sources)
    ids = _ids(nodes)

    node_lines: dict[str, str] = {}
    for node in nodes:
        open_shape, close_shape = _mermaid_shape(node)
        type_name = type(node).__name__
        label = "<br/>".join(
            [
                f"<b>{node.id}</b> [{type_name}]",
                _mermaid_escape(_truncate(node.text, max_label)),
            ]
        )
        node_lines[node.id] = f'{ids[node.id]}{open_shape}"{label}"{close_shape}'

    declared_groups = tuple(requirement_groups)
    groups, unclassified = _requirement_group_members(nodes, declared_groups)
    use_group_layout = bool(declared_groups)
    grouped = (
        (
            {node_id for _, _, members in groups for node_id in members}
            | set(unclassified)
        )
        if use_group_layout
        else set()
    )
    bands = [
        ("Goal", "Goal", [node.id for node in nodes if isinstance(node, Goal)]),
        ("Need", "Need", [node.id for node in nodes if isinstance(node, Need)]),
    ]
    if use_group_layout:
        for key, label, members in bands:
            if not members:
                continue
            lines.append(f"    subgraph band_{key}[{label}]")
            lines.append("        direction LR")
            for node_id in members:
                lines.append(f"        {node_lines[node_id]}")
            lines.append("    end")
    if use_group_layout:
        lines.append("    subgraph band_Requirements[Requirements]")
        lines.append("        direction LR")
        for group_id, label, members in groups:
            lines.append(f"        subgraph group_{group_id}[{_mermaid_escape(label)}]")
            lines.append("            direction TB")
            for node_id in members:
                lines.append(f"            {node_lines[node_id]}")
            lines.append("        end")
        if unclassified:
            lines.append("        subgraph group___unclassified__[未分類]")
            lines.append("            direction TB")
            for node_id in unclassified:
                lines.append(f"            {node_lines[node_id]}")
            lines.append("        end")
        lines.append("    end")
    for node in nodes:
        if not use_group_layout or (
            node.id not in grouped and not isinstance(node, (Goal, Need))
        ):
            lines.append(f"    {node_lines[node.id]}")

    lines.append("")
    for edge in drawn_edges:
        if edge.source not in ids or edge.target not in ids:
            continue
        arrow = _EDGE_STYLE_MERMAID.get(edge.name, "-->")
        lines.append(f"    {ids[edge.source]} {arrow}|{edge.name}| {ids[edge.target]}")

    lines.append("")
    for type_name, style in _MERMAID_CLASSDEF.items():
        lines.append(f"    classDef {type_name} {style}")
    for node in nodes:
        lines.append(f"    class {ids[node.id]} {type(node).__name__}")

    if highlighted:
        lines.append("    classDef highlight stroke-width:3px,stroke:#d93025")
        for node_id in sorted(highlighted):
            if node_id in ids:
                lines.append(f"    class {ids[node_id]} highlight")

    return "\n".join(lines) + "\n"


def _dot_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')


def render_dot(
    graph: RequirementGraph,
    max_label: int = 40,
    highlight: Iterable[str] | None = None,
    include_sources: bool = False,
    requirement_groups: Iterable[RequirementGroup] = (),
) -> str:
    highlighted = set(highlight or ())
    lines = [
        "digraph requirements {",
        "    rankdir=BT;",
        '    node [fontname="sans-serif", style=filled, fillcolor=white];',
        '    edge [fontname="sans-serif", fontsize=10];',
    ]
    nodes, drawn_edges = _drawn(graph, include_sources)
    ids = _ids(nodes)
    node_lines: dict[str, str] = {}
    for node in nodes:
        shape = _dot_shape_of(node)
        label = _dot_escape(
            f"{node.id} [{type(node).__name__}]\\n{_truncate(node.text, max_label)}"
        )
        node_attrs = f'shape={shape}, label="{label}"'
        if node.id in highlighted:
            node_attrs += ', color="#d93025", penwidth=2'
        node_lines[node.id] = f"{ids[node.id]} [{node_attrs}];"

    declared_groups = tuple(requirement_groups)
    groups, unclassified = _requirement_group_members(nodes, declared_groups)
    use_group_layout = bool(declared_groups)
    grouped = (
        (
            {node_id for _, _, members in groups for node_id in members}
            | set(unclassified)
        )
        if use_group_layout
        else set()
    )
    if use_group_layout:
        for name, label, members in [
            ("Goal", "Goal", [node.id for node in nodes if isinstance(node, Goal)]),
            ("Need", "Need", [node.id for node in nodes if isinstance(node, Need)]),
        ]:
            if not members:
                continue
            lines.append(f"    subgraph cluster_{name} {{")
            lines.append(f'        label="{label}";')
            lines.append("        rank=same;")
            for node_id in members:
                lines.append(f"        {node_lines[node_id]}")
            lines.append("    }")
    if use_group_layout:
        lines.append("    subgraph cluster_Requirements {")
        lines.append('        label="Requirements";')
        for group_id, label, members in groups:
            lines.append(f"        subgraph cluster_group_{group_id} {{")
            lines.append(f'            label="{_dot_escape(label)}";')
            lines.append("            rank=same;")
            for node_id in members:
                lines.append(f"            {node_lines[node_id]}")
            lines.append("        }")
        if unclassified:
            lines.append("        subgraph cluster_group___unclassified__ {")
            lines.append('            label="未分類";')
            lines.append("            rank=same;")
            for node_id in unclassified:
                lines.append(f"            {node_lines[node_id]}")
            lines.append("        }")
        lines.append("    }")
    for node in nodes:
        if not use_group_layout or (
            node.id not in grouped and not isinstance(node, (Goal, Need))
        ):
            lines.append(f"    {node_lines[node.id]}")

    for edge in drawn_edges:
        if edge.source not in ids or edge.target not in ids:
            continue
        edge_attrs = [f'label="{edge.name}"']
        lines.append(
            f"    {ids[edge.source]} -> {ids[edge.target]} "
            f"[{', '.join(edge_attrs)}];"
        )
    lines.append("}")
    return "\n".join(lines) + "\n"


def render(
    graph: RequirementGraph,
    fmt: str = "mermaid",
    max_label: int = 40,
    highlight: Iterable[str] | None = None,
    include_sources: bool = False,
    requirement_groups: Iterable[RequirementGroup] = (),
) -> str:
    if fmt == "mermaid":
        return render_mermaid(
            graph, max_label, highlight, include_sources, requirement_groups
        )
    if fmt == "dot":
        return render_dot(
            graph, max_label, highlight, include_sources, requirement_groups
        )
    raise ValueError(f"未対応の形式: {fmt}")
