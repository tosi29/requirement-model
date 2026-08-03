"""要求グラフツール。

要求 (Goal, Need, Requirement, Constraint 等) を型付き有向グラフとして宣言的に記述し、
機械的な検証・変更影響分析・LLM 連携を可能にする。

定義ファイルからはこのパッケージだけを import する::

    from reqmodel import Goal, Need, FunctionalRequirement, Source

なお本ツールは定義ファイルを実行しない。import 文は mypy と IDE 補完のために書く。
"""

from __future__ import annotations

from .findings import Finding, FindingList, Severity
from .graph import Edge, RequirementGraph
from .loader import LoadResult, load_paths, load_sources
from .model import (
    FR,
    QR,
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    Node,
    QualityRequirement,
    Ref,
    Requirement,
    Source,
    Sourced,
    Status,
    System,
    Waiver,
)
from .stats import Ambiguity, Ratio, Stats, collect_stats
from .validate import validate_semantics_lexical, validate_structure
from .waivers import WaiverResult, apply_waivers

__version__ = "0.1.0"

__all__ = [
    # ノード型 (定義ファイル用)
    "Goal",
    "Need",
    "FunctionalRequirement",
    "QualityRequirement",
    "Constraint",
    "Source",
    "System",
    "FR",
    "QR",
    # 基底・補助型
    "Node",
    "Sourced",
    "Requirement",
    "Ref",
    "Status",
    "Waiver",
    # ツール API
    "RequirementGraph",
    "Edge",
    "LoadResult",
    "load_paths",
    "load_sources",
    "validate_structure",
    "validate_semantics_lexical",
    "apply_waivers",
    "WaiverResult",
    "collect_stats",
    "Stats",
    "Ratio",
    "Ambiguity",
    "Finding",
    "FindingList",
    "Severity",
    "__version__",
]
