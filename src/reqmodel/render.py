"""グラフ出力 (Mermaid / DOT)。"""

from __future__ import annotations

from typing import Iterable

from typing import Any

from .graph import RequirementGraph
from .model import (
    TYPE_ORDER,
    Constraint,
    Decision,
    FunctionalRequirement,
    Goal,
    Need,
    Node,
    QualityRequirement,
    Source,
    System,
)

__all__ = ["render_mermaid", "render_dot", "render_meta", "FORMATS"]

FORMATS = ("mermaid", "dot")

#: 型 → Mermaid のノード形状 (前置き, 後置き)
_MERMAID_SHAPE: dict[type[Node], tuple[str, str]] = {
    Goal: ("{{", "}}"),
    Need: ("(", ")"),
    FunctionalRequirement: ("[", "]"),
    QualityRequirement: ("[/", "/]"),
    Constraint: ("[[", "]]"),
    Decision: ("{", "}"),
    System: ("([", "])"),
    Source: ("[(", ")]"),
}

_MERMAID_CLASSDEF = {
    "Goal": "fill:#e8f0fe,stroke:#3b6fd4",
    "Need": "fill:#e9f7ef,stroke:#2f9e5f",
    "FunctionalRequirement": "fill:#fff8e1,stroke:#c9971c",
    "QualityRequirement": "fill:#fdeef4,stroke:#c2557f",
    "Constraint": "fill:#f2f2f2,stroke:#777777",
    "Decision": "fill:#ede7f6,stroke:#6f4fbf",
    "System": "fill:#e0f7fa,stroke:#3a97a8",
    "Source": "fill:#ffffff,stroke:#999999",
}

_DOT_SHAPE: dict[type[Node], str] = {
    Goal: "hexagon",
    Need: "ellipse",
    FunctionalRequirement: "box",
    QualityRequirement: "parallelogram",
    Constraint: "note",
    Decision: "diamond",
    System: "box3d",
    Source: "cylinder",
}

_EDGE_STYLE_MERMAID = {
    "conflicts": "-.->",
    "has_source": "-.->",
}


def render_meta() -> dict[str, Any]:
    """型ごとの描画情報。ブラウザ側で Mermaid を組み立てるために書き出す。

    形状・配色の定義をこのモジュールに一本化し、静的サイト側に複製しないための出口。
    """
    return {
        "types": {
            node_type.__name__: {
                "shape": list(_MERMAID_SHAPE[node_type]),
                "style": _MERMAID_CLASSDEF[node_type.__name__],
            }
            for node_type in TYPE_ORDER
        },
        "edge_arrows": dict(_EDGE_STYLE_MERMAID),
        "default_arrow": "-->",
    }


def _truncate(text: str, limit: int) -> str:
    text = " ".join(text.split())
    if limit > 0 and len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def _safe_id(node_id: str) -> str:
    """Mermaid / DOT のノード識別子として使える形に直す。"""
    return "n_" + "".join(c if c.isalnum() or c == "_" else "_" for c in node_id)


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
) -> str:
    lines = ["flowchart TD"]
    highlighted = set(highlight or ())

    for node in graph.ordered_nodes():
        open_shape, close_shape = _mermaid_shape(node)
        type_name = type(node).__name__
        label = "<br/>".join(
            [
                f"<b>{node.id}</b> [{type_name}]",
                _mermaid_escape(_truncate(node.text, max_label)),
            ]
        )
        lines.append(
            f'    {_safe_id(node.id)}{open_shape}"{label}"{close_shape}'
        )

    lines.append("")
    for edge in graph.edges:
        if edge.target not in graph.nodes:
            continue
        arrow = _EDGE_STYLE_MERMAID.get(edge.name, "-->")
        lines.append(
            f"    {_safe_id(edge.source)} {arrow}|{edge.name}| {_safe_id(edge.target)}"
        )

    lines.append("")
    for type_name, style in _MERMAID_CLASSDEF.items():
        lines.append(f"    classDef {type_name} {style}")
    for node in graph.ordered_nodes():
        lines.append(f"    class {_safe_id(node.id)} {type(node).__name__}")

    if highlighted:
        lines.append("    classDef highlight stroke-width:3px,stroke:#d93025")
        for node_id in sorted(highlighted):
            if node_id in graph.nodes:
                lines.append(f"    class {_safe_id(node_id)} highlight")

    return "\n".join(lines) + "\n"


def _dot_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')


def render_dot(
    graph: RequirementGraph,
    max_label: int = 40,
    highlight: Iterable[str] | None = None,
) -> str:
    highlighted = set(highlight or ())
    lines = [
        "digraph requirements {",
        "    rankdir=BT;",
        '    node [fontname="sans-serif", style=filled, fillcolor=white];',
        '    edge [fontname="sans-serif", fontsize=10];',
    ]
    for node in graph.ordered_nodes():
        shape = _dot_shape_of(node)
        label = _dot_escape(
            f"{node.id} [{type(node).__name__}]\\n{_truncate(node.text, max_label)}"
        )
        node_attrs = f'shape={shape}, label="{label}"'
        if node.id in highlighted:
            node_attrs += ', color="#d93025", penwidth=2'
        lines.append(f"    {_safe_id(node.id)} [{node_attrs}];")

    for edge in graph.edges:
        if edge.target not in graph.nodes:
            continue
        edge_attrs = [f'label="{edge.name}"']
        if edge.name in ("conflicts", "has_source"):
            edge_attrs.append("style=dashed")
        lines.append(
            f"    {_safe_id(edge.source)} -> {_safe_id(edge.target)} "
            f"[{', '.join(edge_attrs)}];"
        )
    lines.append("}")
    return "\n".join(lines) + "\n"


def render(
    graph: RequirementGraph,
    fmt: str = "mermaid",
    max_label: int = 40,
    highlight: Iterable[str] | None = None,
) -> str:
    if fmt == "mermaid":
        return render_mermaid(graph, max_label, highlight)
    if fmt == "dot":
        return render_dot(graph, max_label, highlight)
    raise ValueError(f"未対応の形式: {fmt}")
