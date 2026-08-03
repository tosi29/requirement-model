"""Compatibility wrapper for :mod:`reqmodel.core.graph`."""

from .core.graph import *
# Kept for callers that historically imported this serialization helper directly.
from .core.graph import node_to_json_obj
