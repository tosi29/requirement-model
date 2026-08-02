"""MCP サーバ (`req mcp`)。

ツールの中身は SDK 無しで動くので、ここのほとんどは SDK が入っていなくても回る。
実際に stdio で喋る確認だけ、SDK がある環境に限って行う。
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from importlib.util import find_spec
from pathlib import Path

import pytest

from reqmodel.cli import main
from reqmodel.explain import explain_text
from reqmodel.loader import load_paths
from reqmodel.mcpserver import (
    INSTALL_HINT,
    TOOL_NAMES,
    GraphSession,
    MissingDependency,
    ReqTools,
    build_server,
    call_tool,
    tool_specs,
)

SAMPLE = Path(__file__).resolve().parents[1] / "examples" / "sample.py"
HEADER = "from reqmodel import Need\n"

HAS_SDK = find_spec("mcp") is not None
needs_sdk = pytest.mark.skipif(not HAS_SDK, reason="MCP SDK が入っていない")


@pytest.fixture
def tools() -> ReqTools:
    return ReqTools(GraphSession([str(SAMPLE)]))


def payload(tools: ReqTools, name: str, **arguments) -> dict:
    return json.loads(call_tool(tools, name, arguments))


# ---------------------------------------------------------------------------
# 公開するツールの形
# ---------------------------------------------------------------------------


def test_tool_specs_cover_all_tools():
    specs = tool_specs()
    assert [spec["name"] for spec in specs] == list(TOOL_NAMES)
    for spec in specs:
        assert spec["description"]  # docstring がそのまま説明になる
        assert spec["input_schema"]["type"] == "object"


def test_explain_schema_documents_its_arguments():
    schema = next(s for s in tool_specs() if s["name"] == "explain")["input_schema"]
    properties = schema["properties"]
    assert schema["required"] == ["ids"]
    assert set(properties) == {"ids", "edges", "depth", "undirected"}
    # エッジ種別の一覧は説明に入れておく (エージェントが値を推測しないで済む)
    assert "satisfies" in properties["edges"]["description"]


def test_unknown_tool_is_rejected(tools: ReqTools):
    with pytest.raises(ValueError, match="未知のツール"):
        call_tool(tools, "delete_everything", {})


# ---------------------------------------------------------------------------
# validate
# ---------------------------------------------------------------------------


def test_validate_reports_clean_sample(tools: ReqTools):
    result = payload(tools, "validate")
    assert result["ok"] is True
    assert result["structure_checked"] is True
    assert result["node_count"] == 20
    assert result["findings"] == []


def test_validate_reports_findings(tmp_path: Path):
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 'n = Need(id="N-1", text="適切に精算したい")\n', encoding="utf-8"
    )
    tools = ReqTools(GraphSession([str(definition)]))

    result = payload(tools, "validate")
    codes = {finding["code"] for finding in result["findings"]}
    assert {"structure.orphan_need", "semantics.ambiguous_term"} <= codes

    without_lexicon = payload(tools, "validate", lexicon=False)
    codes = {finding["code"] for finding in without_lexicon["findings"]}
    assert "semantics.ambiguous_term" not in codes


def test_validate_survives_broken_definitions(tmp_path: Path):
    """層0 エラーがあってもサーバは答える。理由が分からないと直せない。"""
    definition = tmp_path / "requirements.py"
    definition.write_text(HEADER + "for i in [1]:\n    pass\n", encoding="utf-8")
    tools = ReqTools(GraphSession([str(definition)]))

    result = payload(tools, "validate")
    assert result["ok"] is False
    assert result["structure_checked"] is False
    assert result["findings"][0]["code"] == "declarative.forbidden"


# ---------------------------------------------------------------------------
# explain / impact
# ---------------------------------------------------------------------------


def test_explain_matches_the_cli_output(tools: ReqTools, capsys):
    """MCP と `req explain` が別のコンテキストを返してはならない。"""
    for arguments in (
        {"ids": ["FR-3"]},
        {"ids": ["FR-3"], "undirected": True, "depth": 2},
        {"ids": ["FR-1", "QR-1"], "edges": ["satisfies", "qualifies"]},
    ):
        graph = load_paths([SAMPLE]).graph
        expected = explain_text(
            graph,
            arguments["ids"],
            arguments.get("edges"),
            arguments.get("depth"),
            arguments.get("undirected", False),
        )
        assert call_tool(tools, "explain", arguments) == expected

    # CLI の標準出力とも突き合わせておく
    assert main(["explain", "FR-3", "-f", str(SAMPLE)]) == 0
    assert capsys.readouterr().out == call_tool(tools, "explain", {"ids": ["FR-3"]})


def test_impact_returns_upstream_and_downstream(tools: ReqTools):
    result = payload(tools, "impact", ids=["FR-3"])
    assert result["targets"] == ["FR-3"]
    assert result["missing"] == []
    assert "D-1" in result["ancestors"]
    assert "N-2" in result["descendants"]
    assert result["subgraph"]["nodes"]


def test_impact_honours_edge_and_depth_limits(tools: ReqTools):
    everything = payload(tools, "impact", ids=["FR-3"])
    narrowed = payload(tools, "impact", ids=["FR-3"], edges=["satisfies"], depth=1)
    assert set(narrowed["descendants"]) < set(everything["descendants"])


def test_explain_rejects_unknown_input(tools: ReqTools):
    with pytest.raises(ValueError, match="ノードが見つからない"):
        call_tool(tools, "explain", {"ids": ["NOPE"]})
    with pytest.raises(ValueError, match="ids を 1 つ以上"):
        call_tool(tools, "explain", {"ids": []})
    with pytest.raises(ValueError, match="未知のエッジ種別"):
        call_tool(tools, "explain", {"ids": ["FR-3"], "edges": ["nope"]})


def test_explain_keeps_going_when_only_some_ids_are_unknown(tools: ReqTools):
    text = call_tool(tools, "explain", {"ids": ["FR-3", "NOPE"]})
    assert "存在しないノード: NOPE" in text
    assert "[FunctionalRequirement] FR-3" in text


# ---------------------------------------------------------------------------
# search / node
# ---------------------------------------------------------------------------


def test_search_matches_id_and_text(tools: ReqTools):
    by_text = payload(tools, "search", query="領収書")
    assert {match["id"] for match in by_text["matches"]} >= {"N-1", "FR-1"}
    assert by_text["truncated"] is False

    by_id = payload(tools, "search", query="fr-", limit=100)
    assert all(match["id"].startswith("FR-") for match in by_id["matches"])


def test_search_filters_by_type_and_limit(tools: ReqTools):
    needs = payload(tools, "search", query="たい", types=["Need"])
    assert {match["type"] for match in needs["matches"]} == {"Need"}

    # FR / QR の短縮名も受ける (定義ファイルと同じ語彙で書ける)
    assert payload(tools, "search", query="-", types=["FR"])["matches"]

    capped = payload(tools, "search", query="-", limit=1)
    assert capped["returned"] == 1
    assert capped["total"] > 1
    assert capped["truncated"] is True


def test_search_rejects_bad_arguments(tools: ReqTools):
    with pytest.raises(ValueError, match="query を空"):
        call_tool(tools, "search", {"query": "  "})
    with pytest.raises(ValueError, match="未知のノード型"):
        call_tool(tools, "search", {"query": "a", "types": ["Widget"]})


def test_node_returns_details_and_edges(tools: ReqTools):
    result = payload(tools, "node", id="FR-1")
    assert result["node"]["type"] == "FunctionalRequirement"
    assert result["node"]["location"].startswith(str(SAMPLE) + ":")
    satisfies = [edge for edge in result["out_edges"] if edge["name"] == "satisfies"]
    assert [edge["target"] for edge in satisfies] == ["N-1"]
    # 相手の本文まで返す (ID だけでは何に繋がっているか分からない)
    assert satisfies[0]["target_text"].startswith("申請者は、領収書を")
    assert any(edge["name"] == "qualifies" for edge in result["in_edges"])


def test_node_carries_its_findings(tmp_path: Path):
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 'n = Need(id="N-1", text="早く精算したい")\n', encoding="utf-8"
    )
    tools = ReqTools(GraphSession([str(definition)]))
    result = payload(tools, "node", id="N-1")
    assert {finding["code"] for finding in result["findings"]} == {
        "structure.orphan_need",
        "structure.missing_source",
    }


def test_node_rejects_unknown_id(tools: ReqTools):
    with pytest.raises(ValueError, match="ノードが見つからない"):
        call_tool(tools, "node", {"id": "NOPE"})


# ---------------------------------------------------------------------------
# 読み直し
# ---------------------------------------------------------------------------


def test_session_reloads_after_the_file_changes(tmp_path: Path):
    """エージェントは対話の途中で定義ファイルを書き換える。古い答えを返さない。"""
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 'n = Need(id="N-1", text="早く精算したい")\n', encoding="utf-8"
    )
    tools = ReqTools(GraphSession([str(definition)]))
    assert payload(tools, "node", id="N-1")["node"]["text"] == "早く精算したい"

    definition.write_text(
        HEADER
        + 'n = Need(id="N-1", text="早く精算したい")\n'
        + 'm = Need(id="N-2", text="今すぐ精算したい")\n',
        encoding="utf-8",
    )
    assert payload(tools, "node", id="N-2")["node"]["text"] == "今すぐ精算したい"
    assert payload(tools, "validate")["node_count"] == 2


def test_session_picks_up_new_files_in_a_directory(tmp_path: Path):
    directory = tmp_path / "requirements"
    directory.mkdir()
    (directory / "a.py").write_text(
        HEADER + 'n = Need(id="N-1", text="早く精算したい")\n', encoding="utf-8"
    )
    tools = ReqTools(GraphSession([str(directory)]))
    assert payload(tools, "validate")["node_count"] == 1

    (directory / "b.py").write_text(
        HEADER + 'm = Need(id="N-2", text="今すぐ精算したい")\n', encoding="utf-8"
    )
    assert payload(tools, "validate")["node_count"] == 2


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def test_list_tools_command(capsys):
    assert main(["mcp", "--list-tools"]) == 0
    specs = json.loads(capsys.readouterr().out)
    assert [spec["name"] for spec in specs] == list(TOOL_NAMES)


def test_missing_sdk_is_reported_with_the_install_hint(monkeypatch, capsys):
    def refuse(tools):
        raise MissingDependency(INSTALL_HINT)

    monkeypatch.setattr("reqmodel.cli.build_server", refuse)
    assert main(["mcp", str(SAMPLE)]) == 2
    err = capsys.readouterr().err
    assert INSTALL_HINT in err
    # 起動できないのに「開始する」とは言わない
    assert "開始する" not in err


def test_missing_definition_file_is_a_usage_error(tmp_path: Path, capsys, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert main(["mcp"]) == 2
    assert "定義ファイルが見つからない" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# SDK 境界
# ---------------------------------------------------------------------------


@pytest.mark.skipif(HAS_SDK, reason="MCP SDK が入っている")
def test_build_server_without_sdk(tools: ReqTools):
    with pytest.raises(MissingDependency, match="reqmodel\\[mcp\\]"):
        build_server(tools)


@needs_sdk
def test_build_server_registers_every_tool(tools: ReqTools):
    server = build_server(tools)
    listed = asyncio.run(server.list_tools())
    assert sorted(tool.name for tool in listed) == sorted(TOOL_NAMES)


@needs_sdk
def test_stdio_server_answers_a_client():
    """実際に `req mcp` を起こし、MCP クライアントとして問い合わせる。"""
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    async def ask() -> tuple[list[str], str, bool]:
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "reqmodel.cli", "mcp", str(SAMPLE)],
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                listed = await session.list_tools()
                explained = await session.call_tool("explain", {"ids": ["FR-3"]})
                failed = await session.call_tool("node", {"id": "NOPE"})
                return (
                    [tool.name for tool in listed.tools],
                    explained.content[0].text,
                    failed.is_error,
                )

    names, explained, is_error = asyncio.run(asyncio.wait_for(ask(), timeout=60))
    assert sorted(names) == sorted(TOOL_NAMES)
    assert explained == explain_text(load_paths([SAMPLE]).graph, ["FR-3"])
    assert is_error is True


@needs_sdk
def test_server_module_runs_as_a_subprocess():
    """起動時に定義ファイルの読み込みまで済ませ、stderr に出す。"""
    process = subprocess.run(
        [sys.executable, "-m", "reqmodel.cli", "mcp", str(SAMPLE)],
        input="",
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert "MCP サーバ (stdio) を開始する" in process.stderr
