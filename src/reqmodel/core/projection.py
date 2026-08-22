"""Default edge projections used by graph traversal and presentation."""

from .metamodel import EDGE_NAMES

#: 図に既定で描くエッジ名。外部参照はノード属性なので、ここに隠すエッジは無い。
DEFAULT_GRAPH_EDGE_NAMES: tuple[str, ...] = EDGE_NAMES
