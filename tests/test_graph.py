"""グラフ操作: 到達可能性・影響範囲・正規化 JSON。"""

from __future__ import annotations

from conftest import build, decision, fr, goal, need, qr, source, system
from reqmodel.graph import RequirementGraph


def chain():
    s = source("S-1")
    n = need("N-1", has_source=[s])
    g = goal("G-1", motivates=[n], has_source=[s])
    f = fr("FR-1", satisfies=[n], has_source=[s])
    q = qr("QR-1", qualifies=[f], has_source=[s])
    return build(s, n, g, f, q)


def test_edges_are_derived_from_fields():
    graph = chain()
    assert ("FR-1", "satisfies", "N-1") in [
        (e.source, e.name, e.target) for e in graph.edges
    ]
    assert len(graph.out_edges("FR-1", ("satisfies",))) == 1
    assert len(graph.in_edges("N-1", ("satisfies",))) == 1


def test_descendants_and_ancestors():
    graph = chain()
    assert graph.descendants("FR-1") == {"N-1", "S-1"}
    assert graph.ancestors("N-1") == {"G-1", "FR-1", "QR-1"}
    assert graph.impact("FR-1") == {"N-1", "S-1", "QR-1"}


def test_edge_filter_narrows_traversal():
    graph = chain()
    assert graph.descendants("FR-1", ("satisfies",)) == {"N-1"}


def test_depth_limits_traversal():
    graph = chain()
    assert graph.descendants("QR-1", depth=1) == {"FR-1", "S-1"}
    assert "N-1" in graph.descendants("QR-1", depth=2)


def test_related_ignores_edge_direction():
    graph = chain()
    # 有向では Goal に届かないが、無向なら理由まで辿れる
    assert "G-1" not in graph.impact("FR-1")
    assert "G-1" in graph.related("FR-1")


def test_pair_edges_expand_to_both_members():
    a = fr("FR-1", conflicts=["FR-2"])
    b = fr("FR-2")
    d = decision("D-1", resolves=[(a, b)])
    graph = build(a, b, d)
    targets = {e.target for e in graph.out_edges("D-1", ("resolves",))}
    assert targets == {"FR-1", "FR-2"}


def test_cycles_are_detected_per_edge_type():
    graph = build(goal("G-1", refines=["G-2"]), goal("G-2", refines=["G-1"]))
    assert graph.cycles(("refines",))
    assert graph.cycles(("motivates",)) == []


def test_json_round_trip_is_stable():
    graph = chain()
    text = graph.to_json()
    again = RequirementGraph.from_json(text)
    assert again.to_json() == text
    assert set(again.nodes) == set(graph.nodes)


def test_locations_survive_the_json_round_trip():
    graph = RequirementGraph([need("N-1"), need("N-2")], {"N-1": "reqs.py:7"})
    record = {n["id"]: n for n in graph.to_json_obj()["nodes"]}
    assert record["N-1"]["location"] == "reqs.py:7"
    assert "location" not in record["N-2"]  # 分からないノードには付けない

    again = RequirementGraph.from_json(graph.to_json())
    assert again.location_of("N-1") == "reqs.py:7"
    assert again.location_of("N-2") is None


def test_locations_of_unknown_nodes_are_dropped():
    graph = RequirementGraph([need("N-1")], {"N-1": "reqs.py:7", "N-9": "reqs.py:9"})
    assert graph.locations == {"N-1": "reqs.py:7"}


def test_node_order_is_deterministic():
    graph = build(qr("QR-1"), goal("G-2"), goal("G-1"), system("SYS"))
    assert [n.id for n in graph.ordered_nodes()] == ["G-1", "G-2", "QR-1", "SYS"]
