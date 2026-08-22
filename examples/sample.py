"""サンプル定義ファイル: 経費精算システム。

宣言のみで構成される。for / if / 関数定義 / 演算 / 属性アクセスは書けない
(層0 の AST 検査で機械的に弾かれる)。

参照はただの変数参照なので、参照されるノードを先に書く。前方参照したいときは
変数の代わりに id 文字列 ("Need-1" など) を書いてもよい。
"""

from reqmodel import (
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    QualityRequirement,
    RequirementGroup,
    Reference,
)

# --- 源泉 -------------------------------------------------------------------

SRC_FINANCE_HEAD = Reference(
    title="経理部長",
    url="https://github.com/tosi29/requirement-model/issues/123#SRC_FINANCE_HEAD",
)
SRC_EMPLOYEE = Reference(
    title="申請者となる一般社員",
    url="https://github.com/tosi29/requirement-model/issues/123#SRC_EMPLOYEE",
)
SRC_POLICY = Reference(
    title="経費精算規程 第4版",
    url="https://github.com/tosi29/requirement-model/issues/123#SRC_POLICY",
)
SRC_LEGACY = Reference(
    title="現行の表計算ファイルとメールによる精算運用",
    url="https://github.com/tosi29/requirement-model/issues/123#SRC_LEGACY",
)

# 引用や補足も Reference.note にまとめる。外部参照はグラフノードではなく、
# 要求ノードの source / realized_by / evidence フィールドに直接保持する。
SRC_POLICY_RECEIPT = Reference(
    title="1万円を超える支出には領収書の添付を要する",
    url="https://github.com/tosi29/requirement-model/issues/123#SRC_POLICY_RECEIPT",
    note="外部参照の補足",
)
SRC_POLICY_DOMESTIC = Reference(
    title="経費に関する証憑は国内に保管しなければならない",
    url="https://github.com/tosi29/requirement-model/issues/123#SRC_POLICY_DOMESTIC",
    note="外部参照の補足",
)
SRC_CFO_BACKLOG = Reference(
    title="月末に承認待ちが溜まって、締めが 3 日ずれることがある",
    url="https://github.com/tosi29/requirement-model/issues/123#SRC_CFO_BACKLOG",
    note="外部参照の補足",
)

# --- システム ---------------------------------------------------------------

# --- ニーズ -----------------------------------------------------------------

NEED_PHOTO_ONLY = Need(
    id="Need-1",
    text="申請者は、領収書を撮影するだけで経費を申請したい",
    source=[SRC_EMPLOYEE],
)
NEED_EARLY_VIOLATION = Need(
    id="Need-2",
    text="経理担当者は、規程に反する申請を差し戻す前に検知したい",
    source=[SRC_FINANCE_HEAD, SRC_POLICY_RECEIPT],
)
NEED_NOTICE_PENDING = Need(
    id="Need-3",
    text="承認者は、自分が承認すべき申請にその日のうちに気づきたい",
    source=[SRC_CFO_BACKLOG, SRC_LEGACY],
)

# --- ゴール -----------------------------------------------------------------

GOAL_HALVE_EFFORT = Goal(
    id="Goal-1",
    text="経費精算にかかる全社の工数を半減する",
    source=[SRC_FINANCE_HEAD],
)
GOAL_LESS_INPUT = Goal(
    id="Goal-2",
    text="申請 1 件あたりの入力の手間を減らす",
    refines=[GOAL_HALVE_EFFORT],
    motivates=[NEED_PHOTO_ONLY, NEED_EARLY_VIOLATION],
    source=[SRC_FINANCE_HEAD],
)
GOAL_LESS_WAITING = Goal(
    id="Goal-3",
    text="承認待ちによる滞留を減らす",
    refines=[GOAL_HALVE_EFFORT],
    motivates=[NEED_NOTICE_PENDING],
    source=[SRC_FINANCE_HEAD],
)

# --- 機能要求 ---------------------------------------------------------------

