"""モデルの健全性メトリクス (req stats)。

``validate`` が個々の指摘を列挙するのに対し、ここは全体の傾向 (充足率・成熟度の
分布) を数える。**判定はしない。** 閾値も持たず、良し悪しも付けない。「充足率が
80% なのは良いのか」はモデルが置かれた文脈次第であり、機械が決められるのは
数と割合までである。

抑制 (``suppress``) は考慮しない。stats が測るのは CI の成否ではなくモデルの素の
状態なので、黙らせた曖昧語も 1 件として数える。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Sequence

from ..core.graph import RequirementGraph
from ..core.metamodel import EDGE_NAMES, TYPE_ORDER
from ..definition.nodes import STATUS_RANK
from ..definition import (
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    Node,
    QualityRequirement,
)
from .validate import validate_semantics_lexical

__all__ = [
    "Ratio",
    "Ambiguity",
    "Stats",
    "collect_stats",
    "render_stats",
    "DEFAULT_STATS_TITLE",
    "SOURCED_TYPES",
]

DEFAULT_STATS_TITLE = "モデル統計"

#: 源泉トレース率の母数。``structure.missing_source`` が見る集合と同じにする
#: (指摘の件数と率が食い違わないようにするため)。
SOURCED_TYPES: tuple[type[Node], ...] = (
    Goal,
    Need,
    FunctionalRequirement,
    QualityRequirement,
    Constraint,
)

#: 未達ノードを本文に並べる上限。超えた分は件数だけ出す。
MISSING_SHOWN = 5


def _ids(ids: Sequence[str]) -> str:
    if len(ids) <= MISSING_SHOWN:
        return ", ".join(ids)
    rest = len(ids) - MISSING_SHOWN
    return ", ".join(ids[:MISSING_SHOWN]) + f", ほか {rest} 件"


# ---------------------------------------------------------------------------
# 個々の指標
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Ratio:
    """「母数のうち条件を満たすものの割合」1 件。"""

    #: 機械可読な指標名 (JSON の鍵)。
    key: str
    label: str
    total: int
    #: 条件を満たさなかったノードの id。
    missing: tuple[str, ...] = ()

    @property
    def covered(self) -> int:
        return self.total - len(self.missing)

    @property
    def rate(self) -> float | None:
        """母数が 0 のときは率が定義できないので None。"""
        if not self.total:
            return None
        return self.covered / self.total

    def format_rate(self) -> str:
        return "-" if self.rate is None else f"{self.rate * 100:.1f}%"

    def format(self) -> str:
        line = f"- {self.label}: {self.format_rate()} ({self.covered}/{self.total})"
        if self.missing:
            line += " 未達: " + _ids(self.missing)
        return line

    def to_json_obj(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "covered": self.covered,
            "total": self.total,
            "rate": self.rate,
            "missing": list(self.missing),
        }


@dataclass(frozen=True)
class Ambiguity:
    """曖昧語の密度。"""

    #: 曖昧語の指摘数 (同一ノード内の同じ語は 1 件に畳まれている)。
    findings: int
    #: 指摘が 1 件以上出たノードの数。
    nodes_with_findings: int
    #: 母数となる全ノード数。
    total_nodes: int

    @property
    def density(self) -> float:
        """指摘数 / ノード数。ノードが無ければ 0。"""
        if not self.total_nodes:
            return 0.0
        return self.findings / self.total_nodes

    def to_json_obj(self) -> dict[str, Any]:
        return {
            "findings": self.findings,
            "nodes_with_findings": self.nodes_with_findings,
            "total_nodes": self.total_nodes,
            "density": self.density,
        }


@dataclass(frozen=True)
class Stats:
    """1 つのグラフから取った健全性メトリクス一式。"""

    nodes: int
    edges: int
    #: 型 → 状態 → 件数。存在しない組も 0 で埋める (分布として読むため)。
    by_type_status: dict[str, dict[str, int]]
    by_edge: dict[str, int]
    ratios: tuple[Ratio, ...]
    #: 曖昧語密度。``--no-lexicon`` のときは測っていないので None。
    ambiguity: Ambiguity | None = None

    @property
    def by_type(self) -> dict[str, int]:
        return {name: sum(row.values()) for name, row in self.by_type_status.items()}

    @property
    def by_status(self) -> dict[str, int]:
        return {
            status: sum(row[status] for row in self.by_type_status.values())
            for status in STATUS_RANK
        }

    def ratio(self, key: str) -> Ratio | None:
        for item in self.ratios:
            if item.key == key:
                return item
        return None

    def to_json_obj(self) -> dict[str, Any]:
        return {
            "totals": {"nodes": self.nodes, "edges": self.edges},
            "nodes": {
                "by_type": self.by_type,
                "by_status": self.by_status,
                "by_type_status": self.by_type_status,
            },
            "edges": {"by_name": self.by_edge},
            "ratios": [item.to_json_obj() for item in self.ratios],
            "ambiguity": self.ambiguity.to_json_obj() if self.ambiguity else None,
        }


# ---------------------------------------------------------------------------
# 集計
# ---------------------------------------------------------------------------


def _ratio(
    key: str, label: str, population: Sequence[Node], covered: Callable[[Node], bool]
) -> Ratio:
    return Ratio(
        key=key,
        label=label,
        total=len(population),
        missing=tuple(node.id for node in population if not covered(node)),
    )


def _ratios(graph: RequirementGraph) -> tuple[Ratio, ...]:
    def has_evidence(node: Node) -> bool:
        return bool(getattr(node, "evidence", []))

    return (
        _ratio(
            "need_satisfied",
            "Need の充足率 (satisfies されている)",
            graph.by_type(Need),
            lambda node: bool(graph.in_edges(node.id, ("satisfies",))),
        ),
        _ratio(
            "evidence_fr",
            "FR の根拠保有率 (evidence を持つ)",
            graph.by_type(FunctionalRequirement),
            has_evidence,
        ),
        _ratio(
            "evidence_qr",
            "QR の根拠保有率 (evidence を持つ)",
            graph.by_type(QualityRequirement),
            has_evidence,
        ),
        _ratio(
            "source_traced",
            "源泉トレース率 (has_source を持つ要求)",
            graph.by_type(*SOURCED_TYPES),
            lambda node: bool(graph.out_edges(node.id, ("has_source",))),
        ),
    )


def _ambiguity(graph: RequirementGraph) -> Ambiguity:
    findings = validate_semantics_lexical(graph).items
    return Ambiguity(
        findings=len(findings),
        nodes_with_findings=len({f.node_id for f in findings if f.node_id}),
        total_nodes=len(graph),
    )


def collect_stats(graph: RequirementGraph, lexicon: bool = True) -> Stats:
    """グラフを数える。ここでは何も判定しない。"""
    by_type_status: dict[str, dict[str, int]] = {
        node_type.__name__: {status: 0 for status in STATUS_RANK}
        for node_type in TYPE_ORDER
    }
    for node in graph.ordered_nodes():
        by_type_status[type(node).__name__][node.status] += 1

    by_edge = {name: 0 for name in EDGE_NAMES}
    for edge in graph.edges:
        by_edge[edge.name] += 1

    return Stats(
        nodes=len(graph),
        edges=len(graph.edges),
        by_type_status=by_type_status,
        by_edge=by_edge,
        ratios=_ratios(graph),
        ambiguity=_ambiguity(graph) if lexicon else None,
    )


# ---------------------------------------------------------------------------
# テキスト出力
# ---------------------------------------------------------------------------


def _type_status_table(stats: Stats) -> list[str]:
    statuses = list(STATUS_RANK)
    lines = [
        "| 型 | " + " | ".join(statuses) + " | 計 |",
        "|---" * (len(statuses) + 2) + "|",
    ]
    for name, row in stats.by_type_status.items():
        counts = [str(row[status]) for status in statuses]
        lines.append(f"| {name} | " + " | ".join(counts) + f" | {sum(row.values())} |")
    totals = stats.by_status
    lines.append(
        "| 計 | "
        + " | ".join(str(totals[status]) for status in statuses)
        + f" | {stats.nodes} |"
    )
    return lines


def render_stats(stats: Stats, sources: Sequence[str] = ()) -> str:
    """テキスト (Markdown) のサマリ。PR 本文にそのまま貼れる形にする。"""
    lines = [f"# {DEFAULT_STATS_TITLE}", ""]
    if sources:
        lines.append(f"- 対象: {', '.join(sources)}")
    lines.append(f"- 規模: {stats.nodes} ノード / {stats.edges} エッジ")
    lines.append("- 判定はしない。閾値を置かず、数と割合だけを出す。")

    lines.extend(["", "## 1. ノード数 (型 × 状態)", ""])
    lines.extend(_type_status_table(stats))

    lines.extend(["", "## 2. エッジ数 (種別)", ""])
    lines.append(
        "- " + " / ".join(f"{name} {count}" for name, count in stats.by_edge.items())
    )

    lines.extend(["", "## 3. 充足率・保有率", ""])
    lines.extend(item.format() for item in stats.ratios)

    lines.extend(["", "## 4. 曖昧語密度", ""])
    if stats.ambiguity is None:
        lines.append("- 測っていない (--no-lexicon)。")
    else:
        ambiguity = stats.ambiguity
        lines.append(
            f"- 指摘 {ambiguity.findings} 件 / {ambiguity.total_nodes} ノード "
            f"= {ambiguity.density:.2f} 件/ノード"
        )
        lines.append(f"- 指摘の出たノード: {ambiguity.nodes_with_findings} 件")

    return "\n".join(lines) + "\n"
