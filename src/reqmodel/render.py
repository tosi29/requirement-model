"""グラフ出力 (Mermaid / DOT)。"""

from __future__ import annotations

from typing import Iterable

from typing import Any

from .graph import Edge, RequirementGraph
from .model import (
    HIGH_PRIORITY_THRESHOLD,
    SOURCE_EDGES,
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

#: Cytoscape.js の形状 → ラベルを内側に収めるための外形の係数。
#: ``(幅の倍率, 幅の余白, 高さの倍率, 高さの余白)`` で、外形は
#: ``(テキスト幅 * 倍率 + 余白, テキスト高 * 倍率 + 余白)``。
#:
#: ラベルの外接矩形にそのまま合わせる (Cytoscape の ``width: "label"``) と、
#: 内側が矩形より狭い図形では文字が図形からはみ出す。中央に置いたテキスト矩形の
#: 大きさを外形に対する割合 (a = 幅の比, b = 高さの比) で見ると、図形ごとに
#: ``a <= f(b)`` の形の制約になる (Cytoscape の多角形は外形の矩形に内接するよう
#: 正規化されているので、比だけで決まる):
#:
#:   hexagon  … a <= 1 - b/2      左右の頂点に向かう斜辺が食い込む
#:   rhomboid … a <= 2/3 - b/3    上下の辺が幅の 1/3 ずつずれた平行四辺形
#:   tag      … a <= 1 - 3b/4     右端が尖る
#:   diamond  … a <= 1 - b
#:   ellipse  … a^2 + b^2 <= 1
#:   矩形系   … a <= 1            (cut-rectangle の隅の落ち・barrel の丸みは余白で吸収)
#:
#: b を決めれば倍率が決まる (高さの倍率 = 1/b、幅の倍率 = 1/f(b))。f はどれも b の
#: 非増加関数なので、余白を足して実際の a・b を狙いより小さくする限り制約は破れない。
_SHAPE_FIT: dict[str, tuple[float, float, float, float]] = {
    "round-rectangle": (1.0, 20, 1.0, 14),
    "cut-rectangle": (1.0, 26, 1.0, 20),
    "barrel": (1.0, 20, 1.0, 22),
    "hexagon": (1.70, 18, 1.25, 12),  # b = 0.80
    "rhomboid": (2.55, 18, 1.25, 12),  # b = 0.80
    "tag": (2.20, 16, 1.40, 12),  # b = 0.71
    "diamond": (2.05, 16, 2.05, 12),  # b = 0.49
    "ellipse": (1.42, 14, 1.42, 10),  # b = 1/√2
}

#: 影響範囲の色分け (選択 / 上流 / 下流 / 関連)。
#: 関連は無向で辿ったとき (``req explain --undirected`` 相当) の色で、
#: 上流と下流の区別が付かないことをそのまま 1 色で表す。
_IMPACT_COLORS = {
    "selected": "#d93025",
    "upstream": "#1a73e8",
    "downstream": "#188038",
    "related": "#8430ce",
}

#: 検索ヒットの暈し (halo) の色。枠線は型 (色) と status (線種)、その外側の輪は
#: 優先度、枠線の色と太さは影響範囲で埋まっているので、検索はノードの下に敷く
#: underlay を使う。他のどの表現とも property が衝突しない。
_SEARCH_HIT = "#00b8d4"

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

#: 静的サイトで帯 (枠) にまとめて上に出す型。並びがそのまま上からの帯の順になる。
#: Goal (最上位) → Need (上位) の階層が、エッジの向きに関わらず常に図の上に来る。
_BANDS: tuple[tuple[type[Node], str], ...] = (
    (Goal, "Goal (最上位)"),
    (Need, "Need (上位)"),
)

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
    "part_of": "-.->",
}


def _fit_of(shape: str) -> dict[str, float]:
    wmul, wpad, hmul, hpad = _SHAPE_FIT[shape]
    return {"wmul": wmul, "wpad": wpad, "hmul": hmul, "hpad": hpad}


def _mermaid_shape_of_type(node_type: type[Node]) -> tuple[str, str]:
    """型 (クラス) の Mermaid 形状。サブクラスは親の形状を継ぐ。"""
    for base, shape in _MERMAID_SHAPE.items():
        if issubclass(node_type, base):
            return shape
    raise KeyError(node_type.__name__)  # pragma: no cover


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
                # ラベルが図形の内側に収まる外形の決め方 (_SHAPE_FIT を参照)。
                "fit": _fit_of(_CYTOSCAPE_SHAPE[node_type]),
                # 画面から Mermaid を書き出す (絞り込み後の図) ときの形状。
                # 書式そのものは render_mermaid() と揃える。
                "mermaid": dict(
                    zip(("open", "close"), _mermaid_shape_of_type(node_type))
                ),
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
        "bands": [
            {"type": node_type.__name__, "label": label}
            for node_type, label in _BANDS
        ],
        "dashed_edges": [
            name for name, arrow in _EDGE_STYLE_MERMAID.items() if arrow == "-.->"
        ],
        "impact_colors": dict(_IMPACT_COLORS),
        "search": {"hit": _SEARCH_HIT},
    }


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

    既定では Source ノードと源泉エッジを落とす (理由は ``model.SOURCE_EDGES``)。
    識別子はここで残ったノードに振るので、除外しても連番に穴は空かない。
    """
    nodes = graph.ordered_nodes()
    edges = list(graph.edges)
    if include_sources:
        return nodes, edges
    nodes = [node for node in nodes if not isinstance(node, Source)]
    return nodes, [edge for edge in edges if edge.name not in SOURCE_EDGES]


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
        if edge.name in ("conflicts", "has_source"):
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
