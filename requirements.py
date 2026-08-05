"""このリポジトリ自身の要求モデル (dogfooding)。

reqmodel は要求管理ツールでありながら、自分の要求だけは要求管理されていなかった。
このファイルはその穴を埋めるもので、`req validate --strict` を自分自身に通すことで
ツールの実用性を実地で検証する役目も持つ。

`loader.DEFAULT_PATHS` がルートの `requirements.py` を見るので、リポジトリ内では
引数なしの `req validate` がそのままこのモデルを読む。

対象は「実装済みの機能」と「開いている issue」の両方である。未着手のものは
status="proposed" で置き、対応する issue 番号を各ノードの直前のコメントに書く。
コメントはモデルに入らない (機械が辿れない) が、外部の課題管理への参照を持つ場は
今のメタモデルに無く、issue ごとに Source を作るのは意味的に歪むため、
現時点ではこの形にしてある。
"""

from reqmodel import (
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    QualityRequirement,
    RequirementGroup,
    Source,
)

# --- 源泉 -------------------------------------------------------------------

SRC_OWNER = Source(
    id="SRC-OWNER",
    text="このツールの作者であり、最初の利用者でもあるリポジトリオーナー",
    kind="stakeholder",
    status="approved",
)
SRC_SPEC = Source(
    id="SRC-SPEC",
    text="初回の実装指示書 (issue #1)",
    kind="document",
    status="approved",
)
SRC_IREB = Source(
    id="SRC-IREB",
    text="IREB (CPRE) の要求工学用語体系",
    kind="document",
    status="approved",
)
SRC_INCOSE = Source(
    id="SRC-INCOSE",
    text="INCOSE による Need と Requirement の区別",
    kind="document",
    status="approved",
)
SRC_LEGACY = Source(
    id="SRC-LEGACY",
    text="要求を Markdown 文書と表計算ソフトで管理する現行の運用",
    kind="existing_system",
    status="approved",
)
SRC_BENCH = Source(
    id="SRC-BENCH",
    text="300 ノードの合成モデル (examples/bench.py) による実測結果",
    kind="document",
    status="approved",
)

# --- ニーズ -----------------------------------------------------------------

NEED_SELF_CHECK = Need(
    id="Need-1",
    text="要求を書く人は、書き方の誤りをレビュー会の前に自分で見つけたい",
    status="approved",
    has_source=[SRC_OWNER, SRC_LEGACY],
)
NEED_NO_DANGLING = Need(
    id="Need-2",
    text="要求をレビューする人は、どこにも繋がっていない要求が残っていないかを知りたい",
    status="approved",
    has_source=[SRC_OWNER, SRC_IREB],
)
NEED_IMPACT = Need(
    id="Need-3",
    text="要求を変更する人は、その変更がどこまで波及するのかを変更前に把握したい",
    status="approved",
    has_source=[SRC_OWNER, SRC_LEGACY],
)
NEED_REVIEW_DIFF = Need(
    id="Need-4",
    text="変更を審査する人は、差分から要求グラフの何が変わったのかを読み取りたい",
    status="approved",
    has_source=[SRC_OWNER],
)
NEED_LLM_CONTEXT = Need(
    id="Need-5",
    text="要求の判断を LLM に委ねる人は、判断に要る文脈を欠けなく渡したい",
    status="approved",
    has_source=[SRC_SPEC, SRC_OWNER],
)
NEED_READABLE = Need(
    id="Need-6",
    text="要求を読む関係者は、ツールを入れずに要求の全体像と個々のトレースを見たい",
    status="approved",
    has_source=[SRC_LEGACY],
)
NEED_METRICS = Need(
    id="Need-7",
    text="要求を管理する人は、モデル全体の充足率と成熟度の分布を数値で把握したい",
    status="approved",
    has_source=[SRC_OWNER],
)
NEED_CI = Need(
    id="Need-8",
    text="CI を回す人は、既知で意図的な指摘を残したまま、新しい指摘だけで失敗させたい",
    status="approved",
    has_source=[SRC_OWNER],
)

