"""サンプル定義ファイル: 経費精算システム。

宣言のみで構成される。for / if / 関数定義 / 演算 / 属性アクセスは書けない
(層0 の AST 検査で機械的に弾かれる)。

参照はただの変数参照なので、参照されるノードを先に書く。前方参照したいときは
変数の代わりに id 文字列 ("N-1" など) を書いてもよい。
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

# --- 源泉 -------------------------------------------------------------------

src_finance_head = Source(
    id="SRC-CFO",
    text="経理部長",
    kind="stakeholder",
    status="approved",
)
src_employee = Source(
    id="SRC-EMP",
    text="申請者となる一般社員",
    kind="stakeholder",
    status="approved",
)
src_policy = Source(
    id="SRC-POLICY",
    text="経費精算規程 第4版",
    kind="document",
    status="approved",
)
src_legacy = Source(
    id="SRC-LEGACY",
    text="現行の表計算ファイルとメールによる精算運用",
    kind="existing_system",
    status="approved",
)

# 引用。part_of で親の源泉にぶら下げ、text には引用文そのものを書く。
# 同じ条文を複数の要求が根拠にできるので、「この規程のどこが使われているか」を
# 引用単位で数えられる。
src_policy_receipt = Source(
    id="SRC-POLICY-A12-3",
    text="1万円を超える支出には領収書の添付を要する",
    kind="document",
    locator="第12条第3項",
    part_of=[src_policy],
    status="approved",
)
src_policy_domestic = Source(
    id="SRC-POLICY-A20-1",
    text="経費に関する証憑は国内に保管しなければならない",
    kind="document",
    locator="第20条第1項",
    part_of=[src_policy],
    status="approved",
)
src_cfo_backlog = Source(
    id="SRC-CFO-HEARING-3",
    text="月末に承認待ちが溜まって、締めが 3 日ずれることがある",
    kind="stakeholder",
    locator="2026-03-12 第3回ヒアリング",
    part_of=[src_finance_head],
    status="approved",
)

# --- システム ---------------------------------------------------------------

system = System(id="SYS", text="経費精算システム", status="approved")

# --- ニーズ -----------------------------------------------------------------

need_photo_only = Need(
    id="N-1",
    text="申請者は、領収書を撮影するだけで経費を申請したい",
    status="approved",
    priority=1,
    has_source=[src_employee],
)
need_early_violation = Need(
    id="N-2",
    text="経理担当者は、規程に反する申請を差し戻す前に検知したい",
    status="approved",
    priority=2,
    has_source=[src_finance_head, src_policy_receipt],
)
need_notice_pending = Need(
    id="N-3",
    text="承認者は、自分が承認すべき申請にその日のうちに気づきたい",
    status="approved",
    priority=2,
    has_source=[src_cfo_backlog, src_legacy],
)

# --- ゴール -----------------------------------------------------------------

goal_halve_effort = Goal(
    id="G-1",
    text="経費精算にかかる全社の工数を半減する",
    status="approved",
    priority=1,
    decomposition="AND",
    has_source=[src_finance_head],
)
goal_less_input = Goal(
    id="G-2",
    text="申請 1 件あたりの入力の手間を減らす",
    status="approved",
    refines=[goal_halve_effort],
    motivates=[need_photo_only, need_early_violation],
    has_source=[src_finance_head],
)
goal_less_waiting = Goal(
    id="G-3",
    text="承認待ちによる滞留を減らす",
    status="approved",
    refines=[goal_halve_effort],
    motivates=[need_notice_pending],
    has_source=[src_finance_head],
)

# --- 機能要求 ---------------------------------------------------------------

fr_ocr = FunctionalRequirement(
    id="FR-1",
    text="領収書画像から金額と日付を抽出し、申請フォームの初期値として表示すること",
    status="approved",
    priority=1,
    satisfies=[need_photo_only],
    has_source=[src_employee],
    acceptance_criteria=[
        "社内で収集した領収書画像 200 枚に対し、金額の抽出正解率が 95% 以上である",
        "抽出に失敗した項目は空欄で表示され、申請者が手入力で上書きできる",
    ],
)
fr_short_form = FunctionalRequirement(
    id="FR-2",
    text="申請フォームの必須入力項目を 3 項目以下とすること",
    status="approved",
    priority=1,
    satisfies=[need_photo_only],
    has_source=[src_employee],
    acceptance_criteria=[
        "新規申請画面の必須項目数が 3 以下である",
    ],
)
fr_rule_check = FunctionalRequirement(
    id="FR-3",
    text="申請内容を経費精算規程の各ルールに照合し、違反項目を申請者に提示すること",
    status="approved",
    priority=1,
    satisfies=[need_early_violation],
    has_source=[src_policy_receipt],
    acceptance_criteria=[
        "規程 第4版 の上限額ルールに違反する申請では、違反したルール番号が表示される",
        "違反がある状態では申請を確定できない",
    ],
)
fr_notify = FunctionalRequirement(
    id="FR-4",
    text="承認待ちの申請が発生したことを承認者に通知すること",
    status="approved",
    priority=2,
    satisfies=[need_notice_pending],
    has_source=[src_legacy],
    acceptance_criteria=[
        "申請の確定から 10 分以内に、承認者へ通知が送信される",
    ],
)
fr_remind = FunctionalRequirement(
    id="FR-5",
    text="承認待ちのまま 24 時間を超えた申請を 1 日 1 回リマインドすること",
    status="proposed",
    priority=3,
    refines=[fr_notify],
    satisfies=[need_notice_pending],
    has_source=[src_legacy],
    acceptance_criteria=[
        "承認待ち 24 時間経過後、毎営業日 9 時にリマインドが送信される",
    ],
)
fr_autofill = FunctionalRequirement(
    id="FR-6",
    text=(
        "規程照合に要する項目を既定値から自動補完し、違反が検出された場合に限り"
        "申請者に追加入力を求めること"
    ),
    status="approved",
    priority=1,
    satisfies=[need_photo_only, need_early_violation],
    has_source=[src_employee, src_policy_receipt],
    acceptance_criteria=[
        "自動補完のあと、新規申請画面の必須項目数が 3 以下のままである",
        "違反が検出されない申請では、追加入力を求められない",
    ],
)

# --- 品質要求 ---------------------------------------------------------------

qr_ocr_latency = QualityRequirement(
    id="QR-1",
    text="領収書画像の送信から抽出結果の表示までを、95 パーセンタイルで 5 秒以内とすること",
    status="approved",
    priority=2,
    qualifies=[fr_ocr],
    has_source=[src_employee],
    acceptance_criteria=[
        "本番同等環境で 100 回計測し、95 パーセンタイル値が 5.0 秒以下である",
    ],
)
qr_availability = QualityRequirement(
    id="QR-2",
    text="システムの月間稼働率を 99.9% 以上とすること",
    status="approved",
    priority=2,
    qualifies=[system],
    has_source=[src_finance_head],
    acceptance_criteria=[
        "月次の稼働率レポートで 99.9% 以上を 3 か月連続で満たす",
    ],
)

# --- 制約 -------------------------------------------------------------------

constraint_region = Constraint(
    id="C-1",
    text="領収書画像は国内リージョンのストレージにのみ保存すること",
    status="approved",
    constrains=[fr_ocr, qr_ocr_latency],
    has_source=[src_policy_domestic],
)

