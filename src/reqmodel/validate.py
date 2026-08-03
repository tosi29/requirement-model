"""層2 (構造チェック) と、辞書ベースの曖昧語検出。

層0 は astcheck、層1 は Pydantic validator (loader が Finding に変換) が担当する。
ここは決定的な構造判定だけを行い、意味の判断は一切しない。
"""

from __future__ import annotations

from dataclasses import replace

from .findings import Finding, FindingList
from .graph import RequirementGraph
from .lexicon import find_ambiguous_terms
from .model import (
    STATUS_RANK,
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    QualityRequirement,
    Source,
    edge_specs_for,
)

__all__ = ["validate_structure", "validate_semantics_lexical", "attach_locations"]

#: 上流ノードの承認状態を検査するエッジ。
#:
#: `constrains` は入れない。制約は制約対象より先に決まりうる (「MCP サーバを作るなら
#: 依存を増やさない範囲で」は着手前に決まっているからこそ意味がある) ため、承認済みの
#: Constraint が proposed の要求を指すのは成熟度の逆転ではない。
_STATUS_EDGES = ("satisfies", "refines", "qualifies", "motivates")


def validate_structure(graph: RequirementGraph) -> FindingList:
    """層2: 構造チェック一式。"""
    findings = FindingList()
    _check_edges(graph, findings)
    _check_refines_cycles(graph, findings)
    _check_part_of_cycles(graph, findings)
    _check_orphan_requirements(graph, findings)
    _check_orphan_needs(graph, findings)
    _check_orphan_quality(graph, findings)
    _check_unused_sources(graph, findings)
    _check_goal_decomposition(graph, findings)
    _check_sources_present(graph, findings)
    _check_acceptance_criteria(graph, findings)
    _check_status_consistency(graph, findings)
    return attach_locations(graph, findings)


def attach_locations(graph: RequirementGraph, findings: FindingList) -> FindingList:
    """node_id しか持たない指摘に、そのノードの出所 (file:line) を補う。

    個々のチェックは構造だけを見ればよく、出所の解決はここに一箇所だけ置く。
    """
    resolved = FindingList()
    for finding in findings:
        where = graph.location_of(finding.node_id or "")
        if finding.location is None and where is not None:
            finding = replace(finding, location=where)
        resolved.add(finding)
    return resolved


# ---------------------------------------------------------------------------
# エッジの型規則と参照整合
# ---------------------------------------------------------------------------


def _check_edges(graph: RequirementGraph, findings: FindingList) -> None:
    for node in graph.ordered_nodes():
        specs = edge_specs_for(type(node))
        for edge in graph.out_edges(node.id):
            spec = specs[edge.name]
            target = graph.nodes.get(edge.target)
            if target is None:
                findings.add(
                    Finding(
                        severity="error",
                        code="structure.dangling_ref",
                        layer=2,
                        message=f"{edge.name} の参照先 {edge.target} が存在しない",
                        node_id=node.id,
                    )
                )
                continue
            if not isinstance(target, spec.targets):
                findings.add(
                    Finding(
                        severity="error",
                        code="structure.edge_type",
                        layer=2,
                        message=(
                            f"{edge.name} は {type(node).__name__}→{spec.target_names()} "
                            f"のみ許される (実際の参照先 {edge.target} は "
                            f"{type(target).__name__})"
                        ),
                        node_id=node.id,
                    )
                )
                continue
            if edge.target == node.id:
                findings.add(
                    Finding(
                        severity="error",
                        code="structure.self_reference",
                        layer=2,
                        message=f"{edge.name} が自分自身を参照している",
                        node_id=node.id,
                    )
                )


def _check_refines_cycles(graph: RequirementGraph, findings: FindingList) -> None:
    for cycle in graph.cycles(("refines",)):
        findings.add(
            Finding(
                severity="error",
                code="structure.refines_cycle",
                layer=2,
                message="refines に閉路がある (詳細化の破綻): " + " → ".join(cycle),
                node_id=cycle[0],
            )
        )


