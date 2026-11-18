"""サンプル定義ファイル: 経費精算システム。

各ノード型の書き方の手本を兼ねる。どの型に書くかの判定と記述形式は
README の「どの型に書くか」を参照すること。

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
    Reference,
    RequirementGroup,
)

# --- 源泉 -------------------------------------------------------------------

SRC_FINANCE_HEAD = Reference(
    title="経理部長",
    note="組織内の利用背景であり、公開 URL はない。",
)
SRC_EMPLOYEE = Reference(
    title="申請者となる一般社員",
    note="組織内の利用背景であり、公開 URL はない。",
)
SRC_FINANCE_STAFF = Reference(
    title="申請 1 件ごとに規程の全項目を目視で確かめており、月末は点検だけで 1 日かかる",
    note="経理担当者への聞き取り。組織内の観測事実であり、公開 URL はない。",
)
SRC_MONTH_END_BACKLOG = Reference(
    title="月末に承認待ちが溜まって、締めが 3 日ずれることがある",
    note="組織内の観測事実であり、公開 URL はない。",
)
SRC_LEGACY = Reference(
    title="現行の表計算ファイルとメールによる精算運用",
    note="組織内の現行運用であり、公開 URL はない。",
)

# 引用や補足も Reference.note にまとめる。外部参照はグラフノードではなく、
# 要求ノードの source / realized_by / evidence フィールドに直接保持する。
SRC_POLICY_RECEIPT = Reference(
    title="1万円を超える支出には領収書の添付を要する",
    note="経費精算規程 第4版 第12条第3項。組織内規程のため、公開 URL はない。",
)

# 制約の源泉は、要求モデルの外から課される条件である。Constraint は Need を
# 満たすために置くものではないため、どこから課されたかを source で示す。
SRC_POLICY_DOMESTIC = Reference(
    title="経費に関する証憑は国内に保管しなければならない",
    note="情報セキュリティ規程。組織内規程のため、公開 URL はない。",
)
SRC_OCR_CONTRACT = Reference(
    title="OCR サービスの全社年間契約",
    note=(
        "情報システム部の調達方針により、契約期間中は他の OCR サービスを新たに"
        "調達しない。組織内の契約のため、公開 URL はない。"
    ),
)

EVIDENCE_OCR_LATENCY = Reference(
    title="OCR 応答時間の計測結果",
    url="https://example.com/tests/performance/ocr-latency",
    note="2026-02-20 に本番同等環境で 100 回計測し、95 パーセンタイル値は 4.2 秒だった",
)

# --- ニーズ -----------------------------------------------------------------
# 主語に役割を書き、「〜たい」で終える。解決策の語 (画面・通知など) は書かない。

NEED_PHOTO_ONLY = Need(
    id="Need-1",
    text="申請者は、領収書を撮影するだけで経費を申請したい",
    source=[SRC_EMPLOYEE],
)
NEED_EARLY_VIOLATION = Need(
    id="Need-2",
    text="申請者は、規程に反していることを、申請を出す時点で知りたい",
    source=[SRC_EMPLOYEE, SRC_LEGACY],
)
NEED_FOCUSED_REVIEW = Need(
    id="Need-3",
    text="経理担当者は、規程違反の疑いがある申請だけを重点的に点検したい",
    source=[SRC_FINANCE_STAFF],
)
NEED_NOTICE_PENDING = Need(
    id="Need-4",
    text="承認者は、自分が承認すべき申請にその日のうちに気づきたい",
    source=[SRC_MONTH_END_BACKLOG, SRC_LEGACY],
)

# --- ゴール -----------------------------------------------------------------
# 主語を書かず、解決策が無くても成り立つ世界の側の変化を書く。
# 工数 (人の手間) と日数 (待ち時間) は別の量なので、別の木に分ける。

GOAL_HALVE_EFFORT = Goal(
    id="Goal-1",
    text="経費精算にかかる全社の工数を半減する",
    source=[SRC_FINANCE_HEAD],
)
GOAL_LESS_INPUT = Goal(
    id="Goal-2",
    text="申請者が申請 1 件の作成にかける時間を減らす",
    refines=[GOAL_HALVE_EFFORT],
    motivates=[NEED_PHOTO_ONLY, NEED_EARLY_VIOLATION],
    source=[SRC_FINANCE_HEAD],
)
GOAL_LESS_REVIEW = Goal(
    id="Goal-3",
    text="経理担当者が申請 1 件の点検にかける時間を減らす",
    refines=[GOAL_HALVE_EFFORT],
    motivates=[NEED_FOCUSED_REVIEW],
    source=[SRC_FINANCE_HEAD],
)
GOAL_SHORTER_LEAD_TIME = Goal(
    id="Goal-4",
    text="申請から精算完了までの日数を短縮する",
    motivates=[NEED_NOTICE_PENDING],
    source=[SRC_FINANCE_HEAD, SRC_MONTH_END_BACKLOG],
)

# --- 機能要求 ---------------------------------------------------------------
# システムの振る舞いを 1 つ、「〜こと」で書く。程度 (数値) は QR に分ける。
# 受け入れ基準には、本文を満たしたかを判定できる観測可能な条件だけを書く。

FR_OCR = FunctionalRequirement(
    id="FR-1",
    text="領収書画像から金額と日付を読み取り、入力済みの状態で申請フォームに表示すること",
    satisfies=[NEED_PHOTO_ONLY],
    source=[SRC_EMPLOYEE],
    acceptance_criteria=[
        "読み取れなかった項目は空欄で表示される",
        "表示された金額と日付を、申請者が申請の確定前に修正できる",
    ],
)
FR_RULE_CHECK = FunctionalRequirement(
    id="FR-2",
    text=(
        "申請の確定時に申請内容を経費精算規程の各ルールと照合し、"
        "違反したルールを申請者に示すこと"
    ),
    satisfies=[NEED_EARLY_VIOLATION],
    source=[SRC_POLICY_RECEIPT],
    acceptance_criteria=[
        "1 万円を超える支出に領収書が添付されていない申請では、違反したルールの条番号が表示される",
        "違反がある申請を確定するには、申請者が理由を入力する必要がある",
    ],
)
FR_REVIEW_FILTER = FunctionalRequirement(
    id="FR-3",
    text="経理担当者の申請一覧で、規程照合で違反が見つかった申請だけを絞り込めること",
    satisfies=[NEED_FOCUSED_REVIEW],
    source=[SRC_FINANCE_STAFF],
    acceptance_criteria=[
        "絞り込んだ一覧には、違反したルールと申請者が入力した理由が表示される",
        "違反の無い申請は、絞り込んだ一覧に現れない",
    ],
)
FR_NOTIFY = FunctionalRequirement(
    id="FR-4",
    text="申請が承認待ちになったとき、承認者に通知すること",
    satisfies=[NEED_NOTICE_PENDING],
    source=[SRC_MONTH_END_BACKLOG],
    acceptance_criteria=[
        "申請の確定から 10 分以内に、承認者へ通知が届く",
    ],
)
FR_REMIND = FunctionalRequirement(
    id="FR-5",
    text="承認待ちのまま 24 時間を過ぎた申請を、毎営業日 1 回承認者にリマインドすること",
    refines=[FR_NOTIFY],
    satisfies=[NEED_NOTICE_PENDING],
    source=[SRC_MONTH_END_BACKLOG],
    acceptance_criteria=[
        "リマインドは毎営業日 9 時に送信される",
        "承認または差し戻しが済んだ申請は、以後リマインドされない",
    ],
)

# --- 品質要求 ---------------------------------------------------------------
# 既存の FR の程度を、測定値と測定条件つきで書く。新しい振る舞いは書かない。

QR_OCR_LATENCY = QualityRequirement(
    id="QR-1",
    text="領収書画像の送信から読み取り結果の表示までを、95 パーセンタイルで 5 秒以内とすること",
    qualifies=[FR_OCR],
    source=[SRC_EMPLOYEE],
    evidence=[EVIDENCE_OCR_LATENCY],
    acceptance_criteria=[
        "本番同等環境で 100 回計測し、95 パーセンタイル値が 5.0 秒以下である",
    ],
)
QR_OCR_ACCURACY = QualityRequirement(
    id="QR-2",
    text="領収書画像からの金額の読み取り正解率を 95% 以上とすること",
    qualifies=[FR_OCR],
    source=[SRC_FINANCE_HEAD],
    acceptance_criteria=[
        "社内で収集した領収書画像 200 枚で、金額の読み取り正解率が 95% 以上である",
    ],
)

# --- 制約 -------------------------------------------------------------------
# 理由がモデル内の Need から辿れない、外から課された条件を書く。
# 禁止形 (〜しないこと)・限定形 (〜にのみ〜こと)・指定形 (〜を用いること) で書き、
# 能力 (〜できるようにすること) は書かない。

CONSTRAINT_REGION = Constraint(
    id="Constraint-1",
    text="領収書画像を国内リージョンのストレージにのみ保存すること",
    constrains=[FR_OCR, QR_OCR_LATENCY],
    source=[SRC_POLICY_DOMESTIC],
)
CONSTRAINT_OCR_SERVICE = Constraint(
    id="Constraint-2",
    text="領収書の読み取りに、会社が契約済みの OCR サービスを用いること",
    constrains=[FR_OCR, QR_OCR_LATENCY, QR_OCR_ACCURACY],
    source=[SRC_OCR_CONTRACT],
)


# --- 表示グループ -----------------------------------------------------------

GROUP_CAPTURE = RequirementGroup(
    id="capture",
    label="領収書入力",
    order=10,
    members=[
        FR_OCR,
        QR_OCR_LATENCY,
        QR_OCR_ACCURACY,
        CONSTRAINT_REGION,
        CONSTRAINT_OCR_SERVICE,
    ],
)
GROUP_POLICY = RequirementGroup(
    id="policy",
    label="規程照合",
    order=20,
    members=[FR_RULE_CHECK, FR_REVIEW_FILTER],
)
GROUP_APPROVAL = RequirementGroup(
    id="approval",
    label="承認通知",
    order=30,
    members=[FR_NOTIFY, FR_REMIND],
)
