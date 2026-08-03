"""定義ファイル → 正規化グラフ の変換。

層0 (AST 検査) と層1 (Pydantic validator) はここで走る。定義ファイルは実行しない。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

from pydantic import ValidationError

from ..astcheck import ExtractResult, RawNode, extract_file, extract_source
from ..findings import Finding, FindingList
from ..core.graph import RequirementGraph
from ..core.metamodel import NODE_TYPES
from ..definition import Node

__all__ = ["LoadResult", "load_paths", "load_sources", "discover_paths", "DEFAULT_PATHS"]

#: 明示指定が無いときに探す既定の場所。
DEFAULT_PATHS: tuple[str, ...] = ("requirements.py", "requirements")


@dataclass
class LoadResult:
    """読み込み結果。エラーがあっても、読めたノードだけでグラフを組む。"""

    graph: RequirementGraph
    findings: FindingList = field(default_factory=FindingList)
    paths: list[Path] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.findings.has_error


def discover_paths(explicit: Sequence[str | os.PathLike[str]] | None) -> list[Path]:
    """定義ファイルの探索。ディレクトリ指定なら中の .py を昇順で集める。"""
    candidates: list[str | os.PathLike[str]]
    if explicit:
        candidates = list(explicit)
    else:
        candidates = [p for p in DEFAULT_PATHS if Path(p).exists()]
        if not candidates:
            raise FileNotFoundError(
                "定義ファイルが見つからない。-f/--file で指定するか "
                f"{DEFAULT_PATHS[0]} を置くこと"
            )

    paths: list[Path] = []
    for candidate in candidates:
        path = Path(candidate)
        if path.is_dir():
            paths.extend(sorted(p for p in path.glob("*.py") if p.name != "__init__.py"))
        elif path.exists():
            paths.append(path)
        else:
            raise FileNotFoundError(f"定義ファイルが存在しない: {path}")
    if not paths:
        raise FileNotFoundError("定義ファイルが 1 つも見つからない")
    return paths


def load_paths(paths: Iterable[Path]) -> LoadResult:
    """複数の定義ファイルをまとめて読み込む。"""
    extracts = []
    used: list[Path] = []
    for path in paths:
        extracts.append(extract_file(path))
        used.append(path)
    result = _build(extracts)
    result.paths = used
    return result


def load_sources(sources: Iterable[tuple[str, str]]) -> LoadResult:
    """(表示名, ソース) の列から読み込む。git の前版を扱うために使う。"""
    return _build([extract_source(text, filename=name) for name, text in sources])


def _build(extracts: list[ExtractResult]) -> LoadResult:
    findings = FindingList()
    nodes: list[Node] = []
    locations: dict[str, str] = {}
    seen_ids: dict[str, str] = {}

    for extract in extracts:
        where = str(extract.path) if extract.path else extract.name

        for violation in extract.violations:
            findings.add(
                Finding(
                    severity="error",
                    code="declarative.forbidden",
                    layer=0,
                    message=violation.message,
                    location=f"{where}:{violation.lineno}",
                )
            )

        for raw in extract.nodes:
            location = f"{where}:{raw.lineno}"
            node = _instantiate(raw, location, findings)
            if node is None:
                continue
            if node.id in seen_ids:
                findings.add(
                    Finding(
                        severity="error",
                        code="syntax.duplicate_id",
                        layer=1,
                        message=f"id が重複している (既出: {seen_ids[node.id]})",
                        node_id=node.id,
                        location=location,
                    )
                )
                continue
            seen_ids[node.id] = location
            locations[node.id] = location
            nodes.append(node)

    return LoadResult(graph=RequirementGraph(nodes, locations), findings=findings)


def _instantiate(raw: RawNode, location: str, findings: FindingList) -> Node | None:
    node_type = NODE_TYPES[raw.type_name]
    try:
        return node_type(**raw.kwargs)
    except ValidationError as exc:
        for error in exc.errors():
            field_path = ".".join(str(part) for part in error["loc"]) or "-"
            message = error["msg"]
            if message.startswith("Value error, "):
                message = message[len("Value error, ") :]
            findings.add(
                Finding(
                    severity="error",
                    code="syntax.invalid_field",
                    layer=1,
                    message=f"{raw.type_name}.{field_path}: {message}",
                    node_id=raw.id,
                    location=location,
                )
            )
        return None
    except TypeError as exc:  # pragma: no cover - 想定外の引数形
        findings.add(
            Finding(
                severity="error",
                code="syntax.invalid_field",
                layer=1,
                message=f"{raw.type_name}: {exc}",
                node_id=raw.id,
                location=location,
            )
        )
        return None