def _check_part_of_cycles(graph: RequirementGraph, findings: FindingList) -> None:
    for cycle in graph.cycles(("part_of",)):
        findings.add(
            Finding(
                severity="error",
                code="structure.part_of_cycle",
                layer=2,
                message="part_of に閉路がある (引用の包含関係の破綻): " + " → ".join(cycle),
                node_id=cycle[0],
            )
        )


# ---------------------------------------------------------------------------
# 孤立検出
# ---------------------------------------------------------------------------


def _reaches_goal(graph: RequirementGraph, fr_id: str) -> bool:
    """FR から Goal へ辿り着けるか。

    FR --refines--> FR --satisfies--> Need <--motivates-- Goal の順に辿る。
    """
    seen = {fr_id}
    stack = [fr_id]
    while stack:
        current = stack.pop()
        node = graph.nodes.get(current)
        if isinstance(node, Goal):
            return True
        for edge in graph.out_edges(current, ("refines", "satisfies")):
            if edge.target not in seen and edge.target in graph.nodes:
                seen.add(edge.target)
                stack.append(edge.target)
        if isinstance(node, Need):
            for edge in graph.in_edges(current, ("motivates",)):
                if edge.source not in seen and edge.source in graph.nodes:
                    seen.add(edge.source)
                    stack.append(edge.source)
    return False


def _check_orphan_requirements(graph: RequirementGraph, findings: FindingList) -> None:
    for node in graph.by_type(FunctionalRequirement):
        if not _reaches_goal(graph, node.id):
            findings.add(
                Finding(
                    severity="warning",
                    code="structure.orphan_fr",
                    layer=2,
                    message="どの Goal にも到達できない (なぜ作るのか不明な要求)",
                    node_id=node.id,
                )
            )


def _check_orphan_needs(graph: RequirementGraph, findings: FindingList) -> None:
    for node in graph.by_type(Need):
        if not graph.in_edges(node.id, ("satisfies",)):
            findings.add(
                Finding(
                    severity="warning",
                    code="structure.orphan_need",
                    layer=2,
                    message="どの FR からも satisfies されていない (置き去りのニーズ)",
                    node_id=node.id,
                )
            )


def _check_orphan_quality(graph: RequirementGraph, findings: FindingList) -> None:
    for node in graph.by_type(QualityRequirement):
        if not graph.out_edges(node.id, ("qualifies",)):
            findings.add(
                Finding(
                    severity="warning",
                    code="structure.orphan_qr",
                    layer=2,
                    message="qualifies の張り先が無い (FR か System に張ること)",
                    node_id=node.id,
                )
            )


def _check_unused_sources(graph: RequirementGraph, findings: FindingList) -> None:
    """要求からも引用からも辿られない源泉を報告する。

    引用 (part_of で子を持つ源泉) は、それ自体が要求から参照されていなくても
    「未使用」ではない。使われているかどうかは子の側で個別に報告されるので、
    親を重ねて報告すると同じことを二重に言うことになる。
    """
    for node in graph.by_type(Source):
        if graph.in_edges(node.id, ("has_source",)):
            continue
        if graph.in_edges(node.id, ("part_of",)):
            continue
        message = (
            "どの要求からも根拠にされていない引用"
            if node.part_of
            else "どの要求からも参照されていない源泉"
        )
        findings.add(
            Finding(
                severity="info",
                code="structure.unused_source",
                layer=2,
                message=message,
                node_id=node.id,
            )
        )


# ---------------------------------------------------------------------------
# Goal の AND/OR 分解
# ---------------------------------------------------------------------------


def _children_of(graph: RequirementGraph, goal_id: str) -> list[str]:
    return [e.source for e in graph.in_edges(goal_id, ("refines",))]