# --- ゴール -----------------------------------------------------------------

GOAL_LESS_REWORK = Goal(
    id="Goal-1",
    text="要求の不備が後工程で見つかることによる手戻りを減らす",
    status="approved",
    motivates=[NEED_SELF_CHECK, NEED_NO_DANGLING, NEED_CI],
    has_source=[SRC_SPEC, SRC_OWNER, SRC_LEGACY],
)
GOAL_LESS_SURVEY = Goal(
    id="Goal-2",
    text="要求を変えるたびに繰り返される影響調査の負荷を減らす",
    status="approved",
    motivates=[NEED_IMPACT, NEED_REVIEW_DIFF],
    has_source=[SRC_SPEC, SRC_LEGACY],
)
GOAL_SHARED_UNDERSTANDING = Goal(
    id="Goal-3",
    text="要求の理解が書き手に依存する度合いを下げる",
    status="approved",
    motivates=[NEED_LLM_CONTEXT, NEED_READABLE, NEED_METRICS],
    has_source=[SRC_SPEC, SRC_OWNER, SRC_LEGACY],
)

# --- 機能要求: 検証 (層0〜層3) -----------------------------------------------

FR_AST_ONLY = FunctionalRequirement(
    id="FR-1",
    text="定義ファイルを実行せず、AST からノード集合を復元すること",
    status="implemented",
    satisfies=[NEED_SELF_CHECK],
    has_source=[SRC_SPEC],
    acceptance_criteria=[
        "for 文・if 文・関数定義を含む定義ファイルは declarative.forbidden として報告される",
        "ノードの復元に exec と eval のどちらも用いない",
    ],
)
FR_SYNTAX = FunctionalRequirement(
    id="FR-2",
    text="ノードの必須属性・id の重複・語尾規則の違反を、定義した行番号とともに報告すること",
    status="implemented",
    satisfies=[NEED_SELF_CHECK],
    has_source=[SRC_SPEC, SRC_IREB],
    acceptance_criteria=[
        "「〜たい」で終わらない Need の text は syntax.invalid_field として報告される",
        "報告には定義ファイルのパスと行番号が付く",
    ],
)
FR_EDGE_RULES = FunctionalRequirement(
    id="FR-3",
    text=(
        "型規則に違反するエッジ・参照切れ・階層エッジ (refines / part_of) の閉路を"
        "error として報告すること"
    ),
    status="implemented",
    satisfies=[NEED_NO_DANGLING],
    has_source=[SRC_SPEC, SRC_IREB],
    acceptance_criteria=[
        "Constraint から Goal へ張ったエッジは structure.edge_type として報告される",
        "存在しない id への参照は structure.dangling_ref として報告される",
        "refines と part_of の閉路は、それぞれ専用のコードで error として報告される",
    ],
)
FR_ORPHAN = FunctionalRequirement(
    id="FR-4",
    text=(
        "どの Goal にも到達できない FR・satisfies されない Need・"
        "張り先の無い QR を warning として報告すること"
    ),
    status="implemented",
    satisfies=[NEED_NO_DANGLING],
    has_source=[SRC_SPEC, SRC_INCOSE],
    acceptance_criteria=[
        "Goal に到達できない FR は structure.orphan_fr として報告される",
        "孤立は FR と QR で別のコードとして報告される",
    ],
)
FR_LEXICON = FunctionalRequirement(
    id="FR-5",
    text="辞書に載っている曖昧語を含む本文を warning として報告すること",
    status="implemented",
    satisfies=[NEED_SELF_CHECK],
    has_source=[SRC_SPEC],
    acceptance_criteria=[
        "「高速に」を含む text は semantics.ambiguous_term として報告される",
        "報告には、その語をどう書き換えるかの助言が付く",
    ],
    suppress=[
        (
            "semantics.ambiguous_term",
            "曖昧語検査そのものの受け入れ基準であり、検出例として辞書の語を引用している。"
            "辞書は語の使用と言及を区別しないため、この指摘は当たらない",
        ),
    ],
)
FR_WAIVER = FunctionalRequirement(
    id="FR-6",
    text=(
        "ノード属性 suppress に書いた (チェックコード, 理由) の組で、"
        "そのノードに出る当該コードの指摘だけを抑制すること"
    ),
    status="implemented",
    satisfies=[NEED_CI],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "理由の無い抑制は層1 のエラーになる",
        "error の抑制は層1 のエラーになる",
        "対象の指摘が出ていない抑制は waiver.stale として報告される",
        "抑制した件数はサマリに残り、--show-suppressed で理由まで読める",
    ],
)
FR_EXIT_CODE = FunctionalRequirement(
    id="FR-7",
    text="指摘の重大度に応じた終了コードを返し、CI にそのまま置けるようにすること",
    status="implemented",
    satisfies=[NEED_CI],
    has_source=[SRC_SPEC],
    acceptance_criteria=[
        "error が 1 件でもあれば終了コードは 1 になる",
        "--strict では warning と severe でも終了コードは 1 になる",
        "定義ファイルが見つからない場合の終了コードは 2 になる",
    ],
)

