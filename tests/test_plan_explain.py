"""構造 diff・影響範囲・グラフ出力。"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from conftest import build, fr, goal, need, qr, source
from reqmodel.application.explain import explain_text, impact_set, source_label
from reqmodel.application.loader import load_paths
from reqmodel.application.plan import diff_graphs, format_plan, load_revision
from reqmodel.presentation.render import render_dot, render_mermaid

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
    #: 源泉エッジは既定で辿らないので S-1 は入らない。
    assert descendants == {"N-1"}
    assert ancestors == set()
    assert "FR-1" in whole


def test_impact_set_reaches_sources_only_when_asked():
    _, descendants, _ = impact_set(chain(), ["FR-1"], include_sources=True)
    assert descendants == {"N-1", "S-1"}


def test_explain_text_contains_natural_language_and_edges():
    text = explain_text(chain(), ["FR-1"])
    assert "# 影響部分グラフ: FR-1" in text
    assert "領収書を読み取ること" in text
    assert "受け入れ基準:" in text
    assert "FR-1 --satisfies--> N-1" in text


def test_explain_text_carries_the_evidence():
    """LLM に渡る文脈で最も具体的なのは、何をもって満たしたと判断したかの側。"""
    s = source("S-1")
    n = need("N-1", has_source=[s])
    g = goal("G-1", motivates=[n], has_source=[s])
    f = fr(
        "FR-1",
        satisfies=[n],
        has_source=[s],
        status="verified",
        evidence=["受入テスト第 1 回で全項目が合格した"],
    )
    text = explain_text(build(s, n, g, f), ["FR-1"])
    assert "    根拠: 受入テスト第 1 回で全項目が合格した" in text


def test_explain_undirected_reaches_the_goal():
    directed = explain_text(chain(), ["FR-1"])
    undirected = explain_text(chain(), ["FR-1"], undirected=True)
    assert "G-1" not in directed
    assert "G-1" in undirected


def test_explain_reports_unknown_node():
    assert "存在しないノード: X-1" in explain_text(chain(), ["FR-1", "X-1"])


# --- 源泉の扱い (図には出さず、ノードの属性として出す) ------------------------


def quoted():
    """引用 (part_of で文書にぶら下がる Source) を持つ最小のグラフ。"""
    document = source("SRC-DOC", text="経費精算規程 第4版", kind="document")
    clause = source(
        "SRC-DOC-A12",
        text="1万円を超える支出には領収書の添付を要する",
        kind="document",
        locator="第12条第3項",
        part_of=[document],
    )
    return build(document, clause, fr("FR-1", has_source=[clause]))


def test_explain_folds_the_source_into_an_attribute_line():
    text = explain_text(quoted(), ["FR-1"])

    #: 引用文・位置・引用元の 3 つが 1 行に畳まれる。
    assert (
        "    源泉: SRC-DOC-A12 (1万円を超える支出には領収書の添付を要する) "
        "[第12条第3項] < SRC-DOC (経費精算規程 第4版)"
    ) in text
    #: Source はブロックとしては出ない (辿っていないので下流に入らない)。
    assert "## 下流" not in text
    assert "- [Source]" not in text


def test_explain_says_it_did_not_follow_source_edges():
    text = explain_text(quoted(), ["FR-1"])

    assert "源泉エッジ (has_source, part_of) は辿っていない" in text
    #: 辿らなかった種別を「現れなかった」にも出すと読み分けられなくなる。
    unused = [line for line in text.splitlines() if "現れなかったエッジ種別" in line]
    assert not any("has_source" in line or "part_of" in line for line in unused)


def test_explain_with_sources_walks_them_instead_of_folding():
    text = explain_text(quoted(), ["FR-1"], include_sources=True)

    assert "- [Source] SRC-DOC-A12" in text
    assert "FR-1 --has_source--> SRC-DOC-A12" in text
    #: 辿ったならブロックで出ているので、属性行には畳まない。
    assert "    源泉:" not in text
    assert "源泉エッジ" not in text


def test_explicit_edge_filter_still_folds_the_source():
    """`--edges` は書き手の明示指定。源泉を辿らないので属性としては残す。"""
    text = explain_text(quoted(), ["FR-1"], edge_names=["satisfies"])

    assert "- [Source]" not in text
    assert "    源泉: SRC-DOC-A12 " in text


def test_source_label_stops_on_a_part_of_cycle():
    """part_of の閉路は層2 がエラーにするが、整形側で無限ループにはしない。"""
    a = source("SRC-A", text="A", part_of=["SRC-B"])
    b = source("SRC-B", text="B", part_of=["SRC-A"])
    label = source_label(build(a, b, fr("FR-1", has_source=[a])), "SRC-A")

    assert label == "SRC-A (A) < SRC-B (B)"


# --- render -----------------------------------------------------------------


def test_graph_leaves_out_sources_by_default():
    graph = quoted()
    default = render_mermaid(graph)
    with_sources = render_mermaid(graph, include_sources=True)

    assert "[Source]" not in default
    assert "has_source" not in default and "part_of" not in default
    assert "[Source]" in with_sources
    assert "has_source" in with_sources
    #: 型としては残るので、凡例のもとになる classDef は既定でも出る。
    assert "    classDef Source" in default


def test_dot_leaves_out_sources_by_default():
    graph = quoted()

    assert "[Source]" not in render_dot(graph)
    assert "[Source]" in render_dot(graph, include_sources=True)


def test_mermaid_output_is_well_formed():
    text = render_mermaid(chain())
    #: 識別子は ordered_nodes() の索引 (型順 → id 順) なので G-1 → N-1 → FR-1 → S-1。
    assert text.startswith("flowchart TD")
    assert 'n3["<b>FR-1</b> [FunctionalRequirement]' in text
    assert "n3 -->|satisfies| n2" in text
    assert "classDef Goal" in text


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


# 記号だけが異なる id は、元の id をそのまま識別子にすると衝突する
# (`FR-1` と `FR_1` の非英数字を潰すとどちらも同じになる)。連番なら起こり得ない。


def collide():
    """記号だけが異なる id を持つノードの組。"""
    s = source("S-1")
    n_dash = need("N-1", has_source=[s])
    n_under = need("N_1", has_source=[s])
    f_dash = fr("FR-1", satisfies=[n_dash], has_source=[s])
    f_dot = fr("FR.1", text="金額を表示すること", satisfies=[n_under], has_source=[s])
    return build(s, n_dash, n_under, f_dash, f_dot)


def test_ids_differing_only_in_punctuation_stay_separate_nodes():
    #: 識別子の衝突を見るテストなので、Source も描かせて全ノードを対象にする。
    text = render_mermaid(collide(), include_sources=True)
    declared = dict(
        (node_id, identifier)
        for identifier, node_id in re.findall(
            r"^    (\w+)\W*\"<b>(.+?)</b>", text, re.MULTILINE
        )
    )

    assert set(declared) == {"N-1", "N_1", "FR-1", "FR.1", "S-1"}
    #: 5 ノードに 5 つの識別子。1 つでも重なればノードが融合している。
    assert len(set(declared.values())) == 5


def test_edges_between_colliding_ids_keep_their_own_endpoints():
    graph = collide()
    mermaid = render_mermaid(graph)
    dot = render_dot(graph)
    ids = {node.id: f"n{i}" for i, node in enumerate(graph.ordered_nodes(), 1)}

    assert f"    {ids['FR-1']} -->|satisfies| {ids['N-1']}" in mermaid
    assert f"    {ids['FR.1']} -->|satisfies| {ids['N_1']}" in mermaid
    assert f'{ids["FR-1"]} -> {ids["N-1"]} [label="satisfies"]' in dot
    assert f'{ids["FR.1"]} -> {ids["N_1"]} [label="satisfies"]' in dot
    #: 融合していれば同じ端点の行が 2 本出る (どちらも satisfies)。
    assert mermaid.count("-->|satisfies|") == 2


def test_dot_gives_every_node_its_own_identifier():
    declared = re.findall(
        r"^    (\w+) \[shape=",
        render_dot(collide(), include_sources=True),
        re.MULTILINE,
    )
    assert len(declared) == len(set(declared)) == 5


def test_highlight_marks_only_the_node_with_that_id():
    graph = collide()
    ids = {node.id: f"n{i}" for i, node in enumerate(graph.ordered_nodes(), 1)}
    text = render_mermaid(graph, highlight=["FR-1"])

    assert f"    class {ids['FR-1']} highlight" in text
    assert f"    class {ids['FR.1']} highlight" not in text
    assert text.count(" highlight\n") == 1


def test_identifiers_follow_the_order_of_ordered_nodes():
    graph = collide()
    text = render_mermaid(graph, include_sources=True)
    declared = [
        line.split("<b>")[1].split("</b>")[0]
        for line in text.splitlines()
        if "<b>" in line
    ]
    #: 宣言の順は ordered_nodes() そのもの = n1, n2, … が振られる順。
    assert declared == [node.id for node in graph.ordered_nodes()]
    assert render_mermaid(graph, include_sources=True) == text
