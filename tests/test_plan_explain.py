"""構造 diff・影響範囲・グラフ出力。"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from conftest import build, fr, goal, need, qr, source
from reqmodel.application.explain import explain_text, impact_set
from reqmodel.application.loader import load_paths
from reqmodel.application.plan import diff_graphs, format_plan, load_revision
from reqmodel.presentation.render import render_dot, render_mermaid
from reqmodel.presentation.plan import render_plan_markdown

HEADER = "from reqmodel import Goal, Need, FunctionalRequirement, Reference\n"


def chain():
    s = source("S-1")
    n = need("Need-1", source=[s])
    g = goal("Goal-1", motivates=[n], source=[s])
    f = fr("FR-1", satisfies=[n], source=[s])
    return build(n, g, f)


def test_diff_detects_added_removed_and_changed():
    before = build(need("Need-1"), need("Need-2"))
    after = build(need("Need-1", text="もっと早く精算したい"), need("Need-3"))
    diff = diff_graphs(before, after)
    assert diff.added == ["Need-3"]
    assert diff.removed == ["Need-2"]
    assert list(diff.changed) == ["Need-1"]
    assert diff.changed["Need-1"][0].field == "text"


def test_diff_detects_edge_changes():
    before = build(need("Need-1"), fr("FR-1"))
    after = build(need("Need-1"), fr("FR-1", satisfies=["Need-1"]))
    changes = diff_graphs(before, after).changed["FR-1"]
    assert [c.field for c in changes] == ["satisfies"]
    assert changes[0].after == ["Need-1"]


def test_diff_detects_type_change():
    before = build(qr("Q-1", text="5 秒以内とすること"))
    after = build(fr("Q-1", text="5 秒以内とすること"))
    assert diff_graphs(before, after).retyped["Q-1"] == (
        "QualityRequirement",
        "FunctionalRequirement",
    )


def test_empty_diff():
    diff = diff_graphs(chain(), chain())
    assert diff.empty
    assert "構造上の変更はない" in format_plan(chain(), chain(), diff, "HEAD")


def test_plan_output_lists_impact():
    s = source("S-1")
    before = chain()
    after = build(
        need("Need-1", source=[s]),
        goal("Goal-1", motivates=["Need-1"], source=[s]),
        fr("FR-1", satisfies=["Need-1"], source=[s], status="approved"),
    )
    diff = diff_graphs(before, after)
    text = format_plan(before, after, diff, "HEAD")
    assert "~ [FunctionalRequirement] FR-1" in text
    assert "status: proposed → approved" in text
    assert "## 影響範囲" in text
    assert "Need-1" in text.split("## 影響範囲")[1]


def test_markdown_plan_contains_table_mermaid_and_diff_colors():
    before = build(need("Need-1"), fr("FR-1", satisfies=["Need-1"]))
    after = build(
        need("Need-1"),
        fr("FR-1", text="変更後を読み取ること", satisfies=["Need-1"]),
        qr("QR-1", text="5 秒以内とすること", qualifies=["FR-1"]),
    )
    diff = diff_graphs(before, after)
    text = render_plan_markdown(before, after, diff, "origin/main")
    assert "```mermaid" in text
    assert "classDef added fill:#dafbe1" in text
    assert "classDef impacted fill:#fff8c5" in text
    assert "| 🟢 追加 | `QR-1`" in text
    assert "| 🔵 変更 | `FR-1` | `text`" in text
    assert "- 🟡 `Need-1`" in text


def test_load_revision_reads_the_previous_version(tmp_path: Path):
    def git(*args: str) -> None:
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)

    git("init")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 'n = Need(id="Need-1", text="早く精算したい")\n', encoding="utf-8"
    )
    git("add", "requirements.py")
    git("commit", "-m", "first")

    definition.write_text(
        HEADER
        + 'n = Need(id="Need-1", text="もっと早く精算したい")\n'
        + 'n2 = Need(id="Need-2", text="紙をなくしたい")\n',
        encoding="utf-8",
    )

    previous = load_revision([definition], "HEAD", repo=tmp_path)
    current = load_paths([definition])
    assert previous.ok and current.ok
    diff = diff_graphs(previous.graph, current.graph)
    assert diff.added == ["Need-2"]
    assert diff.changed["Need-1"][0].before == "早く精算したい"


def test_moving_a_definition_to_another_line_is_not_a_change(tmp_path: Path):
    def git(*args: str) -> None:
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)

    git("init")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER
        + 'n = Need(id="Need-1", text="早く精算したい")\n'
        + 'n2 = Need(id="Need-2", text="紙をなくしたい")\n',
        encoding="utf-8",
    )
    git("add", "requirements.py")
    git("commit", "-m", "first")
    definition.write_text(
        HEADER
        + "\n"
        + 'n2 = Need(id="Need-2", text="紙をなくしたい")\n'
        + "\n"
        + 'n = Need(id="Need-1", text="早く精算したい")\n',
        encoding="utf-8",
    )

    previous = load_revision([definition], "HEAD", repo=tmp_path)
    current = load_paths([definition])
    assert previous.graph.location_of("Need-1") != current.graph.location_of("Need-1")
    diff = diff_graphs(previous.graph, current.graph)
    assert diff.empty


def test_load_revision_tolerates_files_absent_in_the_revision(tmp_path: Path):
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    definition = tmp_path / "requirements.py"
    definition.write_text(HEADER, encoding="utf-8")
    assert len(load_revision([definition], "HEAD", repo=tmp_path).graph) == 0


def test_impact_set_splits_upstream_and_downstream():
    ancestors, descendants, whole = impact_set(chain(), ["FR-1"])
    assert descendants == {"Need-1"}
    assert ancestors == set()
    assert "FR-1" in whole


def test_explain_text_contains_natural_language_edges_and_references():
    text = explain_text(chain(), ["FR-1"])
    assert "# 影響部分グラフ: FR-1" in text
    assert "領収書を読み取ること" in text
    assert "受け入れ基準:" in text
    assert "Source: 経理部長 <https://example.com/references/S-1>" in text
    assert "FR-1 --satisfies--> Need-1" in text


def test_explain_text_carries_the_evidence_reference():
    s = source("S-1")
    e = source("EV-1", text="受入テスト第 1 回")
    n = need("Need-1", source=[s])
    g = goal("Goal-1", motivates=[n], source=[s])
    f = fr("FR-1", satisfies=[n], source=[s], status="verified", evidence=[e])
    text = explain_text(build(n, g, f), ["FR-1"])
    assert "Evidence: 受入テスト第 1 回 <https://example.com/references/EV-1>" in text


def test_explain_undirected_reaches_the_goal():
    directed = explain_text(chain(), ["FR-1"])
    undirected = explain_text(chain(), ["FR-1"], undirected=True)
    assert "Goal-1" not in directed
    assert "Goal-1" in undirected


def test_explain_reports_unknown_node():
    assert "存在しないノード: X-1" in explain_text(chain(), ["FR-1", "X-1"])


def test_mermaid_output_is_well_formed():
    text = render_mermaid(chain())
    assert text.startswith("flowchart TD")
    assert 'n3["<b>FR-1</b> [FunctionalRequirement]' in text
    assert "n3 -->|satisfies| n2" in text
    assert "classDef Goal" in text
    assert "Source" not in text


def test_mermaid_escapes_reserved_characters():
    text = render_mermaid(build(fr("FR-1", text='"<x>" を表示すること')))
    assert "#quot;#lt;x#gt;#quot;" in text


def test_mermaid_highlight():
    text = render_mermaid(chain(), highlight=["FR-1"])
    assert "class n3 highlight" in text


def test_dot_output_is_well_formed():
    text = render_dot(chain())
    assert text.startswith("digraph requirements {")
    assert 'n3 -> n2 [label="satisfies"]' in text
    assert text.rstrip().endswith("}")


def test_quality_requirement_output_uses_requirement_shape():
    graph = build(qr("QR-1", text="5 秒以内とすること"))
    mermaid = render_mermaid(graph)
    dot = render_dot(graph)
    assert 'n1["<b>QR-1</b> [QualityRequirement]' in mermaid
    assert 'n1 [shape=box, label="QR-1 [QualityRequirement]' in dot


def collide():
    s = source("S-1")
    n_dash = need("Need-1", source=[s])
    n_under = need("N_1", source=[s])
    f_dash = fr("FR-1", satisfies=[n_dash], source=[s])
    f_dot = fr("FR.1", text="金額を表示すること", satisfies=[n_under], source=[s])
    return build(n_dash, n_under, f_dash, f_dot)


def test_ids_differing_only_in_punctuation_stay_separate_nodes():
    text = render_mermaid(collide())
    declared = dict(
        (node_id, identifier)
        for identifier, node_id in re.findall(
            r"^    (\w+)\W*\"<b>(.+?)</b>", text, re.MULTILINE
        )
    )
    assert set(declared) == {"Need-1", "N_1", "FR-1", "FR.1"}
    assert len(set(declared.values())) == 4


def test_edges_between_colliding_ids_keep_their_own_endpoints():
    graph = collide()
    mermaid = render_mermaid(graph)
    dot = render_dot(graph)
    ids = {node.id: f"n{i}" for i, node in enumerate(graph.ordered_nodes(), 1)}
    assert f"    {ids['FR-1']} -->|satisfies| {ids['Need-1']}" in mermaid
    assert f"    {ids['FR.1']} -->|satisfies| {ids['N_1']}" in mermaid
    assert f'{ids["FR-1"]} -> {ids["Need-1"]} [label="satisfies"]' in dot
    assert f'{ids["FR.1"]} -> {ids["N_1"]} [label="satisfies"]' in dot
    assert mermaid.count("-->|satisfies|") == 2


def test_dot_gives_every_node_its_own_identifier():
    declared = re.findall(
        r"^    (\w+) \[shape=",
        render_dot(collide()),
        re.MULTILINE,
    )
    assert len(declared) == 4
    assert len(set(declared)) == 4
