"""仕様書とトレーサビリティ表の生成 (doc.py) の確認。"""

from __future__ import annotations

import csv
import io

import pytest
from conftest import build, constraint, fr, goal, need, qr, source, system

from reqmodel.application.doc import (
    CSV_HEADER,
    MATRICES,
    MatrixSpec,
    build_matrix,
    render_matrices_csv,
    render_matrices_markdown,
    render_spec,
)
from reqmodel.model import FunctionalRequirement, Need, Source


def sample():
    """Goal → Need → FR → QR が 1 本通った最小のグラフ。"""
    return build(
        source("S-1"),
        goal("G-1", motivates=["N-1"], has_source=["S-1"]),
        need("N-1", has_source=["S-1"]),
        fr("FR-1", satisfies=["N-1"]),
        qr("QR-1", qualifies=["FR-1"]),
    )


def heading_of(text: str, node_id: str) -> str:
    for line in text.splitlines():
        if line.startswith("#") and line.split(" ")[1:2] == [node_id]:
            return line.split(" ")[0]
    raise AssertionError(f"{node_id} の見出しが無い")


# ---------------------------------------------------------------------------
# 仕様書
# ---------------------------------------------------------------------------


def test_spec_nests_goal_need_fr_qr():
    text = render_spec(sample())
    assert heading_of(text, "G-1") == "###"
    assert heading_of(text, "N-1") == "####"
    assert heading_of(text, "FR-1") == "#####"
    assert heading_of(text, "QR-1") == "######"
    assert text.index("### G-1") < text.index("#### N-1") < text.index("##### FR-1")


def test_spec_lists_attributes_criteria_and_traces():
    text = render_spec(sample(), title="経費精算 仕様書", sources=["examples/x.py"])
    assert text.startswith("# 経費精算 仕様書\n")
    assert "- 生成元: examples/x.py" in text
    assert "種別: FunctionalRequirement / 状態: proposed" in text
    assert "- 充足するニーズ: N-1" in text
    assert "- 源泉: S-1 (経理部長)" in text
    assert "    - 読み取り率 95% 以上" in text  # 受け入れ基準


def test_spec_shows_node_location_when_known():
    graph = sample()
    graph.locations["FR-1"] = "requirements.py:12"
    assert "- 定義: requirements.py:12" in render_spec(graph)


def test_spec_repeats_shared_node_as_reference():
    graph = build(
        goal("G-1", motivates=["N-1", "N-2"]),
        need("N-1"),
        need("N-2", text="早く承認したい"),
        fr("FR-1", satisfies=["N-1", "N-2"]),
    )
    text = render_spec(graph)
    assert text.count("##### FR-1") == 1  # 本文は 1 か所だけ
    assert "- (前掲) FR-1 領収書を読み取ること" in text


def test_spec_sections_cover_constraint_and_source():
    graph = build(
        source("S-1"),
        fr("FR-1"),
        constraint("C-1", constrains=["FR-1"], has_source=["S-1"]),
    )
    text = render_spec(graph)
    assert "### C-1 国内リージョンにのみ保存すること" in text
    assert "- 制約する対象: FR-1" in text
    assert "- **S-1** (stakeholder) 経理部長 — C-1" in text


def test_spec_puts_system_quality_in_its_own_section():
    text = render_spec(build(system("SYS"), qr("QR-2", qualifies=["SYS"])))
    assert "## 2. システムに張られた品質要求" in text
    assert heading_of(text, "SYS") == "###"
    assert heading_of(text, "QR-2") == "####"


def test_spec_lists_nodes_that_no_section_reached():
    text = render_spec(build(need("N-9")))  # どの Goal からも動機づけられていない
    assert "## 5. 上記に現れなかったノード" in text
    assert "- **N-9** (Need) 早く精算したい" in text


def test_spec_keeps_empty_sections_with_placeholder():
    text = render_spec(build(goal("G-1")))
    assert "## 3. 制約\n\n該当なし。" in text


def test_spec_orders_goals_by_refines_tree_and_survives_cycles():
    graph = build(
        goal("G-1"),
        goal("G-2", text="入力の手間を減らす", refines=["G-1"]),
        goal("G-8", text="堂々巡りする", refines=["G-9"]),
        goal("G-9", text="ぐるぐる回る", refines=["G-8"]),
    )
    text = render_spec(graph)
    assert text.index("### G-1") < text.index("### G-2")
    for node_id in ("G-8", "G-9"):  # 閉路のゴールも落とさない
        assert f"### {node_id}" in text