# --- 機能要求: 影響分析と LLM 連携 -------------------------------------------

FR_IMPACT = FunctionalRequirement(
    id="FR-8",
    text="指定したノードの上流と下流を辿り、影響部分グラフを抽出すること",
    status="implemented",
    satisfies=[NEED_IMPACT],
    has_source=[SRC_SPEC],
    acceptance_criteria=[
        "辿るエッジ種別を --edges で限定できる",
        "探索の深さを --depth で打ち切れる",
        "--undirected でエッジの向きを無視して辿れる",
    ],
)
FR_EXPLAIN = FunctionalRequirement(
    id="FR-9",
    text="影響部分グラフの本文と根拠を、LLM に渡せる書式に整形して出力すること",
    status="implemented",
    refines=[FR_IMPACT],
    satisfies=[NEED_LLM_CONTEXT],
    has_source=[SRC_SPEC, SRC_OWNER],
    acceptance_criteria=[
        "出力には各ノードの text と evidence が含まれる",
        "--json で機械可読な形でも出せる",
    ],
)
FR_PLAN = FunctionalRequirement(
    id="FR-10",
    text=(
        "git の前版の定義ファイルを読み、ノード単位とフィールド単位の構造差分と、"
        "変更されたノードの影響範囲を出すこと"
    ),
    status="implemented",
    satisfies=[NEED_REVIEW_DIFF],
    has_source=[SRC_SPEC],
    acceptance_criteria=[
        "定義の並べ替えだけの変更は差分として出ない (出所は比較対象に含めない)",
        "比較先のリビジョンを --rev で指定できる",
    ],
)

# --- 機能要求: 出力と閲覧 ----------------------------------------------------

