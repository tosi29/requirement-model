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
from ..definition import Constraint, FunctionalRequirement, Node, QualityRequirement
from ..presentation.view import RequirementGroup

__all__ = ["LoadResult", "load_paths", "load_sources", "discover_paths", "DEFAULT_PATHS"]

#: 明示指定が無いときに探す既定の場所。
DEFAULT_PATHS: tuple[str, ...] = ("requirements.py", "requirements")


@dataclass
class LoadResult:
    """読み込み結果。エラーがあっても、読めたノードだけでグラフを組む。"""

    graph: RequirementGraph
    findings: FindingList = field(default_factory=FindingList)
    paths: list[Path] = field(default_factory=list)
    requirement_groups: list[RequirementGroup] = field(default_factory=list)

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
    groups: list[RequirementGroup] = []
    seen_group_ids: dict[str, str] = {}
    group_locations: dict[str, str] = {}
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
            if isinstance(node, RequirementGroup):
                if node.id in seen_group_ids:
                    findings.add(Finding(severity="error", code="syntax.duplicate_id", layer=1, message=f"RequirementGroup id が重複している (既出: {seen_group_ids[node.id]})", node_id=node.id, location=location))
                    continue
                seen_group_ids[node.id] = location
                group_locations[node.id] = location
                groups.append(node)
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

    graph = RequirementGraph(nodes, locations)
    groups = sorted(groups, key=lambda g: (g.order, g.id))
    findings.extend(_validate_requirement_groups(graph, groups, group_locations).items)
    return LoadResult(graph=graph, findings=findings, requirement_groups=groups)


def _instantiate(raw: RawNode, location: str, findings: FindingList) -> Node | RequirementGroup | None:
    node_type = RequirementGroup if raw.type_name == "RequirementGroup" else NODE_TYPES[raw.type_name]
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


def _validate_requirement_groups(
    graph: RequirementGraph,
    groups: list[RequirementGroup],
    locations: dict[str, str],
) -> FindingList:
    """表示グループの所属を診断する。

    RequirementGroup は presentation 層のビュー定義なので、ここで見つかる問題は
    モデルの構造エラーにはしない。サイトでは未所属ノードを「未分類」に置き、
    複数所属は `order` と `id` で最初のグループを主所属にする。その暗黙の補正を
    INFO として明示する。
    """
    findings = FindingList()
    requirement_ids = {
        node.id
        for node in graph.nodes.values()
        if isinstance(node, (FunctionalRequirement, QualityRequirement, Constraint))
    }
    membership: dict[str, list[str]] = {}
    for group in groups:
        for member_id in group.members:
            member_id = str(member_id)
            if member_id not in graph.nodes:
                findings.add(
                    Finding(
                        severity="info",
                        code="presentation.group_dangling",
                        layer=2,
                        message=f"RequirementGroup {group.id} が存在しない id {member_id} を参照している",
                        node_id=group.id,
                        location=locations.get(group.id),
                    )
                )
                continue
            if member_id not in requirement_ids:
                findings.add(
                    Finding(
                        severity="info",
                        code="presentation.group_dangling",
                        layer=2,
                        message=f"RequirementGroup {group.id} の members には FR / QR / Constraint だけを書ける ({member_id} は対象外)",
                        node_id=group.id,
                        location=locations.get(group.id),
                    )
                )
                continue
            membership.setdefault(member_id, []).append(group.id)

    for node_id in sorted(requirement_ids - set(membership)):
        findings.add(
            Finding(
                severity="info",
                code="presentation.group_unassigned",
                layer=2,
                message="RequirementGroup に属さないため、静的サイトでは「未分類」枠に描かれる",
                node_id=node_id,
                location=graph.location_of(node_id),
            )
        )
    for node_id, group_ids in sorted(membership.items()):
        if len(group_ids) <= 1:
            continue
        primary = group_ids[0]
        findings.add(
            Finding(
                severity="info",
                code="presentation.group_multiple",
                layer=2,
                message=(
                    "複数の RequirementGroup に属しているため、静的サイトでは "
                    f"{primary} を主所属として描く (所属: {', '.join(group_ids)})"
                ),
                node_id=node_id,
                location=graph.location_of(node_id),
            )
        )
    return findings
