"""指摘の抑制 (waiver)。"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from conftest import build, codes, fr, goal, need, source
from pydantic import ValidationError

from reqmodel.codes import CHECK_CODES, SUPPRESSIBLE_CODES
from reqmodel.findings import Finding, FindingList
from reqmodel.definition import Need
from reqmodel.application.validate import validate_semantics_lexical, validate_structure
from reqmodel.application.waivers import apply_waivers

SRC = Path(__file__).resolve().parents[1] / "src" / "reqmodel"


def orphan_need_graph(*waivers: tuple[str, str]):
    """satisfies されない Need が 2 つ。N-1 だけに抑制を書く。"""
    s = source("S-1")
    return build(
        s,
        need("N-1", has_source=[s], suppress=list(waivers)),
        need("N-2", has_source=[s]),
    )


# ---------------------------------------------------------------------------
# 抑制の適用
# ---------------------------------------------------------------------------


def test_suppresses_only_the_named_node_and_code():
    graph = orphan_need_graph(("structure.orphan_need", "この版では FR を書かない"))
    result = apply_waivers(graph, validate_structure(graph))

    remaining = [f for f in result.findings if f.code == "structure.orphan_need"]
    assert [f.node_id for f in remaining] == ["N-2"]
    assert result.count == 1
    assert result.suppressed[0].finding.node_id == "N-1"
    assert result.suppressed[0].reason == "この版では FR を書かない"


def test_other_codes_on_the_same_node_survive():
    s = source("S-1")
    graph = build(
        s,
        need("N-1", suppress=[("structure.orphan_need", "FR は次版で書く")]),
    )
    result = apply_waivers(graph, validate_structure(graph))

    # 源泉が無い指摘は抑制していないので残る。
    assert codes(result.findings) == {"structure.missing_source", "structure.unused_source"}
    assert result.count == 1


def test_suppression_covers_lexical_findings():
    s = source("S-1")
    n = need("N-1", has_source=[s])
    f = fr(
        "FR-1",
        text="領収書を高速に読み取ること",
        satisfies=[n],
        has_source=[s],
        suppress=[("semantics.ambiguous_term", "計測条件は QR-1 側に書いた")],
    )
    graph = build(s, n, goal("G-1", motivates=[n], has_source=[s]), f)
    result = apply_waivers(graph, validate_semantics_lexical(graph))

    assert list(result.findings) == []
    assert result.count == 1


def test_errors_are_never_suppressed():
    """宣言側で弾いているが、コードの重大度が変わっても素通りさせない。

    指摘そのものは出ているので、陳腐化 (waiver.stale) でもない。
    """
    graph = orphan_need_graph(("structure.orphan_need", "既知"))
    findings = FindingList(
        [
            Finding(
                severity="error",
                code="structure.orphan_need",
                layer=2,
                message="仮にエラーになった場合",
                node_id="N-1",
            )
        ]
    )
    result = apply_waivers(graph, findings)

    assert result.count == 0
    assert [f.severity for f in result.findings] == ["error"]


def test_suppressed_finding_keeps_its_location():
    graph = orphan_need_graph(("structure.orphan_need", "既知"))
    result = apply_waivers(graph, validate_structure(graph))
    assert result.suppressed[0].finding.node_id == "N-1"
    assert "抑制: 既知" in result.suppressed[0].format()


# ---------------------------------------------------------------------------
# 陳腐化した抑制
# ---------------------------------------------------------------------------


def test_stale_waiver_is_reported():
    s = source("S-1")
    n = need("N-1", has_source=[s], suppress=[("structure.orphan_qr", "QR は無い")])
    graph = build(s, n, fr("FR-1", satisfies=[n], has_source=[s]))
    result = apply_waivers(graph, validate_structure(graph))

    stale = [f for f in result.findings if f.code == "waiver.stale"]
    assert len(stale) == 1
    assert stale[0].node_id == "N-1"
    assert stale[0].severity == "warning"
    assert "structure.orphan_qr" in stale[0].message
    assert "QR は無い" in stale[0].message
    assert result.count == 0


def test_stale_waiver_gets_the_node_location():
    graph = orphan_need_graph(("structure.orphan_qr", "QR は無い"))
    graph.locations["N-1"] = "requirements.py:12"
    result = apply_waivers(graph, validate_structure(graph))

    stale = [f for f in result.findings if f.code == "waiver.stale"]
    assert stale[0].location == "requirements.py:12"


def test_summary_counts_suppressed():
    graph = orphan_need_graph(("structure.orphan_need", "既知"))
    result = apply_waivers(graph, validate_structure(graph))
    assert result.summary().endswith("(抑制 1 件)")

    clean = apply_waivers(build(source("S-1"), fr("FR-1")), FindingList())
    assert "抑制" not in clean.summary()


# ---------------------------------------------------------------------------
# 宣言そのものの検査 (層1)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value, expected",
    [
        (["structure.orphan_need"], "理由が無い"),
        ([("structure.orphan_need",)], "2 要素の組"),
        ([("structure.orphan_need", "")], "理由が要る"),
        ([("structure.orphan_need", "   ")], "理由が要る"),
        ([("structure.typo", "既知")], "未知のチェックコード"),
        ([("structure.dangling_ref", "既知")], "抑制できない"),
        ([("structure.orphan_need", 1)], "文字列"),
        ("structure.orphan_need", "組のリスト"),
        (
            [("structure.orphan_need", "A"), ("structure.orphan_need", "B")],
            "重複",
        ),
    ],
)
def test_invalid_suppress_declarations_are_rejected(value, expected):
    with pytest.raises(ValidationError) as excinfo:
        Need(id="N-1", text="知りたい", suppress=value)
    assert expected in str(excinfo.value)


def test_reason_is_stripped_and_kept_as_pairs():
    node = Need(
        id="N-1", text="知りたい", suppress=[("structure.orphan_need", "  既知  ")]
    )
    assert node.suppress == [("structure.orphan_need", "既知")]


def test_suppress_is_not_an_edge():
    """suppress は (str, str) の組なので、エッジとして拾われてはならない。"""
    graph = orphan_need_graph(("structure.orphan_need", "既知"))
    assert [e.name for e in graph.out_edges("N-1")] == ["has_source"]


# ---------------------------------------------------------------------------
# コード表と実装の突き合わせ
# ---------------------------------------------------------------------------


def test_every_emitted_code_is_registered():
    """実装が出すコードは、必ず codes.py に登録されていること。

    登録漏れがあると、そのチェックは抑制できないまま `--strict` を壊す。
    """
    emitted: set[str] = set()
    for path in SRC.rglob("*.py"):
        emitted.update(re.findall(r'code="([\w.]+)"', path.read_text(encoding="utf-8")))

    assert emitted, "コードを 1 つも見つけられていない (探索が壊れている)"
    assert emitted <= set(CHECK_CODES)


def test_registered_codes_are_emitted_somewhere():
    sources = "".join(path.read_text(encoding="utf-8") for path in SRC.rglob("*.py"))
    for code in CHECK_CODES:
        assert f'"{code}"' in sources, f"{code} はどこからも出ていない"


def test_error_codes_are_not_suppressible():
    assert "structure.dangling_ref" not in SUPPRESSIBLE_CODES
    assert "waiver.stale" not in SUPPRESSIBLE_CODES
    assert "structure.missing_source" in SUPPRESSIBLE_CODES
