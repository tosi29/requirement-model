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
    Source,
    System,
)

# --- 源泉 -------------------------------------------------------------------

src_owner = Source(
    id="SRC-OWNER",
    text="このツールの作者であり、最初の利用者でもあるリポジトリオーナー",
    kind="stakeholder",
    status="approved",
)
src_spec = Source(
    id="SRC-SPEC",
    text="初回の実装指示書 (issue #1)",
    kind="document",
    status="approved",
)
src_ireb = Source(
    id="SRC-IREB",
    text="IREB (CPRE) の要求工学用語体系",
    kind="document",
    status="approved",
)
src_incose = Source(
    id="SRC-INCOSE",
    text="INCOSE による Need と Requirement の区別",
    kind="document",
    status="approved",
)
src_legacy = Source(
    id="SRC-LEGACY",
    text="要求を Markdown 文書と表計算ソフトで管理する現行の運用",
    kind="existing_system",
    status="approved",
)
src_bench = Source(
    id="SRC-BENCH",
    text="300 ノードの合成モデル (examples/bench.py) による実測結果",
    kind="document",
    status="approved",
)

# --- システム ---------------------------------------------------------------

system = System(
    id="SYS",
    text="reqmodel (要求を型付き有向グラフとして扱う検証・分析ツール)",
    status="implemented",
)

# --- ニーズ -----------------------------------------------------------------

need_self_check = Need(
    id="N-1",
    text="要求を書く人は、書き方の誤りをレビュー会の前に自分で見つけたい",
    status="approved",
    priority=1,
    has_source=[src_owner, src_legacy],
)
need_no_dangling = Need(
    id="N-2",
    text="要求をレビューする人は、どこにも繋がっていない要求が残っていないかを知りたい",
    status="approved",
    priority=1,
    has_source=[src_owner, src_ireb],
)
need_impact = Need(
    id="N-3",
    text="要求を変更する人は、その変更がどこまで波及するのかを変更前に把握したい",
    status="approved",
    priority=1,
    has_source=[src_owner, src_legacy],
)
need_review_diff = Need(
    id="N-4",
    text="変更を審査する人は、差分から要求グラフの何が変わったのかを読み取りたい",
    status="approved",
    priority=2,
    has_source=[src_owner],
)
need_llm_context = Need(
    id="N-5",
    text="要求の判断を LLM に委ねる人は、判断に要る文脈を欠けなく渡したい",
    status="approved",
    priority=2,
    has_source=[src_spec, src_owner],
)
need_readable = Need(
    id="N-6",
    text="要求を読む関係者は、ツールを入れずに要求の全体像と個々のトレースを見たい",
    status="approved",
    priority=2,
    has_source=[src_legacy],
)
need_metrics = Need(
    id="N-7",
    text="要求を管理する人は、モデル全体の充足率と成熟度の分布を数値で把握したい",
    status="approved",
    priority=3,
    has_source=[src_owner],
)
need_ci = Need(
    id="N-8",
    text="CI を回す人は、既知で意図的な指摘を残したまま、新しい指摘だけで失敗させたい",
    status="approved",
    priority=2,
    has_source=[src_owner],
)

# --- ゴール -----------------------------------------------------------------

goal_machine_checked = Goal(
    id="G-1",
    text="要求の構造的な誤りと変更の影響を、人手のレビューに頼らず機械的に把握できる状態にする",
    status="approved",
    priority=1,
    decomposition="AND",
    has_source=[src_spec, src_owner],
)
goal_find_defects = Goal(
    id="G-2",
    text="要求の構造上の誤りを、レビュー会を待たずに発見できる状態にする",
    status="approved",
    priority=1,
    refines=[goal_machine_checked],
    motivates=[need_self_check, need_no_dangling, need_ci],
    has_source=[src_spec],
)
goal_trace_change = Goal(
    id="G-3",
    text="要求変更の影響範囲を、確認漏れなく把握できる状態にする",
    status="approved",
    priority=1,
    refines=[goal_machine_checked],
    motivates=[need_impact, need_review_diff],
    has_source=[src_spec],
)
goal_llm_ready = Goal(
    id="G-4",
    text="要求の意味の判断を LLM に委ねられる形で、機械が文脈を揃える",
    status="approved",
    priority=2,
    refines=[goal_machine_checked],
    motivates=[need_llm_context],
    has_source=[src_spec, src_owner],
)
goal_shareable = Goal(
    id="G-5",
    text="要求モデルを、専用のツールを持たない関係者にも読める形で配る",
    status="approved",
    priority=2,
    refines=[goal_machine_checked],
    motivates=[need_readable, need_metrics],
    has_source=[src_owner, src_legacy],
)

