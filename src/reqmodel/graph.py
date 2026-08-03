"""正規化されたノード集合と、その上のグラフ操作。

すべての検証・影響分析・diff はこの正規化表現に対して行う。
"""

from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass
from typing import Any, Iterable, Iterator, Mapping, TypeVar

from .model import NODE_TYPES, TYPE_INDEX, Node, edge_specs_for

__all__ = ["Edge", "RequirementGraph", "SCHEMA_VERSION", "LOCATION_KEY"]

#: 2: ノードごとの出所 (location) を正規化 JSON に含めるようになった。
#: 3: 全ノードが suppress (指摘の抑制) を持つようになった。
SCHEMA_VERSION = 3

#: 正規化 JSON でノードの出所を入れる鍵。ノードの属性ではなくメタ情報である。
LOCATION_KEY = "location"

NodeT = TypeVar("NodeT", bound=Node)


@dataclass(frozen=True)
class Edge:
    """型付き有向エッジ。"""

    source: str
    name: str
    target: str

    def __str__(self) -> str:  # pragma: no cover - 表示のみ
        return f"{self.source} --{self.name}--> {self.target}"


class RequirementGraph:
    """ノード集合とエッジ集合。エッジはノードのフィールドから導出される。

    ノードの出所 (``file.py:42``) は ``locations`` に横持ちする。ノード本体の
    属性にはしない。定義ファイルの書き手が触るものではないうえ、diff の対象に
    なってしまうと「行が動いただけ」が変更として出てしまうため。
    """

    def __init__(
        self, nodes: Iterable[Node], locations: Mapping[str, str] | None = None
    ):
        self.nodes: dict[str, Node] = {}
        for node in nodes:
            self.nodes[node.id] = node
        self.locations: dict[str, str] = {
            node_id: where
            for node_id, where in (locations or {}).items()
            if node_id in self.nodes
        }
        self.edges: list[Edge] = []
        self._out: dict[str, list[Edge]] = {}
        self._in: dict[str, list[Edge]] = {}
        self._build_edges()

    # -- 構築 ---------------------------------------------------------------

    def _build_edges(self) -> None:
        for node in self.ordered_nodes():
            for spec in edge_specs_for(type(node)).values():
                for target_id in self._targets_of(node, spec.name):
                    edge = Edge(source=node.id, name=spec.name, target=target_id)
                    self.edges.append(edge)
                    self._out.setdefault(node.id, []).append(edge)
                    self._in.setdefault(target_id, []).append(edge)

    @staticmethod
    def _targets_of(node: Node, edge_name: str) -> list[str]:
        values = getattr(node, edge_name, []) or []
        return [str(value) for value in values]

    # -- 参照 ---------------------------------------------------------------

    def ordered_nodes(self) -> list[Node]:
        """型順 → id 順の安定した並び。"""
        return sorted(
            self.nodes.values(),
            key=lambda n: (TYPE_INDEX.get(type(n).__name__, 99), n.id),
        )

    def location_of(self, node_id: str) -> str | None:
        """ノードの出所 (``file.py:42``)。分からなければ None。"""
        return self.locations.get(node_id)

    def by_type(self, *types: type[NodeT]) -> list[NodeT]:
        return [n for n in self.ordered_nodes() if isinstance(n, types)]

    def out_edges(self, node_id: str, names: Iterable[str] | None = None) -> list[Edge]:
        edges = self._out.get(node_id, [])
        if names is None:
            return list(edges)
        allowed = set(names)
        return [e for e in edges if e.name in allowed]

    def in_edges(self, node_id: str, names: Iterable[str] | None = None) -> list[Edge]:
        edges = self._in.get(node_id, [])
        if names is None:
            return list(edges)
        allowed = set(names)
        return [e for e in edges if e.name in allowed]

    def __contains__(self, node_id: object) -> bool:
        return node_id in self.nodes

    def __len__(self) -> int:
        return len(self.nodes)

    def __iter__(self) -> Iterator[Node]:
        return iter(self.ordered_nodes())

    # -- 到達可能性 ---------------------------------------------------------

    def descendants(
        self,
        node_id: str,
        names: Iterable[str] | None = None,
        depth: int | None = None,
    ) -> set[str]:
        """node_id から辿れるノード (自分自身は含まない)。"""
        return self._reach(node_id, self.out_edges, "target", names, depth)

    def ancestors(
        self,
        node_id: str,
        names: Iterable[str] | None = None,
        depth: int | None = None,
    ) -> set[str]:
        """node_id へ辿り着けるノード (自分自身は含まない)。"""
        return self._reach(node_id, self.in_edges, "source", names, depth)

    def impact(
        self,
        node_id: str,
        names: Iterable[str] | None = None,
        depth: int | None = None,
    ) -> set[str]:
        """impact(n) = ancestors(n) ∪ descendants(n)。"""
        return self.ancestors(node_id, names, depth) | self.descendants(
            node_id, names, depth
        )

    def related(
        self,
        node_id: str,
        names: Iterable[str] | None = None,
        depth: int | None = None,
    ) -> set[str]:
        """エッジの向きを無視して辿れるノード。

        「この FR はなぜ作るのか (Goal)」のように、有向の到達可能性では繋がらない
        文脈を集めるために使う。
        """
        if node_id not in self.nodes:
            return set()
        allowed = list(names) if names is not None else None
        seen: set[str] = set()
        queue: deque[tuple[str, int]] = deque([(node_id, 0)])
        while queue:
            current, distance = queue.popleft()
            if depth is not None and distance >= depth:
                continue
            neighbours = [e.target for e in self.out_edges(current, allowed)]
            neighbours += [e.source for e in self.in_edges(current, allowed)]
            for nxt in neighbours:
                if nxt in seen or nxt == node_id or nxt not in self.nodes:
                    continue
                seen.add(nxt)
                queue.append((nxt, distance + 1))
        return seen

    def _reach(
        self,
        start: str,
        edges_of: Any,
        attr: str,
        names: Iterable[str] | None,
        depth: int | None,
    ) -> set[str]:
        if start not in self.nodes:
            return set()
        allowed = list(names) if names is not None else None
        seen: set[str] = set()
        queue: deque[tuple[str, int]] = deque([(start, 0)])
        while queue:
            current, distance = queue.popleft()
            if depth is not None and distance >= depth:
                continue
            for edge in edges_of(current, allowed):
                nxt = getattr(edge, attr)
                if nxt in seen or nxt == start or nxt not in self.nodes:
                    continue
                seen.add(nxt)
                queue.append((nxt, distance + 1))
        return seen

    def cycles(self, names: Iterable[str]) -> list[list[str]]:
        """指定エッジ型だけを見たときの閉路を列挙する。"""
        allowed = set(names)
        color: dict[str, int] = {}
        stack: list[str] = []
        found: list[list[str]] = []

        def visit(node_id: str) -> None:
            color[node_id] = 1
            stack.append(node_id)
            for edge in self.out_edges(node_id, allowed):
                target = edge.target
                if target not in self.nodes or target == node_id:
                    continue  # 自己参照は self_reference として別途報告する
                state = color.get(target, 0)
                if state == 0:
                    visit(target)
                elif state == 1:
                    cycle = stack[stack.index(target) :] + [target]
                    if cycle not in found:
                        found.append(cycle)
            stack.pop()
            color[node_id] = 2

        for node in self.ordered_nodes():
            if color.get(node.id, 0) == 0:
                visit(node.id)
        return found

    # -- 正規化 JSON --------------------------------------------------------

    def to_json_obj(self) -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "nodes": [self._node_record(node) for node in self.ordered_nodes()],
        }

    def _node_record(self, node: Node) -> dict[str, Any]:
        """出力用のノード 1 件。出所が分かっていれば末尾に添える。"""
        record = node_to_json_obj(node)
        where = self.locations.get(node.id)
        if where is not None:
            record[LOCATION_KEY] = where
        return record

    def to_json(self) -> str:
        return json.dumps(self.to_json_obj(), ensure_ascii=False, indent=2) + "\n"

    @classmethod
    def from_json_obj(cls, obj: dict[str, Any]) -> "RequirementGraph":
        nodes: list[Node] = []
        locations: dict[str, str] = {}
        for record in obj.get("nodes", []):
            data = dict(record)
            type_name = data.pop("type")
            where = data.pop(LOCATION_KEY, None)
            node = NODE_TYPES[type_name](**data)
            nodes.append(node)
            if where is not None:
                locations[node.id] = where
        return cls(nodes, locations)

    @classmethod
    def from_json(cls, text: str) -> "RequirementGraph":
        return cls.from_json_obj(json.loads(text))


def node_to_json_obj(node: Node) -> dict[str, Any]:
    """ノード 1 件の正規化表現。型名を先頭に置く。

    出所 (location) は**含めない**。ここが diff (``req plan``) の比較単位なので、
    定義の行が動いただけの変更を「変更」として出さないためである。
    出所込みの表現が要るときは ``RequirementGraph.to_json_obj()`` を使う。
    """
    return {"type": type(node).__name__, **node.model_dump(mode="json")}
