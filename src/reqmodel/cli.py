"""`req` コマンド。

    req validate           # 層0〜層2 の全チェック
    req plan               # git 上の前版との構造 diff → 影響範囲
    req graph [--format mermaid|dot]
    req explain <ID...>    # 影響部分グラフをテキスト化 (LLM コンテキスト用)
    req export             # 正規化 JSON の出力
    req site               # 閲覧用の静的サイト生成 (GitHub Pages 用)
    req mcp                # MCP サーバ (stdio) として公開する
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

from .explain import explain_text, impact_json
from .findings import FindingList
from .loader import LoadResult, discover_paths, load_paths
from .mcpserver import (
    GraphSession,
    MissingDependency,
    ReqTools,
    build_server,
    run_stdio,
    tool_specs,
)
from .model import EDGE_NAMES
from .plan import diff_graphs, format_plan, load_revision
from .render import FORMATS, render
from .site import DEFAULT_TITLE, SITE_ASSETS, asset_srcs, build_site
from .validate import validate_semantics_lexical, validate_structure

__all__ = ["main", "build_parser"]

EXIT_OK = 0
EXIT_FINDINGS = 1
EXIT_USAGE = 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="req",
        description="要求グラフツール: 宣言的な要求定義を検証・可視化・影響分析する",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common(sub: argparse.ArgumentParser, positional: bool = True) -> None:
        if positional:
            sub.add_argument(
                "path",
                nargs="*",
                help="定義ファイルまたはディレクトリ (既定: requirements.py)",
            )
        sub.add_argument(
            "-f",
            "--file",
            action="append",
            default=[],
            help="定義ファイルまたはディレクトリ (複数指定可)",
        )

    validate_parser = subparsers.add_parser(
        "validate", help="層0〜層2 の全チェックを実行する"
    )
    add_common(validate_parser)
    validate_parser.add_argument(
        "--strict", action="store_true", help="warning / severe もエラー扱いにする"
    )
    validate_parser.add_argument(
        "--no-lexicon", action="store_true", help="曖昧語チェックを行わない"
    )
    validate_parser.add_argument(
        "--json", action="store_true", help="指摘を JSON で出力する"
    )

    plan_parser = subparsers.add_parser(
        "plan", help="git 上の前版との構造 diff と影響範囲を表示する"
    )
    add_common(plan_parser)
    plan_parser.add_argument(
        "--rev", default="HEAD", help="比較対象のリビジョン (既定: HEAD)"
    )
    plan_parser.add_argument(
        "--edges",
        help="影響範囲の計算に使うエッジ種別をカンマ区切りで指定する",
    )

    graph_parser = subparsers.add_parser("graph", help="グラフを出力する")
    add_common(graph_parser)
    graph_parser.add_argument("--format", choices=FORMATS, default="mermaid")
    graph_parser.add_argument("-o", "--output", help="出力先ファイル (既定: 標準出力)")
    graph_parser.add_argument(
        "--max-label", type=int, default=40, help="ラベルの最大文字数 (0 で無制限)"
    )
    graph_parser.add_argument(
        "--highlight", help="強調するノード ID をカンマ区切りで指定する"
    )

    explain_parser = subparsers.add_parser(
        "explain", help="影響部分グラフを LLM 向けテキストに整形する"
    )
    explain_parser.add_argument("ids", nargs="+", help="起点となるノード ID")
    add_common(explain_parser, positional=False)
    explain_parser.add_argument("--depth", type=int, help="探索の深さ上限")
    explain_parser.add_argument(
        "--edges", help="辿るエッジ種別をカンマ区切りで指定する"
    )
    explain_parser.add_argument(
        "--undirected",
        action="store_true",
        help="エッジの向きを無視して辿る (FR から Goal などの文脈も集める)",
    )
    explain_parser.add_argument("-o", "--output", help="出力先ファイル")
    explain_parser.add_argument(
        "--json", action="store_true", help="部分グラフを JSON で出力する"
    )

    export_parser = subparsers.add_parser(
        "export", help="正規化 JSON を出力する (真のソース・オブ・トゥルース)"
    )
    add_common(export_parser)
    export_parser.add_argument("-o", "--output", help="出力先ファイル")

    site_parser = subparsers.add_parser(
        "site", help="閲覧用の静的サイトを生成する (GitHub Pages 用)"
    )
    add_common(site_parser)
    site_parser.add_argument(
        "-o", "--output", default="site", help="出力先ディレクトリ (既定: site)"
    )
    site_parser.add_argument("--title", default=DEFAULT_TITLE, help="ページタイトル")
    site_parser.add_argument(
        "--assets",
        choices=("cdn", "local"),
        default="cdn",
        help=(
            "描画ライブラリ (Cytoscape.js) の参照先。local を選び、出力先に "
            f"{' / '.join(asset.file for asset in SITE_ASSETS)} を置けば、"
            "外部通信の無い自己完結サイトになる (既定: cdn)"
        ),
    )
    site_parser.add_argument(
        "--no-lexicon", action="store_true", help="曖昧語チェックを行わない"
    )

    mcp_parser = subparsers.add_parser(
        "mcp",
        help="MCP サーバ (stdio) として公開し、LLM エージェントから参照できるようにする",
    )
    add_common(mcp_parser)
    mcp_parser.add_argument(
        "--list-tools",
        action="store_true",
        help="公開するツールの一覧を JSON で出して終わる (サーバは起動しない)",
    )

    return parser


# ---------------------------------------------------------------------------
# 補助
# ---------------------------------------------------------------------------


def _explicit(args: argparse.Namespace) -> list[str] | None:
    """コマンドラインで指定された定義ファイル (未指定なら None)。"""
    given = list(getattr(args, "path", []) or []) + list(args.file or [])
    return given or None


def _paths(args: argparse.Namespace) -> list[Path]:
    return discover_paths(_explicit(args))


def _load(args: argparse.Namespace) -> LoadResult:
    return load_paths(_paths(args))


def _edge_filter(value: str | None) -> list[str] | None:
    if not value:
        return None
    names = [name.strip() for name in value.split(",") if name.strip()]
    unknown = [name for name in names if name not in EDGE_NAMES]
    if unknown:
        raise SystemExit(
            f"未知のエッジ種別: {', '.join(unknown)} (指定可能: {', '.join(EDGE_NAMES)})"
        )
    return names


def _write(text: str, output: str | None) -> None:
    if output:
        Path(output).write_text(text, encoding="utf-8")
        print(f"書き出した: {output}", file=sys.stderr)
    else:
        sys.stdout.write(text)


def _print_load_errors(result: LoadResult) -> None:
    for finding in result.findings.sorted():
        print(finding.format(), file=sys.stderr)


def _require_loadable(result: LoadResult) -> None:
    """グラフを前提とするコマンドでは、層0/層1 エラーがあれば中断する。"""
    if not result.ok:
        _print_load_errors(result)
        print(
            "定義ファイルに層0/層1 のエラーがある。まず `req validate` を通すこと。",
            file=sys.stderr,
        )
        raise SystemExit(EXIT_FINDINGS)


# ---------------------------------------------------------------------------
# 各コマンド
# ---------------------------------------------------------------------------


def cmd_validate(args: argparse.Namespace) -> int:
    result = _load(args)
    findings = FindingList(list(result.findings))

    if result.ok:
        findings.extend(validate_structure(result.graph).items)
        if not args.no_lexicon:
            findings.extend(validate_semantics_lexical(result.graph).items)
        skipped = False
    else:
        skipped = True

    if args.json:
        payload = {
            "files": [str(p) for p in result.paths],
            "node_count": len(result.graph),
            "structure_checked": not skipped,
            "findings": [f.to_dict() for f in findings.sorted()],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for finding in findings.sorted():
            print(finding.format())
        print("")
        print(
            f"対象: {', '.join(str(p) for p in result.paths)} "
            f"({len(result.graph)} ノード / {len(result.graph.edges)} エッジ)"
        )
        print(f"結果: {findings.summary()}")
        if skipped:
            print("層2 の構造チェックは、層0/層1 のエラーのため未実行。")

    if findings.has_error:
        return EXIT_FINDINGS
    if args.strict and findings.has_warning:
        return EXIT_FINDINGS
    return EXIT_OK


def cmd_plan(args: argparse.Namespace) -> int:
    paths = _paths(args)
    current = load_paths(paths)
    _require_loadable(current)

    previous = load_revision(paths, args.rev)
    if not previous.ok:
        print(
            f"警告: {args.rev} 側の定義ファイルに層0/層1 エラーがある。"
            "読めたノードだけで比較する。",
            file=sys.stderr,
        )
        for finding in previous.findings.sorted():
            print("  " + finding.format(), file=sys.stderr)

    diff = diff_graphs(previous.graph, current.graph)
    sys.stdout.write(
        format_plan(
            previous.graph, current.graph, diff, args.rev, _edge_filter(args.edges)
        )
    )
    return EXIT_OK


def cmd_graph(args: argparse.Namespace) -> int:
    result = _load(args)
    _require_loadable(result)
    highlight = (
        [i.strip() for i in args.highlight.split(",") if i.strip()]
        if args.highlight
        else None
    )
    _write(
        render(result.graph, args.format, args.max_label, highlight), args.output
    )
    return EXIT_OK


def cmd_explain(args: argparse.Namespace) -> int:
    result = _load(args)
    _require_loadable(result)
    edges = _edge_filter(args.edges)

    missing = [node_id for node_id in args.ids if node_id not in result.graph.nodes]
    if len(missing) == len(args.ids):
        print(f"ノードが見つからない: {', '.join(missing)}", file=sys.stderr)
        return EXIT_USAGE

    if args.json:
        payload = impact_json(
            result.graph, args.ids, edges, args.depth, args.undirected
        )
        _write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", args.output)
    else:
        _write(
            explain_text(result.graph, args.ids, edges, args.depth, args.undirected),
            args.output,
        )
    return EXIT_OK


def cmd_export(args: argparse.Namespace) -> int:
    result = _load(args)
    _require_loadable(result)
    _write(result.graph.to_json(), args.output)
    return EXIT_OK


def cmd_site(args: argparse.Namespace) -> int:
    result = _load(args)
    _require_loadable(result)

    findings = FindingList(validate_structure(result.graph).items)
    if not args.no_lexicon:
        findings.extend(validate_semantics_lexical(result.graph).items)

    index = build_site(
        result.graph,
        findings,
        Path(args.output),
        title=args.title,
        sources=[str(p) for p in result.paths],
        scripts=asset_srcs(local=args.assets == "local"),
    )
    print(
        f"生成した: {index} ({len(result.graph)} ノード / {findings.summary()})",
        file=sys.stderr,
    )
    return EXIT_OK


def cmd_mcp(args: argparse.Namespace) -> int:
    if args.list_tools:
        print(json.dumps(tool_specs(), ensure_ascii=False, indent=2))
        return EXIT_OK

    # 層0/層1 のエラーがあってもサーバは起動する。エージェントは validate を
    # 呼んで理由を知り、定義ファイルを直せばよい (呼ぶたびに読み直される)。
    session = GraphSession(_explicit(args))
    result = session.result()
    try:
        server = build_server(ReqTools(session))
    except MissingDependency as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_USAGE

    print(
        f"MCP サーバ (stdio) を開始する: "
        f"{', '.join(str(p) for p in result.paths)} ({len(result.graph)} ノード)",
        file=sys.stderr,
    )
    if not result.ok:
        print(
            "定義ファイルに層0/層1 のエラーがある。validate ツールで確認できる。",
            file=sys.stderr,
        )
    run_stdio(server)
    return EXIT_OK


_COMMANDS = {
    "validate": cmd_validate,
    "plan": cmd_plan,
    "graph": cmd_graph,
    "explain": cmd_explain,
    "export": cmd_export,
    "site": cmd_site,
    "mcp": cmd_mcp,
}


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return _COMMANDS[args.command](args)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_USAGE
    except SystemExit as exc:  # _require_loadable などからの中断
        code = exc.code
        if isinstance(code, int):
            return code
        if code is not None:
            print(str(code), file=sys.stderr)
        return EXIT_USAGE


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