FR_DOC = FunctionalRequirement(
    id="FR-11",
    text="モデルから仕様書とトレーサビリティ表を生成すること",
    status="implemented",
    satisfies=[NEED_READABLE],
    has_source=[SRC_LEGACY],
    acceptance_criteria=[
        "仕様書は 5 節構成で、どのノードも必ずいずれかの節に現れる",
        "トレーサビリティ表はエッジ型ごとに 1 枚出て、トレースの無い行と列を併記する",
        "表は Markdown と CSV の両方で出せる",
    ],
)
FR_SITE = FunctionalRequirement(
    id="FR-12",
    text="外部の実行環境を要さない 1 枚の HTML として、閲覧用サイトを生成すること",
    status="implemented",
    satisfies=[NEED_READABLE],
    has_source=[SRC_OWNER, SRC_LEGACY],
    acceptance_criteria=[
        "生成物を静的ファイルとして配るだけでブラウザから閲覧できる",
        "ノードを選ぶと影響範囲が色分けされ、指摘の一覧から該当ノードへ飛べる",
        "RequirementGroup とグループ内ノードは、表示幅に合わせて折り返される",
    ],
)
FR_FIT_WHOLE = FunctionalRequirement(
    id="FR-13",
    text=(
        "図の初期表示でグラフ全体を 1 画面に収め、この表示は俯瞰の用途に限ること"
    ),
    status="implemented",
    refines=[FR_SITE],
    satisfies=[NEED_READABLE],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "読み込み直後の倍率は、全ノードが表示領域に入る値になる",
    ],
)
FR_TABLE = FunctionalRequirement(
    id="FR-14",
    text=(
        "閲覧用サイトに表形式の一覧を設け、列見出しで並べ替えられるようにし、"
        "同値の行の並びを安定させること"
    ),
    status="implemented",
    refines=[FR_SITE],
    satisfies=[NEED_READABLE],
    has_source=[SRC_LEGACY],
    acceptance_criteria=[
        "同値の行は正規化 JSON の並び (型順 → id 順) で決まり、押すたびに入れ替わらない",
        "値の無い行は昇順でも降順でも末尾に置かれる",
    ],
    suppress=[
        (
            "semantics.ambiguous_term",
            "「安定」はソートの安定性を指す技術用語で、可用性の指標に置き換える助言は"
            "当たらない。プロジェクト固有語を辞書から外せるようになれば解消する (#7)",
        ),
    ],
)
FR_PERMALINK = FunctionalRequirement(
    id="FR-15",
    text="選択したノードと表示の絞り込みを URL に載せ、同じ画面を相手にも出せるようにすること",
    status="implemented",
    refines=[FR_SITE],
    satisfies=[NEED_READABLE],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "既定値のままの項目は URL に書かれない",
        "解釈できない値は黙って捨て、読み込み後の URL は解釈できた形に直る",
    ],
)
FR_STATS = FunctionalRequirement(
    id="FR-16",
    text="ノード数・エッジ数・充足率・曖昧語密度を数え、判定を伴わない形で出すこと",
    status="implemented",
    satisfies=[NEED_METRICS],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "閾値を持たず、終了コードは常に 0 になる",
        "率が 100% に満たない行には未達のノード id が並ぶ",
        "母数が 0 のときの率は - (JSON では null) になる",
    ],
)
FR_EXPORT = FunctionalRequirement(
    id="FR-17",
    text="正規化 JSON と Mermaid / DOT の図を出力すること",
    status="implemented",
    satisfies=[NEED_READABLE],
    has_source=[SRC_SPEC],
    acceptance_criteria=[
        "正規化 JSON の各ノードに定義位置 (file:line) が入る",
        "Mermaid はそのまま Markdown に貼れる",
    ],
)

# --- 機能要求: 未着手 (対応する issue はノード直前のコメントを参照) ----------

