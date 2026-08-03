"""ベンチ用の大きいサンプル定義ファイル (物流管理システム)。

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

# --- 源泉 ------------------------------------------------------------------------

Source(
    id="SRC-1",
    text="物流部門の統括責任者",
    kind="stakeholder",
    status="approved",
)

Source(
    id="SRC-2",
    text="受注業務を担当する社員",
    kind="stakeholder",
    status="approved",
)

Source(
    id="SRC-3",
    text="配送を担う協力会社の運行管理者",
    kind="stakeholder",
    status="approved",
)

Source(
    id="SRC-4",
    text="物流業務規程 第7版",
    kind="document",
    status="approved",
)

Source(
    id="SRC-5",
    text="取引先との基本契約書",
    kind="document",
    status="approved",
)

Source(
    id="SRC-6",
    text="現行の基幹システムと表計算による運用",
    kind="existing_system",
    status="approved",
)

# --- システム ----------------------------------------------------------------------

System(
    id="SYS",
    text="物流管理システム",
    status="approved",
)

# --- ゴール -----------------------------------------------------------------------

Goal(
    id="G-1",
    text="物流業務全体の処理時間を 30% 削減する",
    status="approved",
    has_source=["SRC-1"],
)

Goal(
    id="G-2",
    text="受注業務の手戻りを 20% 減らす",
    status="approved",
    has_source=["SRC-1"],
    refines=["G-1"],
)

Goal(
    id="G-3",
    text="在庫業務の手戻りを 20% 減らす",
    status="approved",
    has_source=["SRC-2"],
    refines=["G-1"],
)

Goal(
    id="G-4",
    text="出荷業務の手戻りを 20% 減らす",
    status="approved",
    has_source=["SRC-3"],
    refines=["G-1"],
)

Goal(
    id="G-5",
    text="配送業務の手戻りを 20% 減らす",
    status="approved",
    has_source=["SRC-4"],
    refines=["G-1"],
)

Goal(
    id="G-6",
    text="請求の入力と確認にかかる工数を減らす",
    status="approved",
    has_source=["SRC-2"],
    refines=["G-2"],
    motivates=["N-1", "N-2", "N-3"],
)

Goal(
    id="G-7",
    text="返品の入力と確認にかかる工数を減らす",
    status="approved",
    has_source=["SRC-3"],
    refines=["G-2"],
    motivates=["N-4", "N-5", "N-6"],
)

Goal(
    id="G-8",
    text="与信の入力と確認にかかる工数を減らす",
    status="approved",
    has_source=["SRC-4"],
    refines=["G-3"],
    motivates=["N-7", "N-8", "N-9"],
)

Goal(
    id="G-9",
    text="倉庫の入力と確認にかかる工数を減らす",
    status="approved",
    has_source=["SRC-5"],
    refines=["G-3"],
    motivates=["N-10", "N-11", "N-12"],
)

Goal(
    id="G-10",
    text="車両の入力と確認にかかる工数を減らす",
    status="approved",
    has_source=["SRC-6"],
    refines=["G-4"],
    motivates=["N-13", "N-14", "N-15"],
)

Goal(
    id="G-11",
    text="積載の入力と確認にかかる工数を減らす",
    status="approved",
    has_source=["SRC-1"],
    refines=["G-4"],
    motivates=["N-16", "N-17", "N-18"],
)

Goal(
    id="G-12",
    text="通関の入力と確認にかかる工数を減らす",
    status="approved",
    has_source=["SRC-2"],
    refines=["G-5"],
    motivates=["N-19", "N-20", "N-21"],
)

Goal(
    id="G-13",
    text="検品の入力と確認にかかる工数を減らす",
    status="approved",
    has_source=["SRC-3"],
    refines=["G-5"],
    motivates=["N-22", "N-23", "N-24"],
)

# --- ニーズ -----------------------------------------------------------------------

Need(
    id="N-1",
    text="受注担当者は、受注の登録内容を確認したい",
    status="implemented",
    has_source=["SRC-1", "SRC-4"],
)

Need(
    id="N-2",
    text="倉庫管理者は、在庫の引当状況を把握したい",
    status="approved",
    has_source=["SRC-2", "SRC-5"],
)

Need(
    id="N-3",
    text="配送計画者は、出荷の進捗を記録したい",
    status="approved",
    has_source=["SRC-3", "SRC-6"],
)

Need(
    id="N-4",
    text="請求担当者は、配送の履歴を受け取りたい",
    status="implemented",
    has_source=["SRC-4", "SRC-1"],
)

Need(
    id="N-5",
    text="与信審査者は、請求の実績を見直したい",
    status="approved",
    has_source=["SRC-5", "SRC-2"],
)

Need(
    id="N-6",
    text="運行管理者は、返品の予定を引き継ぎたい",
    status="approved",
    has_source=["SRC-6", "SRC-3"],
)

Need(
    id="N-7",
    text="受注担当者は、与信の明細を確認したい",
    status="implemented",
    has_source=["SRC-1", "SRC-4"],
)

Need(
    id="N-8",
    text="倉庫管理者は、倉庫の残高を把握したい",
    status="approved",
    has_source=["SRC-2", "SRC-5"],
)

Need(
    id="N-9",
    text="配送計画者は、車両の区分を記録したい",
    status="approved",
    has_source=["SRC-3", "SRC-6"],
)

Need(
    id="N-10",
    text="請求担当者は、積載の担当割当を受け取りたい",
    status="implemented",
    has_source=["SRC-4", "SRC-1"],
)

Need(
    id="N-11",
    text="与信審査者は、通関の登録内容を見直したい",
    status="approved",
    has_source=["SRC-5", "SRC-2"],
)

Need(
    id="N-12",
    text="運行管理者は、検品の引当状況を引き継ぎたい",
    status="approved",
    has_source=["SRC-6", "SRC-3"],
)

Need(
    id="N-13",
    text="受注担当者は、受注の進捗を確認したい",
    status="implemented",
    has_source=["SRC-1", "SRC-4"],
)

Need(
    id="N-14",
    text="倉庫管理者は、在庫の履歴を把握したい",
    status="approved",
    has_source=["SRC-2", "SRC-5"],
)

Need(
    id="N-15",
    text="配送計画者は、出荷の実績を記録したい",
    status="approved",
    has_source=["SRC-3", "SRC-6"],
)

Need(
    id="N-16",
    text="請求担当者は、配送の予定を受け取りたい",
    status="implemented",
    has_source=["SRC-4", "SRC-1"],
)

Need(
    id="N-17",
    text="与信審査者は、請求の明細を見直したい",
    status="approved",
    has_source=["SRC-5", "SRC-2"],
)

Need(
    id="N-18",
    text="運行管理者は、返品の残高を引き継ぎたい",
    status="approved",
    has_source=["SRC-6", "SRC-3"],
)

Need(
    id="N-19",
    text="受注担当者は、与信の区分を確認したい",
    status="implemented",
    has_source=["SRC-1", "SRC-4"],
)

Need(
    id="N-20",
    text="倉庫管理者は、倉庫の担当割当を把握したい",
    status="approved",
    has_source=["SRC-2", "SRC-5"],
)

Need(
    id="N-21",
    text="配送計画者は、車両の登録内容を記録したい",
    status="approved",
    has_source=["SRC-3", "SRC-6"],
)

Need(
    id="N-22",
    text="請求担当者は、積載の引当状況を受け取りたい",
    status="implemented",
    has_source=["SRC-4", "SRC-1"],
)

Need(
    id="N-23",
    text="与信審査者は、通関の進捗を見直したい",
    status="approved",
    has_source=["SRC-5", "SRC-2"],
)

Need(
    id="N-24",
    text="運行管理者は、検品の履歴を引き継ぎたい",
    status="approved",
    has_source=["SRC-6", "SRC-3"],
)

# --- 機能要求 (ここが同じ段に大量に並ぶ) -------------------------------------------------------

FunctionalRequirement(
    id="FR-1",
    text="受注の登録内容を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-1"],
    acceptance_criteria=["受注の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-2",
    text="在庫の引当状況を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-2"],
    acceptance_criteria=["在庫の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-3",
    text="出荷の進捗を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-3"],
    evidence=["出荷の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["出荷の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-4",
    text="配送の履歴をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-4"],
    acceptance_criteria=["配送の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-5",
    text="請求の実績を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-5"],
    acceptance_criteria=["請求の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-6",
    text="返品の予定を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-6"],
    evidence=["返品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["返品の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-7",
    text="与信の明細を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    refines=["FR-6"],
    acceptance_criteria=["与信の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-8",
    text="倉庫の残高を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-8"],
    acceptance_criteria=["倉庫の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-9",
    text="車両の区分を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-9"],
    evidence=["車両の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["車両の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-10",
    text="積載の担当割当をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-10"],
    acceptance_criteria=["積載の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-11",
    text="通関の登録内容を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-11"],
    acceptance_criteria=["通関の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-12",
    text="検品の引当状況を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-12"],
    evidence=["検品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["検品の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-13",
    text="受注の進捗を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-13"],
    acceptance_criteria=["受注の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-14",
    text="在庫の履歴を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    refines=["FR-13"],
    acceptance_criteria=["在庫の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-15",
    text="出荷の実績を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-15"],
    evidence=["出荷の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["出荷の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-16",
    text="配送の予定をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-16"],
    acceptance_criteria=["配送の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-17",
    text="請求の明細を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-17"],
    acceptance_criteria=["請求の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-18",
    text="返品の残高を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-18"],
    evidence=["返品の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["返品の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-19",
    text="与信の区分を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-19"],
    acceptance_criteria=["与信の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-20",
    text="倉庫の担当割当を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-20"],
    acceptance_criteria=["倉庫の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-21",
    text="車両の登録内容を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    refines=["FR-20"],
    evidence=["車両の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["車両の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-22",
    text="積載の引当状況をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-22"],
    acceptance_criteria=["積載の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-23",
    text="通関の進捗を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-23"],
    acceptance_criteria=["通関の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-24",
    text="検品の履歴を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-24"],
    evidence=["検品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["検品の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-25",
    text="受注の実績を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-1"],
    acceptance_criteria=["受注の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-26",
    text="在庫の予定を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-2"],
    acceptance_criteria=["在庫の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-27",
    text="出荷の明細を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-3"],
    evidence=["出荷の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["出荷の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-28",
    text="配送の残高をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    refines=["FR-27"],
    acceptance_criteria=["配送の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-29",
    text="請求の区分を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-5"],
    acceptance_criteria=["請求の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-30",
    text="返品の担当割当を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-6"],
    evidence=["返品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["返品の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-31",
    text="与信の登録内容を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-7"],
    acceptance_criteria=["与信の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-32",
    text="倉庫の引当状況を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-8"],
    acceptance_criteria=["倉庫の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-33",
    text="車両の進捗を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-9"],
    evidence=["車両の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["車両の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-34",
    text="積載の履歴をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-10"],
    acceptance_criteria=["積載の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-35",
    text="通関の実績を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    refines=["FR-34"],
    acceptance_criteria=["通関の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-36",
    text="検品の予定を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-12"],
    evidence=["検品の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["検品の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-37",
    text="受注の明細を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-13"],
    acceptance_criteria=["受注の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-38",
    text="在庫の残高を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-14"],
    acceptance_criteria=["在庫の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-39",
    text="出荷の区分を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-15"],
    evidence=["出荷の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["出荷の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-40",
    text="配送の担当割当をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-16"],
    acceptance_criteria=["配送の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-41",
    text="請求の登録内容を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-17"],
    acceptance_criteria=["請求の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-42",
    text="返品の引当状況を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    refines=["FR-41"],
    evidence=["返品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["返品の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-43",
    text="与信の進捗を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-19"],
    acceptance_criteria=["与信の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-44",
    text="倉庫の履歴を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-20"],
    acceptance_criteria=["倉庫の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-45",
    text="車両の実績を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-21"],
    evidence=["車両の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["車両の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-46",
    text="積載の予定をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-22"],
    acceptance_criteria=["積載の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-47",
    text="通関の明細を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-23"],
    acceptance_criteria=["通関の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-48",
    text="検品の残高を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-24"],
    evidence=["検品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["検品の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-49",
    text="受注の区分を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    refines=["FR-48"],
    acceptance_criteria=["受注の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-50",
    text="在庫の担当割当を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-2"],
    acceptance_criteria=["在庫の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-51",
    text="出荷の登録内容を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-3"],
    evidence=["出荷の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["出荷の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-52",
    text="配送の引当状況をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-4"],
    acceptance_criteria=["配送の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-53",
    text="請求の進捗を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-5"],
    acceptance_criteria=["請求の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-54",
    text="返品の履歴を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-6"],
    evidence=["返品の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["返品の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-55",
    text="与信の実績を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-7"],
    acceptance_criteria=["与信の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-56",
    text="倉庫の予定を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    refines=["FR-55"],
    acceptance_criteria=["倉庫の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-57",
    text="車両の明細を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-9"],
    evidence=["車両の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["車両の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-58",
    text="積載の残高をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-10"],
    acceptance_criteria=["積載の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-59",
    text="通関の区分を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-11"],
    acceptance_criteria=["通関の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-60",
    text="検品の担当割当を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-12"],
    evidence=["検品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["検品の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-61",
    text="受注の登録内容を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-13"],
    acceptance_criteria=["受注の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-62",
    text="在庫の引当状況を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-14"],
    acceptance_criteria=["在庫の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-63",
    text="出荷の進捗を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    refines=["FR-62"],
    evidence=["出荷の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["出荷の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-64",
    text="配送の履歴をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-16"],
    acceptance_criteria=["配送の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-65",
    text="請求の実績を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-17"],
    acceptance_criteria=["請求の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-66",
    text="返品の予定を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-18"],
    evidence=["返品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["返品の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-67",
    text="与信の明細を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-19"],
    acceptance_criteria=["与信の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-68",
    text="倉庫の残高を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-20"],
    acceptance_criteria=["倉庫の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-69",
    text="車両の区分を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-21"],
    evidence=["車両の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["車両の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-70",
    text="積載の担当割当をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    refines=["FR-69"],
    acceptance_criteria=["積載の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-71",
    text="通関の登録内容を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-23"],
    acceptance_criteria=["通関の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-72",
    text="検品の引当状況を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-24"],
    evidence=["検品の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["検品の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-73",
    text="受注の進捗を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-1"],
    acceptance_criteria=["受注の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-74",
    text="在庫の履歴を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-2"],
    acceptance_criteria=["在庫の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-75",
    text="出荷の実績を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-3"],
    evidence=["出荷の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["出荷の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-76",
    text="配送の予定をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-4"],
    acceptance_criteria=["配送の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-77",
    text="請求の明細を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    refines=["FR-76"],
    acceptance_criteria=["請求の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-78",
    text="返品の残高を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-6"],
    evidence=["返品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["返品の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-79",
    text="与信の区分を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-7"],
    acceptance_criteria=["与信の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-80",
    text="倉庫の担当割当を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-8"],
    acceptance_criteria=["倉庫の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-81",
    text="車両の登録内容を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-9"],
    evidence=["車両の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["車両の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-82",
    text="積載の引当状況をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-10"],
    acceptance_criteria=["積載の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-83",
    text="通関の進捗を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-11"],
    acceptance_criteria=["通関の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-84",
    text="検品の履歴を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    refines=["FR-83"],
    evidence=["検品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["検品の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-85",
    text="受注の実績を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-13"],
    acceptance_criteria=["受注の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-86",
    text="在庫の予定を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-14"],
    acceptance_criteria=["在庫の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-87",
    text="出荷の明細を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-15"],
    evidence=["出荷の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["出荷の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-88",
    text="配送の残高をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-16"],
    acceptance_criteria=["配送の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-89",
    text="請求の区分を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-17"],
    acceptance_criteria=["請求の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-90",
    text="返品の担当割当を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-18"],
    evidence=["返品の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["返品の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-91",
    text="与信の登録内容を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    refines=["FR-90"],
    acceptance_criteria=["与信の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-92",
    text="倉庫の引当状況を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-20"],
    acceptance_criteria=["倉庫の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-93",
    text="車両の進捗を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-21"],
    evidence=["車両の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["車両の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-94",
    text="積載の履歴をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-22"],
    acceptance_criteria=["積載の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-95",
    text="通関の実績を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-23"],
    acceptance_criteria=["通関の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-96",
    text="検品の予定を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-24"],
    evidence=["検品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["検品の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-97",
    text="受注の明細を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-1"],
    acceptance_criteria=["受注の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-98",
    text="在庫の残高を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    refines=["FR-97"],
    acceptance_criteria=["在庫の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-99",
    text="出荷の区分を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-3"],
    evidence=["出荷の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["出荷の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-100",
    text="配送の担当割当をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-4"],
    acceptance_criteria=["配送の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-101",
    text="請求の登録内容を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-5"],
    acceptance_criteria=["請求の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-102",
    text="返品の引当状況を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-6"],
    evidence=["返品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["返品の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-103",
    text="与信の進捗を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-7"],
    acceptance_criteria=["与信の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-104",
    text="倉庫の履歴を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-8"],
    acceptance_criteria=["倉庫の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-105",
    text="車両の実績を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    refines=["FR-104"],
    evidence=["車両の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["車両の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-106",
    text="積載の予定をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-10"],
    acceptance_criteria=["積載の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-107",
    text="通関の明細を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-11"],
    acceptance_criteria=["通関の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-108",
    text="検品の残高を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-12"],
    evidence=["検品の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["検品の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-109",
    text="受注の区分を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-13"],
    acceptance_criteria=["受注の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-110",
    text="在庫の担当割当を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-14"],
    acceptance_criteria=["在庫の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-111",
    text="出荷の登録内容を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-15"],
    evidence=["出荷の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["出荷の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-112",
    text="配送の引当状況をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    refines=["FR-111"],
    acceptance_criteria=["配送の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-113",
    text="請求の進捗を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-17"],
    acceptance_criteria=["請求の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-114",
    text="返品の履歴を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-18"],
    evidence=["返品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["返品の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-115",
    text="与信の実績を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-19"],
    acceptance_criteria=["与信の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-116",
    text="倉庫の予定を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-20"],
    acceptance_criteria=["倉庫の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-117",
    text="車両の明細を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-21"],
    evidence=["車両の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["車両の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-118",
    text="積載の残高をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-22"],
    acceptance_criteria=["積載の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-119",
    text="通関の区分を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    refines=["FR-118"],
    acceptance_criteria=["通関の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-120",
    text="検品の担当割当を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-24"],
    evidence=["検品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["検品の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-121",
    text="受注の登録内容を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-1"],
    acceptance_criteria=["受注の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-122",
    text="在庫の引当状況を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-2"],
    acceptance_criteria=["在庫の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-123",
    text="出荷の進捗を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-3"],
    evidence=["出荷の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["出荷の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-124",
    text="配送の履歴をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-4"],
    acceptance_criteria=["配送の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-125",
    text="請求の実績を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-5"],
    acceptance_criteria=["請求の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-126",
    text="返品の予定を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    refines=["FR-125"],
    evidence=["返品の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["返品の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-127",
    text="与信の明細を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-7"],
    acceptance_criteria=["与信の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-128",
    text="倉庫の残高を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-8"],
    acceptance_criteria=["倉庫の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-129",
    text="車両の区分を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-9"],
    evidence=["車両の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["車両の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-130",
    text="積載の担当割当をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-10"],
    acceptance_criteria=["積載の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-131",
    text="通関の登録内容を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-11"],
    acceptance_criteria=["通関の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-132",
    text="検品の引当状況を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-12"],
    evidence=["検品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["検品の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-133",
    text="受注の進捗を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    refines=["FR-132"],
    acceptance_criteria=["受注の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-134",
    text="在庫の履歴を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-14"],
    acceptance_criteria=["在庫の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-135",
    text="出荷の実績を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-15"],
    evidence=["出荷の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["出荷の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-136",
    text="配送の予定をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-16"],
    acceptance_criteria=["配送の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-137",
    text="請求の明細を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-17"],
    acceptance_criteria=["請求の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-138",
    text="返品の残高を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-18"],
    evidence=["返品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["返品の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-139",
    text="与信の区分を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-19"],
    acceptance_criteria=["与信の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-140",
    text="倉庫の担当割当を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    refines=["FR-139"],
    acceptance_criteria=["倉庫の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-141",
    text="車両の登録内容を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-21"],
    evidence=["車両の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["車両の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-142",
    text="積載の引当状況をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-22"],
    acceptance_criteria=["積載の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-143",
    text="通関の進捗を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-23"],
    acceptance_criteria=["通関の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-144",
    text="検品の履歴を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-24"],
    evidence=["検品の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["検品の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-145",
    text="受注の実績を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-1"],
    acceptance_criteria=["受注の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-146",
    text="在庫の予定を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-2"],
    acceptance_criteria=["在庫の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-147",
    text="出荷の明細を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    refines=["FR-146"],
    evidence=["出荷の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["出荷の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-148",
    text="配送の残高をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-4"],
    acceptance_criteria=["配送の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-149",
    text="請求の区分を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-5"],
    acceptance_criteria=["請求の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-150",
    text="返品の担当割当を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-6"],
    evidence=["返品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["返品の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-151",
    text="与信の登録内容を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-7"],
    acceptance_criteria=["与信の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-152",
    text="倉庫の引当状況を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-8"],
    acceptance_criteria=["倉庫の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-153",
    text="車両の進捗を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-9"],
    evidence=["車両の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["車両の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-154",
    text="積載の履歴をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    refines=["FR-153"],
    acceptance_criteria=["積載の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-155",
    text="通関の実績を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-11"],
    acceptance_criteria=["通関の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-156",
    text="検品の予定を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-12"],
    evidence=["検品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["検品の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-157",
    text="受注の明細を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-13"],
    acceptance_criteria=["受注の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-158",
    text="在庫の残高を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-14"],
    acceptance_criteria=["在庫の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-159",
    text="出荷の区分を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-15"],
    evidence=["出荷の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["出荷の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-160",
    text="配送の担当割当をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-16"],
    acceptance_criteria=["配送の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-161",
    text="請求の登録内容を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    refines=["FR-160"],
    acceptance_criteria=["請求の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-162",
    text="返品の引当状況を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-18"],
    evidence=["返品の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["返品の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-163",
    text="与信の進捗を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-19"],
    acceptance_criteria=["与信の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-164",
    text="倉庫の履歴を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-20"],
    acceptance_criteria=["倉庫の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-165",
    text="車両の実績を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-21"],
    evidence=["車両の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["車両の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-166",
    text="積載の予定をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-22"],
    acceptance_criteria=["積載の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-167",
    text="通関の明細を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-23"],
    acceptance_criteria=["通関の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-168",
    text="検品の残高を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    refines=["FR-167"],
    evidence=["検品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["検品の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-169",
    text="受注の区分を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-1"],
    acceptance_criteria=["受注の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-170",
    text="在庫の担当割当を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-2"],
    acceptance_criteria=["在庫の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-171",
    text="出荷の登録内容を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-3"],
    evidence=["出荷の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["出荷の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-172",
    text="配送の引当状況をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-4"],
    acceptance_criteria=["配送の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-173",
    text="請求の進捗を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-5"],
    acceptance_criteria=["請求の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-174",
    text="返品の履歴を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-6"],
    evidence=["返品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["返品の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-175",
    text="与信の実績を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    refines=["FR-174"],
    acceptance_criteria=["与信の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-176",
    text="倉庫の予定を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-8"],
    acceptance_criteria=["倉庫の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-177",
    text="車両の明細を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-9"],
    evidence=["車両の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["車両の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-178",
    text="積載の残高をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-10"],
    acceptance_criteria=["積載の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-179",
    text="通関の区分を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-11"],
    acceptance_criteria=["通関の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-180",
    text="検品の担当割当を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-12"],
    evidence=["検品の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["検品の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-181",
    text="受注の登録内容を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-13"],
    acceptance_criteria=["受注の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-182",
    text="在庫の引当状況を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    refines=["FR-181"],
    acceptance_criteria=["在庫の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-183",
    text="出荷の進捗を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-15"],
    evidence=["出荷の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["出荷の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-184",
    text="配送の履歴をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-16"],
    acceptance_criteria=["配送の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-185",
    text="請求の実績を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-17"],
    acceptance_criteria=["請求の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-186",
    text="返品の予定を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-18"],
    evidence=["返品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["返品の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-187",
    text="与信の明細を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-19"],
    acceptance_criteria=["与信の明細が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-188",
    text="倉庫の残高を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-20"],
    acceptance_criteria=["倉庫の残高が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-189",
    text="車両の区分を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    refines=["FR-188"],
    evidence=["車両の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["車両の区分が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-190",
    text="積載の担当割当をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    satisfies=["N-22"],
    acceptance_criteria=["積載の担当割当が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-191",
    text="通関の登録内容を変更履歴として残すこと",
    status="implemented",
    has_source=["SRC-5"],
    satisfies=["N-23"],
    acceptance_criteria=["通関の登録内容が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-192",
    text="検品の引当状況を基幹システムへ連携すること",
    status="verified",
    has_source=["SRC-6"],
    satisfies=["N-24"],
    evidence=["検品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["検品の引当状況が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-193",
    text="受注の進捗を一覧画面に表示すること",
    status="approved",
    has_source=["SRC-1"],
    satisfies=["N-1"],
    acceptance_criteria=["受注の進捗が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-194",
    text="在庫の履歴を日次で集計すること",
    status="implemented",
    has_source=["SRC-2"],
    satisfies=["N-2"],
    acceptance_criteria=["在庫の履歴が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-195",
    text="出荷の実績を担当者に通知すること",
    status="verified",
    has_source=["SRC-3"],
    satisfies=["N-3"],
    evidence=["出荷の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["出荷の実績が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

FunctionalRequirement(
    id="FR-196",
    text="配送の予定をCSV として出力すること",
    status="approved",
    has_source=["SRC-4"],
    refines=["FR-195"],
    acceptance_criteria=["配送の予定が 3 秒以内に画面へ出る", "実行した担当者と日時が操作ログに残る"],
)

# --- 品質要求 ----------------------------------------------------------------------

QualityRequirement(
    id="QR-1",
    text="受注の登録内容の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-3"],
    qualifies=["FR-1"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-2",
    text="在庫の引当状況の表示を 2 秒以内に返すこと",
    status="approved",
    has_source=["SRC-4"],
    qualifies=["FR-5"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-3",
    text="出荷の進捗の表示を 2 秒以内に返すこと",
    status="implemented",
    has_source=["SRC-5"],
    qualifies=["FR-9"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-4",
    text="配送の履歴の表示を 2 秒以内に返すこと",
    status="verified",
    has_source=["SRC-6"],
    qualifies=["FR-13"],
    evidence=["配送の受入テスト第 4 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-5",
    text="請求の実績の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-1"],
    qualifies=["FR-17"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-6",
    text="返品の予定の表示を 2 秒以内に返すこと",
    status="approved",
    has_source=["SRC-2"],
    qualifies=["FR-21"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-7",
    text="与信の明細の表示を 2 秒以内に返すこと",
    status="implemented",
    has_source=["SRC-3"],
    qualifies=["FR-25"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-8",
    text="倉庫の残高の表示を 2 秒以内に返すこと",
    status="verified",
    has_source=["SRC-4"],
    qualifies=["FR-29"],
    evidence=["倉庫の受入テスト第 8 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-9",
    text="車両の区分の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-5"],
    qualifies=["FR-33"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-10",
    text="積載の担当割当の表示を 2 秒以内に返すこと",
    status="approved",
    has_source=["SRC-6"],
    qualifies=["FR-37"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-11",
    text="通関の登録内容の表示を 2 秒以内に返すこと",
    status="implemented",
    has_source=["SRC-1"],
    qualifies=["FR-41"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-12",
    text="検品の引当状況の表示を 2 秒以内に返すこと",
    status="verified",
    has_source=["SRC-2"],
    qualifies=["FR-45"],
    evidence=["検品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-13",
    text="受注の進捗の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-3"],
    qualifies=["FR-49"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-14",
    text="在庫の履歴の表示を 2 秒以内に返すこと",
    status="approved",
    has_source=["SRC-4"],
    qualifies=["FR-53"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-15",
    text="出荷の実績の表示を 2 秒以内に返すこと",
    status="implemented",
    has_source=["SRC-5"],
    qualifies=["FR-57"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-16",
    text="配送の予定の表示を 2 秒以内に返すこと",
    status="verified",
    has_source=["SRC-6"],
    qualifies=["FR-61"],
    evidence=["配送の受入テスト第 7 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-17",
    text="請求の明細の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-1"],
    qualifies=["FR-65"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-18",
    text="返品の残高の表示を 2 秒以内に返すこと",
    status="approved",
    has_source=["SRC-2"],
    qualifies=["FR-69"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-19",
    text="与信の区分の表示を 2 秒以内に返すこと",
    status="implemented",
    has_source=["SRC-3"],
    qualifies=["FR-73"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-20",
    text="倉庫の担当割当の表示を 2 秒以内に返すこと",
    status="verified",
    has_source=["SRC-4"],
    qualifies=["FR-77"],
    evidence=["倉庫の受入テスト第 2 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-21",
    text="車両の登録内容の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-5"],
    qualifies=["FR-81"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-22",
    text="積載の引当状況の表示を 2 秒以内に返すこと",
    status="approved",
    has_source=["SRC-6"],
    qualifies=["FR-85"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-23",
    text="通関の進捗の表示を 2 秒以内に返すこと",
    status="implemented",
    has_source=["SRC-1"],
    qualifies=["FR-89"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-24",
    text="検品の履歴の表示を 2 秒以内に返すこと",
    status="verified",
    has_source=["SRC-2"],
    qualifies=["FR-93"],
    evidence=["検品の受入テスト第 6 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-25",
    text="受注の実績の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-3"],
    qualifies=["FR-97"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-26",
    text="在庫の予定の表示を 2 秒以内に返すこと",
    status="approved",
    has_source=["SRC-4"],
    qualifies=["FR-101"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-27",
    text="出荷の明細の表示を 2 秒以内に返すこと",
    status="implemented",
    has_source=["SRC-5"],
    qualifies=["FR-105"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-28",
    text="配送の残高の表示を 2 秒以内に返すこと",
    status="verified",
    has_source=["SRC-6"],
    qualifies=["FR-109"],
    evidence=["配送の受入テスト第 1 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-29",
    text="請求の区分の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-1"],
    qualifies=["FR-113"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-30",
    text="返品の担当割当の表示を 2 秒以内に返すこと",
    status="approved",
    has_source=["SRC-2"],
    qualifies=["FR-117"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-31",
    text="与信の登録内容の表示を 2 秒以内に返すこと",
    status="implemented",
    has_source=["SRC-3"],
    qualifies=["FR-121"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-32",
    text="倉庫の引当状況の表示を 2 秒以内に返すこと",
    status="verified",
    has_source=["SRC-4"],
    qualifies=["FR-125"],
    evidence=["倉庫の受入テスト第 5 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-33",
    text="車両の進捗の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-5"],
    qualifies=["FR-129"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-34",
    text="積載の履歴の表示を 2 秒以内に返すこと",
    status="approved",
    has_source=["SRC-6"],
    qualifies=["FR-133"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-35",
    text="通関の実績の表示を 2 秒以内に返すこと",
    status="implemented",
    has_source=["SRC-1"],
    qualifies=["FR-137"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-36",
    text="検品の予定の表示を 2 秒以内に返すこと",
    status="verified",
    has_source=["SRC-2"],
    qualifies=["FR-141"],
    evidence=["検品の受入テスト第 9 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-37",
    text="受注の明細の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-3"],
    qualifies=["FR-145"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-38",
    text="在庫の残高の表示を 2 秒以内に返すこと",
    status="approved",
    has_source=["SRC-4"],
    qualifies=["FR-149"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-39",
    text="出荷の区分の表示を 2 秒以内に返すこと",
    status="implemented",
    has_source=["SRC-5"],
    qualifies=["FR-153"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-40",
    text="配送の担当割当の表示を 2 秒以内に返すこと",
    status="verified",
    has_source=["SRC-6"],
    qualifies=["FR-157"],
    evidence=["配送の受入テスト第 4 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-41",
    text="請求の登録内容の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-1"],
    qualifies=["FR-161"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-42",
    text="返品の引当状況の表示を 2 秒以内に返すこと",
    status="approved",
    has_source=["SRC-2"],
    qualifies=["FR-165"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-43",
    text="与信の進捗の表示を 2 秒以内に返すこと",
    status="implemented",
    has_source=["SRC-3"],
    qualifies=["FR-169"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-44",
    text="倉庫の履歴の表示を 2 秒以内に返すこと",
    status="verified",
    has_source=["SRC-4"],
    qualifies=["FR-173"],
    evidence=["倉庫の受入テスト第 8 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-45",
    text="車両の実績の表示を 2 秒以内に返すこと",
    status="proposed",
    has_source=["SRC-5"],
    qualifies=["FR-177"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-46",
    text="積載を含む全機能の稼働率を月間 99.9% 以上に保つこと",
    status="approved",
    has_source=["SRC-6"],
    qualifies=["SYS"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-47",
    text="通関を含む全機能の稼働率を月間 99.9% 以上に保つこと",
    status="implemented",
    has_source=["SRC-1"],
    qualifies=["SYS"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-48",
    text="検品を含む全機能の稼働率を月間 99.9% 以上に保つこと",
    status="verified",
    has_source=["SRC-2"],
    qualifies=["SYS"],
    evidence=["検品の受入テスト第 3 回で、全項目が合格している"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-49",
    text="受注を含む全機能の稼働率を月間 99.9% 以上に保つこと",
    status="proposed",
    has_source=["SRC-3"],
    qualifies=["SYS"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

QualityRequirement(
    id="QR-50",
    text="在庫を含む全機能の稼働率を月間 99.9% 以上に保つこと",
    status="approved",
    has_source=["SRC-4"],
    qualifies=["SYS"],
    acceptance_criteria=["連続 30 日の計測で、上限を超えた回数が 0 件である"],
)

# --- 制約 ------------------------------------------------------------------------

Constraint(
    id="C-1",
    text="受注の操作は社内ネットワークからのみ受け付けること",
    status="proposed",
    has_source=["SRC-5"],
    constrains=["FR-1"],
)

Constraint(
    id="C-2",
    text="在庫の操作は社内ネットワークからのみ受け付けること",
    status="approved",
    has_source=["SRC-6"],
    constrains=["FR-18"],
)

Constraint(
    id="C-3",
    text="出荷の操作は社内ネットワークからのみ受け付けること",
    status="proposed",
    has_source=["SRC-1"],
    constrains=["FR-35"],
)

Constraint(
    id="C-4",
    text="配送の操作は社内ネットワークからのみ受け付けること",
    status="approved",
    has_source=["SRC-2"],
    constrains=["FR-52"],
)

Constraint(
    id="C-5",
    text="請求の操作は社内ネットワークからのみ受け付けること",
    status="proposed",
    has_source=["SRC-3"],
    constrains=["FR-69"],
)

Constraint(
    id="C-6",
    text="返品の操作は社内ネットワークからのみ受け付けること",
    status="approved",
    has_source=["SRC-4"],
    constrains=["FR-86"],
)

Constraint(
    id="C-7",
    text="与信の操作は社内ネットワークからのみ受け付けること",
    status="proposed",
    has_source=["SRC-5"],
    constrains=["FR-103"],
)

Constraint(
    id="C-8",
    text="倉庫の操作は社内ネットワークからのみ受け付けること",
    status="approved",
    has_source=["SRC-6"],
    constrains=["FR-120"],
)

Constraint(
    id="C-9",
    text="車両の操作は社内ネットワークからのみ受け付けること",
    status="proposed",
    has_source=["SRC-1"],
    constrains=["FR-137"],
)

Constraint(
    id="C-10",
    text="積載の操作は社内ネットワークからのみ受け付けること",
    status="approved",
    has_source=["SRC-2"],
    constrains=["FR-154"],
)
