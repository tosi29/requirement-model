"""影響部分グラフの抽出とテキスト化 (LLM コンテキスト生成)。

機械が網羅性を担保し、解釈は LLM と人間に委ねる。ここでは意味判断を一切せず、
到達可能性で選んだノードの自然言語をそのまま並べる。
"""

from __future__ import annotations

from typing import Iterable, Sequence

from .graph import RequirementGraph
from .model import GRAPH_EDGE_NAMES, SOURCE_EDGES, Source, edge_specs_for

__all__ = ["impact_set", "explain_text", "subgraph_edges", "traversed_edges"]


def traversed_edges(
    edge_names: Iterable[str] | None, include_sources: bool
) -> list[str] | None:
    """実際に辿るエッジ種別。``None`` は「全種別」。

    ``edge_names`` (``--edges``) は書き手の明示指定なのでそのまま通す。指定が
    無いときだけ、源泉エッジを既定で外す (理由は ``model.SOURCE_EDGES``)。
    源泉を辿らなければ Source ノードは要求から到達できなくなるので、
    ノード側を落とす処理は要らない。
    """
    if edge_names is not None:
        return list(edge_names)
    return None if include_sources else list(GRAPH_EDGE_NAMES)


def impact_set(
    graph: RequirementGraph,
    targets: Sequence[str],
    edge_names: Iterable[str] | None = None,
    depth: int | None = None,
    undirected: bool = False,
    include_sources: bool = False,
) -> tuple[set[str], set[str], set[str]]:
    """(上流, 下流, 全体) を返す。全体には対象ノード自身を含む。

    undirected=True のときは向きを無視して集め、全件を「下流」側に入れる
    (呼び出し側は 1 つの「関連ノード」ブロックとして扱う)。
    """
    names = traversed_edges(edge_names, include_sources)
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


def source_label(graph: RequirementGraph, source_id: str) -> str:
    """源泉 1 件の表示。``SRC-A (本文) [位置] < 親の源泉`` の形。

    源泉はノードとして図に出さないので (``model.SOURCE_EDGES``)、引用元を辿る
    ``part_of`` の鎖もここで畳んで 1 行に収める。閉路があっても止まるように
    通過済みを持つ (``structure.part_of_cycle`` が別途エラーにする)。
    """
    parts: list[str] = []
    seen: set[str] = set()
    current: str | None = source_id
    while current is not None and current not in seen:
        seen.add(current)
        node = graph.nodes.get(current)
        if node is None:
            parts.append(current)
            break
        label = f"{node.id} ({node.text})"
        locator = getattr(node, "locator", None)
        if locator:
            label += f" [{locator}]"
        parts.append(label)
        parents = graph.out_edges(current, ("part_of",))
        current = parents[0].target if parents else None
    return " < ".join(parts)


def _describe(
    graph: RequirementGraph, node_id: str, inline_sources: bool = True
) -> list[str]:
    node = graph.nodes[node_id]
    type_name = type(node).__name__
    head = f"- [{type_name}] {node.id}: {node.text}"
    lines = [head]
    attrs = [f"status={node.status}"]
    if node.priority is not None:
        attrs.append(f"priority={node.priority}")
    if isinstance(node, Source):
        attrs.append(f"kind={node.kind}")
    decomposition = getattr(node, "decomposition", None)
    if decomposition is not None and graph.in_edges(node.id, ("refines",)):
        attrs.append(f"decomposition={decomposition}")
    lines.append(f"    ({', '.join(attrs)})")
    for item in getattr(node, "evidence", []) or []:
        lines.append(f"    根拠: {item}")
    for criterion in getattr(node, "acceptance_criteria", []) or []:
        lines.append(f"    受け入れ基準: {criterion}")
    #: 源泉は辿らない代わりに、参照元ノードの属性として書き出す。図から外しても
    #: 「この要求がどこから来たか」は LLM に渡る文脈に残る。源泉を辿った
    #: ときは Source 自身がブロックとして出るので、こちらは畳む。
    if inline_sources:
        for edge in graph.out_edges(node.id, ("has_source",)):
            lines.append(f"    源泉: {source_label(graph, edge.target)}")
    return lines


def explain_text(
    graph: RequirementGraph,
    targets: Sequence[str],
    edge_names: Iterable[str] | None = None,
    depth: int | None = None,
    undirected: bool = False,
    include_sources: bool = False,
) -> str:
    """影響部分グラフを LLM に渡せる形に整形する。"""
    missing = [t for t in targets if t not in graph.nodes]
    ancestors, descendants, whole = impact_set(
        graph, targets, edge_names, depth, undirected, include_sources
    )
    #: 源泉を辿ったときは Source 自身がブロックで出るので、畳んだ表示はしない。
    inline_sources = not include_sources

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
    elif not include_sources:
        lines.append(
            "源泉エッジ (" + ", ".join(sorted(SOURCE_EDGES)) + ") は辿っていない。"
            "源泉は各ノードの「源泉:」行に畳んである"
        )
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
            lines.extend(_describe(graph, node_id, inline_sources))

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

    #: 既定で外した源泉エッジは「現れなかった」に混ぜない。除外は上で明記して
    #: あり、両方に出すと「モデルに無い」のか「辿っていない」のか読み分けられない。
    #: --edges で明示されたときは書き手の指定なので、この畳み込みはしない。
    hidden = frozenset() if (include_sources or edge_names is not None) else SOURCE_EDGES
    unused = [
        name
        for name in _all_edge_names(graph)
        if name not in hidden and not any(e.name == name for e in edges)
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