def _check_goal_decomposition(graph: RequirementGraph, findings: FindingList) -> None:
    memo: dict[str, bool] = {}
    in_progress: set[str] = set()

    def reaches_requirements(goal_id: str) -> bool:
        if goal_id in memo:
            return memo[goal_id]
        if goal_id in in_progress:  # refines の閉路は別途エラー
            return False
        in_progress.add(goal_id)
        result = False
        for edge in graph.out_edges(goal_id, ("motivates",)):
            if graph.in_edges(edge.target, ("satisfies",)):
                result = True
                break
        if not result:
            children = _children_of(graph, goal_id)
            node = graph.nodes.get(goal_id)
            mode = node.decomposition if isinstance(node, Goal) else "AND"
            if children:
                if mode == "AND":
                    result = all(reaches_requirements(c) for c in children)
                else:
                    result = any(reaches_requirements(c) for c in children)
        in_progress.discard(goal_id)
        memo[goal_id] = result
        return result

    for goal in graph.by_type(Goal):
        children = _children_of(graph, goal.id)
        motivated = [e.target for e in graph.out_edges(goal.id, ("motivates",))]

        if not children and not motivated:
            findings.add(
                Finding(
                    severity="warning",
                    code="structure.goal_leaf",
                    layer=2,
                    message="子 Goal も Need も持たない (未分解の Goal)",
                    node_id=goal.id,
                )
            )
            continue

        if not children:
            continue

        if goal.decomposition == "AND":
            unmet = [c for c in children if not reaches_requirements(c)]
            if unmet:
                findings.add(
                    Finding(
                        severity="warning",
                        code="structure.goal_decomposition",
                        layer=2,
                        message=(
                            "AND 分解だが要求群に到達しない子 Goal がある: "
                            + ", ".join(sorted(unmet))
                        ),
                        node_id=goal.id,
                    )
                )
        elif not any(reaches_requirements(c) for c in children):
            findings.add(
                Finding(
                    severity="warning",
                    code="structure.goal_decomposition",
                    layer=2,
                    message="OR 分解だが、要求群に到達する子 Goal が 1 つも無い",
                    node_id=goal.id,
                )
            )


# ---------------------------------------------------------------------------
# 源泉・受け入れ基準・状態整合
# ---------------------------------------------------------------------------


def _check_sources_present(graph: RequirementGraph, findings: FindingList) -> None:
    types = (Goal, Need, FunctionalRequirement, QualityRequirement, Constraint)
    for node in graph.by_type(*types):
        if not graph.out_edges(node.id, ("has_source",)):
            findings.add(
                Finding(
                    severity="warning",
                    code="structure.missing_source",
                    layer=2,
                    message="源泉 (has_source) が無い",
                    node_id=node.id,
                )
            )


def _check_acceptance_criteria(graph: RequirementGraph, findings: FindingList) -> None:
    for node in graph.by_type(FunctionalRequirement, QualityRequirement):
        if not node.acceptance_criteria:
            findings.add(
                Finding(
                    severity="warning",
                    code="structure.missing_acceptance_criteria",
                    layer=2,
                    message="受け入れ基準が無い (検証可能性)",
                    node_id=node.id,
                )
            )


def _check_status_consistency(graph: RequirementGraph, findings: FindingList) -> None:
    for node in graph.ordered_nodes():
        source_rank = STATUS_RANK[node.status]
        if source_rank < STATUS_RANK["approved"]:
            continue
        for edge in graph.out_edges(node.id, _STATUS_EDGES):
            target = graph.nodes.get(edge.target)
            if target is None:
                continue
            if STATUS_RANK[target.status] >= STATUS_RANK["approved"]:
                continue
            findings.add(
                Finding(
                    severity="warning",
                    code="structure.status_inconsistent",
                    layer=2,
                    message=(
                        f"{node.status} の {type(node).__name__} が "
                        f"{target.status} の {type(target).__name__} {edge.target} に "
                        f"{edge.name} を張っている"
                    ),
                    node_id=node.id,
                )
            )


# ---------------------------------------------------------------------------
# 曖昧語 (層3 の先行実装。辞書一致なので決定的)
# ---------------------------------------------------------------------------


def validate_semantics_lexical(graph: RequirementGraph) -> FindingList:
    findings = FindingList()
    for node in graph.ordered_nodes():
        texts = [node.text]
        texts.extend(getattr(node, "acceptance_criteria", []) or [])
        reported: set[str] = set()
        for text in texts:
            for term, advice in find_ambiguous_terms(text):
                if term in reported:
                    continue
                reported.add(term)
                findings.add(
                    Finding(
                        severity="warning",
                        code="semantics.ambiguous_term",
                        layer=1,
                        message=f"曖昧語「{term}」: {advice}",
                        node_id=node.id,
                    )
                )
    return attach_locations(graph, findings)
