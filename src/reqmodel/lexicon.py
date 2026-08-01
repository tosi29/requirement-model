"""曖昧語辞書。

「意味の判断は人間と LLM」が原則だが、辞書一致で決定的に検出できる範囲だけは
機械の担当にする (層3 の LLM 判定に回す前の足切り)。

語によっては単純な部分一致で誤検出する (「同等」の中の「等」など) ため、
必要なものだけ正規表現で文脈を絞る。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ["AmbiguousTerm", "AMBIGUOUS_TERMS", "find_ambiguous_terms"]


@dataclass(frozen=True)
class AmbiguousTerm:
    """曖昧語 1 語。label が指摘に出る表記、pattern が検出条件。"""

    label: str
    advice: str
    pattern: str = ""

    def regex(self) -> re.Pattern[str]:
        return re.compile(self.pattern or re.escape(self.label))


def _term(label: str, advice: str, pattern: str = "") -> AmbiguousTerm:
    return AmbiguousTerm(label=label, advice=advice, pattern=pattern)


_NUMERIC = "上限・下限を数値で書くこと"

AMBIGUOUS_TERMS: tuple[AmbiguousTerm, ...] = (
    _term("高速", "どの操作が何秒以内かを QR として測定可能に書くこと"),
    _term("速く", "どの操作が何秒以内かを QR として測定可能に書くこと"),
    _term("適切", "何をもって適切とするかの判定基準を書くこと"),
    _term("適宜", "誰がいつ判断するのかを書くこと"),
    _term("十分", "充足量を数値または判定基準で書くこと", r"十分(?!の[一二三四五六七八九十])"),
    _term("柔軟", "どの軸で何を変更できるのかを書くこと"),
    _term("迅速", "所要時間の上限を数値で書くこと"),
    _term("簡単", "誰にとってどの操作が何ステップかを書くこと"),
    _term("使いやすい", "測定可能な利用品質 (手順数・学習時間等) に置き換えること"),
    _term("ユーザーフレンドリー", "測定可能な利用品質に置き換えること"),
    _term("必要に応じて", "条件を明示するか、条件ごとに要求を分けること"),
    _term("可能な限り", _NUMERIC),
    _term("なるべく", _NUMERIC),
    _term("極力", _NUMERIC),
    _term("大量", "件数・容量を数値で書くこと"),
    _term("安定", "可用性・エラー率などの指標に置き換えること", r"(?<![不安])安定"),
    _term("基本的に", "例外条件を明示すること"),
    _term("原則", "例外条件を明示すること"),
    _term("その他", "対象を確定させること"),
    # 「など」「等」は列挙を開いたままにする語。「同等」「平等」等の誤検出を避ける。
    _term("など", "列挙を確定させること (曖昧な拡張余地を残さない)"),
    _term(
        "等",
        "列挙を確定させること (曖昧な拡張余地を残さない)",
        r"(?<![同平均対高低初上劣一二三四五六七八九十])等(?=[のをにはがでやも、。\s]|$)",
    ),
)


def find_ambiguous_terms(text: str) -> list[tuple[str, str]]:
    """文字列に含まれる曖昧語を (表記, 助言) の列で返す。"""
    return [
        (term.label, term.advice)
        for term in AMBIGUOUS_TERMS
        if term.regex().search(text)
    ]
