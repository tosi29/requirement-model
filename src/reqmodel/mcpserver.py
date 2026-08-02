"""`req mcp`: 要求グラフを MCP (Model Context Protocol) サーバとして公開する。

これまで LLM への受け渡しは `req explain` の出力を人手でコピペする経路
(site の「影響部分グラフをコピー」ボタンを含む) しか無かった。ここでは同じ
情報を、エージェント側から直接引ける経路として開く。

設計上の約束が 3 つある。

- **公開するのは参照だけ**。検索・詳細・検証・影響分析の 4 系統で、定義ファイルの
  書き換えはしない。書き換えるのはエージェント自身であり、その結果はここから
  読み直される (`GraphSession`)。
- **SDK 依存はオプショナル** (`pip install "reqmodel[mcp]"`)。ツールの中身
  (`ReqTools`) は SDK 抜きで動き、テストも SDK 無しで回る。SDK に触るのは
  `build_server()` と `run_stdio()` だけ。
- **出力は CLI と同じ**。explain は `req explain`、impact は `req explain --json`、
  validate は `req validate --json` と同じ関数から作る。CLI とエージェントで
  別のコンテキストが出ることが無いようにする。
"""

from __future__ import annotations

import inspect
import json
import os
from pathlib import Path
from typing import Annotated, Any, Callable, Sequence

from pydantic import Field, create_model

from .explain import explain_text, impact_json
from .findings import FindingList
from .graph import LOCATION_KEY, RequirementGraph, node_to_json_obj
from .loader import LoadResult, discover_paths, load_paths
from .model import EDGE_NAMES, NODE_TYPES, TYPE_ORDER
from .validate import validate_semantics_lexical, validate_structure

__all__ = [
    "GraphSession",
    "ReqTools",
    "MissingDependency",
    "TOOL_NAMES",
    "tool_specs",
    "call_tool",
    "build_server",
    "run_stdio",
    "SERVER_NAME",
    "INSTALL_HINT",
]

SERVER_NAME = "reqmodel"

#: 公開するツール。`ReqTools` の同名メソッドが実体。
TOOL_NAMES: tuple[str, ...] = ("validate", "explain", "impact", "search", "node")

INSTALL_HINT = (
    "MCP SDK が入っていない。`pip install \"reqmodel[mcp]\"` で入れること "
    "(コアインストールには含まれない)。"
)

#: サーバ全体の説明。エージェントが最初に読む。
INSTRUCTIONS = """\
要求 (Goal / Need / FunctionalRequirement / QualityRequirement / Constraint /
Decision / System / Source) を型付き有向グラフとして持つ定義ファイルを参照する。

- 何がどこにあるか分からないときは search、1 件の詳細は node。
- 実装・レビューの前に、対象ノードの周辺を explain で読むこと。
  「なぜこの要求があるのか」まで辿るには undirected=true を使う。
- 定義ファイルを書き換えたら validate を呼ぶこと。グラフは呼ぶたびに読み直される。

ここは参照専用で、定義ファイルは書き換えない。意味の判断はこちらではしないので、
返した自然言語をそのまま読んで判断すること。
"""

#: search の返却上限。
SEARCH_LIMIT_MAX = 200


class MissingDependency(RuntimeError):
    """MCP SDK が入っていない。"""


# ---------------------------------------------------------------------------
# グラフの供給
# ---------------------------------------------------------------------------


