"""チェックコードの一覧と、抑制 (waiver) 可否の定義。

指摘の抑制はノード属性 ``suppress`` で宣言する。抑制できるコードをここに
一元化しておき、定義ファイルを読んだ時点 (層1) で「存在しないコードの抑制」
「抑制できないコードの抑制」を弾く。

**エラーは抑制できない。** エラーは「モデルが壊れている」という意味であり、
既知として飼い慣らす対象ではないため。抑制の対象は severe / warning / info、
つまり ``--strict`` の成否を左右する指摘だけである。
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["CheckCode", "CHECK_CODES", "SUPPRESSIBLE_CODES", "WAIVER_STALE"]


@dataclass(frozen=True)
class CheckCode:
    """チェック 1 種類の素性。"""

    code: str
    layer: int
    summary: str
    #: ノード属性 ``suppress`` で黙らせてよいか (エラーは不可)。
    suppressible: bool


#: 陳腐化した抑制そのものを報告するコード。これ自体は抑制できない。
WAIVER_STALE = "waiver.stale"


def _code(code: str, layer: int, summary: str, suppressible: bool) -> CheckCode:
    return CheckCode(code=code, layer=layer, summary=summary, suppressible=suppressible)


#: 全チェックコード。新しいチェックを足したらここにも登録する
#: (``tests/test_waivers.py`` が実装との突き合わせを行う)。
CHECK_CODES: dict[str, CheckCode] = {
    entry.code: entry
    for entry in (
        # 層0: 宣言性
        _code("declarative.forbidden", 0, "宣言以外の構文", False),
        # 層1: 構文
        _code("syntax.duplicate_id", 1, "id の重複", False),
        _code("syntax.invalid_field", 1, "属性の値が規約に反する", False),
        _code("semantics.ambiguous_term", 1, "曖昧語", True),
        # 層2: 構造
        _code("structure.dangling_ref", 2, "参照先ノードが存在しない", False),
        _code("structure.edge_type", 2, "型規則違反エッジ", False),
        _code("structure.self_reference", 2, "自分自身への参照", False),
        _code("structure.refines_cycle", 2, "refines の閉路", False),
        _code("structure.part_of_cycle", 2, "part_of の閉路", False),
        _code("structure.orphan_fr", 2, "Goal に到達できない FR", True),
        _code("structure.orphan_need", 2, "satisfies されない Need", True),
        _code("structure.orphan_qr", 2, "FR への qualifies が無い QR", True),
        _code("structure.unused_source", 2, "参照されない Source", True),
        _code("structure.goal_leaf", 2, "未分解の Goal", True),
        _code("structure.goal_decomposition", 2, "AND/OR 分解が要求群に到達しない", True),
        _code("structure.missing_source", 2, "源泉 (has_source) が無い", True),
        _code("structure.unverified_claim", 2, "verified なのに根拠が無い", True),
        _code("structure.status_inconsistent", 2, "状態の成熟度が逆転している", True),
        # 抑制機構そのもの
        _code(WAIVER_STALE, 2, "指摘が出ていない抑制 (陳腐化)", False),
    )
}

#: ``suppress`` に書けるコード (安定した並び)。
SUPPRESSIBLE_CODES: tuple[str, ...] = tuple(
    code for code, entry in CHECK_CODES.items() if entry.suppressible
)
