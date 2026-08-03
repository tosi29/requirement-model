"""層1: Pydantic による構文チェックと、エッジ型規則のフィールド表現。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from conftest import fr, need, source
from reqmodel.model import (
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    QualityRequirement,
    Source,
    System,
    edge_specs_for,
)


def test_need_requires_desire_ending():
    assert need(text="早く精算したい").text.endswith("したい")
    assert need(text="承認待ちに気づきたい")
    with pytest.raises(ValidationError, match="願望形"):
        need(text="早く精算する")


def test_fr_requires_koto_ending():
    assert fr(text="金額を表示すること")
    assert fr(text="領収書を読み取ること")
    with pytest.raises(ValidationError, match="こと"):
        fr(text="領収書を読み取る")


def test_trailing_period_is_tolerated():
    assert need(text="早く精算したい。")
    assert fr(text="領収書を読み取ること。")


def test_id_must_not_be_blank_or_contain_spaces():
    with pytest.raises(ValidationError):
        need("")
    with pytest.raises(ValidationError):
        need("N 1")


def test_unknown_field_is_rejected():
    with pytest.raises(ValidationError):
        need(nonexistent="x")


def test_reference_accepts_node_or_id_string():
    s = source("S-1")
    assert need("N-1", has_source=[s]).has_source == ["S-1"]
    assert need("N-2", has_source=["S-1"]).has_source == ["S-1"]


def test_status_default_is_proposed():
    assert need().status == "proposed"


def test_edge_specs_are_derived_from_field_annotations():
    goal_edges = edge_specs_for(Goal)
    assert goal_edges["refines"].targets == (Goal,)
    assert goal_edges["motivates"].targets == (Need,)
    assert goal_edges["has_source"].targets == (Source,)

    fr_edges = edge_specs_for(FunctionalRequirement)
    assert fr_edges["satisfies"].targets == (Need,)
    assert fr_edges["refines"].targets == (FunctionalRequirement,)

    qr_edges = edge_specs_for(QualityRequirement)
    assert qr_edges["qualifies"].targets == (FunctionalRequirement, System)
    assert "qualifies" not in fr_edges  # qualifies を出せるのは QR のみ

    constraint_edges = edge_specs_for(Constraint)
    assert constraint_edges["constrains"].targets == (
        FunctionalRequirement,
        QualityRequirement,
    )


def test_source_is_a_single_type_classified_by_kind():
    assert Source(id="S", text="規程", kind="document").kind == "document"
    with pytest.raises(ValidationError):
        Source(id="S", text="規程", kind="unknown")


def test_public_definition_package_has_no_internal_dependencies():
    """Author-facing definitions must not depend on graph or presentation code."""
    import ast
    from pathlib import Path

    root = Path(__file__).parents[1] / "src" / "reqmodel" / "definition"
    forbidden = {"reqmodel.core", "reqmodel.presentation"}
    for path in root.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        imports = {
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        imports.update(
            node.module or ""
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.level == 0
        )
        assert not any(
            name == blocked or name.startswith(blocked + ".")
            for name in imports
            for blocked in forbidden
        ), path


def test_new_package_api_and_legacy_root_api_are_identical():
    from reqmodel import Goal as RootGoal
    from reqmodel.definition import Goal as DefinitionGoal
    from reqmodel.core.graph import RequirementGraph as CoreGraph
    from reqmodel.graph import RequirementGraph as LegacyGraph

    assert RootGoal is DefinitionGoal
    assert CoreGraph is LegacyGraph
