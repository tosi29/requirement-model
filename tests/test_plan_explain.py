"""構造 diff・影響範囲・グラフ出力。"""

from __future__ import annotations

import subprocess
from pathlib import Path

from conftest import build, fr, goal, need, qr, source
from reqmodel.explain import explain_text, impact_set
from reqmodel.loader import load_paths
from reqmodel.plan import diff_graphs, format_plan, load_revision
from reqmodel.render import render_dot, render_mermaid

HEADER = "from reqmodel import Goal, Need, FunctionalRequirement, Source\n"


def chain():
    s = source("S-1")
    n = need("N-1", has_source=[s])
    g = goal("G-1", motivates=[n], has_source=[s])
    f = fr("FR-1", satisfies=[n], has_source=[s])
    return build(s, n, g, f)


# --- diff -------------------------------------------------------------------


def test_diff_detects_added_removed_and_changed():
    before = build(need("N-1"), need("N-2"))
    after = build(need("N-1", text="もっと早く精算したい"), need("N-3"))

    diff = diff_graphs(before, after)
    assert diff.added == ["N-3"]
    assert diff.removed == ["N-2"]
    assert list(diff.changed) == ["N-1"]
    assert diff.changed["N-1"][0].field == "text"
    assert diff.touched == ["N-1", "N-2", "N-3"]


def test_diff_detects_edge_changes():
    before = build(need("N-1"), fr("FR-1"))
    after = build(need("N-1"), fr("FR-1", satisfies=["N-1"]))
    changes = diff_graphs(before, after).changed["FR-1"]
    assert [c.field for c in changes] == ["satisfies"]
    assert changes[0].after == ["N-1"]


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
    before = chain()
    after = build(
        source("S-1"),
        need("N-1", has_source=["S-1"]),
        goal("G-1", motivates=["N-1"], has_source=["S-1"]),
        fr("FR-1", satisfies=["N-1"], has_source=["S-1"], status="approved"),
    )
    diff = diff_graphs(before, after)
    text = format_plan(before, after, diff, "HEAD")
    assert "~ [FunctionalRequirement] FR-1" in text
    assert "status: proposed → approved" in text
    assert "## 影響範囲" in text
    assert "N-1" in text.split("## 影響範囲")[1]


def test_load_revision_reads_the_previous_version(tmp_path: Path):
    def git(*args: str) -> None:
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)

    git("init")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 'n = Need(id="N-1", text="早く精算したい")\n', encoding="utf-8"
    )
    git("add", "requirements.py")
    git("commit", "-m", "first")

    definition.write_text(
        HEADER
        + 'n = Need(id="N-1", text="もっと早く精算したい")\n'
        + 'n2 = Need(id="N-2", text="紙をなくしたい")\n',
        encoding="utf-8",
    )

    previous = load_revision([definition], "HEAD", repo=tmp_path)
    current = load_paths([definition])
    assert previous.ok and current.ok

    diff = diff_graphs(previous.graph, current.graph)
    assert diff.added == ["N-2"]
    assert diff.changed["N-1"][0].before == "早く精算したい"


def test_moving_a_definition_to_another_line_is_not_a_change(tmp_path: Path):
    """出所は正規化 JSON には載るが、diff の比較対象からは外してある。"""

    def git(*args: str) -> None:
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)

    git("init")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER
        + 'n = Need(id="N-1", text="早く精算したい")\n'
        + 'n2 = Need(id="N-2", text="紙をなくしたい")\n',
        encoding="utf-8",
    )
    git("add", "requirements.py")
    git("commit", "-m", "first")

    # 並べ替えと空行の挿入だけを行う (ノードの中身は変えない)
    definition.write_text(
        HEADER
        + "\n"
        + 'n2 = Need(id="N-2", text="紙をなくしたい")\n'
        + "\n"
        + 'n = Need(id="N-1", text="早く精算したい")\n',
        encoding="utf-8",
    )

    previous = load_revision([definition], "HEAD", repo=tmp_path)
    current = load_paths([definition])
    assert previous.graph.location_of("N-1") != current.graph.location_of("N-1")

    diff = diff_graphs(previous.graph, current.graph)
    assert diff.empty
    assert "構造上の変更はない" in format_plan(
        previous.graph, current.graph, diff, "HEAD"
    )


def test_load_revision_tolerates_files_absent_in_the_revision(tmp_path: Path):
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    definition = tmp_path / "requirements.py"
    definition.write_text(HEADER, encoding="utf-8")
    assert len(load_revision([definition], "HEAD", repo=tmp_path).graph) == 0


# --- explain ----------------------------------------------------------------


def test_impact_set_splits_upstream_and_downstream():
    ancestors, descendants, whole = impact_set(chain(), ["FR-1"])
    assert descendants == {"N-1", "S-1"}
    assert ancestors == set()
    assert "FR-1" in whole


def test_explain_text_contains_natural_language_and_edges():
    text = explain_text(chain(), ["FR-1"])
    assert "# 影響部分グラフ: FR-1" in text
    assert "領収書を読み取ること" in text
    assert "受け入れ基準:" in text
    assert "FR-1 --satisfies--> N-1" in text


def test_explain_undirected_reaches_the_goal():
    directed = explain_text(chain(), ["FR-1"])
    undirected = explain_text(chain(), ["FR-1"], undirected=True)
    assert "G-1" not in directed
    assert "G-1" in undirected


def test_explain_reports_unknown_node():
    assert "存在しないノード: X-1" in explain_text(chain(), ["FR-1", "X-1"])


# --- render -----------------------------------------------------------------


def test_mermaid_output_is_well_formed():
    text = render_mermaid(chain())
    assert text.startswith("flowchart TD")
    assert 'n_FR_1["<b>FR-1</b> [FunctionalRequirement]' in text
    assert "n_FR_1 -->|satisfies| n_N_1" in text
    assert "classDef Goal" in text


def test_mermaid_escapes_reserved_characters():
    text = render_mermaid(build(fr("FR-1", text='"<x>" を表示すること')))
    assert "#quot;#lt;x#gt;#quot;" in text


def test_mermaid_highlight():
    text = render_mermaid(chain(), highlight=["FR-1"])
    assert "class n_FR_1 highlight" in text


def test_dot_output_is_well_formed():
    text = render_dot(chain())
    assert text.startswith("digraph requirements {")
    assert 'n_FR_1 -> n_N_1 [label="satisfies"]' in text
    assert text.rstrip().endswith("}")
