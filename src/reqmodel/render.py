"""グラフ出力 (Mermaid / DOT)。"""

from __future__ import annotations

from typing import Iterable

from typing import Any

from .graph import RequirementGraph
from .model import (
    HIGH_PRIORITY_THRESHOLD,
    STATUS_RANK,
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

#: 型 → (塗り, 線) の配色。形状以外の見た目はここが唯一の出典。
_PALETTE: dict[str, tuple[str, str]] = {
    "Goal": ("#e8f0fe", "#3b6fd4"),
    "Need": ("#e9f7ef", "#2f9e5f"),
    "FunctionalRequirement": ("#fff8e1", "#c9971c"),
    "QualityRequirement": ("#fdeef4", "#c2557f"),
    "Constraint": ("#f2f2f2", "#777777"),
    "Decision": ("#ede7f6", "#6f4fbf"),
    "System": ("#e0f7fa", "#3a97a8"),
    "Source": ("#ffffff", "#999999"),
}

_MERMAID_CLASSDEF = {
    type_name: f"fill:{fill},stroke:{stroke}"
    for type_name, (fill, stroke) in _PALETTE.items()
}

#: 型 → Cytoscape.js のノード形状。静的サイトの描画に使う。
_CYTOSCAPE_SHAPE: dict[type[Node], str] = {
    Goal: "hexagon",
    Need: "ellipse",
    FunctionalRequirement: "round-rectangle",
    QualityRequirement: "rhomboid",
    Constraint: "cut-rectangle",
    Decision: "diamond",
    System: "barrel",
    Source: "tag",
}

#: 影響範囲の色分け (選択 / 上流 / 下流)。
_IMPACT_COLORS = {
    "selected": "#d93025",
    "upstream": "#1a73e8",
    "downstream": "#188038",
}

#: status → 枠線の (線種, 太さ)。成熟するほど「実線に近く・太く」なる。
#:
#: 4 つの status が **線種だけで区別できる** ようにしてあるのが要点。影響範囲の
#: ハイライトは border-color と border-width を奪うので、太さに意味を持たせると
#: 強調中に status が読めなくなる。太さは線種の補強に留める。
_STATUS_BORDER: dict[str, tuple[str, float]] = {
    "proposed": ("dotted", 1.5),
    "approved": ("dashed", 1.5),
    "implemented": ("solid", 2),
    "verified": ("double", 4),
}

#: 高優先度 (priority <= HIGH_PRIORITY_THRESHOLD) を囲む輪の色。
#: 枠線は型 (色) と status (線種) で埋まっているので、その外側の outline を使う。
_HIGH_PRIORITY_OUTLINE = "#f9ab00"

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
    """型・status・優先度ごとの描画情報。ブラウザ側 (Cytoscape.js) の初期化に使う。

    形状・配色・線種の定義をこのモジュールに一本化し、静的サイト側に複製しない
    ための出口。凡例もここから作るので、定義を足せば凡例にも自動で並ぶ。
    """
    return {
        "types": {
            node_type.__name__: {
                "shape": _CYTOSCAPE_SHAPE[node_type],
                "fill": _PALETTE[node_type.__name__][0],
                "stroke": _PALETTE[node_type.__name__][1],
            }
            for node_type in TYPE_ORDER
        },
        # 並びは成熟度 (STATUS_RANK) を唯一の出典とする。凡例もこの順に出る。
        "statuses": {
            status: {
                "border_style": _STATUS_BORDER[status][0],
                "border_width": _STATUS_BORDER[status][1],
            }
            for status in sorted(STATUS_RANK, key=lambda name: STATUS_RANK[name])
        },
        "priority": {
            "threshold": HIGH_PRIORITY_THRESHOLD,
            "outline": _HIGH_PRIORITY_OUTLINE,
        },
        "dashed_edges": [
            name for name, arrow in _EDGE_STYLE_MERMAID.items() if arrow == "-.->"
        ],
        "impact_colors": dict(_IMPACT_COLORS),
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
