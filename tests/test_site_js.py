"""静的サイトの JS ロジック。

3 つのことを見る。

- `tests/js/` のユニットテストが通ること (Node の test runner をそのまま呼ぶ)
- `nodeContext()` の出力が `req explain` と一致すること
- `mermaidText()` の出力が `req graph --format mermaid` と一致すること

後の 2 つは、サイトが配るもの (LLM に渡すコンテキスト / 書き出した .mmd) が
CLI の出力と食い違うと、気付かないまま別物を配ることになるためである。
Python 側 (``explain_text()`` / ``render_mermaid()``) を真とし、JS 側の出力を
突き合わせる。
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from reqmodel.application.explain import explain_text
from reqmodel.findings import FindingList
from reqmodel.application.loader import load_paths
from reqmodel.core.metamodel import EDGE_NAMES
from reqmodel.presentation.render import render_mermaid
from reqmodel.presentation.site import SITE_SCRIPTS, site_data

ROOT = Path(__file__).resolve().parents[1]
JS_TESTS = ROOT / "tests" / "js"
BRIDGE = JS_TESTS / "context_bridge.mjs"
EXPORT_BRIDGE = JS_TESTS / "export_bridge.mjs"
SAMPLE = ROOT / "examples" / "sample.py"

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node が無い")


def run_node(args: list[str], stdin: str | None = None) -> subprocess.CompletedProcess:
    assert NODE is not None
    return subprocess.run(
        [NODE, *args],
        cwd=ROOT,
        input=stdin,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def node_contexts(data: dict, requests: list[dict]) -> list[str]:
    """`nodeContext()` を Node 上で走らせ、要求と同じ並びで結果を返す。"""
    payload = json.dumps({"data": data, "requests": requests}, ensure_ascii=False)
    result = run_node([str(BRIDGE)], payload)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def mermaid_export(data: dict, **selection) -> str:
    """`mermaidText()` を Node 上で走らせる (絞り込みは selection で渡す)。"""
    payload = json.dumps({"data": data, **selection}, ensure_ascii=False)
    result = run_node([str(EXPORT_BRIDGE)], payload)
    assert result.returncode == 0, result.stderr
    return result.stdout


def sample_graph():
    loaded = load_paths([SAMPLE])
    assert loaded.ok
    return loaded.graph


def test_js_modules_are_syntactically_valid_on_their_own():
    """切り出した JS は、埋め込まなくても単体で構文検査できる。"""
    for name in SITE_SCRIPTS:
        result = run_node(["--check", str(ROOT / "src" / "reqmodel" / "presentation" / name)])
        assert result.returncode == 0, result.stderr


def test_js_unit_tests_pass():
    result = run_node(["--test", str(JS_TESTS / "logic.test.mjs")])
    assert result.returncode == 0, result.stdout + result.stderr


def test_node_context_matches_req_explain():
    """絞り込み無しのとき、コピー本文は `req explain ID` と一字一句同じ。"""
    graph = sample_graph()
    data = site_data(graph, FindingList(), "題名", [str(SAMPLE)])
    node_ids = [node["id"] for node in data["nodes"]]

    actual = node_contexts(data, [{"id": node_id} for node_id in node_ids])

    assert len(actual) == len(node_ids)
    for node_id, text in zip(node_ids, actual):
        assert text == explain_text(graph, [node_id]), node_id


def test_node_context_matches_req_explain_with_edge_filter():
    """エッジを絞ったときは `req explain ID --edges ...` と同じになる。"""
    graph = sample_graph()
    data = site_data(graph, FindingList(), "題名", [str(SAMPLE)])
    node_ids = [node["id"] for node in data["nodes"]]
    selected = [name for name in EDGE_NAMES if name in ("refines", "satisfies", "motivates")]

    actual = node_contexts(
        data, [{"id": node_id, "edges": selected} for node_id in node_ids]
    )

    for node_id, text in zip(node_ids, actual):
        assert text == explain_text(graph, [node_id], edge_names=selected), node_id


@pytest.mark.parametrize("depth", [1, 2, 3])
def test_node_context_matches_req_explain_with_depth(depth: int):
    """深さを絞ったときは `req explain ID --depth N` と同じになる。"""
    graph = sample_graph()
    data = site_data(graph, FindingList(), "題名", [str(SAMPLE)])
    node_ids = [node["id"] for node in data["nodes"]]

    actual = node_contexts(
        data, [{"id": node_id, "depth": depth} for node_id in node_ids]
    )

    for node_id, text in zip(node_ids, actual):
        assert text == explain_text(graph, [node_id], depth=depth), node_id


@pytest.mark.parametrize("depth", [None, 2])
def test_node_context_matches_req_explain_undirected(depth: int | None):
    """向きを無視したときは `req explain ID --undirected` と同じになる。"""
    graph = sample_graph()
    data = site_data(graph, FindingList(), "題名", [str(SAMPLE)])
    node_ids = [node["id"] for node in data["nodes"]]

    actual = node_contexts(
        data,
        [
            {"id": node_id, "depth": depth, "undirected": True}
            for node_id in node_ids
        ],
    )

    for node_id, text in zip(node_ids, actual):
        expected = explain_text(graph, [node_id], depth=depth, undirected=True)
        assert text == expected, node_id


def test_mermaid_export_matches_req_graph():
    """絞り込み無しのとき、画面からの書き出しは `req graph --format mermaid` と同じ。

    ページの「.mmd」ボタンは、出力先に置かれる graph.mmd と同じ書式でなければ
    ならない (絞り込んだぶんだけが減る、という関係にする)。
    """
    graph = sample_graph()
    data = site_data(graph, FindingList(), "題名", [str(SAMPLE)])

    assert mermaid_export(data) == render_mermaid(graph)


def test_mermaid_export_drops_filtered_out_nodes():
    """種別を外すと、そのノードと端点を持つエッジが書き出しからも消える。"""
    graph = sample_graph()
    data = site_data(graph, FindingList(), "題名", [str(SAMPLE)])
    types = [name for name in data["types"] if name != "Source"]

    text = mermaid_export(data, types=types)
    lines = text.splitlines()

    assert not [line for line in lines if "[Source]" in line]
    assert not [line for line in lines if line.startswith("    class n_") and line.endswith(" Source")]
    assert "source" not in text
