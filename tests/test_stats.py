"""健全性メトリクス (req stats) の確認。"""

from __future__ import annotations

from conftest import build, constraint, fr, goal, need, qr, source

from reqmodel.application.stats import collect_stats, render_stats


def test_counts_nodes_by_type_and_status():
    stats = collect_stats(
        build(
            goal(),
            need(status="approved"),
            fr(satisfies=["Need-1"]),
            qr(qualifies=["FR-1"], status="verified"),
            source(),
        )
    )

    assert stats.nodes == 4
    assert stats.by_type["FunctionalRequirement"] == 1
    assert stats.by_type["Constraint"] == 0  # 存在しない型も 0 で並ぶ (分布として読む)
    assert stats.by_status == {
        "proposed": 2,
        "approved": 1,
        "implemented": 0,
        "verified": 1,
    }
    assert stats.by_type_status["QualityRequirement"]["verified"] == 1


def test_counts_edges_by_name():
    ref = source()
    stats = collect_stats(
        build(
            need(source=[ref]),
            fr(satisfies=["Need-1"], source=[ref]),
        )
    )

    assert stats.edges == 1
    assert stats.by_edge["satisfies"] == 1
    assert stats.by_edge["qualifies"] == 0


def test_need_satisfaction_ratio_lists_the_uncovered():
    stats = collect_stats(
        build(need("Need-1"), need("Need-2"), fr(satisfies=["Need-1"]))
    )

    ratio = stats.ratio("need_satisfied")
    assert ratio is not None
    assert (ratio.covered, ratio.total) == (1, 2)
    assert ratio.rate == 0.5
    assert ratio.missing == ("Need-2",)


def test_evidence_ratios_are_split_by_type():
    stats = collect_stats(
        build(
            fr("FR-1", evidence=[source("EV-1", text="受入テストで確認した")]),
            fr("FR-2"),
            qr("QR-1"),
        )
    )

    assert stats.ratio("evidence_fr").missing == ("FR-2",)
    assert stats.ratio("evidence_qr").rate == 0.0


def test_source_reference_ratio_counts_nodes_with_source():
    ref = source()
    stats = collect_stats(
        build(
            goal(source=[ref]),
            need(source=[ref]),
            fr(source=[ref]),
            qr(),
            constraint(),
        )
    )

    ratio = stats.ratio("source_referenced")
    assert ratio.total == 5
    assert ratio.missing == ("QR-1", "Constraint-1")


def test_ratio_without_population_has_no_rate():
    ratio = collect_stats(build()).ratio("need_satisfied")

    assert (ratio.total, ratio.rate) == (0, None)
    assert ratio.format_rate() == "-"


def test_ambiguity_density_counts_lexicon_findings():
    stats = collect_stats(build(need(text="適切に精算したい"), need("Need-2")))

    assert stats.ambiguity is not None
    assert stats.ambiguity.findings == 1
    assert stats.ambiguity.nodes_with_findings == 1
    assert stats.ambiguity.density == 1 / 2


def test_ambiguity_is_not_measured_without_lexicon():
    stats = collect_stats(build(need(text="適切に精算したい")), lexicon=False)

    assert stats.ambiguity is None
    assert "測っていない" in render_stats(stats)


def test_suppressed_findings_are_still_counted():
    """stats は CI の成否ではなくモデルの素の状態を測る。"""
    suppressed = need(
        text="適切に精算したい",
        suppress=[("semantics.ambiguous_term", "規程の語をそのまま引いている")],
    )

    assert collect_stats(build(suppressed)).ambiguity.findings == 1


def test_render_text_summary():
    text = render_stats(
        collect_stats(build(goal(), need("Need-1"), fr(satisfies=["Need-1"]))),
        ["requirements.py"],
    )

    assert text.startswith("# モデル統計\n")
    assert "- 対象: requirements.py" in text
    assert "- 規模: 3 ノード / 1 エッジ" in text
    assert "| Goal | 1 | 0 | 0 | 0 | 1 |" in text
    assert "| 計 | 3 | 0 | 0 | 0 | 3 |" in text
    assert "- Need の充足率 (satisfies されている): 100.0% (1/1)" in text
    assert "- 外部参照率 (source を持つノード): 0.0% (0/3) 未達: Goal-1, Need-1, FR-1" in text


def test_render_truncates_a_long_list_of_uncovered_nodes():
    text = render_stats(collect_stats(build(*[need(f"Need-{i}") for i in range(1, 9)])))

    assert "未達: Need-1, Need-2, Need-3, Need-4, Need-5, ほか 3 件" in text


def test_json_shape():
    payload = collect_stats(build(need("Need-1"), fr(satisfies=["Need-1"]))).to_json_obj()

    assert payload["totals"] == {"nodes": 2, "edges": 1}
    assert payload["nodes"]["by_type"]["Need"] == 1
    assert payload["edges"]["by_name"]["satisfies"] == 1
    assert {
        "key": "need_satisfied",
        "label": "Need の充足率 (satisfies されている)",
        "covered": 1,
        "total": 1,
        "rate": 1.0,
        "missing": [],
    } in payload["ratios"]
    assert payload["ambiguity"]["density"] == 0.0
