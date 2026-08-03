"""Default edge projections used by graph traversal and presentation."""

from .metamodel import EDGE_NAMES

#: 源泉トレースのエッジ。**図には既定で描かない。**
#:
#: Source は数十件の要求から参照されるハブなので、ノードとして置くと近傍が一気に
#: 広がり、レイアウトが源泉に引っ張られる。源泉は「どの要求がどこから来たか」を
#: ノードの属性として読む情報であって、要求どうしの関係を辿るための経路ではない。
#: そのため図では描かず、参照元ノードの属性として出す (``req doc`` が最初から
#: そうしている)。集約して見たいとき (この条文がどの要求に効いているか) は
#: 源泉節・``Source × 要求`` 表・テーブルビューを使う。
#:
#: 型としての Source と検査 (``structure.missing_source`` 等) は無関係で、
#: ここで決まるのは描画だけである。
SOURCE_EDGE_NAMES: frozenset[str] = frozenset({"has_source", "part_of"})

#: 図に既定で描くエッジ名。並びは EDGE_NAMES のまま。
DEFAULT_GRAPH_EDGE_NAMES: tuple[str, ...] = tuple(
    name for name in EDGE_NAMES if name not in SOURCE_EDGE_NAMES
)

# Backwards-compatible names.
SOURCE_EDGES = SOURCE_EDGE_NAMES
GRAPH_EDGE_NAMES = DEFAULT_GRAPH_EDGE_NAMES
