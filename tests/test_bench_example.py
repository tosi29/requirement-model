"""ベンチ用サンプル (`examples/bench.py`) とその生成器。

このモデルは「大きいグラフでの表示と探索」を確かめるための土台なので、
2 つのことを見張る。

- **生成物とコミット内容が一致すること**。手で直すと生成器との差が黙って開く
- **指摘が 1 件も出ないこと**。指摘だらけのモデルでベンチを取ると、
  何を見ているのか分からなくなる (指摘一覧の描画のほうが重くなる)
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

from reqmodel.findings import FindingList
from reqmodel.application.loader import load_paths
from reqmodel.application.validate import validate_semantics_lexical, validate_structure

ROOT = Path(__file__).resolve().parents[1]
BENCH = ROOT / "examples" / "bench.py"
GENERATOR = ROOT / "tools" / "gen_bench.py"

#: このくらいの規模で表示戦略を試す、という下限 (#17 の完了条件)。
MIN_NODES = 300


def load_generator() -> ModuleType:
    """`tools/` はパッケージではないので、パスから直接読み込む。"""
    spec = importlib.util.spec_from_file_location("gen_bench", GENERATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def bench():
    loaded = load_paths([BENCH])
    assert loaded.ok, [str(finding) for finding in loaded.findings]
    return loaded.graph


def test_bench_file_matches_generator():
    """`python tools/gen_bench.py` の出力がそのままコミットされている。"""
    assert BENCH.read_text(encoding="utf-8") == load_generator().render()


def test_bench_is_large_enough(bench):
    assert len(bench) >= MIN_NODES


def test_bench_has_a_wide_rank(bench):
    """同じ段に並ぶ FR が多いこと (横長になる原因そのもの)。"""
    frs = [node for node in bench.nodes.values() if type(node).__name__ == "FunctionalRequirement"]
    assert len(frs) > len(bench) / 2


def test_bench_validates_without_findings(bench):
    """--strict でも通る。ベンチの邪魔になる指摘を残さない。"""
    findings = FindingList(validate_structure(bench).items)
    findings.extend(validate_semantics_lexical(bench).items)

    assert list(findings.sorted()) == [], [str(finding) for finding in findings.sorted()]