FR_OCR = FunctionalRequirement(
    id="FR-1",
    text="領収書画像から金額と日付を抽出し、申請フォームの初期値として表示すること",
    satisfies=[NEED_PHOTO_ONLY],
    source=[SRC_EMPLOYEE],
    acceptance_criteria=[
        "社内で収集した領収書画像 200 枚に対し、金額の抽出正解率が 95% 以上である",
        "抽出に失敗した項目は空欄で表示され、申請者が手入力で上書きできる",
    ],
)
FR_SHORT_FORM = FunctionalRequirement(
    id="FR-2",
    text="申請フォームの必須入力項目を 3 項目以下とすること",
    satisfies=[NEED_PHOTO_ONLY],
    source=[SRC_EMPLOYEE],
    evidence=[
        "受入テスト第 3 回 (2026-02-18) で新規申請画面の必須項目を数え、3 項目だった",
    ],
    acceptance_criteria=[
        "新規申請画面の必須項目数が 3 以下である",
    ],
)
FR_RULE_CHECK = FunctionalRequirement(
    id="FR-3",
    text="申請内容を経費精算規程の各ルールに照合し、違反項目を申請者に提示すること",
    satisfies=[NEED_EARLY_VIOLATION],
    source=[SRC_POLICY_RECEIPT],
    acceptance_criteria=[
        "規程 第4版 の上限額ルールに違反する申請では、違反したルール番号が表示される",
        "違反がある状態では申請を確定できない",
    ],
)
FR_NOTIFY = FunctionalRequirement(
    id="FR-4",
    text="承認待ちの申請が発生したことを承認者に通知すること",
    satisfies=[NEED_NOTICE_PENDING],
    source=[SRC_LEGACY],
    acceptance_criteria=[
        "申請の確定から 10 分以内に、承認者へ通知が送信される",
    ],
)
FR_REMIND = FunctionalRequirement(
    id="FR-5",
    text="承認待ちのまま 24 時間を超えた申請を 1 日 1 回リマインドすること",
    refines=[FR_NOTIFY],
    satisfies=[NEED_NOTICE_PENDING],
    source=[SRC_LEGACY],
    acceptance_criteria=[
        "承認待ち 24 時間経過後、毎営業日 9 時にリマインドが送信される",
    ],
)
FR_AUTOFILL = FunctionalRequirement(
    id="FR-6",
    text=(
        "規程照合に要する項目を既定値から自動補完し、違反が検出された場合に限り"
        "申請者に追加入力を求めること"
    ),
    satisfies=[NEED_PHOTO_ONLY, NEED_EARLY_VIOLATION],
    source=[SRC_EMPLOYEE, SRC_POLICY_RECEIPT],
    acceptance_criteria=[
        "自動補完のあと、新規申請画面の必須項目数が 3 以下のままである",
        "違反が検出されない申請では、追加入力を求められない",
    ],
)

# --- 品質要求 ---------------------------------------------------------------

QR_OCR_LATENCY = QualityRequirement(
    id="QR-1",
    text="領収書画像の送信から抽出結果の表示までを、95 パーセンタイルで 5 秒以内とすること",
    qualifies=[FR_OCR],
    source=[SRC_EMPLOYEE],
    evidence=[
        "本番同等環境で 100 回計測し (2026-02-20)、95 パーセンタイル値は 4.2 秒だった",
    ],
    acceptance_criteria=[
        "本番同等環境で 100 回計測し、95 パーセンタイル値が 5.0 秒以下である",
    ],
)

# --- 制約 -------------------------------------------------------------------

CONSTRAINT_REGION = Constraint(
    id="Constraint-1",
    text="領収書画像は国内リージョンのストレージにのみ保存すること",
    constrains=[FR_OCR, QR_OCR_LATENCY],
    source=[SRC_POLICY_DOMESTIC],
)



# --- 表示グループ -----------------------------------------------------------

GROUP_CAPTURE = RequirementGroup(
    id="capture",
    label="領収書入力",
    order=10,
    members=[FR_OCR, FR_SHORT_FORM, FR_AUTOFILL, QR_OCR_LATENCY, CONSTRAINT_REGION],
)
GROUP_APPROVAL = RequirementGroup(
    id="approval",
    label="承認通知",
    order=20,
    members=[FR_NOTIFY, FR_REMIND],
)
GROUP_POLICY = RequirementGroup(
    id="policy",
    label="規程照合",
    order=30,
    members=[FR_RULE_CHECK],
)