class GraphSession:
    """定義ファイルを読み直しながらグラフを供給する。

    エージェントは同じセッションの最中に定義ファイルを書き換える。起動時のグラフを
    持ち続けると、書き換えた直後の問い合わせが古い答えを返してしまう。ファイルの
    更新時刻とサイズが変わっていれば読み直す (定義ファイルは実行しないので、
    読み直しは AST の解析だけで済む)。

    ディレクトリ指定にも追随できるよう、探索そのものを毎回やり直す。
    """

    def __init__(self, explicit: Sequence[str | os.PathLike[str]] | None = None):
        self._explicit = [str(p) for p in explicit] if explicit else None
        self._signature: tuple[tuple[str, int, int], ...] | None = None
        self._result: LoadResult | None = None
        self._findings: dict[bool, FindingList] = {}

    def result(self) -> LoadResult:
        paths = discover_paths(self._explicit)
        signature = tuple(_signature_of(path) for path in paths)
        if self._result is None or signature != self._signature:
            self._result = load_paths(paths)
            self._signature = signature
            self._findings.clear()
        return self._result

    def graph(self) -> RequirementGraph:
        return self.result().graph

    def findings(self, lexicon: bool = True) -> FindingList:
        """層0〜層2 (+ 曖昧語) の指摘。読み直しごとに 1 度だけ計算する。"""
        result = self.result()
        cached = self._findings.get(lexicon)
        if cached is not None:
            return cached
        findings = FindingList(list(result.findings))
        if result.ok:
            findings.extend(validate_structure(result.graph).items)
            if lexicon:
                findings.extend(validate_semantics_lexical(result.graph).items)
        self._findings[lexicon] = findings
        return findings


def _signature_of(path: Path) -> tuple[str, int, int]:
    stat = path.stat()
    return (str(path), stat.st_mtime_ns, stat.st_size)


# ---------------------------------------------------------------------------
# 引数の型 (説明つき。ここが入力スキーマの唯一の出典)
# ---------------------------------------------------------------------------

Ids = Annotated[list[str], Field(description="起点となるノード ID (1 つ以上)")]
Edges = Annotated[
    list[str] | None,
    Field(description=f"辿るエッジ種別を限定する (既定: すべて)。{', '.join(EDGE_NAMES)}"),
]
Depth = Annotated[int | None, Field(description="探索の深さ上限 (既定: 無制限)")]
Undirected = Annotated[
    bool,
    Field(
        description=(
            "エッジの向きを無視して辿る。有向では辿れない「その要求がなぜ必要か "
            "(Goal)」までを集めたいときに true にする"
        )
    ),
]


# ---------------------------------------------------------------------------
# ツールの中身 (SDK に依存しない)
# ---------------------------------------------------------------------------


