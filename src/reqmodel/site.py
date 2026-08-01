"""静的サイトの生成 (GitHub Pages 用)。

正規化グラフと検証結果を 1 枚の HTML に埋め込み、ブラウザ上で
グラフ表示・絞り込み・影響範囲の可視化ができるようにする。

描画の定義 (形状・配色) は render.py から `render_meta()` で受け取り、
ブラウザ側に複製しない。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from html import escape
from importlib import resources
from pathlib import Path
from typing import Any, Sequence

from .findings import FindingList
from .graph import RequirementGraph
from .model import EDGE_NAMES, TYPE_ORDER
from .render import render_dot, render_meta, render_mermaid

__all__ = [
    "build_site",
    "site_data",
    "Asset",
    "SITE_ASSETS",
    "asset_srcs",
    "DEFAULT_TITLE",
]


@dataclass(frozen=True)
class Asset:
    """ページが読み込む描画ライブラリ 1 つ。"""

    file: str
    url: str


#: 図の描画に使うライブラリ。バージョンは固定する。
#: どちらも単一ファイルの UMD ビルドなので、公開先に置いて相対パスを指す
#: (自己完結) こともできる。cytoscape-dagre は dagre を同梱しているため、
#: 別途 dagre を置く必要は無い。
CYTOSCAPE_VERSION = "3.34.0"
CYTOSCAPE_DAGRE_VERSION = "4.0.0"
_CDN = "https://cdn.jsdelivr.net/npm"

SITE_ASSETS: tuple[Asset, ...] = (
    Asset(
        "cytoscape.min.js",
        f"{_CDN}/cytoscape@{CYTOSCAPE_VERSION}/dist/cytoscape.min.js",
    ),
    Asset(
        "cytoscape-dagre.js",
        f"{_CDN}/cytoscape-dagre@{CYTOSCAPE_DAGRE_VERSION}/dist/cytoscape-dagre.js",
    ),
)

DEFAULT_TITLE = "要求グラフ"


def asset_srcs(local: bool = False) -> list[str]:
    """`<script src>` に入れる参照先。local なら出力先の同名ファイルを相対参照する。"""
    return [asset.file if local else asset.url for asset in SITE_ASSETS]


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
    scripts: Sequence[str] | None = None,
) -> Path:
    """out_dir に index.html と生データを書き出し、index.html のパスを返す。

    scripts に相対パス (``asset_srcs(local=True)``) を渡し、同じディレクトリへ
    その UMD ビルドを置けば、外部への通信が無い自己完結のサイトになる。
    """
    data = site_data(graph, findings, title, sources)
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    tags = "\n".join(
        f'<script src="{escape(src, quote=True)}"></script>'
        for src in (asset_srcs() if scripts is None else scripts)
    )

    html = (
        _template()
        .replace("__TITLE__", escape(title))
        .replace("__SCRIPTS__", tags)
        .replace("__DATA__", payload)
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    index = out_dir / "index.html"
    index.write_text(html, encoding="utf-8")
    (out_dir / "model.json").write_text(graph.to_json(), encoding="utf-8")
    (out_dir / "graph.mmd").write_text(render_mermaid(graph), encoding="utf-8")
    (out_dir / "graph.dot").write_text(render_dot(graph), encoding="utf-8")
    return index