# → issue #6
FR_PLAN_MARKDOWN = FunctionalRequirement(
    id="FR-18",
    text="構造差分を Markdown で出力し、PR コメントに貼れる形にすること",
    status="proposed",
    refines=[FR_PLAN],
    satisfies=[NEED_REVIEW_DIFF],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "出力は GitHub の Markdown としてそのまま読める",
        "差分が無いときは、差分が無いことが 1 行で分かる",
    ],
)
# → issue #7
FR_CONFIG = FunctionalRequirement(
    id="FR-19",
    text="プロジェクト固有の曖昧語と、検査ごとの有効・無効を設定ファイルで宣言できるようにすること",
    status="proposed",
    satisfies=[NEED_SELF_CHECK],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "設定ファイルに書いた語が曖昧語として報告される",
        "設定ファイルから外した語は報告されなくなる",
        "設定ファイルが無くても既定の辞書で動く",
    ],
)
# → issue #10
FR_MCP = FunctionalRequirement(
    id="FR-20",
    text="MCP サーバとして validate / explain / impact を公開すること",
    status="proposed",
    satisfies=[NEED_LLM_CONTEXT],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "MCP クライアントから 3 つの操作を呼び出せる",
        "返す内容は同名の CLI の --json 出力と一致する",
    ],
)
# → issue #13
FR_MORE_CHECKS = FunctionalRequirement(
    id="FR-21",
    text="測定不能な QR・status の後退・id の命名規則違反を検査すること",
    status="proposed",
    satisfies=[NEED_NO_DANGLING],
    has_source=[SRC_OWNER, SRC_IREB],
    acceptance_criteria=[
        "数値を含まない QR の text が報告される",
        "追加する検査はいずれもチェックコードを持ち、抑制の可否が定義されている",
    ],
)
# → issue #14
FR_SARIF = FunctionalRequirement(
    id="FR-22",
    text="指摘を SARIF 形式で出力し、GitHub Code Scanning に載せられるようにすること",
    status="proposed",
    satisfies=[NEED_CI],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "出力は SARIF 2.1.0 のスキーマに適合する",
        "指摘がファイルと行に紐づき、PR の差分上に表示される",
    ],
)
# → issue #24
FR_SVG = FunctionalRequirement(
    id="FR-23",
    text="Graphviz のレイアウトを用いて SVG の図を書き出すこと",
    status="proposed",
    satisfies=[NEED_READABLE],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "Graphviz が入っていない環境では、その旨を伝えて終了コード 2 で終わる",
    ],
)
FR_ID_COLLISION = FunctionalRequirement(
    id="FR-24",
    text="記号だけが異なる id を持つノードを、図の上でも別のノードとして描き分けること",
    status="implemented",
    satisfies=[NEED_READABLE],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "FR.1 と FR-1 を含むモデルの Mermaid 出力に、2 つのノードが別々に現れる",
    ],
)
FR_SOURCE_AS_ATTRIBUTE = FunctionalRequirement(
    id="FR-25",
    text=(
        "源泉を図に描かず、参照元ノードの属性として引用文・位置・引用元まで"
        "出すこと"
    ),
    status="implemented",
    satisfies=[NEED_READABLE, NEED_LLM_CONTEXT],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "既定の Mermaid / DOT 出力に Source ノードと has_source / part_of が現れない",
        "req explain の各ノードに、引用文と locator と part_of の親を畳んだ源泉行が出る",
        "閲覧用サイトの詳細ペインに源泉欄が出る (図の絞り込みに依らず読める)",
        "--with-sources を付けると図に描き、源泉エッジも辿る",
    ],
)
FR_FOCUS = FunctionalRequirement(
    id="FR-26",
    text="選択したノードの近傍だけを図に描くフォーカス表示を設けること",
    status="implemented",
    refines=[FR_SITE],
    satisfies=[NEED_READABLE],
    has_source=[SRC_OWNER, SRC_BENCH],
    acceptance_criteria=[
        "深さ (1〜3 ホップ) を選ぶと、図に描かれるのは選択ノードの近傍だけになる",
        "フォーカスは図の描画にしか効かず、一覧・テーブル・上流/下流の件数は全体のまま",
    ],
)

# --- 品質要求 ---------------------------------------------------------------

