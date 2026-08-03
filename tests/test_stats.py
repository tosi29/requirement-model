"""健全性メトリクス (req stats) の確認。"""

from __future__ import annotations

from conftest import build, constraint, fr, goal, need, qr, source, system

from reqmodel.application.stats import collect_stats, render_stats


def test_counts_nodes_by_type_and_status():
    stats = collect_stats(
        build(
            goal(),
            need(status="approved"),
            fr(satisfies=["N-1"]),
            qr(qualifies=["FR-1"], status="verified"),
            source(),
        )
    )

    assert stats.nodes == 5
    assert stats.by_type["FunctionalRequirement"] == 1
    assert stats.by_type["Constraint"] == 0  # 存在しない型も 0 で並ぶ (分布として読む)
    assert stats.by_status == {
        "proposed": 3,
        "approved": 1,
        "implemented": 0,
        "verified": 1,
    }
    assert stats.by_type_status["QualityRequirement"]["verified"] == 1


def test_counts_edges_by_name():
    stats = collect_stats(
        build(
            source(),
            need(has_source=["S-1"]),
            fr(satisfies=["N-1"], has_source=["S-1"]),
        )
    )

    assert stats.edges == 3
    assert stats.by_edge["has_source"] == 2
    assert stats.by_edge["satisfies"] == 1
    assert stats.by_edge["qualifies"] == 0


def test_need_satisfaction_ratio_lists_the_uncovered():
    stats = collect_stats(
        build(need("N-1"), need("N-2"), fr(satisfies=["N-1"]))
    )

    ratio = stats.ratio("need_satisfied")
    assert ratio is not None
    assert (ratio.covered, ratio.total) == (1, 2)
    assert ratio.rate == 0.5
    assert ratio.missing == ("N-2",)


def test_evidence_ratios_are_split_by_type():
    stats = collect_stats(
        build(
            fr("FR-1", evidence=["受入テストで確認した"]),
            fr("FR-2"),
            qr("QR-1"),
        )
    )

    assert stats.ratio("evidence_fr").missing == ("FR-2",)
    assert stats.ratio("evidence_qr").rate == 0.0


def test_source_trace_ratio_covers_the_same_types_as_missing_source():
    stats = collect_stats(
        build(
            source(),
            goal(has_source=["S-1"]),
            need(has_source=["S-1"]),
            fr(has_source=["S-1"]),
            qr(),
            constraint(),
            system(),  # System と Source は母数に入らない
        )
    )

    ratio = stats.ratio("source_traced")
    assert ratio.total == 5
    assert ratio.missing == ("QR-1", "C-1")


def test_ratio_without_population_has_no_rate():
    ratio = collect_stats(build(source())).ratio("need_satisfied")

    assert (ratio.total, ratio.rate) == (0, None)
    assert ratio.format_rate() == "-"


def test_ambiguity_density_counts_lexicon_findings():
    stats = collect_stats(build(need(text="適切に精算したい"), need("N-2"), source()))

    assert stats.ambiguity is not None
    assert stats.ambiguity.findings == 1
    assert stats.ambiguity.nodes_with_findings == 1
    assert stats.ambiguity.density == 1 / 3


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
        collect_stats(build(goal(), need("N-1"), fr(satisfies=["N-1"]))),
        ["requirements.py"],
    )

    assert text.startswith("# モデル統計\n")
    assert "- 対象: requirements.py" in text
    assert "- 規模: 3 ノード / 1 エッジ" in text
    assert "| Goal | 1 | 0 | 0 | 0 | 1 |" in text
    assert "| 計 | 3 | 0 | 0 | 0 | 3 |" in text
    assert "- Need の充足率 (satisfies されている): 100.0% (1/1)" in text
    assert "- 源泉トレース率 (has_source を持つ要求): 0.0% (0/3) 未達: G-1, N-1, FR-1" in text


def test_render_truncates_a_long_list_of_uncovered_nodes():
    text = render_stats(collect_stats(build(*[need(f"N-{i}") for i in range(1, 9)])))

    assert "未達: N-1, N-2, N-3, N-4, N-5, ほか 3 件" in text


def test_json_shape():
    payload = collect_stats(build(need("N-1"), fr(satisfies=["N-1"]))).to_json_obj()

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
