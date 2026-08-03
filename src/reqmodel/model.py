"""Compatibility imports for the former combined model module.

New code should import public definition types from :mod:`reqmodel.definition`
and internal metadata or projections from :mod:`reqmodel.core`.
"""

from .definition import *
from .definition.nodes import STATUS_RANK
from .core.metamodel import EDGE_NAMES, NODE_TYPES, TYPE_INDEX, TYPE_ORDER, EdgeSpec, edge_specs_for
from .core.projection import DEFAULT_GRAPH_EDGE_NAMES, GRAPH_EDGE_NAMES, SOURCE_EDGE_NAMES, SOURCE_EDGES