# --- 機能要求: 検証 (層0〜層3) -----------------------------------------------

fr_ast_only = FunctionalRequirement(
    id="FR-1",
    text="定義ファイルを実行せず、AST からノード集合を復元すること",
    status="implemented",
    priority=1,
    satisfies=[need_self_check],
    has_source=[src_spec],
    acceptance_criteria=[
        "for 文・if 文・関数定義を含む定義ファイルは declarative.forbidden として報告される",
        "ノードの復元に exec と eval のどちらも用いない",
    ],
)
fr_syntax = FunctionalRequirement(
    id="FR-2",
    text="ノードの必須属性・id の重複・語尾規則の違反を、定義した行番号とともに報告すること",
    status="implemented",
    priority=1,
    satisfies=[need_self_check],
    has_source=[src_spec, src_ireb],
    acceptance_criteria=[
        "「〜たい」で終わらない Need の text は syntax.invalid_field として報告される",
        "報告には定義ファイルのパスと行番号が付く",
    ],
)
fr_edge_rules = FunctionalRequirement(
    id="FR-3",
    text=(
        "型規則に違反するエッジ・参照切れ・階層エッジ (refines / part_of) の閉路を"
        "error として報告すること"
    ),
    status="implemented",
    priority=1,
    satisfies=[need_no_dangling],
    has_source=[src_spec, src_ireb],
    acceptance_criteria=[
        "Constraint から Goal へ張ったエッジは structure.edge_type として報告される",
        "存在しない id への参照は structure.dangling_ref として報告される",
        "refines と part_of の閉路は、それぞれ専用のコードで error として報告される",
    ],
)
fr_orphan = FunctionalRequirement(
    id="FR-4",
    text=(
        "どの Goal にも到達できない FR・satisfies されない Need・"
        "張り先の無い QR を warning として報告すること"
    ),
    status="implemented",
    priority=1,
    satisfies=[need_no_dangling],
    has_source=[src_spec, src_incose],
    acceptance_criteria=[
        "Goal に到達できない FR は structure.orphan_fr として報告される",
        "孤立は FR と QR で別のコードとして報告される",
    ],
)
fr_lexicon = FunctionalRequirement(
    id="FR-5",
    text="辞書に載っている曖昧語を含む本文を warning として報告すること",
    status="implemented",
    priority=2,
    satisfies=[need_self_check],
    has_source=[src_spec],
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
fr_waiver = FunctionalRequirement(
    id="FR-6",
    text=(
        "ノード属性 suppress に書いた (チェックコード, 理由) の組で、"
        "そのノードに出る当該コードの指摘だけを抑制すること"
    ),
    status="implemented",
    priority=1,
    satisfies=[need_ci],
    has_source=[src_owner],
    acceptance_criteria=[
        "理由の無い抑制は層1 のエラーになる",
        "error の抑制は層1 のエラーになる",
        "対象の指摘が出ていない抑制は waiver.stale として報告される",
        "抑制した件数はサマリに残り、--show-suppressed で理由まで読める",
    ],
)
fr_exit_code = FunctionalRequirement(
    id="FR-7",
    text="指摘の重大度に応じた終了コードを返し、CI にそのまま置けるようにすること",
    status="implemented",
    priority=1,
    satisfies=[need_ci],
    has_source=[src_spec],
    acceptance_criteria=[
        "error が 1 件でもあれば終了コードは 1 になる",
        "--strict では warning と severe でも終了コードは 1 になる",
        "定義ファイルが見つからない場合の終了コードは 2 になる",
    ],
)

# --- 機能要求: 影響分析と LLM 連携 -------------------------------------------

fr_impact = FunctionalRequirement(
    id="FR-8",
    text="指定したノードの上流と下流を辿り、影響部分グラフを抽出すること",
    status="implemented",
    priority=1,
    satisfies=[need_impact],
    has_source=[src_spec],
    acceptance_criteria=[
        "辿るエッジ種別を --edges で限定できる",
        "探索の深さを --depth で打ち切れる",
        "--undirected でエッジの向きを無視して辿れる",
    ],
)
fr_explain = FunctionalRequirement(
    id="FR-9",
    text="影響部分グラフの本文と根拠を、LLM に渡せる書式に整形して出力すること",
    status="implemented",
    priority=1,
    refines=[fr_impact],
    satisfies=[need_llm_context],
    has_source=[src_spec, src_owner],
    acceptance_criteria=[
        "出力には各ノードの text と evidence が含まれる",
        "--json で機械可読な形でも出せる",
    ],
)
fr_plan = FunctionalRequirement(
    id="FR-10",
    text=(
        "git の前版の定義ファイルを読み、ノード単位とフィールド単位の構造差分と、"
        "変更されたノードの影響範囲を出すこと"
    ),
    status="implemented",
    priority=1,
    satisfies=[need_review_diff],
    has_source=[src_spec],
    acceptance_criteria=[
        "定義の並べ替えだけの変更は差分として出ない (出所は比較対象に含めない)",
        "比較先のリビジョンを --rev で指定できる",
    ],
)

# --- 機能要求: 出力と閲覧 ----------------------------------------------------

fr_doc = FunctionalRequirement(
    id="FR-11",
    text="モデルから仕様書とトレーサビリティ表を生成すること",
    status="implemented",
    priority=2,
    satisfies=[need_readable],
    has_source=[src_legacy],
    acceptance_criteria=[
        "仕様書は 5 節構成で、どのノードも必ずいずれかの節に現れる",
        "トレーサビリティ表はエッジ型ごとに 1 枚出て、トレースの無い行と列を併記する",
        "表は Markdown と CSV の両方で出せる",
    ],
)
fr_site = FunctionalRequirement(
    id="FR-12",
    text="外部の実行環境を要さない 1 枚の HTML として、閲覧用サイトを生成すること",
    status="implemented",
    priority=2,
    satisfies=[need_readable],
    has_source=[src_owner, src_legacy],
    acceptance_criteria=[
        "生成物を静的ファイルとして配るだけでブラウザから閲覧できる",
        "ノードを選ぶと影響範囲が色分けされ、指摘の一覧から該当ノードへ飛べる",
    ],
)
fr_fit_whole = FunctionalRequirement(
    id="FR-13",
    text=(
        "図の初期表示でグラフ全体を 1 画面に収め、この表示は俯瞰の用途に限ること"
    ),
    status="implemented",
    priority=3,
    refines=[fr_site],
    satisfies=[need_readable],
    has_source=[src_owner],
    acceptance_criteria=[
        "読み込み直後の倍率は、全ノードが表示領域に入る値になる",
    ],
)
fr_table = FunctionalRequirement(
    id="FR-14",
    text=(
        "閲覧用サイトに表形式の一覧を設け、列見出しで並べ替えられるようにし、"
        "同値の行の並びを安定させること"
    ),
    status="implemented",
    priority=3,
    refines=[fr_site],
    satisfies=[need_readable],
    has_source=[src_legacy],
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
fr_permalink = FunctionalRequirement(
    id="FR-15",
    text="選択したノードと表示の絞り込みを URL に載せ、同じ画面を相手にも出せるようにすること",
    status="implemented",
    priority=3,
    refines=[fr_site],
    satisfies=[need_readable],
    has_source=[src_owner],
    acceptance_criteria=[
        "既定値のままの項目は URL に書かれない",
        "解釈できない値は黙って捨て、読み込み後の URL は解釈できた形に直る",
    ],
)
fr_stats = FunctionalRequirement(
    id="FR-16",
    text="ノード数・エッジ数・充足率・曖昧語密度を数え、判定を伴わない形で出すこと",
    status="implemented",
    priority=3,
    satisfies=[need_metrics],
    has_source=[src_owner],
    acceptance_criteria=[
        "閾値を持たず、終了コードは常に 0 になる",
        "率が 100% に満たない行には未達のノード id が並ぶ",
        "母数が 0 のときの率は - (JSON では null) になる",
    ],
)
fr_export = FunctionalRequirement(
    id="FR-17",
    text="正規化 JSON と Mermaid / DOT の図を出力すること",
    status="implemented",
    priority=3,
    satisfies=[need_readable],
    has_source=[src_spec],
    acceptance_criteria=[
        "正規化 JSON の各ノードに定義位置 (file:line) が入る",
        "Mermaid はそのまま Markdown に貼れる",
    ],
)

# --- 機能要求: 未着手 (対応する issue はノード直前のコメントを参照) ----------

# → issue #6
fr_plan_markdown = FunctionalRequirement(
    id="FR-18",
    text="構造差分を Markdown で出力し、PR コメントに貼れる形にすること",
    status="proposed",
    priority=2,
    refines=[fr_plan],
    satisfies=[need_review_diff],
    has_source=[src_owner],
    acceptance_criteria=[
        "出力は GitHub の Markdown としてそのまま読める",
        "差分が無いときは、差分が無いことが 1 行で分かる",
    ],
)
# → issue #7
fr_config = FunctionalRequirement(
    id="FR-19",
    text="プロジェクト固有の曖昧語と、検査ごとの有効・無効を設定ファイルで宣言できるようにすること",
    status="proposed",
    priority=2,
    satisfies=[need_self_check],
    has_source=[src_owner],
    acceptance_criteria=[
        "設定ファイルに書いた語が曖昧語として報告される",
        "設定ファイルから外した語は報告されなくなる",
        "設定ファイルが無くても既定の辞書で動く",
    ],
)
# → issue #10
fr_mcp = FunctionalRequirement(
    id="FR-20",
    text="MCP サーバとして validate / explain / impact を公開すること",
    status="proposed",
    priority=3,
    satisfies=[need_llm_context],
    has_source=[src_owner],
    acceptance_criteria=[
        "MCP クライアントから 3 つの操作を呼び出せる",
        "返す内容は同名の CLI の --json 出力と一致する",
    ],
)
# → issue #13
fr_more_checks = FunctionalRequirement(
    id="FR-21",
    text="測定不能な QR・status の後退・id の命名規則違反を検査すること",
    status="proposed",
    priority=3,
    satisfies=[need_no_dangling],
    has_source=[src_owner, src_ireb],
    acceptance_criteria=[
        "数値を含まない QR の text が報告される",
        "追加する検査はいずれもチェックコードを持ち、抑制の可否が定義されている",
    ],
)
# → issue #14
fr_sarif = FunctionalRequirement(
    id="FR-22",
    text="指摘を SARIF 形式で出力し、GitHub Code Scanning に載せられるようにすること",
    status="proposed",
    priority=3,
    satisfies=[need_ci],
    has_source=[src_owner],
    acceptance_criteria=[
        "出力は SARIF 2.1.0 のスキーマに適合する",
        "指摘がファイルと行に紐づき、PR の差分上に表示される",
    ],
)
# → issue #24
fr_svg = FunctionalRequirement(
    id="FR-23",
    text="Graphviz のレイアウトを用いて SVG の図を書き出すこと",
    status="proposed",
    priority=3,
    satisfies=[need_readable],
    has_source=[src_owner],
    acceptance_criteria=[
        "Graphviz が入っていない環境では、その旨を伝えて終了コード 2 で終わる",
    ],
)
fr_id_collision = FunctionalRequirement(
    id="FR-24",
    text="記号だけが異なる id を持つノードを、図の上でも別のノードとして描き分けること",
    status="implemented",
    priority=2,
    satisfies=[need_readable],
    has_source=[src_owner],
    acceptance_criteria=[
        "FR.1 と FR-1 を含むモデルの Mermaid 出力に、2 つのノードが別々に現れる",
    ],
)
fr_source_as_attribute = FunctionalRequirement(
    id="FR-25",
    text=(
        "源泉を図に描かず、参照元ノードの属性として引用文・位置・引用元まで"
        "出すこと"
    ),
    status="implemented",
    priority=2,
    satisfies=[need_readable, need_llm_context],
    has_source=[src_owner],
    acceptance_criteria=[
        "既定の Mermaid / DOT 出力に Source ノードと has_source / part_of が現れない",
        "req explain の各ノードに、引用文と locator と part_of の親を畳んだ源泉行が出る",
        "閲覧用サイトの詳細ペインに源泉欄が出る (図の絞り込みに依らず読める)",
        "--with-sources を付けると図に描き、源泉エッジも辿る",
    ],
)
fr_focus = FunctionalRequirement(
    id="FR-26",
    text="選択したノードの近傍だけを図に描くフォーカス表示を設けること",
    status="implemented",
    priority=2,
    refines=[fr_site],
    satisfies=[need_readable],
    has_source=[src_owner, src_bench],
    acceptance_criteria=[
        "深さ (1〜3 ホップ) を選ぶと、図に描かれるのは選択ノードの近傍だけになる",
        "フォーカスは図の描画にしか効かず、一覧・テーブル・上流/下流の件数は全体のまま",
    ],
)

# --- 品質要求 ---------------------------------------------------------------

qr_readable_zoom = QualityRequirement(
    id="QR-1",
    text="図に描かれるノードのラベルが読める倍率 (0.5 倍以上) を保つこと",
    status="approved",
    priority=2,
    qualifies=[fr_focus],
    has_source=[src_bench, src_owner],
    acceptance_criteria=[
        "300 ノードの合成モデルで、フォーカス 2 ホップ表示の倍率が 0.5 倍以上である",
    ],
)
qr_validate_speed = QualityRequirement(
    id="QR-2",
    text="300 ノードの定義ファイルについて、読み取りから指摘の出力までを 2 秒以内で終えること",
    status="verified",
    priority=3,
    qualifies=[system],
    has_source=[src_bench],
    evidence=[
        "examples/bench.py (300 ノード) に対する req validate を 3 回計測し、"
        "0.25〜0.43 秒で終わった",
    ],
)
qr_site_cli_parity = QualityRequirement(
    id="QR-3",
    text="閲覧用サイトが書き出す図と CLI が出す図を、一字一句一致させること",
    status="verified",
    priority=2,
    qualifies=[fr_site],
    has_source=[src_owner],
    evidence=[
        "tests/test_site_js.py の test_mermaid_export_matches_req_graph が、"
        "サイトの Mermaid 出力と render_mermaid() の一致を CI で検査している",
    ],
)
qr_keyboard = QualityRequirement(
    id="QR-4",
    text="閲覧用サイトの図 (canvas) 以外の要素を、キーボードだけで辿れるようにすること",
    status="approved",
    priority=3,
    qualifies=[fr_site],
    has_source=[src_owner],
    acceptance_criteria=[
        "一覧・表・指摘の各行に tab キーだけで到達でき、Enter で開ける",
        "フォーカスの位置がマウス操作以外では常に見える",
    ],
)

# --- 制約 -------------------------------------------------------------------

constraint_no_exec = Constraint(
    id="C-1",
    text="定義ファイルを実行しないこと",
    status="approved",
    priority=1,
    constrains=[fr_ast_only, fr_plan],
    has_source=[src_spec],
)
constraint_pydantic_only = Constraint(
    id="C-2",
    text="実行時の依存を pydantic だけに保つこと",
    status="approved",
    priority=2,
    constrains=[fr_mcp, fr_svg],
    has_source=[src_spec],
)
constraint_git_only = Constraint(
    id="C-3",
    text="履歴とレビューの基盤を Git に置き、RDB と外部ストレージを持たないこと",
    status="approved",
    priority=2,
    constrains=[fr_plan],
    has_source=[src_spec],
)
constraint_offline_site = Constraint(
    id="C-4",
    text="公開する閲覧用サイトを、外部への通信なしで表示できるようにすること",
    status="approved",
    priority=2,
    constrains=[fr_site],
    has_source=[src_owner],
)
constraint_no_llm_call = Constraint(
    id="C-5",
    text="LLM API を直接呼ばず、LLM に渡す文脈の生成までに留めること",
    status="approved",
    priority=2,
    constrains=[fr_explain, fr_mcp],
    has_source=[src_spec],
)

