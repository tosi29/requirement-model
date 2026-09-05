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

from ..findings import FindingList
from ..core.graph import RequirementGraph
from ..core.metamodel import EDGE_NAMES, TYPE_ORDER, edge_specs_for
from ..definition.nodes import STATUS_RANK
from .render import render_dot, render_meta, render_mermaid
from ..definition import RequirementGroup

__all__ = [
    "build_site",
    "site_data",
    "app_js",
    "Asset",
    "RepoLink",
    "SITE_ASSETS",
    "SITE_SCRIPTS",
    "asset_srcs",
    "DEFAULT_REF",
    "DEFAULT_TITLE",
]


@dataclass(frozen=True)
class Asset:
    """ページが読み込む描画ライブラリ 1 つ。"""

    file: str
    url: str


#: 図のレイアウトに使うライブラリ。バージョンは固定する。
#: 単一ファイルの UMD ビルドなので、公開先に置いて相対パスを指す
#: (自己完結) こともできる。描画はブラウザ標準の SVG DOM で行う。
DAGRE_VERSION = "1.1.5"
_CDN = "https://cdn.jsdelivr.net/npm"

SITE_ASSETS: tuple[Asset, ...] = (
    Asset(
        "dagre.min.js",
        f"{_CDN}/@dagrejs/dagre@{DAGRE_VERSION}/dist/dagre.min.js",
    ),
)

DEFAULT_TITLE = "要求グラフ"

#: `--repo-ref` の既定。ブランチ名でもコミット SHA でもよい。
DEFAULT_REF = "main"


@dataclass(frozen=True)
class RepoLink:
    """定義ファイルの置き場所 (ページから「GitHub で開く」を出すための情報)。

    ノードの出所 (``examples/sample.py:42``) は**生成時の作業ディレクトリからの
    相対パス**なので、リポジトリの URL と参照 (ブランチ / SHA) を足せば
    blob URL になる。組み立てはページ側 (``site_logic.sourceUrl()``) で行う。
    """

    url: str
    ref: str = DEFAULT_REF

    def to_dict(self) -> dict[str, str]:
        return {"url": self.url.rstrip("/"), "ref": self.ref}


def asset_srcs(local: bool = False) -> list[str]:
    """`<script src>` に入れる参照先。local なら出力先の同名ファイルを相対参照する。"""
    return [asset.file if local else asset.url for asset in SITE_ASSETS]


def site_data(
    graph: RequirementGraph,
    findings: FindingList,
    title: str,
    sources: Sequence[str],
    suppressed: int = 0,
    repo: RepoLink | None = None,
    requirement_groups: Sequence[RequirementGroup] = (),
) -> dict[str, Any]:
    """ページに埋め込むデータ一式。

    findings は抑制 (waiver) 適用後の指摘。抑制した件数は消さずに
    ``stats.suppressed`` として残す。

    repo を渡すと、ノードと指摘の出所から定義ファイルへのリンクがページに出る。
    渡さなければ出所は今まで通りただの文字列として出る。
    """
    return {
        "title": title,
        "generated_from": list(sources),
        # 出所 (file:line) から定義ファイルへ飛ぶためのリポジトリ情報。無ければ null。
        "repo": repo.to_dict() if repo else None,
        "schema_version": graph.to_json_obj()["schema_version"],
        "types": [node_type.__name__ for node_type in TYPE_ORDER],
        "edge_names": list(EDGE_NAMES),
        # 図に既定で描かないもの。現在は全ノード・全エッジを描く。
        "hidden_by_default": {"types": [], "edges": []},
        # status の成熟度。テーブルビューの status 列をこの順で並べる
        # (辞書順に並べても意味が無いので、順序は Python 側を唯一の出典とする)。
        "status_rank": dict(STATUS_RANK),
        # ノード型ごとのエッジ種別。ページ側が「このグラフに現れうるエッジ」を
        # CLI (explain._all_edge_names) と同じ手順で数えるために渡す。
        "edge_names_by_type": {
            node_type.__name__: list(edge_specs_for(node_type))
            for node_type in TYPE_ORDER
        },
        "requirement_groups": [
            group.model_dump(mode="json") for group in requirement_groups
        ],
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
            "suppressed": suppressed,
        },
        "meta": render_meta(),
    }


def _read(name: str) -> str:
    return (
        resources.files("reqmodel.presentation")
        .joinpath(name)
        .read_text(encoding="utf-8")
    )


#: 開発時に直接 lint / test する ES modules。配布時は esbuild の生成物だけを読む。
SITE_SCRIPTS: tuple[str, ...] = (
    "site_text.ts", "site_graph.ts", "site_table.ts", "site_state.ts",
    "site_context.ts", "site_layout.ts", "site_logic.ts", "site_types.ts",
    "site_graph_view.ts", "site_app.ts",
)
SITE_BUNDLE = "site_bundle.js"


def app_js() -> str:
    """ビルド時に生成して package data に含めた自己完結 bundle を返す。"""
    source = _read(SITE_BUNDLE)
    if "</script" in source:
        raise ValueError(f"{SITE_BUNDLE} に </script> が含まれている")
    return source


def build_site(
    graph: RequirementGraph,
    findings: FindingList,
    out_dir: Path,
    title: str = DEFAULT_TITLE,
    sources: Sequence[str] = (),
    scripts: Sequence[str] | None = None,
    suppressed: int = 0,
    repo: RepoLink | None = None,
    requirement_groups: Sequence[RequirementGroup] = (),
) -> Path:
    """out_dir に index.html と生データを書き出し、index.html のパスを返す。

    scripts に相対パス (``asset_srcs(local=True)``) を渡し、同じディレクトリへ
    その UMD ビルドを置けば、外部への通信が無い自己完結のサイトになる。
    """
    data = site_data(
        graph, findings, title, sources, suppressed, repo, requirement_groups
    )
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    tags = "\n".join(
        f'<script src="{escape(src, quote=True)}"></script>'
        for src in (asset_srcs() if scripts is None else scripts)
    )

    # __DATA__ の差し込みは最後に行う。定義ファイル由来の文字列が
    # 他のプレースホルダとして解釈されないようにするため。
    html = (
        _read("site_template.html")
        .replace("__TITLE__", escape(title))
        .replace("__SCRIPTS__", tags)
        .replace("__APP_JS__", app_js())
        .replace("__DATA__", payload)
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    index = out_dir / "index.html"
    index.write_text(html, encoding="utf-8")
    (out_dir / "model.json").write_text(graph.to_json(), encoding="utf-8")
    (out_dir / "graph.mmd").write_text(
        render_mermaid(graph, requirement_groups=requirement_groups), encoding="utf-8"
    )
    (out_dir / "graph.dot").write_text(
        render_dot(graph, requirement_groups=requirement_groups), encoding="utf-8"
    )
    return index
