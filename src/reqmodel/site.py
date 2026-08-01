"""静的サイトの生成 (GitHub Pages 用)。

正規化グラフと検証結果を 1 枚の HTML に埋め込み、ブラウザ上で
グラフ表示・絞り込み・影響範囲の可視化ができるようにする。

描画の定義 (形状・配色) は render.py から `render_meta()` で受け取り、
ブラウザ側に複製しない。
"""

from __future__ import annotations

import json
from html import escape
from importlib import resources
from pathlib import Path
from typing import Any, Sequence

from .findings import FindingList
from .graph import RequirementGraph
from .model import EDGE_NAMES, TYPE_ORDER
from .render import render_dot, render_meta, render_mermaid

__all__ = ["build_site", "site_data", "MERMAID_URL", "DEFAULT_TITLE"]

#: 図の描画に使う Mermaid。バージョンは固定する。
#: 単一ファイルの UMD ビルドなので、公開先に置いて相対パスを指す (自己完結) こともできる。
MERMAID_VERSION = "11.16.0"
MERMAID_FILE = "mermaid.min.js"
MERMAID_URL = f"https://cdn.jsdelivr.net/npm/mermaid@{MERMAID_VERSION}/dist/{MERMAID_FILE}"

DEFAULT_TITLE = "要求グラフ"


def site_data(
    graph: RequirementGraph,
    findings: FindingList,
    title: str,
    sources: Sequence[str],
) -> dict[str, Any]:
    """ページに埋め込むデータ一式。"""
    return {
        "title": title,
        "generated_from": list(sources),
        "schema_version": graph.to_json_obj()["schema_version"],
        "types": [node_type.__name__ for node_type in TYPE_ORDER],
        "edge_names": list(EDGE_NAMES),
        "nodes": graph.to_json_obj()["nodes"],
        "edges": [
            {"source": edge.source, "name": edge.name, "target": edge.target}
            for edge in graph.edges
            if edge.target in graph.nodes
        ],
        "findings": [finding.to_dict() for finding in findings.sorted()],
        "stats": {
            "nodes": len(graph),
            "edges": len(graph.edges),
            "findings": {
                severity: findings.count(severity)  # type: ignore[arg-type]
                for severity in ("error", "severe", "warning", "info")
            },
        },
        "meta": render_meta(),
    }


def _template() -> str:
    return (
        resources.files("reqmodel")
        .joinpath("site_template.html")
        .read_text(encoding="utf-8")
    )


def build_site(
    graph: RequirementGraph,
    findings: FindingList,
    out_dir: Path,
    title: str = DEFAULT_TITLE,
    sources: Sequence[str] = (),
    mermaid_url: str = MERMAID_URL,
) -> Path:
    """out_dir に index.html と生データを書き出し、index.html のパスを返す。

    mermaid_url に相対パス (例: ``mermaid.min.js``) を渡し、同じディレクトリへ
    その UMD ビルドを置けば、外部への通信が無い自己完結のサイトになる。
    """
    data = site_data(graph, findings, title, sources)
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")

    html = (
        _template()
        .replace("__TITLE__", escape(title))
        .replace("__MERMAID_URL__", escape(mermaid_url, quote=True))
        .replace("__DATA__", payload)
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    index = out_dir / "index.html"
    index.write_text(html, encoding="utf-8")
    (out_dir / "model.json").write_text(graph.to_json(), encoding="utf-8")
    (out_dir / "graph.mmd").write_text(render_mermaid(graph), encoding="utf-8")
    (out_dir / "graph.dot").write_text(render_dot(graph), encoding="utf-8")
    return index
