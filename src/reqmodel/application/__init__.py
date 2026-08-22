"""CLI から独立して利用できる要求モデルのユースケース。"""

from .doc import (
    CSV_HEADER,
    DOC_FORMATS,
    DEFAULT_MATRIX_TITLE,
    DEFAULT_SPEC_TITLE,
    MATRICES,
    Matrix,
    MatrixSpec,
    build_matrix,
    render_matrices_csv,
    render_matrices_markdown,
    render_spec,
)
from .explain import explain_text, impact_set, subgraph_edges, traversed_edges
from .loader import DEFAULT_PATHS, LoadResult, discover_paths, load_paths, load_sources
from .plan import FieldChange, GraphDiff, diff_graphs, format_plan, load_revision
from .stats import (
    DEFAULT_STATS_TITLE,
    Ambiguity,
    Ratio,
    Stats,
    collect_stats,
    render_stats,
)
from .validate import attach_locations, validate_semantics_lexical, validate_structure
from .waivers import Suppressed, WaiverResult, apply_waivers

__all__ = [
    "CSV_HEADER", "DOC_FORMATS", "DEFAULT_MATRIX_TITLE", "DEFAULT_PATHS", "DEFAULT_SPEC_TITLE",
    "DEFAULT_STATS_TITLE", "MATRICES", "Ambiguity", "FieldChange",
    "GraphDiff", "LoadResult", "Matrix", "MatrixSpec", "Ratio", "Stats", "Suppressed",
    "WaiverResult", "apply_waivers", "attach_locations", "build_matrix", "collect_stats",
    "diff_graphs", "discover_paths", "explain_text", "format_plan", "impact_set",
    "load_paths", "load_revision", "load_sources", "render_matrices_csv",
    "render_matrices_markdown", "render_spec", "render_stats",
    "subgraph_edges", "traversed_edges", "validate_semantics_lexical", "validate_structure",
]
