"""静的サイトの JS ロジック。

2 つのことを見る。

- `tests/js/` のユニットテストが通ること (Node の test runner をそのまま呼ぶ)
- `nodeContext()` の出力が `req explain` と一致すること

後者はサイトの「影響部分グラフをコピー」が LLM に渡す本文そのものなので、
CLI と食い違うと気付かないまま別物を配ることになる。Python 側の
``explain_text()`` を真とし、JS 側の出力を突き合わせる。
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from reqmodel.explain import explain_text
from reqmodel.findings import FindingList
from reqmodel.loader import load_paths
from reqmodel.model import EDGE_NAMES
from reqmodel.site import site_data

ROOT = Path(__file__).resolve().parents[1]
JS_TESTS = ROOT / "tests" / "js"
BRIDGE = JS_TESTS / "context_bridge.mjs"
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


def sample_graph():
    loaded = load_paths([SAMPLE])
    assert loaded.ok
    return loaded.graph


def test_js_modules_are_syntactically_valid_on_their_own():
    """切り出した JS は、埋め込まなくても単体で構文検査できる。"""
    for name in ("site_logic.js", "site_app.js"):
        result = run_node(["--check", str(ROOT / "src" / "reqmodel" / name)])
        assert result.returncode == 0, result.stderr


def test_js_unit_tests_pass():
    result = run_node(["--test", str(JS_TESTS / "*.test.mjs")])
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
