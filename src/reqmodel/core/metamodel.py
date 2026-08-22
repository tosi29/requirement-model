"""Internal metamodel derived from public node type annotations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, Union, get_args, get_origin, get_type_hints

from ..definition.nodes import (
    Constraint, FunctionalRequirement, Goal, Need, Node, QualityRequirement,
    RefMarker,
)

#: 出力順序を安定させるための型の並び。
TYPE_ORDER: tuple[type[Node], ...] = (
    Goal,
    Need,
    FunctionalRequirement,
    QualityRequirement,
    Constraint,
)

NODE_TYPES: dict[str, type[Node]] = {t.__name__: t for t in TYPE_ORDER}
NODE_TYPES["FR"] = FunctionalRequirement
NODE_TYPES["QR"] = QualityRequirement

TYPE_INDEX: dict[str, int] = {t.__name__: i for i, t in enumerate(TYPE_ORDER)}


# ---------------------------------------------------------------------------
# エッジ仕様 (フィールド型注釈から機械的に導出する)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EdgeSpec:
    """1 つのエッジ型の仕様。ノード型のフィールド注釈から導出される。"""

    name: str
    owner: type[Node]
    targets: tuple[type[Node], ...]

    def target_names(self) -> str:
        return " | ".join(t.__name__ for t in self.targets)


def _analyze(annotation: Any) -> tuple[type, ...]:
    """注釈を辿り参照先の型を返す。参照でなければ空タプル。"""
    origin = get_origin(annotation)

    if origin is Annotated:
        args = get_args(annotation)
        if any(isinstance(meta, RefMarker) for meta in args[1:]):
            return tuple(
                arg
                for arg in (get_args(args[0]) or (args[0],))
                if isinstance(arg, type) and arg is not str
            )
        return _analyze(args[0])

    if origin in (list, set, frozenset) or origin is Union:
        collected: list[type] = []
        for arg in get_args(annotation):
            for target in _analyze(arg):
                if target not in collected:
                    collected.append(target)
        return tuple(collected)

    return ()


def _build_edge_specs() -> dict[type[Node], dict[str, EdgeSpec]]:
    specs: dict[type[Node], dict[str, EdgeSpec]] = {}
    for node_type in TYPE_ORDER:
        hints = get_type_hints(node_type, include_extras=True)
        found: dict[str, EdgeSpec] = {}
        for field_name in node_type.model_fields:
            targets = _analyze(hints.get(field_name))
            if not targets:
                continue
            found[field_name] = EdgeSpec(
                name=field_name,
                owner=node_type,
                targets=targets,
            )
        specs[node_type] = found
    return specs


_EDGE_SPECS: dict[type[Node], dict[str, EdgeSpec]] = _build_edge_specs()


def edge_specs_for(node_type: type[Node]) -> dict[str, EdgeSpec]:
    """ノード型が持つエッジ仕様を返す。"""
    return _EDGE_SPECS[node_type]


#: エッジ名の一覧 (CLI のフィルタ指定などに使う)。
EDGE_NAMES: tuple[str, ...] = tuple(
    dict.fromkeys(
        name for specs in _EDGE_SPECS.values() for name in specs
    )
)
