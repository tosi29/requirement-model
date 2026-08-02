"""CLI の受け入れ確認。サンプル定義ファイルで全コマンドを通す。"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from reqmodel.cli import main
from reqmodel.graph import SCHEMA_VERSION

SAMPLE = str(Path(__file__).resolve().parents[1] / "examples" / "sample.py")
HEADER = "from reqmodel import Need\n"


def test_validate_sample_is_clean(capsys):
    assert main(["validate", SAMPLE]) == 0
    out = capsys.readouterr().out
    assert "error=0 severe=0 warning=0 info=0" in out


def test_validate_json_output(capsys):
    assert main(["validate", "-f", SAMPLE, "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["node_count"] == 20
    assert payload["structure_checked"] is True
    assert payload["findings"] == []


def test_validate_reports_errors_and_exits_nonzero(tmp_path: Path, capsys):
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 'n = Need(id="N-1", text="早く精算する")\n', encoding="utf-8"
    )
    assert main(["validate", str(definition)]) == 1
    assert "syntax.invalid_field" in capsys.readouterr().out


def test_validate_strict_turns_warnings_into_failure(tmp_path: Path, capsys):
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 'n = Need(id="N-1", text="早く精算したい")\n', encoding="utf-8"
    )
    assert main(["validate", str(definition)]) == 0
    assert main(["validate", str(definition), "--strict"]) == 1
    assert "structure.orphan_need" in capsys.readouterr().out


def test_validate_skips_layer2_when_layer0_fails(tmp_path: Path, capsys):
    definition = tmp_path / "requirements.py"
    definition.write_text(HEADER + "for i in [1]:\n    pass\n", encoding="utf-8")
    assert main(["validate", str(definition)]) == 1
    assert "層2 の構造チェックは" in capsys.readouterr().out


def test_no_lexicon_option(tmp_path: Path, capsys):
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 'n = Need(id="N-1", text="適切に精算したい")\n', encoding="utf-8"
    )
    main(["validate", str(definition)])
    assert "semantics.ambiguous_term" in capsys.readouterr().out
    main(["validate", str(definition), "--no-lexicon"])
    assert "semantics.ambiguous_term" not in capsys.readouterr().out


@pytest.mark.parametrize("fmt", ["mermaid", "dot"])
def test_graph_command(fmt, capsys):
    assert main(["graph", SAMPLE, "--format", fmt]) == 0
    out = capsys.readouterr().out
    assert ("flowchart TD" if fmt == "mermaid" else "digraph requirements") in out


def test_graph_writes_to_file(tmp_path: Path):
    output = tmp_path / "graph.mmd"
    assert main(["graph", SAMPLE, "-o", str(output)]) == 0
    assert output.read_text(encoding="utf-8").startswith("flowchart TD")


def test_explain_command(capsys):
    assert main(["explain", "FR-3", "-f", SAMPLE]) == 0
    out = capsys.readouterr().out
    assert "# 影響部分グラフ: FR-3" in out
    assert "FR-3 --conflicts--> FR-2" in out


def test_explain_json_command(capsys):
    assert main(["explain", "FR-3", "-f", SAMPLE, "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["targets"] == ["FR-3"]
    assert "N-2" in payload["descendants"]
    assert payload["subgraph"]["nodes"]


def test_explain_unknown_node(capsys):
    assert main(["explain", "NOPE", "-f", SAMPLE]) == 2
    assert "見つからない" in capsys.readouterr().err


def test_explain_edge_filter_rejects_unknown_edge(capsys):
    assert main(["explain", "FR-3", "-f", SAMPLE, "--edges", "nope"]) == 2
    assert "未知のエッジ種別" in capsys.readouterr().err


def test_plan_command(tmp_path: Path, capsys, monkeypatch):
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
        HEADER + 'n = Need(id="N-1", text="今すぐ精算したい")\n', encoding="utf-8"
    )

    monkeypatch.chdir(tmp_path)
    assert main(["plan"]) == 0
    out = capsys.readouterr().out
    assert "# 構造 diff (HEAD → 作業ツリー)" in out
    assert "text: 早く精算したい → 今すぐ精算したい" in out


def test_export_command(capsys):
    assert main(["export", SAMPLE]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["schema_version"] == SCHEMA_VERSION
    assert payload["nodes"][0]["type"] == "Goal"
    assert all(node["location"].startswith(SAMPLE + ":") for node in payload["nodes"])


def test_commands_refuse_to_run_on_broken_definitions(tmp_path: Path, capsys):
    definition = tmp_path / "requirements.py"
    definition.write_text(HEADER + "x = 1 + 1\n", encoding="utf-8")
    assert main(["graph", str(definition)]) == 1
    assert "層0/層1" in capsys.readouterr().err


def test_missing_definition_file_is_reported(tmp_path: Path, capsys, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert main(["validate"]) == 2
    assert "定義ファイルが見つからない" in capsys.readouterr().err
