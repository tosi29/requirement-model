"""要求グラフツール。

要求 (Goal, Need, Requirement, Constraint 等) を型付き有向グラフとして宣言的に記述し、
機械的な検証・変更影響分析・LLM 連携を可能にする。

定義ファイルからはこのパッケージだけを import する::

    from reqmodel import Goal, Need, FunctionalRequirement, Source

なお本ツールは定義ファイルを実行しない。import 文は mypy と IDE 補完のために書く。
"""

from __future__ import annotations

from .config import (
    Config,
    ConfigError,
    active_config,
    find_config_file,
    load_config,
    use_config,
)
from .findings import Finding, FindingList, Severity
from .graph import Edge, RequirementGraph
from .loader import LoadResult, load_paths, load_sources
from .model import (
    FR,
    QR,
    Constraint,
    Decision,
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
)
from .validate import validate_naming, validate_semantics_lexical, validate_structure

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
    "Decision",
    "FR",
    "QR",
    # 基底・補助型
    "Node",
    "Sourced",
    "Requirement",
    "Ref",
    "Status",
    # ツール API
    "RequirementGraph",
    "Edge",
    "LoadResult",
    "load_paths",
    "load_sources",
    "validate_structure",
    "validate_semantics_lexical",
    "validate_naming",
    # 設定
    "Config",
    "ConfigError",
    "load_config",
    "find_config_file",
    "active_config",
    "use_config",
    "Finding",
    "FindingList",
    "Severity",
    "__version__",
]
