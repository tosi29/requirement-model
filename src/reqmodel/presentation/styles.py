"""Presentation-only node shapes, colors, and browser rendering metadata."""

from __future__ import annotations

from typing import Any

from ..definition import (Constraint, FunctionalRequirement, Goal, Need, Node, QualityRequirement, Source)
from ..core.metamodel import TYPE_ORDER
from ..definition.nodes import STATUS_RANK

#: 型 → Mermaid のノード形状 (前置き, 後置き)
_MERMAID_SHAPE: dict[type[Node], tuple[str, str]] = {
    Goal: ("{{", "}}"),
    Need: ("(", ")"),
    FunctionalRequirement: ("[", "]"),
    QualityRequirement: ("[/", "/]"),
    Constraint: ("[[", "]]"),
    Source: ("[(", ")]"),
}

#: 型 → (塗り, 線) の配色。形状以外の見た目はここが唯一の出典。
_PALETTE: dict[str, tuple[str, str]] = {
    "Goal": ("#e8f0fe", "#3b6fd4"),
    "Need": ("#e9f7ef", "#2f9e5f"),
    "FunctionalRequirement": ("#fff8e1", "#c9971c"),
    "QualityRequirement": ("#fdeef4", "#c2557f"),
    "Constraint": ("#f2f2f2", "#777777"),
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

#: 検索ヒットの暈し (halo) の色。枠線は型 (色) と status (線種)、枠線の色と太さは
#: 影響範囲で埋まっているので、検索はノードの下に敷く underlay を使う。
#: 他のどの表現とも property が衝突しない。
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
    Source: "cylinder",
}

_EDGE_STYLE_MERMAID = {
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
    """型・status ごとの描画情報。ブラウザ側 (Cytoscape.js) の初期化に使う。

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