QR_READABLE_ZOOM = QualityRequirement(
    id="QR-1",
    text="図に描かれるノードのラベルが読める倍率 (0.5 倍以上) を保つこと",
    status="approved",
    qualifies=[FR_FOCUS],
    has_source=[SRC_BENCH, SRC_OWNER],
    acceptance_criteria=[
        "300 ノードの合成モデルで、フォーカス 2 ホップ表示の倍率が 0.5 倍以上である",
    ],
)
QR_SITE_CLI_PARITY = QualityRequirement(
    id="QR-3",
    text="閲覧用サイトが書き出す図と CLI が出す図を、一字一句一致させること",
    status="verified",
    qualifies=[FR_SITE],
    has_source=[SRC_OWNER],
    evidence=[
        "tests/test_site_js.py の test_mermaid_export_matches_req_graph が、"
        "サイトの Mermaid 出力と render_mermaid() の一致を CI で検査している",
    ],
)
QR_KEYBOARD = QualityRequirement(
    id="QR-4",
    text="閲覧用サイトの図 (canvas) 以外の要素を、キーボードだけで辿れるようにすること",
    status="approved",
    qualifies=[FR_SITE],
    has_source=[SRC_OWNER],
    acceptance_criteria=[
        "一覧・表・指摘の各行に tab キーだけで到達でき、Enter で開ける",
        "フォーカスの位置がマウス操作以外では常に見える",
    ],
)

# --- 制約 -------------------------------------------------------------------

CONSTRAINT_NO_EXEC = Constraint(
    id="Constraint-1",
    text="定義ファイルを実行しないこと",
    status="approved",
    constrains=[FR_AST_ONLY, FR_PLAN],
    has_source=[SRC_SPEC],
)
CONSTRAINT_PYDANTIC_ONLY = Constraint(
    id="Constraint-2",
    text="実行時の依存を pydantic だけに保つこと",
    status="approved",
    constrains=[FR_MCP, FR_SVG],
    has_source=[SRC_SPEC],
)
CONSTRAINT_GIT_ONLY = Constraint(
    id="Constraint-3",
    text="履歴とレビューの基盤を Git に置き、RDB と外部ストレージを持たないこと",
    status="approved",
    constrains=[FR_PLAN],
    has_source=[SRC_SPEC],
)
CONSTRAINT_OFFLINE_SITE = Constraint(
    id="Constraint-4",
    text="公開する閲覧用サイトを、外部への通信なしで表示できるようにすること",
    status="approved",
    constrains=[FR_SITE],
    has_source=[SRC_OWNER],
)
CONSTRAINT_NO_LLM_CALL = Constraint(
    id="Constraint-5",
    text="LLM API を直接呼ばず、LLM に渡す文脈の生成までに留めること",
    status="approved",
    constrains=[FR_EXPLAIN, FR_MCP],
    has_source=[SRC_SPEC],
)



# --- 表示グループ -----------------------------------------------------------

GROUP_VALIDATION = RequirementGroup(
    id="validation",
    label="検証",
    order=10,
    members=[
        FR_AST_ONLY,
        FR_SYNTAX,
        FR_EDGE_RULES,
        FR_ORPHAN,
        FR_LEXICON,
        FR_WAIVER,
        FR_EXIT_CODE,
        CONSTRAINT_NO_EXEC,
    ],
)
GROUP_ANALYSIS = RequirementGroup(
    id="analysis",
    label="影響分析・LLM連携",
    order=20,
    members=[FR_IMPACT, FR_EXPLAIN, FR_PLAN, CONSTRAINT_GIT_ONLY, CONSTRAINT_NO_LLM_CALL],
)
GROUP_PRESENTATION = RequirementGroup(
    id="presentation",
    label="出力と閲覧",
    order=30,
    members=[
        FR_DOC,
        FR_SITE,
        FR_FIT_WHOLE,
        FR_TABLE,
        FR_PERMALINK,
        FR_STATS,
        FR_MCP,
        FR_SVG,
        FR_ID_COLLISION,
        FR_SOURCE_AS_ATTRIBUTE,
        FR_FOCUS,
        QR_READABLE_ZOOM,
        QR_SITE_CLI_PARITY,
        QR_KEYBOARD,
        CONSTRAINT_PYDANTIC_ONLY,
        CONSTRAINT_OFFLINE_SITE,
    ],
)
