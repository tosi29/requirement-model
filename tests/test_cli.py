"""CLI の受け入れ確認。サンプル定義ファイルで全コマンドを通す。"""

from __future__ import annotations

import csv
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


#: 源泉付きの Need 1 つ。放っておくと structure.orphan_need だけが出る。
WAIVER_HEADER = (
    "from reqmodel import Need, Source\n"
    's = Source(id="S-1", text="経理部長", kind="stakeholder")\n'
)


def waived(code: str) -> str:
    """指定コードを抑制した Need の定義ファイル。"""
    return (
        WAIVER_HEADER + 'n = Need(id="N-1", text="早く精算したい", has_source=[s],\n'
        f'         suppress=[("{code}", "この版では FR を書かない")])\n'
    )


def test_strict_passes_when_the_finding_is_suppressed(tmp_path: Path, capsys):
    definition = tmp_path / "requirements.py"
    definition.write_text(waived("structure.orphan_need"), encoding="utf-8")

    assert main(["validate", str(definition), "--strict"]) == 0
    out = capsys.readouterr().out
    assert "structure.orphan_need" not in out
    assert "結果: error=0 severe=0 warning=0 info=0 (抑制 1 件)" in out


def test_show_suppressed_lists_the_reason(tmp_path: Path, capsys):
    definition = tmp_path / "requirements.py"
    definition.write_text(waived("structure.orphan_need"), encoding="utf-8")

    assert main(["validate", str(definition), "--show-suppressed"]) == 0
    out = capsys.readouterr().out
    assert "structure.orphan_need" in out
    assert "[抑制: この版では FR を書かない]" in out


def test_validate_json_reports_suppressed_findings(tmp_path: Path, capsys):
    definition = tmp_path / "requirements.py"
    definition.write_text(waived("structure.orphan_need"), encoding="utf-8")

    assert main(["validate", str(definition), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["findings"] == []
    assert payload["suppressed"] == [
        {
            "severity": "warning",
            "code": "structure.orphan_need",
            "layer": 2,
            "message": "どの FR からも satisfies されていない (置き去りのニーズ)",
            "node_id": "N-1",
            "location": f"{definition}:3",
            "reason": "この版では FR を書かない",
        }
    ]


def test_stale_waiver_fails_strict(tmp_path: Path, capsys):
    definition = tmp_path / "requirements.py"
    definition.write_text(waived("structure.orphan_qr"), encoding="utf-8")

    assert main(["validate", str(definition), "--strict"]) == 1
    out = capsys.readouterr().out
    assert "waiver.stale" in out
    assert "structure.orphan_qr の抑制が残っているが" in out


def test_unsuppressible_code_is_a_layer1_error(tmp_path: Path, capsys):
    definition = tmp_path / "requirements.py"
    definition.write_text(waived("structure.dangling_ref"), encoding="utf-8")

    assert main(["validate", str(definition)]) == 1
    assert "structure.dangling_ref は抑制できない" in capsys.readouterr().out


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


def test_doc_command_writes_spec(tmp_path: Path):
    output = tmp_path / "spec.md"
    assert main(["doc", SAMPLE, "-o", str(output)]) == 0
    text = output.read_text(encoding="utf-8")
    assert text.startswith("# 要求仕様書\n")
    assert "### G-1 経費精算にかかる全社の工数を半減する" in text
    assert "##### FR-1 領収書画像から金額と日付を抽出し" in text


def test_doc_title_option(capsys):
    assert main(["doc", "-f", SAMPLE, "--title", "経費精算 要求仕様書"]) == 0
    assert capsys.readouterr().out.startswith("# 経費精算 要求仕様書\n")


def test_doc_matrix_infers_csv_from_output_suffix(tmp_path: Path):
    output = tmp_path / "trace.csv"
    assert main(["doc", SAMPLE, "--matrix", "-o", str(output)]) == 0
    rows = list(csv.reader(output.read_text(encoding="utf-8").splitlines()))
    assert rows[0][:4] == ["matrix", "edge", "row_type", "row_id"]
    assert ["Need × FR", "satisfies", "Need", "N-1"] in [row[:4] for row in rows]


def test_doc_matrix_markdown(capsys):
    assert main(["doc", SAMPLE, "--matrix"]) == 0
    out = capsys.readouterr().out
    assert out.startswith("# トレーサビリティマトリクス\n")
    assert "| Need × FR | FR-1 | FR-2 | FR-3 | FR-4 | FR-5 |" in out


def test_doc_rejects_csv_without_matrix(capsys):
    assert main(["doc", SAMPLE, "--format", "csv"]) == 2
    assert "--matrix を付けること" in capsys.readouterr().err


def test_stats_command(capsys):
    assert main(["stats", SAMPLE]) == 0
    out = capsys.readouterr().out
    assert out.startswith("# モデル統計\n")
    assert "- 規模: 20 ノード / 34 エッジ" in out
    assert "| FunctionalRequirement | 1 | 4 | 0 | 0 | 5 |" in out
    assert "- Need の充足率 (satisfies されている): 100.0% (3/3)" in out


def test_stats_json_output(capsys):
    assert main(["stats", "-f", SAMPLE, "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["files"] == [SAMPLE]
    assert payload["totals"]["nodes"] == 20
    assert payload["nodes"]["by_status"] == {
        "proposed": 1,
        "approved": 19,
        "implemented": 0,
        "verified": 0,
    }
    assert payload["ambiguity"]["findings"] == 0


def test_stats_no_lexicon_option(capsys):
    assert main(["stats", SAMPLE, "--no-lexicon", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["ambiguity"] is None


def test_stats_writes_to_file(tmp_path: Path):
    output = tmp_path / "stats.md"
    assert main(["stats", SAMPLE, "-o", str(output)]) == 0
    assert output.read_text(encoding="utf-8").startswith("# モデル統計\n")


def test_stats_does_not_fail_on_an_unhealthy_model(tmp_path: Path, capsys):
    """stats は判定をしない。指摘だらけのモデルでも終了コードは 0。"""
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 'n = Need(id="N-1", text="適切に精算したい")\n', encoding="utf-8"
    )
    assert main(["stats", str(definition)]) == 0
    out = capsys.readouterr().out
    assert "- Need の充足率 (satisfies されている): 0.0% (0/1) 未達: N-1" in out
    assert "- 指摘 1 件 / 1 ノード = 1.00 件/ノード" in out


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
