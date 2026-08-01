"""層2: 構造チェック。"""

from __future__ import annotations

from conftest import (
    build,
    codes,
    codes_for,
    constraint,
    decision,
    fr,
    goal,
    need,
    qr,
    source,
    system,
)
from reqmodel.validate import validate_semantics_lexical, validate_structure


def traced_chain():
    """Goal → Need → FR まで繋がった最小の健全なグラフ。"""
    s = source("S-1")
    n = need("N-1", has_source=[s], status="approved")
    g = goal("G-1", motivates=[n], has_source=[s], status="approved")
    f = fr("FR-1", satisfies=[n], has_source=[s], status="approved")
    return [s, n, g, f]


def test_healthy_graph_has_no_findings():
    findings = validate_structure(build(*traced_chain()))
    assert list(findings) == []


def test_dangling_reference_is_an_error():
    findings = validate_structure(build(fr("FR-1", satisfies=["N-missing"])))
    assert "structure.dangling_ref" in codes(findings)
    assert any(f.severity == "error" for f in findings)


def test_edge_type_violation_is_an_error():
    # Constraint→Goal は型規則違反 (constrains は FR/QR/Decision のみ)
    graph = build(goal("G-1"), constraint("C-1", constrains=["G-1"]))
    findings = validate_structure(graph)
    assert "structure.edge_type" in codes_for(findings, "C-1")


def test_self_reference_is_an_error():
    findings = validate_structure(build(fr("FR-1", refines=["FR-1"])))
    assert "structure.self_reference" in codes_for(findings, "FR-1")


def test_refines_cycle_is_an_error():
    graph = build(
        goal("G-1", refines=["G-2"]),
        goal("G-2", refines=["G-3"]),
        goal("G-3", refines=["G-1"]),
    )
    findings = validate_structure(graph)
    cycle = [f for f in findings if f.code == "structure.refines_cycle"]
    assert cycle and cycle[0].severity == "error"


def test_fr_without_path_to_goal_is_reported():
    s, n, g, f = traced_chain()
    orphan = fr("FR-9", has_source=[s], acceptance_criteria=["x"])
    findings = validate_structure(build(s, n, g, f, orphan))
    assert codes_for(findings, "FR-9") == {"structure.orphan_fr"}


def test_fr_reaches_goal_through_refines():
    s, n, g, f = traced_chain()
    child = fr("FR-2", refines=[f], has_source=[s], acceptance_criteria=["x"])
    findings = validate_structure(build(s, n, g, f, child))
    assert "structure.orphan_fr" not in codes_for(findings, "FR-2")


def test_need_without_satisfies_is_reported():
    s = source("S-1")
    n = need("N-1", has_source=[s])
    g = goal("G-1", motivates=[n], has_source=[s])
    findings = validate_structure(build(s, n, g))
    assert "structure.orphan_need" in codes_for(findings, "N-1")


def test_quality_requirement_without_qualifies_is_reported():
    findings = validate_structure(build(qr("QR-1")))
    assert "structure.orphan_qr" in codes_for(findings, "QR-1")


def test_quality_requirement_may_qualify_the_system():
    sys_node = system("SYS")
    findings = validate_structure(build(sys_node, qr("QR-1", qualifies=[sys_node])))
    assert "structure.orphan_qr" not in codes_for(findings, "QR-1")


def test_unused_source_is_information():
    findings = validate_structure(build(source("S-1")))
    unused = [f for f in findings if f.code == "structure.unused_source"]
    assert unused and unused[0].severity == "info"


def test_and_decomposition_requires_every_child_to_reach_requirements():
    s, n, g, f = traced_chain()
    reaching = goal("G-2", refines=[g], motivates=[n], has_source=[s])
    dangling = goal("G-3", refines=[g], has_source=[s])
    findings = validate_structure(build(s, n, g, f, reaching, dangling))
    messages = [
        f.message for f in findings if f.code == "structure.goal_decomposition"
    ]
    assert messages and "G-3" in messages[0]


def test_or_decomposition_needs_only_one_child():
    s, n, g, f = traced_chain()
    root = goal("G-0", decomposition="OR", has_source=[s], status="approved")
    reaching = goal("G-2", refines=[root], motivates=[n], has_source=[s])
    dangling = goal("G-3", refines=[root], has_source=[s])
    findings = validate_structure(build(s, n, root, f, reaching, dangling, g))
    assert "structure.goal_decomposition" not in codes_for(findings, "G-0")


def test_goal_without_children_or_needs_is_reported():
    findings = validate_structure(build(goal("G-1")))
    assert "structure.goal_leaf" in codes_for(findings, "G-1")


def test_unresolved_conflict_is_a_warning():
    a = fr("FR-1", conflicts=["FR-2"])
    b = fr("FR-2")
    findings = [
        f
        for f in validate_structure(build(a, b))
        if f.code == "structure.conflict_unresolved"
    ]
    assert findings and findings[0].severity == "warning"


def test_conflict_between_high_priority_requirements_is_severe():
    a = fr("FR-1", priority=1, conflicts=["FR-2"])
    b = fr("FR-2", priority=2)
    findings = [
        f
        for f in validate_structure(build(a, b))
        if f.code == "structure.conflict_unresolved"
    ]
    assert findings and findings[0].severity == "severe"


def test_decision_resolves_the_conflict():
    a = fr("FR-1", priority=1, conflicts=["FR-2"])
    b = fr("FR-2", priority=1)
    d = decision("D-1", resolves=[(a, b)])
    findings = validate_structure(build(a, b, d))
    assert "structure.conflict_unresolved" not in codes(findings)


def test_decision_resolving_a_non_conflict_is_reported():
    a = fr("FR-1")
    b = fr("FR-2")
    d = decision("D-1", resolves=[(a, b)])
    findings = validate_structure(build(a, b, d))
    assert "structure.resolve_no_conflict" in codes_for(findings, "D-1")


def test_missing_source_is_reported():
    findings = validate_structure(build(need("N-1")))
    assert "structure.missing_source" in codes_for(findings, "N-1")


def test_missing_acceptance_criteria_is_reported():
    findings = validate_structure(build(fr("FR-1", acceptance_criteria=[])))
    assert "structure.missing_acceptance_criteria" in codes_for(findings, "FR-1")


def test_approved_requirement_pointing_at_proposed_need_is_reported():
    s = source("S-1")
    n = need("N-1", has_source=[s], status="proposed")
    g = goal("G-1", motivates=[n], has_source=[s])
    f = fr("FR-1", satisfies=[n], has_source=[s], status="approved")
    findings = validate_structure(build(s, n, g, f))
    inconsistent = [
        f for f in findings if f.code == "structure.status_inconsistent"
    ]
    assert inconsistent and inconsistent[0].node_id == "FR-1"


def test_ambiguous_terms_are_detected():
    graph = build(fr("FR-1", text="検索結果を高速に表示すること"))
    findings = validate_semantics_lexical(graph)
    assert [f.code for f in findings] == ["semantics.ambiguous_term"]
    assert "高速" in findings.items[0].message


def test_ambiguous_terms_are_detected_in_acceptance_criteria():
    graph = build(fr("FR-1", acceptance_criteria=["適切に表示される"]))
    assert "semantics.ambiguous_term" in codes(validate_semantics_lexical(graph))


def test_ambiguous_term_lookup_avoids_false_positives():
    graph = build(
        fr("FR-1", text="本番同等の環境で計測できること", acceptance_criteria=["不安定な回線でも動くこと"])
    )
    assert list(validate_semantics_lexical(graph)) == []
