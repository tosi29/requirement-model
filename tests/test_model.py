"""層1: Pydantic による構文チェックと、エッジ型規則のフィールド表現。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from conftest import constraint, fr, goal, need, qr, source
from reqmodel.core.metamodel import edge_specs_for
from reqmodel.definition import (
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    QualityRequirement,
    Reference,
    RequirementGroup,
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


def test_goal_has_no_decomposition_mode():
    with pytest.raises(ValidationError):
        Goal(id="Goal-1", text="工数を半減する", decomposition="OR")


def test_reference_accepts_node_or_id_string():
    s = source("S-1")
    assert need("Need-1", source=[s]).source == [s]


def test_status_default_is_proposed():
    assert need().status == "proposed"


@pytest.mark.parametrize("factory", [goal, need, constraint])
@pytest.mark.parametrize("status", ["proposed", "approved"])
def test_decision_nodes_accept_decision_statuses(factory, status):
    assert factory(status=status).status == status


@pytest.mark.parametrize("factory", [goal, need, constraint])
@pytest.mark.parametrize("status", ["implemented", "verified"])
def test_decision_nodes_reject_delivery_statuses(factory, status):
    with pytest.raises(ValidationError):
        factory(status=status)


@pytest.mark.parametrize("factory", [fr, qr])
@pytest.mark.parametrize("status", ["proposed", "approved", "implemented", "verified"])
def test_requirements_accept_all_requirement_statuses(factory, status):
    assert factory(status=status).status == status


def test_edge_specs_are_derived_from_field_annotations():
    goal_edges = edge_specs_for(Goal)
    assert goal_edges["refines"].targets == (Goal,)
    assert goal_edges["motivates"].targets == (Need,)
    assert "source" not in goal_edges

    fr_edges = edge_specs_for(FunctionalRequirement)
    assert fr_edges["satisfies"].targets == (Need,)
    assert fr_edges["refines"].targets == (FunctionalRequirement,)

    qr_edges = edge_specs_for(QualityRequirement)
    assert qr_edges["qualifies"].targets == (FunctionalRequirement,)
    assert "qualifies" not in fr_edges  # qualifies を出せるのは QR のみ

    constraint_edges = edge_specs_for(Constraint)
    assert constraint_edges["constrains"].targets == (
        FunctionalRequirement,
        QualityRequirement,
    )


def test_reference_is_a_value_object_without_kind():
    assert Reference(title="規程", url="https://example.com").note is None
    with pytest.raises(ValidationError):
        Reference(title="規程", url="")


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


def test_definition_types_are_exposed_by_the_public_root_api():
    from reqmodel import Goal as RootGoal
    from reqmodel import RequirementGroup as RootRequirementGroup
    from reqmodel.definition import Goal as DefinitionGoal
    from reqmodel.definition import RequirementGroup as DefinitionRequirementGroup

    assert RootGoal is DefinitionGoal
    assert RootRequirementGroup is DefinitionRequirementGroup


def test_lower_layers_do_not_import_presentation():
    """AST, application, core, and definition must not depend on presentation."""
    import ast
    from pathlib import Path

    root = Path(__file__).parents[1] / "src" / "reqmodel"
    paths = [root / "astcheck.py"]
    paths += [
        path
        for package in ("application", "core", "definition")
        for path in (root / package).glob("*.py")
    ]
    for path in paths:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        assert not any(
            (
                isinstance(node, ast.Import)
                and any(
                    alias.name.startswith("reqmodel.presentation")
                    for alias in node.names
                )
            )
            or (
                isinstance(node, ast.ImportFrom)
                and (
                    (node.module or "").startswith("reqmodel.presentation")
                    or (node.module or "").split(".")[0] == "presentation"
                )
            )
            for node in ast.walk(tree)
        ), path


def test_requirement_group_is_not_a_requirement_node():
    group = RequirementGroup(id="input", label="入力")

    from reqmodel.definition import Node

    assert not isinstance(group, Node)
