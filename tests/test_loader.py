"""定義ファイル → 正規化グラフ の変換 (層0/層1 の Finding 化)。"""

from __future__ import annotations

from pathlib import Path

from reqmodel.application.loader import discover_paths, load_paths, load_sources

HEADER = "from reqmodel import Goal, Need, FunctionalRequirement, Reference\n"


def load(source_text: str):
    return load_sources([("<test>", HEADER + source_text)])


def test_definition_file_is_never_executed(tmp_path: Path):
    marker = tmp_path / "marker.txt"
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER
        + f'open({str(marker)!r}, "w").write("x")\n'
        + 's = Reference(title="経理部長", url="about:blank#S-1")\n',
        encoding="utf-8",
    )
    result = load_paths([definition])
    assert not marker.exists()  # 実行されていない
    assert not result.ok  # 層0 違反として報告される
    assert result.graph.nodes == {}


def test_node_locations_are_recorded():
    result = load(
        's = Reference(title="経理部長", url="about:blank#S-1")\n'
        'n = Need(\n'
        '    id="Need-1",\n'
        '    text="早く精算したい",\n'
        '    source=[s],\n'
        ')\n'
    )
    assert result.ok
    assert result.graph.location_of("Need-1") == "<test>:3"
    assert result.graph.location_of("Need-1") == "<test>:3"


def test_node_location_points_at_the_file(tmp_path: Path):
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 's = Reference(title="経理部長", url="about:blank#S-1")\n',
        encoding="utf-8",
    )
    result = load_paths([definition])
    assert result.graph.location_of("S-1") is None


def test_layer0_violation_becomes_a_finding():
    result = load("for i in [1]:\n    pass\n")
    assert not result.ok
    finding = result.findings.items[0]
    assert finding.layer == 0
    assert finding.code == "declarative.forbidden"
    assert finding.location and finding.location.startswith("<test>:")


def test_layer1_violation_becomes_a_finding():
    result = load('n = Need(id="Need-1", text="早く精算する")\n')
    assert not result.ok
    finding = result.findings.items[0]
    assert finding.layer == 1
    assert finding.code == "syntax.invalid_field"
    assert finding.node_id == "Need-1"
    assert "願望形" in finding.message


def test_duplicate_id_is_reported():
    result = load(
        'n1 = Need(id="Need-1", text="早く精算したい")\n'
        'n2 = Need(id="Need-1", text="紙をなくしたい")\n'
    )
    assert result.findings.count("error") == 1
    duplicate = next(f for f in result.findings if f.code == "syntax.duplicate_id")
    assert duplicate.node_id == "Need-1"


def test_variable_references_are_resolved_to_ids():
    result = load(
        's = Reference(title="経理部長", url="about:blank#S-1")\n'
        'n = Need(id="Need-1", text="早く精算したい", source=[s])\n'
        'g = Goal(id="Goal-1", text="工数を半減する", motivates=[n], source=[s])\n'
    )
    assert result.ok
    assert result.graph.nodes["Goal-1"].motivates == ["Need-1"]
    assert result.graph.nodes["Need-1"].source[0].title == "経理部長"


def test_id_strings_may_be_used_for_forward_references():
    result = load(
        'g = Goal(id="Goal-1", text="工数を半減する", motivates=["Need-1"])\n'
        'n = Need(id="Need-1", text="早く精算したい")\n'
    )
    assert result.ok
    assert result.graph.nodes["Goal-1"].motivates == ["Need-1"]


def test_multiple_files_are_merged(tmp_path: Path):
    (tmp_path / "a.py").write_text(
        HEADER + 's = Reference(title="経理部長", url="about:blank#S-1")\n',
        encoding="utf-8",
    )
    (tmp_path / "b.py").write_text(
        HEADER + 'n = Need(id="Need-1", text="早く精算したい", source=["S-1"])\n',
        encoding="utf-8",
    )
    result = load_paths(discover_paths([str(tmp_path)]))
    assert result.ok
    assert set(result.graph.nodes) == {"Need-1"}


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
    assert len(result.graph) == 14


def test_requirement_group_is_loaded_as_presentation_view(tmp_path: Path) -> None:
    path = tmp_path / "requirements.py"
    path.write_text(
        """
from reqmodel import FunctionalRequirement, Need, RequirementGroup

NEED = Need(id="Need-1", text="利用者は、入力したい")
FR = FunctionalRequirement(id="FR-1", text="入力すること", satisfies=[NEED])
GROUP = RequirementGroup(id="input", label="入力", order=20, members=[FR])
""",
        encoding="utf-8",
    )

    result = load_paths([path])

    assert result.ok
    assert list(result.graph.nodes) == ["Need-1", "FR-1"]
    assert [group.model_dump(mode="json") for group in result.requirement_groups] == [
        {"id": "input", "label": "入力", "members": ["FR-1"], "order": 20}
    ]