class ReqTools:
    """MCP に公開するツールの実装。戻り値はそのままツールの本文になる。

    JSON を返すものは、対応する CLI の `--json` 出力と同じ構造にしてある。
    """

    def __init__(self, session: GraphSession):
        self.session = session

    # -- 検証 ---------------------------------------------------------------

    def validate(
        self,
        lexicon: Annotated[
            bool, Field(description="曖昧語 (「適切に」等) のチェックを行うか")
        ] = True,
    ) -> str:
        """定義ファイルを検証し、指摘の一覧を返す (`req validate --json` と同じ)。

        層0 (宣言性) / 層1 (構文) / 層2 (構造) と、辞書ベースの曖昧語チェック。
        層0/層1 にエラーがあると構造チェックは走らない (structure_checked=false)。
        """
        result = self.session.result()
        findings = self.session.findings(lexicon)
        return _json(
            {
                "files": [str(path) for path in result.paths],
                "node_count": len(result.graph),
                "edge_count": len(result.graph.edges),
                "structure_checked": result.ok,
                "ok": not findings.has_error,
                "summary": findings.summary(),
                "findings": [finding.to_dict() for finding in findings.sorted()],
            }
        )

    # -- 影響部分グラフ -----------------------------------------------------

    def explain(
        self,
        ids: Ids,
        edges: Edges = None,
        depth: Depth = None,
        undirected: Undirected = False,
    ) -> str:
        """影響部分グラフを読める形に整形して返す (`req explain` と同じ本文)。

        起点ノードと、そこから到達できる上流 (理由・根拠) / 下流 (影響を受ける先) を
        自然言語と受け入れ基準つきで並べる。網羅性は機械が担保するので、解釈はこの
        本文を読んで行うこと。
        """
        graph = self.session.graph()
        _require_targets(graph, ids)
        return explain_text(graph, ids, _edge_names(edges), depth, undirected)

    def impact(
        self,
        ids: Ids,
        edges: Edges = None,
        depth: Depth = None,
        undirected: Undirected = False,
    ) -> str:
        """影響範囲を機械可読な形で返す (`req explain --json` と同じ)。

        上流・下流のノード ID と、部分グラフの正規化 JSON。ID の集合だけが要るとき、
        あるいは自前で加工したいときに使う。読んで判断するなら explain を使うこと。
        """
        graph = self.session.graph()
        _require_targets(graph, ids)
        return _json(impact_json(graph, ids, _edge_names(edges), depth, undirected))

    # -- 検索・参照 ---------------------------------------------------------

    def search(
        self,
        query: Annotated[
            str, Field(description="ID と本文に対する部分一致 (大文字小文字は区別しない)")
        ],
        types: Annotated[
            list[str] | None,
            Field(
                description=(
                    "ノード型で絞り込む (既定: すべて)。"
                    + ", ".join(t.__name__ for t in TYPE_ORDER)
                )
            ),
        ] = None,
        limit: Annotated[int, Field(description="返す件数の上限", ge=1)] = 20,
    ) -> str:
        """ID と本文でノードを検索する。

        まずここで対象を見つけ、詳細は node、周辺は explain で取る。
        """
        needle = query.strip().casefold()
        if not needle:
            raise ValueError("query を空にはできない")
        limit = max(1, min(limit, SEARCH_LIMIT_MAX))
        wanted = _node_types(types)

        graph = self.session.graph()
        matches = [
            node
            for node in graph.ordered_nodes()
            if (wanted is None or type(node).__name__ in wanted)
            and (needle in node.id.casefold() or needle in node.text.casefold())
        ]
        shown = matches[:limit]
        return _json(
            {
                "query": query,
                "types": sorted(wanted) if wanted else None,
                "total": len(matches),
                "returned": len(shown),
                "truncated": len(shown) < len(matches),
                "matches": [_summary(graph, node.id) for node in shown],
            }
        )

    def node(
        self,
        id: Annotated[str, Field(description="ノード ID")],
    ) -> str:
        """ノード 1 件の詳細を返す。

        属性一式と出所 (file:line)、出入りのエッジ、そのノードに付いている指摘。
        定義を直したいときは location の位置を開くこと。
        """
        graph = self.session.graph()
        if id not in graph.nodes:
            raise ValueError(f"ノードが見つからない: {id}")
        record = node_to_json_obj(graph.nodes[id])
        where = graph.location_of(id)
        if where is not None:
            record[LOCATION_KEY] = where
        return _json(
            {
                "node": record,
                "out_edges": [
                    {
                        "name": edge.name,
                        "target": edge.target,
                        "target_text": _text_of(graph, edge.target),
                    }
                    for edge in graph.out_edges(id)
                ],
                "in_edges": [
                    {
                        "name": edge.name,
                        "source": edge.source,
                        "source_text": _text_of(graph, edge.source),
                    }
                    for edge in graph.in_edges(id)
                ],
                "findings": [
                    finding.to_dict()
                    for finding in self.session.findings().sorted()
                    if finding.node_id == id
                ],
            }
        )


# ---------------------------------------------------------------------------
# 補助
# ---------------------------------------------------------------------------


def _json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _edge_names(edges: Sequence[str] | None) -> list[str] | None:
    if edges is None:
        return None
    names = [name.strip() for name in edges if name.strip()]
    if not names:
        return None
    unknown = [name for name in names if name not in EDGE_NAMES]
    if unknown:
        raise ValueError(
            f"未知のエッジ種別: {', '.join(unknown)} (指定可能: {', '.join(EDGE_NAMES)})"
        )
    return names


def _node_types(types: Sequence[str] | None) -> set[str] | None:
    if types is None:
        return None
    names = [name.strip() for name in types if name.strip()]
    if not names:
        return None
    known = {t.__name__ for t in TYPE_ORDER}
    resolved: set[str] = set()
    for name in names:
        node_type = NODE_TYPES.get(name)  # FR / QR の短縮名も受ける
        if node_type is None:
            raise ValueError(
                f"未知のノード型: {name} (指定可能: {', '.join(sorted(known))})"
            )
        resolved.add(node_type.__name__)
    return resolved


