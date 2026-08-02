"""定義ファイル → 正規化グラフ の変換 (層0/層1 の Finding 化)。"""

from __future__ import annotations

from pathlib import Path

from reqmodel.loader import discover_paths, load_paths, load_sources

HEADER = "from reqmodel import Goal, Need, FunctionalRequirement, Source\n"


def load(source_text: str):
    return load_sources([("<test>", HEADER + source_text)])


def test_definition_file_is_never_executed(tmp_path: Path):
    marker = tmp_path / "marker.txt"
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER
        + f'open({str(marker)!r}, "w").write("x")\n'
        + 's = Source(id="S-1", text="経理部長", kind="stakeholder")\n',
        encoding="utf-8",
    )
    result = load_paths([definition])
    assert not marker.exists()  # 実行されていない
    assert not result.ok  # 層0 違反として報告される
    assert "S-1" in result.graph.nodes


def test_node_locations_are_recorded():
    result = load(
        's = Source(id="S-1", text="経理部長", kind="stakeholder")\n'
        'n = Need(\n'
        '    id="N-1",\n'
        '    text="早く精算したい",\n'
        '    has_source=[s],\n'
        ')\n'
    )
    assert result.ok
    assert result.graph.location_of("S-1") == "<test>:2"
    assert result.graph.location_of("N-1") == "<test>:3"


def test_node_location_points_at_the_file(tmp_path: Path):
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 's = Source(id="S-1", text="経理部長", kind="stakeholder")\n',
        encoding="utf-8",
    )
    result = load_paths([definition])
    assert result.graph.location_of("S-1") == f"{definition}:2"


def test_layer0_violation_becomes_a_finding():
    result = load("for i in [1]:\n    pass\n")
    assert not result.ok
    finding = result.findings.items[0]
    assert finding.layer == 0
    assert finding.code == "declarative.forbidden"
    assert finding.location and finding.location.startswith("<test>:")


def test_layer1_violation_becomes_a_finding():
    result = load('n = Need(id="N-1", text="早く精算する")\n')
    assert not result.ok
    finding = result.findings.items[0]
    assert finding.layer == 1
    assert finding.code == "syntax.invalid_field"
    assert finding.node_id == "N-1"
    assert "願望形" in finding.message


def test_duplicate_id_is_reported():
    result = load(
        's1 = Source(id="S-1", text="経理部長", kind="stakeholder")\n'
        's2 = Source(id="S-1", text="申請者", kind="stakeholder")\n'
    )
    assert result.findings.count("error") == 1
    assert result.findings.items[0].code == "syntax.duplicate_id"
    assert len(result.graph) == 1


def test_variable_references_are_resolved_to_ids():
    result = load(
        's = Source(id="S-1", text="経理部長", kind="stakeholder")\n'
        'n = Need(id="N-1", text="早く精算したい", has_source=[s])\n'
        'g = Goal(id="G-1", text="工数を半減する", motivates=[n], has_source=[s])\n'
    )
    assert result.ok
    assert result.graph.nodes["G-1"].motivates == ["N-1"]
    assert result.graph.nodes["N-1"].has_source == ["S-1"]


def test_id_strings_may_be_used_for_forward_references():
    result = load(
        'g = Goal(id="G-1", text="工数を半減する", motivates=["N-1"])\n'
        'n = Need(id="N-1", text="早く精算したい")\n'
    )
    assert result.ok
    assert result.graph.nodes["G-1"].motivates == ["N-1"]


def test_multiple_files_are_merged(tmp_path: Path):
    (tmp_path / "a.py").write_text(
        HEADER + 's = Source(id="S-1", text="経理部長", kind="stakeholder")\n',
        encoding="utf-8",
    )
    (tmp_path / "b.py").write_text(
        HEADER + 'n = Need(id="N-1", text="早く精算したい", has_source=["S-1"])\n',
        encoding="utf-8",
    )
    result = load_paths(discover_paths([str(tmp_path)]))
    assert result.ok
    assert set(result.graph.nodes) == {"S-1", "N-1"}


def test_discover_paths_defaults_to_requirements_py(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "requirements.py").write_text(HEADER, encoding="utf-8")
    assert [p.name for p in discover_paths(None)] == ["requirements.py"]


def test_discover_paths_reports_missing_file(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    try:
        discover_paths(None)
    except FileNotFoundError as exc:
        assert "定義ファイルが見つからない" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("FileNotFoundError が送出されるべき")


def test_sample_definition_loads_cleanly():
    sample = Path(__file__).resolve().parents[1] / "examples" / "sample.py"
    result = load_paths([sample])
    assert result.ok, [f.format() for f in result.findings]
    assert len(result.graph) == 20
