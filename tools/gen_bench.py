#!/usr/bin/env python3
"""`examples/bench.py` (300 ノード級のベンチ用モデル) を生成する。

定義ファイルは宣言のみ (層0) なので、大きいモデルを手で書くことも、定義ファイルの
中で組み立てることもできない。**生成器はモデルの外に置く**、というのがこの
スクリプトの位置付けである。出力は普通の定義ファイルなので、`req validate` も
`req site` もそのまま通る。

形は実モデルの縮尺ではなく、**表示が破綻する形**を狙って作ってある。

- Goal は数段の refines で積まれた木 (13 件)
- Need は葉の Goal から動機づけられる (24 件)
- FR は Need に対して大量に並ぶ (196 件)。**同じ段に並ぶ幅**がそのまま
  図の横長さになる (#17 で問題にしているのはここ)
- QR / Constraint / Source は現実的な比率で少数

出力は決定的 (乱数を使わない)。`tests/test_bench_example.py` が、
コミットされている `examples/bench.py` とこの生成結果の一致を見張る。

    $ python tools/gen_bench.py            # examples/bench.py を書き出す
    $ python tools/gen_bench.py --stdout   # 標準出力に出す
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

OUT_PATH = Path(__file__).resolve().parents[1] / "examples" / "bench.py"

# --- 規模 -------------------------------------------------------------------

GOALS_MID = 4
GOALS_LEAF = 8
GOALS = 1 + GOALS_MID + GOALS_LEAF
NEEDS = 24
#: 全体で 300 ノード (tests/test_bench_example.py の MIN_NODES) に届く数。
FRS = 196
QRS = 50
CONSTRAINTS = 10
SOURCES = 6

#: FR どうしの詳細化。この倍数の FR は Need ではなく 1 つ前の FR を詳細化する。
FR_REFINE_EVERY = 7
#: System に張る QR (残りは FR に張る)。
QR_ON_SYSTEM = 5

# --- 語彙 -------------------------------------------------------------------
#
# 曖昧語辞書 (lexicon.py) に載る語は使わない。使うと semantics.ambiguous_term が
# 出て、ベンチ用モデルが「指摘だらけのモデル」になってしまう。

AREAS = [
    "受注",
    "在庫",
    "出荷",
    "配送",
    "請求",
    "返品",
    "与信",
    "倉庫",
    "車両",
    "積載",
    "通関",
    "検品",
]
THINGS = [
    "登録内容",
    "引当状況",
    "進捗",
    "履歴",
    "実績",
    "予定",
    "明細",
    "残高",
    "区分",
    "担当割当",
]
ROLES = [
    "受注担当者",
    "倉庫管理者",
    "配送計画者",
    "請求担当者",
    "与信審査者",
    "運行管理者",
]
WANTS = [
    "確認したい",
    "把握したい",
    "記録したい",
    "受け取りたい",
    "見直したい",
    "引き継ぎたい",
]
FR_VERBS = [
    "一覧画面に表示すること",
    "日次で集計すること",
    "担当者に通知すること",
    "CSV として出力すること",
    "変更履歴として残すこと",
    "基幹システムへ連携すること",
]
SOURCE_KINDS = [
    ("stakeholder", "物流部門の統括責任者"),
    ("stakeholder", "受注業務を担当する社員"),
    ("stakeholder", "配送を担う協力会社の運行管理者"),
    ("document", "物流業務規程 第7版"),
    ("document", "取引先との基本契約書"),
    ("existing_system", "現行の基幹システムと表計算による運用"),
]

STATUSES_FR = ["approved", "implemented", "verified"]
STATUSES_QR = ["proposed", "approved", "implemented", "verified"]


def evidence_for(status: str, index: int) -> list[str]:
    """``verified`` と書いた分だけ根拠を添える (``structure.unverified_claim``)。

    根拠が要るのは主張した時点だけなので、それ以外の status では空にする。
    """
    if status != "verified":
        return []
    return [f"{area(index)}の受入テスト第 {index % 9 + 1} 回で、全項目が合格している"]


def area(index: int) -> str:
    return AREAS[index % len(AREAS)]


def thing(index: int) -> str:
    return THINGS[index % len(THINGS)]


def source_of(index: int) -> str:
    return f"SRC-{index % SOURCES + 1}"


HEADER = '''"""ベンチ用の大きいサンプル定義ファイル (物流管理システム)。

**このファイルは生成物である。手で編集せず `python tools/gen_bench.py` を実行する**
(`tests/test_bench_example.py` が生成結果との一致を見張っている)。

大きいモデルでの表示と探索を確かめるためのもので、内容そのものに意味は無い。
同じ段に並ぶ FR の数が図の横長さになるよう、FR を厚くしてある。

    $ req validate examples/bench.py
    $ req site examples/bench.py -o bench-site && python -m http.server -d bench-site
