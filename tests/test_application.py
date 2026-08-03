"""Application-layer package boundaries and legacy import compatibility."""

from __future__ import annotations

import importlib

import pytest


@pytest.mark.parametrize(
    ("module", "public_name"),
    [
        ("loader", "load_paths"),
        ("validate", "validate_structure"),
        ("waivers", "apply_waivers"),
        ("explain", "explain_text"),
        ("plan", "diff_graphs"),
        ("doc", "render_spec"),
        ("stats", "collect_stats"),
    ],
)
def test_legacy_modules_reexport_application_api(module: str, public_name: str):
    legacy = importlib.import_module(f"reqmodel.{module}")
    application = importlib.import_module(f"reqmodel.application.{module}")

    assert getattr(legacy, public_name) is getattr(application, public_name)
