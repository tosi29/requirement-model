"""静的サイトの生成 (GitHub Pages 用)。

正規化グラフと検証結果を 1 枚の HTML に埋め込み、ブラウザ上で
グラフ表示・絞り込み・影響範囲の可視化ができるようにする。

描画の定義 (形状・配色) は render.py から `render_meta()` で受け取り、
ブラウザ側に複製しない。図を描く部分は差し替えられるようにしてあり、
`renderer_*.js` のどれか 1 つがテンプレートに埋め込まれる。
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
    "library_url",
    "RENDERERS",
    "DEFAULT_RENDERER",
    "MERMAID_URL",
    "GRAPHVIZ_URL",
    "DEFAULT_TITLE",
]


@dataclass(frozen=True)
class Renderer:
    """図の描画方式。テンプレートに埋め込む JS と、その依存ライブラリ。"""

    name: str
    script: str
    #: 既定の参照先 (CDN)。相対パスを渡せば同梱したファイルを見に行く。
    url: str
    #: 自己完結サイトに置くときの推奨ファイル名。
    local_name: str


#: 図の描画に使うライブラリ。バージョンは固定する。
MERMAID_VERSION = "11.16.0"
MERMAID_URL = (
    f"https://cdn.jsdelivr.net/npm/mermaid@{MERMAID_VERSION}/dist/mermaid.min.js"
)

#: Graphviz の WASM ビルド。dist/index.js は wasm を内包した単一の ES モジュール。
GRAPHVIZ_VERSION = "1.28.0"
GRAPHVIZ_URL = (
    "https://cdn.jsdelivr.net/npm/"
    f"@hpcc-js/wasm-graphviz@{GRAPHVIZ_VERSION}/dist/index.js"
)

RENDERERS: dict[str, Renderer] = {
    "mermaid": Renderer(
        name="mermaid",
        script="renderer_mermaid.js",
        url=MERMAID_URL,
        local_name="mermaid.min.js",
    ),
    "graphviz": Renderer(
        name="graphviz",
        script="renderer_graphviz.js",
        url=GRAPHVIZ_URL,
        # ES モジュールとして動的 import するので、相対パスの形にしておく。
        local_name="./graphviz.js",
    ),
}

DEFAULT_RENDERER = "mermaid"
DEFAULT_TITLE = "要求グラフ"


def library_url(renderer: str, local: bool = False) -> str:
    """描画ライブラリの参照先。local=True なら同梱したファイルへの相対パス。"""
    entry = _renderer(renderer)
    return entry.local_name if local else entry.url


def _renderer(name: str) -> Renderer:
    try:
        return RENDERERS[name]
    except KeyError:
        raise ValueError(
            f"未対応の描画方式: {name} (使えるのは {', '.join(RENDERERS)})"
        ) from None


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


def _asset(name: str) -> str:
    return resources.files("reqmodel").joinpath(name).read_text(encoding="utf-8")


def build_site(
    graph: RequirementGraph,
    findings: FindingList,
    out_dir: Path,
    title: str = DEFAULT_TITLE,
    sources: Sequence[str] = (),
    renderer: str = DEFAULT_RENDERER,
    library: str | None = None,
) -> Path:
    """out_dir に index.html と生データを書き出し、index.html のパスを返す。

    library に相対パス (例: ``mermaid.min.js`` / ``./graphviz.js``) を渡し、
    同じディレクトリへその実体を置けば、外部への通信が無い自己完結のサイトになる。
    """
    entry = _renderer(renderer)
    data = site_data(graph, findings, title, sources)
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")

    html = (
        _asset("site_template.html")
        .replace("__RENDERER_JS__", _asset(entry.script))
        .replace("__TITLE__", escape(title))
        .replace("__LIBRARY_URL__", escape(library or entry.url, quote=True))
        .replace("__DATA__", payload)
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    index = out_dir / "index.html"
    index.write_text(html, encoding="utf-8")
    (out_dir / "model.json").write_text(graph.to_json(), encoding="utf-8")
    (out_dir / "graph.mmd").write_text(render_mermaid(graph), encoding="utf-8")
    (out_dir / "graph.dot").write_text(render_dot(graph), encoding="utf-8")
    return index
