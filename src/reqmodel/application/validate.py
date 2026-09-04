"""層2 (構造チェック) と、辞書ベースの曖昧語検出。

層0 は astcheck、層1 は Pydantic validator (loader が Finding に変換) が担当する。
ここは決定的な構造判定だけを行い、意味の判断は一切しない。
"""

from __future__ import annotations

from dataclasses import replace

from ..findings import Finding, FindingList
from ..core.graph import RequirementGraph
from ..lexicon import find_ambiguous_terms
from ..core.metamodel import edge_specs_for
from ..definition.nodes import STATUS_RANK
from ..definition import (
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    QualityRequirement,
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
    _check_orphan_requirements(graph, findings)
    _check_orphan_needs(graph, findings)
    _check_orphan_quality(graph, findings)
    _check_goal_decomposition(graph, findings)
    _check_unverified_claims(graph, findings)
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
                    message="qualifies の張り先が無い (FR に張ること)",
                    node_id=node.id,
                )
            )


# ---------------------------------------------------------------------------
# Goal の分解
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
            if children:
                result = all(reaches_requirements(c) for c in children)
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

        unmet = [c for c in children if not reaches_requirements(c)]
        if unmet:
            findings.add(
                Finding(
                    severity="warning",
                    code="structure.goal_decomposition",
                    layer=2,
                    message=(
                        "要求群に到達しない子 Goal がある: "
                        + ", ".join(sorted(unmet))
                    ),
                    node_id=goal.id,
                )
            )


# ---------------------------------------------------------------------------
# 源泉・受け入れ基準・状態整合
# ---------------------------------------------------------------------------



def _check_unverified_claims(graph: RequirementGraph, findings: FindingList) -> None:
    """``verified`` という主張に根拠が付いているかを見る。

    発火するのは主張の時点だけである。まだ誰も合意していない ``proposed`` の要求に
    検証を求めても意味が無く、逆に「確かめた」と書いた以上は何で確かめたかが残って
    いるべき、という非対称をそのまま検査にしている。
    """
    for node in graph.by_type(FunctionalRequirement, QualityRequirement):
        if node.status != "verified":
            continue
        if not node.evidence:
            findings.add(
                Finding(
                    severity="warning",
                    code="structure.unverified_claim",
                    layer=2,
                    message="verified なのに根拠 (evidence) が無い",
                    node_id=node.id,
                )
            )


def _check_status_consistency(graph: RequirementGraph, findings: FindingList) -> None:
    """合意済みの構造が、未合意のノードに依存していないかを見る。

    implemented / verified は FR / QR にだけある実現状態であり、エッジの両端で
    比較する成熟度ではない。参照元が approved 以上なら、参照先は approved で
    あればよい。
    """
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
        #: 事前の基準と事後の根拠も本文と同じ辞書にかける。「十分高速だった」の類は
        #: 根拠の側にこそ出るため、evidence を対象から外すと検査の穴になる。
        for reference in getattr(node, "source", []) or []:
            texts.extend([reference.title, reference.url])
            if reference.note:
                texts.append(reference.note)
        for reference in getattr(node, "realized_by", []) or []:
            texts.extend([reference.title, reference.url])
            if reference.note:
                texts.append(reference.note)
        for reference in getattr(node, "evidence", []) or []:
            texts.extend([reference.title, reference.url])
            if reference.note:
                texts.append(reference.note)
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
