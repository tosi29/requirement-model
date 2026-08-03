"""仕様書とトレーサビリティマトリクスの生成 (req doc)。

モデルが唯一の真実である以上、レビュー会に配る仕様書も監査に出すトレース表も
モデルから導出する。ここでも意味の判断は一切せず、ノードの自然言語をそのまま
並べ、階層と表はエッジだけから決める。

見出しの深さは Goal=h3 / Need=h4 / FR=h5 / QR=h6 に固定する。Goal の詳細化は
何段でも書けるので、深さをそのまま見出しレベルに写すと h6 を超えてしまう。
Goal 間の階層は DFS の並び順と各ノードの「上位ゴール」欄で表す。

同じノードが複数の親にぶら下がるとき (FR が 2 つの Need を満たす等) は、最初の
1 か所だけ本文を出し、2 か所目からは前掲として参照だけを置く。
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from typing import Iterable, Sequence

from ..core.graph import RequirementGraph
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

__all__ = [
    "render_spec",
    "render_matrices_markdown",
    "render_matrices_csv",
    "MatrixSpec",
    "Matrix",
    "MATRICES",
    "build_matrix",
    "DEFAULT_SPEC_TITLE",
    "DEFAULT_MATRIX_TITLE",
    "DOC_FORMATS",
    "CSV_HEADER",
    "MARK",
]

DEFAULT_SPEC_TITLE = "要求仕様書"
DEFAULT_MATRIX_TITLE = "トレーサビリティマトリクス"

#: `req doc` が出せる形式。csv はトレーサビリティ表専用。
DOC_FORMATS: tuple[str, ...] = ("md", "csv")

#: トレースリンクがあることを表す印。
MARK = "✓"


# ---------------------------------------------------------------------------
# 共通の小道具
# ---------------------------------------------------------------------------


def _inline(text: str) -> str:
    """表のセルや 1 行の見出しに入れられる形に均す。"""
    return " ".join(text.split())


def _cell(text: str) -> str:
    return _inline(text).replace("|", "\\|")


def _unique(ids: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(ids))


# ---------------------------------------------------------------------------
# ノード 1 件の記述
# ---------------------------------------------------------------------------

#: 出ていくエッジの見出し語。
_OUT_LABELS: dict[str, str] = {
    "refines": "上位ノード (これが詳細化する対象)",
    "motivates": "動機づけるニーズ",
    "satisfies": "充足するニーズ",
    "qualifies": "品質を付与する対象",
    "constrains": "制約する対象",
    "has_source": "源泉",
    "part_of": "上位の源泉 (これが引用元)",
}

#: 入ってくるエッジの見出し語。
_IN_LABELS: dict[str, str] = {
    "refines": "下位ノード (これを詳細化するもの)",
    "motivates": "動機づけているゴール",
    "satisfies": "これを充足する機能要求",
    "qualifies": "付与されている品質要求",
    "constrains": "受けている制約",
    "has_source": "この源泉を参照しているノード",
    "part_of": "この源泉から引用されている箇所",
}


def _ref(graph: RequirementGraph, node_id: str, with_text: bool = False) -> str:
    node = graph.nodes.get(node_id)
    if node is None:
        return f"{node_id} (未定義)"
    if with_text:
        return f"{node_id} ({_inline(node.text)})"
    return node_id


def _attr_line(graph: RequirementGraph, node: Node) -> str:
    parts = [f"種別: {type(node).__name__}", f"状態: {node.status}"]
    if isinstance(node, Source):
        parts.append(f"分類: {node.kind}")
        if node.locator is not None:
            parts.append(f"出典: {_inline(node.locator)}")
    if isinstance(node, Goal) and graph.in_edges(node.id, ("refines",)):
        parts.append(f"分解: {node.decomposition}")
    return "- " + " / ".join(parts)


def _relation_lines(graph: RequirementGraph, node: Node) -> list[str]:
    """エッジを、向きごとに 1 行ずつ並べる。"""
    lines: list[str] = []
    for labels, edges_of, attr in (
        (_OUT_LABELS, graph.out_edges, "target"),
        (_IN_LABELS, graph.in_edges, "source"),
    ):
        for name, label in labels.items():
            related = _unique(
                str(getattr(edge, attr)) for edge in edges_of(node.id, (name,))
            )
            if not related:
                continue
            with_text = name == "has_source" and attr == "target"
            joined = ", ".join(_ref(graph, i, with_text) for i in related)
            lines.append(f"- {label}: {joined}")
    return lines


def _listed(node: Node, attr: str, label: str) -> list[str]:
    items: Sequence[str] = getattr(node, attr, []) or []
    if not items:
        return []
    lines = [f"- {label}:"]
    lines.extend(f"    - {_inline(item)}" for item in items)
    return lines


def _criteria_lines(node: Node) -> list[str]:
    """根拠 (事後) を先、受け入れ基準 (事前) を後に置く。"""
    return _listed(node, "evidence", "根拠") + _listed(
        node, "acceptance_criteria", "受け入れ基準"
    )


def _node_block(graph: RequirementGraph, node: Node, level: int) -> list[str]:
    lines = ["", f"{'#' * level} {node.id} {_inline(node.text)}", ""]
    lines.append(_attr_line(graph, node))
    lines.extend(_relation_lines(graph, node))
    lines.extend(_criteria_lines(node))
    where = graph.location_of(node.id)
    if where is not None:
        lines.append(f"- 定義: {where}")
    return lines


def _repeat_lines(node: Node) -> list[str]:
    """2 か所目以降の掲載。直前のノードの属性欄と地続きに見えないよう空行を置く。"""
    return ["", f"- (前掲) {node.id} {_inline(node.text)}"]


# ---------------------------------------------------------------------------
# 階層 (Goal → Need → FR → QR)
# ---------------------------------------------------------------------------


def _goal_order(graph: RequirementGraph) -> list[Goal]:
    """refines の木を根から DFS した順。

    閉路に入っているゴール (層2 でエラーになる) も落とさず末尾で拾う。文書生成が
    検証を兼ねてしまわないよう、ここでは黙って全件を並べる。
    """
    goals = graph.by_type(Goal)
    children: dict[str, list[Goal]] = {}
    has_parent: set[str] = set()
    for goal in goals:
        for edge in graph.out_edges(goal.id, ("refines",)):
            if isinstance(graph.nodes.get(edge.target), Goal):
                children.setdefault(edge.target, []).append(goal)
                has_parent.add(goal.id)

    order: list[Goal] = []
    seen: set[str] = set()

    def visit(goal: Goal) -> None:
        if goal.id in seen:
            return
        seen.add(goal.id)
        order.append(goal)
        for child in children.get(goal.id, []):
            visit(child)

    for goal in goals:
        if goal.id not in has_parent:
            visit(goal)
    for goal in goals:
        visit(goal)
    return order


def _sources_of(graph: RequirementGraph, node_id: str, edge: str) -> list[Node]:
    return [
        graph.nodes[e.source]
        for e in graph.in_edges(node_id, (edge,))
        if e.source in graph.nodes
    ]


def _targets_of(graph: RequirementGraph, node_id: str, edge: str) -> list[Node]:
    return [
        graph.nodes[e.target]
        for e in graph.out_edges(node_id, (edge,))
        if e.target in graph.nodes
    ]


def _hierarchy_lines(graph: RequirementGraph, emitted: set[str]) -> list[str]:
    lines: list[str] = []

    def emit(node: Node, level: int) -> bool:
        """本文を出したら True、前掲なら False。"""
        if node.id in emitted:
            lines.extend(_repeat_lines(node))
            return False
        emitted.add(node.id)
        lines.extend(_node_block(graph, node, level))
        return True

    for goal in _goal_order(graph):
        emit(goal, 3)
        for need in _targets_of(graph, goal.id, "motivates"):
            if not isinstance(need, Need) or not emit(need, 4):
                continue
            for fr in _sources_of(graph, need.id, "satisfies"):
                if not isinstance(fr, FunctionalRequirement) or not emit(fr, 5):
                    continue
                for qr in _sources_of(graph, fr.id, "qualifies"):
                    if isinstance(qr, QualityRequirement):
                        emit(qr, 6)
    return lines


def _system_lines(graph: RequirementGraph, emitted: set[str]) -> list[str]:
    lines: list[str] = []
    for system in graph.by_type(System):
        emitted.add(system.id)
        lines.extend(_node_block(graph, system, 3))
        for qr in _sources_of(graph, system.id, "qualifies"):
            if isinstance(qr, QualityRequirement) and qr.id not in emitted:
                emitted.add(qr.id)
                lines.extend(_node_block(graph, qr, 4))
    return lines


def _simple_section(
    graph: RequirementGraph, nodes: Sequence[Node], emitted: set[str]
) -> list[str]:
    lines: list[str] = []
    for node in nodes:
        emitted.add(node.id)
        lines.extend(_node_block(graph, node, 3))
    return lines


def _source_line(graph: RequirementGraph, source: Source, depth: int) -> str:
    """源泉 1 件の行。引用なら locator と、根拠にしている要求を並べる。"""
    head = f"**{source.id}**"
    if depth == 0:
        head += f" ({source.kind})"
    if source.locator is not None:
        head += f" [{_inline(source.locator)}]"

    users = _unique(e.source for e in graph.in_edges(source.id, ("has_source",)))
    if users:
        tail = ", ".join(users)
    elif graph.in_edges(source.id, ("part_of",)):
        tail = "引用のみ"
    else:
        tail = "参照なし"

    return f"{'  ' * depth}- {head} {_inline(source.text)} — {tail}"


def _source_section(graph: RequirementGraph, emitted: set[str]) -> list[str]:
    """源泉の一覧。引用は親の下にぶら下げ、それぞれの引用元要求を添える。

    「この源泉のどこが、どの要求の根拠になっているか」を 1 か所で読めるようにする
    のが目的なので、part_of の階層をそのまま入れ子で出す。
    """
    children: dict[str, list[Source]] = {}
    for source in graph.by_type(Source):
        for edge in graph.out_edges(source.id, ("part_of",)):
            children.setdefault(edge.target, []).append(source)

    lines: list[str] = []

    def emit(source: Source, depth: int, seen: frozenset[str]) -> None:
        emitted.add(source.id)
        lines.append(_source_line(graph, source, depth))
        # 閉路は structure.part_of_cycle が error として報告する。ここでは
        # 文書生成が止まらないように、辿った枝を覚えて打ち切るだけにする。
        for child in children.get(source.id, []):
            if child.id not in seen:
                emit(child, depth + 1, seen | {source.id})

    for source in graph.by_type(Source):
        if not source.part_of:
            emit(source, 0, frozenset())

    # part_of の閉路などで根から辿れなかった源泉も、文書から落とさない。
    for source in graph.by_type(Source):
        if source.id not in emitted:
            emit(source, 0, frozenset())

    return lines


def _remainder_section(graph: RequirementGraph, emitted: set[str]) -> list[str]:
    """どの節にも出てこなかったノード。文書から要求が落ちないことを担保する。"""
    return [
        f"- **{node.id}** ({type(node).__name__}) {_inline(node.text)}"
        for node in graph.ordered_nodes()
        if node.id not in emitted
    ]


def _section(number: int, title: str, body: Sequence[str]) -> list[str]:
    """節 1 つ。本文の先頭には必ず空行を置く (箇条書きが見出しに続かないように)。"""
    content = list(body) or ["該当なし。"]
    if content[0] != "":
        content.insert(0, "")
    return ["", f"## {number}. {title}", *content]


def render_spec(
    graph: RequirementGraph,
    title: str = DEFAULT_SPEC_TITLE,
    sources: Sequence[str] = (),
) -> str:
    """Goal → Need → FR/QR の階層で並べた Markdown 仕様書。"""
    emitted: set[str] = set()

    lines = [f"# {title}", ""]
    if sources:
        lines.append(f"- 生成元: {', '.join(sources)}")
    lines.append(f"- 規模: {len(graph)} ノード / {len(graph.edges)} エッジ")
    lines.append(
        "- この文書は要求モデルから生成されている。修正は定義ファイル側で行うこと。"
    )

    body = [
        ("要求階層 (Goal → Need → FR → QR)", _hierarchy_lines(graph, emitted)),
        ("システムに張られた品質要求", _system_lines(graph, emitted)),
        ("制約", _simple_section(graph, graph.by_type(Constraint), emitted)),
        ("源泉", _source_section(graph, emitted)),
    ]
    for number, (heading, content) in enumerate(body, start=1):
        lines.extend(_section(number, heading, content))

    # 残りは最後に数える。前の節がどのノードを消化したかに依存するため。
    lines.extend(
        _section(
            len(body) + 1,
            "上記に現れなかったノード",
            _remainder_section(graph, emitted),
        )
    )
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# トレーサビリティマトリクス
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MatrixSpec:
    """1 枚のマトリクスの定義。行を上流、列を下流に置く。"""

    title: str
    edge: str
    rows: tuple[type[Node], ...]
    cols: tuple[type[Node], ...]
    #: True なら、エッジは列 → 行 に張られている (satisfies のように下流が上流を指す)。
    reverse: bool = False


#: 出力するマトリクス。エッジ型ごとに 1 枚。
MATRICES: tuple[MatrixSpec, ...] = (
    MatrixSpec("Goal × Need", "motivates", (Goal,), (Need,)),
    MatrixSpec("Need × FR", "satisfies", (Need,), (FunctionalRequirement,), reverse=True),
    MatrixSpec(
        "FR/System × QR",
        "qualifies",
        (FunctionalRequirement, System),
        (QualityRequirement,),
        reverse=True,
    ),
    MatrixSpec(
        "Source × 要求",
        "has_source",
        (Source,),
        (Goal, Need, FunctionalRequirement, QualityRequirement, Constraint),
        reverse=True,
    ),
    MatrixSpec(
        "Constraint × 制約対象",
        "constrains",
        (Constraint,),
        (FunctionalRequirement, QualityRequirement),
    ),
)


@dataclass(frozen=True)
class Matrix:
    """マトリクス 1 枚の中身。"""

    spec: MatrixSpec
    rows: tuple[Node, ...]
    cols: tuple[Node, ...]
    cells: frozenset[tuple[str, str]]

    def marked(self, row_id: str, col_id: str) -> bool:
        return (row_id, col_id) in self.cells

    def uncovered_rows(self) -> list[Node]:
        return [n for n in self.rows if not any(r == n.id for r, _ in self.cells)]

    def uncovered_cols(self) -> list[Node]:
        return [n for n in self.cols if not any(c == n.id for _, c in self.cells)]

    @property
    def empty(self) -> bool:
        return not self.rows or not self.cols


def build_matrix(graph: RequirementGraph, spec: MatrixSpec) -> Matrix:
    """グラフから 1 枚のマトリクスを組む。"""
    rows = tuple(graph.by_type(*spec.rows))
    cols = tuple(graph.by_type(*spec.cols))
    row_ids = {node.id for node in rows}
    col_ids = {node.id for node in cols}

    cells: set[tuple[str, str]] = set()
    for edge in graph.edges:
        if edge.name != spec.edge:
            continue
        row, col = (
            (edge.target, edge.source) if spec.reverse else (edge.source, edge.target)
        )
        if row in row_ids and col in col_ids:
            cells.add((row, col))
    return Matrix(spec=spec, rows=rows, cols=cols, cells=frozenset(cells))


def _matrix_table(matrix: Matrix) -> list[str]:
    header = f"| {_cell(matrix.spec.title)} | " + " | ".join(
        node.id for node in matrix.cols
    ) + " |"
    ruler = "|---" * (len(matrix.cols) + 1) + "|"
    lines = [header, ruler]
    for row in matrix.rows:
        marks = " | ".join(
            MARK if matrix.marked(row.id, col.id) else "" for col in matrix.cols
        )
        lines.append(f"| {row.id} {_cell(row.text)} | {marks} |")
    return lines


def _uncovered_line(label: str, nodes: Sequence[Node]) -> str:
    if not nodes:
        return f"- {label}: なし"
    return f"- {label}: " + ", ".join(node.id for node in nodes)


def render_matrices_markdown(
    graph: RequirementGraph,
    title: str = DEFAULT_MATRIX_TITLE,
    sources: Sequence[str] = (),
    specs: Sequence[MatrixSpec] = MATRICES,
) -> str:
    """トレーサビリティマトリクスを Markdown の表で出す。"""
    lines = [f"# {title}", ""]
    if sources:
        lines.append(f"- 生成元: {', '.join(sources)}")
    lines.append(f"- 規模: {len(graph)} ノード / {len(graph.edges)} エッジ")
    lines.append(f"- 行が上流、列が下流。{MARK} はトレースリンクがあることを表す。")

    for number, spec in enumerate(specs, start=1):
        matrix = build_matrix(graph, spec)
        lines.extend(["", f"## {number}. {spec.title} ({spec.edge})", ""])
        if matrix.empty:
            lines.append("該当するノードが無い。")
            continue
        lines.extend(_matrix_table(matrix))
        lines.append("")
        lines.append(_uncovered_line("トレースの無い行", matrix.uncovered_rows()))
        lines.append(_uncovered_line("トレースの無い列", matrix.uncovered_cols()))
        lines.append("")
        lines.append("列:")
        lines.extend(
            f"- {node.id} {_inline(node.text)}" for node in matrix.cols
        )
    return "\n".join(lines) + "\n"


#: CSV の列。マトリクスを 1 枚ずつ格子で並べると 1 ファイルに収まらないので、
#: 「1 行 = 1 トレースリンク」の縦持ちにする。表計算でもピボットで格子に戻せる。
CSV_HEADER: tuple[str, ...] = (
    "matrix",
    "edge",
    "row_type",
    "row_id",
    "row_text",
    "col_type",
    "col_id",
    "col_text",
)


def render_matrices_csv(
    graph: RequirementGraph, specs: Sequence[MatrixSpec] = MATRICES
) -> str:
    """トレーサビリティ表を CSV (縦持ち) で出す。

    トレース先の無い行は、列側を空欄にした 1 行として残す。CSV だけを見ても
    「どこが未トレースか」が分かるようにするため。
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_HEADER)
    for spec in specs:
        matrix = build_matrix(graph, spec)
        for row in matrix.rows:
            linked = [col for col in matrix.cols if matrix.marked(row.id, col.id)]
            if not linked:
                writer.writerow(
                    [
                        spec.title,
                        spec.edge,
                        type(row).__name__,
                        row.id,
                        _inline(row.text),
                        "",
                        "",
                        "",
                    ]
                )
                continue
            for col in linked:
                writer.writerow(
                    [
                        spec.title,
                        spec.edge,
                        type(row).__name__,
                        row.id,
                        _inline(row.text),
                        type(col).__name__,
                        col.id,
                        _inline(col.text),
                    ]
                )
    return buffer.getvalue()