def _require_targets(graph: RequirementGraph, ids: Sequence[str]) -> None:
    """起点が 1 つも無い / 1 つも存在しないなら、空の結果を返さず理由を返す。"""
    if not ids:
        raise ValueError("ids を 1 つ以上指定すること")
    missing = [node_id for node_id in ids if node_id not in graph.nodes]
    if len(missing) == len(ids):
        raise ValueError(
            f"ノードが見つからない: {', '.join(missing)} (search で探すこと)"
        )


def _text_of(graph: RequirementGraph, node_id: str) -> str | None:
    node = graph.nodes.get(node_id)
    return node.text if node is not None else None


def _summary(graph: RequirementGraph, node_id: str) -> dict[str, Any]:
    node = graph.nodes[node_id]
    return {
        "id": node.id,
        "type": type(node).__name__,
        "text": node.text,
        "status": node.status,
        "priority": node.priority,
        LOCATION_KEY: graph.location_of(node.id),
    }


# ---------------------------------------------------------------------------
# ツールの公開形 (入力スキーマはメソッドの注釈から導出する)
# ---------------------------------------------------------------------------


def input_schema(handler: Callable[..., Any]) -> dict[str, Any]:
    """ハンドラの注釈から JSON Schema を組む。

    スキーマを別に書き起こすと、引数と説明が二重管理になる。SDK も同じ注釈から
    スキーマを作るので、出典はメソッドのシグネチャ 1 か所だけになる。
    """
    signature = inspect.signature(handler)
    fields: dict[str, Any] = {}
    for name, parameter in signature.parameters.items():
        if name == "self":
            continue
        annotation = (
            Any if parameter.annotation is inspect.Parameter.empty
            else parameter.annotation
        )
        default = ... if parameter.default is inspect.Parameter.empty else parameter.default
        fields[name] = (annotation, default)
    model = create_model(f"{handler.__name__}_args", **fields)
    schema = model.model_json_schema()
    schema.pop("title", None)
    return schema


def tool_specs(tools: ReqTools | None = None) -> list[dict[str, Any]]:
    """公開するツールの一覧 (`req mcp --list-tools` が出すもの)。"""
    tools = tools or ReqTools(GraphSession())
    specs = []
    for name in TOOL_NAMES:
        handler = getattr(tools, name)
        specs.append(
            {
                "name": name,
                "description": inspect.getdoc(handler) or "",
                "input_schema": input_schema(handler),
            }
        )
    return specs


def call_tool(tools: ReqTools, name: str, arguments: dict[str, Any] | None = None) -> str:
    """ツールを名前で呼ぶ。SDK を通さずに同じ経路を叩けるようにしてある。"""
    if name not in TOOL_NAMES:
        raise ValueError(
            f"未知のツール: {name} (公開しているのは {', '.join(TOOL_NAMES)})"
        )
    handler: Callable[..., str] = getattr(tools, name)
    return handler(**(arguments or {}))


# ---------------------------------------------------------------------------
# SDK 境界
# ---------------------------------------------------------------------------


def build_server(tools: ReqTools) -> Any:
    """MCP サーバを組み立てる。SDK に触るのはここだけ。"""
    try:
        from mcp.server import MCPServer  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - SDK の有無で分岐する
        raise MissingDependency(INSTALL_HINT) from exc

    from . import __version__

    server = MCPServer(
        name=SERVER_NAME, version=__version__, instructions=INSTRUCTIONS
    )
    for name in TOOL_NAMES:
        handler = getattr(tools, name)
        server.add_tool(handler, name=name, description=inspect.getdoc(handler))
    return server


def run_stdio(server: Any) -> None:
    """stdio トランスポートでサーバを動かす (終わるまで戻らない)。"""
    server.run("stdio")