"""

from reqmodel import (
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    QualityRequirement,
    Source,
    System,
)
'''



# --- 出力の組み立て ---------------------------------------------------------


def literal(value: Any) -> str:
    """定義ファイルに書ける形の値。書けるのは文字列・数・リスト・タプルだけ。"""
    if isinstance(value, str):
        return f'"{value}"'
    if isinstance(value, bool):  # pragma: no cover - 使わない
        raise TypeError("真偽値は定義ファイルに書かない")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, tuple):
        return "(" + ", ".join(literal(item) for item in value) + ")"
    if isinstance(value, list):
        if not value:
            return "[]"
        items = ", ".join(literal(item) for item in value)
        if len(items) <= 70:
            return f"[{items}]"
        lines = "\n".join(f"        {literal(item)}," for item in value)
        return f"[\n{lines}\n    ]"
    raise TypeError(f"書けない値: {value!r}")


def node(type_name: str, **kwargs: Any) -> str:
    """ノード 1 件の宣言。値が空のキーワードは落とす。"""
    lines = [f"{type_name}("]
    for key, value in kwargs.items():
        if value is None or value == [] or value == "":
            continue
        lines.append(f"    {key}={literal(value)},")
    lines.append(")")
    return "\n".join(lines)


def section(title: str) -> str:
    return f"# --- {title} " + "-" * max(3, 74 - len(title)) + "\n"


def render() -> str:
    """`examples/bench.py` の中身。"""
    parts: list[str] = [HEADER]

    # 源泉 ------------------------------------------------------------------
    parts.append(section("源泉"))
    for index, (kind, text) in enumerate(SOURCE_KINDS, start=1):
        parts.append(node("Source", id=f"SRC-{index}", text=text, kind=kind, status="approved"))

    # システム --------------------------------------------------------------
    parts.append(section("システム"))
    parts.append(node("System", id="SYS", text="物流管理システム", status="approved"))

    # ゴール ----------------------------------------------------------------
    #
    # G-1 (根) → G-2..G-5 (中間) → G-6..G-13 (葉)。葉だけが Need を動機づける。
    parts.append(section("ゴール"))
    parts.append(
        node(
            "Goal",
            id="G-1",
            text="物流業務全体の処理時間を 30% 削減する",
            status="approved",
            has_source=["SRC-1"],
        )
    )
    for index in range(GOALS_MID):
        number = 2 + index
        parts.append(
            node(
                "Goal",
                id=f"G-{number}",
                text=f"{area(index)}業務の手戻りを 20% 減らす",
                status="approved",
                has_source=[source_of(index)],
                refines=["G-1"],
            )
        )
    for index in range(GOALS_LEAF):
        number = 2 + GOALS_MID + index
        parent = 2 + index // 2
        parts.append(
            node(
                "Goal",
                id=f"G-{number}",
                text=f"{area(index + GOALS_MID)}の入力と確認にかかる工数を減らす",
                status="approved",
                has_source=[source_of(index + 1)],
                refines=[f"G-{parent}"],
                motivates=[
                    f"N-{need}"
                    for need in range(1, NEEDS + 1)
                    if (need - 1) * GOALS_LEAF // NEEDS == index
                ],
            )
        )

    # ニーズ ----------------------------------------------------------------
    parts.append(section("ニーズ"))
    for index in range(NEEDS):
        number = index + 1
        role = ROLES[index % len(ROLES)]
        parts.append(
            node(
                "Need",
                id=f"N-{number}",
                text=f"{role}は、{area(index)}の{thing(index)}を{WANTS[index % len(WANTS)]}",
                status="approved" if index % 3 else "implemented",
                has_source=[source_of(index), source_of(index + 3)],
            )
        )

    # 機能要求 --------------------------------------------------------------
    #
    # ここが大量に並ぶ。1 つの Need にぶら下がる FR が 8 件前後になる。
    parts.append(section("機能要求 (ここが同じ段に大量に並ぶ)"))
    for index in range(FRS):
        number = index + 1
        refines_parent = number % FR_REFINE_EVERY == 0
        status = STATUSES_FR[index % len(STATUSES_FR)]
        parts.append(
            node(
                "FunctionalRequirement",
                id=f"FR-{number}",
                text=f"{area(index)}の{thing(index)}を{FR_VERBS[index % len(FR_VERBS)]}",
                status=status,
                has_source=[source_of(index)],
                satisfies=[] if refines_parent else [f"N-{index % NEEDS + 1}"],
                refines=[f"FR-{number - 1}"] if refines_parent else [],
                evidence=evidence_for(status, index),
                acceptance_criteria=[
                    f"{area(index)}の{thing(index)}が 3 秒以内に画面へ出る",
                    "実行した担当者と日時が操作ログに残る",
                ],
            )
        )

    # 品質要求 --------------------------------------------------------------
    parts.append(section("品質要求"))
    for index in range(QRS):
        number = index + 1
        on_system = number > QRS - QR_ON_SYSTEM
        if on_system:
            text = f"{area(index)}を含む全機能の稼働率を月間 99.9% 以上に保つこと"
            target = "SYS"
        else:
            target = f"FR-{index * 4 % FRS + 1}"
            text = f"{area(index)}の{thing(index)}の表示を 2 秒以内に返すこと"
        status = STATUSES_QR[index % len(STATUSES_QR)]
        parts.append(
            node(
                "QualityRequirement",
                id=f"QR-{number}",
                text=text,
                status=status,
                has_source=[source_of(index + 2)],
                qualifies=[target],
                evidence=evidence_for(status, index),
                acceptance_criteria=[
                    "連続 30 日の計測で、上限を超えた回数が 0 件である",
                ],
            )
        )

    # 制約 ------------------------------------------------------------------
    parts.append(section("制約"))
    for index in range(CONSTRAINTS):
        number = index + 1
        parts.append(
            node(
                "Constraint",
                id=f"C-{number}",
                text=f"{area(index)}の操作は社内ネットワークからのみ受け付けること",
                status="approved" if index % 2 else "proposed",
                has_source=[source_of(index + 4)],
                constrains=[f"FR-{index * 17 % FRS + 1}"],
            )
        )

    return "\n\n".join(part.rstrip("\n") for part in parts) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stdout", action="store_true", help="ファイルに書かず標準出力に出す")
    args = parser.parse_args(argv)

    text = render()
    if args.stdout:
        sys.stdout.write(text)
        return 0
    OUT_PATH.write_text(text, encoding="utf-8")
    nodes = text.count("\n    id=")
    print(f"{OUT_PATH} に {nodes} ノードを書き出した")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