def test_spec_squashes_newlines_in_text():
    graph = build(goal("G-1", text="工数を\n半減する"))
    assert "### G-1 工数を 半減する" in render_spec(graph)


# ---------------------------------------------------------------------------
# トレーサビリティマトリクス
# ---------------------------------------------------------------------------


NEED_FR = MatrixSpec("Need × FR", "satisfies", (Need,), (FunctionalRequirement,), reverse=True)


def test_build_matrix_puts_upstream_on_rows():
    graph = build(need("N-1"), need("N-2", text="早く承認したい"), fr("FR-1", satisfies=["N-1"]))
    matrix = build_matrix(graph, NEED_FR)
    assert [n.id for n in matrix.rows] == ["N-1", "N-2"]
    assert [n.id for n in matrix.cols] == ["FR-1"]
    assert matrix.marked("N-1", "FR-1")
    assert not matrix.marked("N-2", "FR-1")
    assert [n.id for n in matrix.uncovered_rows()] == ["N-2"]
    assert matrix.uncovered_cols() == []


def test_build_matrix_ignores_edges_outside_the_declared_types():
    graph = build(system("SYS"), qr("QR-1", qualifies=["SYS"]), fr("FR-1"), need("N-1"))
    assert build_matrix(graph, NEED_FR).cells == frozenset()


def test_matrix_is_empty_when_a_side_has_no_node():
    matrix = build_matrix(build(need("N-1")), NEED_FR)
    assert matrix.empty
    assert "該当するノードが無い。" in render_matrices_markdown(
        build(need("N-1")), specs=[NEED_FR]
    )


def test_markdown_matrix_marks_links_and_reports_gaps():
    graph = build(need("N-1"), fr("FR-1", satisfies=["N-1"]), fr("FR-2", text="通知すること"))
    text = render_matrices_markdown(graph, specs=[NEED_FR])
    assert "| Need × FR | FR-1 | FR-2 |" in text
    assert "| N-1 早く精算したい | ✓ |  |" in text
    assert "- トレースの無い行: なし" in text
    assert "- トレースの無い列: FR-2" in text
    assert "- FR-1 領収書を読み取ること" in text  # 列の凡例


def test_markdown_matrix_escapes_pipe_in_text():
    graph = build(need("N-1", text="A | B を見たい"), fr("FR-1", satisfies=["N-1"]))
    row = [
        line
        for line in render_matrices_markdown(graph, specs=[NEED_FR]).splitlines()
        if line.startswith("| N-1")
    ][0]
    assert row == "| N-1 A \\| B を見たい | ✓ |"
    assert row.count("|") - row.count("\\|") == 3  # 表の区切りは 3 本のまま


def test_default_matrices_cover_the_main_edges():
    assert [spec.edge for spec in MATRICES] == [
        "motivates",
        "satisfies",
        "qualifies",
        "has_source",
        "constrains",
    ]


def test_csv_is_one_row_per_link_and_keeps_uncovered_rows():
    graph = build(need("N-1"), need("N-2", text="早く承認したい"), fr("FR-1", satisfies=["N-1"]))
    rows = list(csv.reader(io.StringIO(render_matrices_csv(graph, specs=[NEED_FR]))))
    assert rows[0] == list(CSV_HEADER)
    assert rows[1] == [
        "Need × FR",
        "satisfies",
        "Need",
        "N-1",
        "早く精算したい",
        "FunctionalRequirement",
        "FR-1",
        "領収書を読み取ること",
    ]
    assert rows[2] == ["Need × FR", "satisfies", "Need", "N-2", "早く承認したい", "", "", ""]


@pytest.mark.parametrize("render", [render_spec, render_matrices_markdown])
def test_documents_end_with_a_single_newline(render):
    text = render(sample())
    assert text.endswith("\n") and not text.endswith("\n\n")


def test_source_section_nests_quotes_under_their_origin():
    """「この源泉のどこが、どの要求の根拠か」を 1 か所で読めること。"""
    graph = build(
        source("S-1"),
        Source(
            id="S-2",
            text="領収書の添付を要する",
            kind="document",
            locator="第12条第3項",
            part_of=["S-1"],
        ),
        need("N-1", has_source=["S-2"]),
        fr("FR-1", satisfies=["N-1"], has_source=["S-2"]),
    )
    text = render_spec(graph)
    assert "- **S-1** (stakeholder) 経理部長 — 引用のみ" in text
    assert "  - **S-2** [第12条第3項] 領収書の添付を要する — N-1, FR-1" in text


def test_source_section_keeps_sources_that_have_no_quotes():
    text = render_spec(sample())
    assert "- **S-1** (stakeholder) 経理部長 — G-1, N-1" in text
