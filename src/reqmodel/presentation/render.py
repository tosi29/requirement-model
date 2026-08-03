"""グラフ出力 (Mermaid / DOT)。"""

from __future__ import annotations

from typing import Any, Iterable

from ..core.graph import Edge, RequirementGraph
from ..core.metamodel import TYPE_ORDER
from ..core.projection import SOURCE_EDGE_NAMES
from ..definition import (
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    Node,
    QualityRequirement,
    Source,
    System,
)
from ..definition.nodes import STATUS_RANK

__all__ = ["render_mermaid", "render_dot", "render_meta", "FORMATS"]

FORMATS = ("mermaid", "dot")

from .styles import (
    _DOT_SHAPE, _EDGE_STYLE_MERMAID, _MERMAID_CLASSDEF, _MERMAID_SHAPE,
    _mermaid_shape_of_type, render_meta,
)

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

    既定では Source ノードと源泉エッジを落とす (理由は ``core.projection.SOURCE_EDGE_NAMES``)。
    識別子はここで残ったノードに振るので、除外しても連番に穴は空かない。
    """
    nodes = graph.ordered_nodes()
    edges = list(graph.edges)
    if include_sources:
        return nodes, edges
    nodes = [node for node in nodes if not isinstance(node, Source)]
    return nodes, [edge for edge in edges if edge.name not in SOURCE_EDGE_NAMES]


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


def render_mermaid(
    graph: RequirementGraph,
    max_label: int = 40,
    highlight: Iterable[str] | None = None,
    include_sources: bool = False,
) -> str:
    lines = ["flowchart TD"]
    highlighted = set(highlight or ())
    nodes, drawn_edges = _drawn(graph, include_sources)
    ids = _ids(nodes)

    for node in nodes:
        open_shape, close_shape = _mermaid_shape(node)
        type_name = type(node).__name__
        label = "<br/>".join(
            [
                f"<b>{node.id}</b> [{type_name}]",
                _mermaid_escape(_truncate(node.text, max_label)),
            ]
        )
        lines.append(
            f'    {ids[node.id]}{open_shape}"{label}"{close_shape}'
        )

    lines.append("")
    for edge in drawn_edges:
        if edge.source not in ids or edge.target not in ids:
            continue
        arrow = _EDGE_STYLE_MERMAID.get(edge.name, "-->")
        lines.append(
            f"    {ids[edge.source]} {arrow}|{edge.name}| {ids[edge.target]}"
        )

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
    for node in nodes:
        shape = _dot_shape_of(node)
        label = _dot_escape(
            f"{node.id} [{type(node).__name__}]\\n{_truncate(node.text, max_label)}"
        )
        node_attrs = f'shape={shape}, label="{label}"'
        if node.id in highlighted:
            node_attrs += ', color="#d93025", penwidth=2'
        lines.append(f"    {ids[node.id]} [{node_attrs}];")

    for edge in drawn_edges:
        if edge.source not in ids or edge.target not in ids:
            continue
        edge_attrs = [f'label="{edge.name}"']
        if edge.name == "has_source":
            edge_attrs.append("style=dashed")
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
) -> str:
    if fmt == "mermaid":
        return render_mermaid(graph, max_label, highlight, include_sources)
    if fmt == "dot":
        return render_dot(graph, max_label, highlight, include_sources)
    raise ValueError(f"未対応の形式: {fmt}")
