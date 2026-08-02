# requirement-model

要求 (Goal, Need, Requirement, Constraint 等) を **型付き有向グラフ**として宣言的に記述し、
機械的な検証・変更影響分析・LLM 連携を可能にする Python 製ツール。

設計思想: **意味の判断は人間と LLM、構造の判断は機械**。
意味内容は自然言語のまま各ノードに保持し、構造 (型・エッジ・グラフ全体の性質) だけを形式化する。

語彙は IREB (CPRE) を主参考に、INCOSE の Need を加えた折衷。

## アーキテクチャ

```
定義ファイル (Python / 宣言のみ)
    │  AST 検査(層0: 宣言性の担保)
    ▼
正規化 JSON (真のソース・オブ・トゥルース)
    │
    ├─ validate (層1: 構文 / 層2: 構造)
    ├─ plan     (git 前版との構造 diff + 影響範囲)
    ├─ graph    (Mermaid / DOT 出力)
    └─ explain  (影響部分グラフ抽出 → LLM 用コンテキスト生成)
```

- Python クラス (Pydantic) = 書くためのインターフェース兼スキーマ。
  モデル定義 (`src/reqmodel/`) と実体の定義ファイル (`examples/sample.py` 等) は分離してある。
  実体ファイルだけ差し替えれば動く。
- 検証・影響分析・diff・LLM 連携はすべて正規化 JSON (と、そこから組んだグラフ) に対して行う。
- RDB は使わない。テキストで diff が取れることを重視し、Git を履歴・レビュー基盤とする。

## インストール

```console
$ pip install -e .          # Python 3.11 以上 / 依存は pydantic のみ
$ req validate examples/sample.py
```

## 使い方

```console
$ req validate [PATH ...]                  # 層0〜層2 の全チェック
$ req plan     [PATH ...] [--rev HEAD]     # git 前版との構造 diff → 影響範囲
$ req graph    [PATH ...] [--format mermaid|dot] [-o FILE]
$ req explain  ID [ID ...] [-f PATH]       # 影響部分グラフを LLM 用に整形
$ req export   [PATH ...] [-o FILE]        # 正規化 JSON の出力
$ req site     [PATH ...] [-o DIR]         # 閲覧用の静的サイト生成 (GitHub Pages 用)
```

`PATH` を省略するとカレントの `requirements.py` または `requirements/` を探す。
ディレクトリを指定すると配下の `*.py` をまとめて 1 つのグラフとして扱う。

終了コードは、`validate` でエラーがあれば 1 (`--strict` を付けると警告でも 1)、
定義ファイルが見つからない等の使い方の誤りは 2。CI にそのまま置ける。

主なオプション:

| オプション | コマンド | 意味 |
|---|---|---|
| `--strict` | validate | warning / severe もエラー扱いにする |
| `--json` | validate, explain | 機械可読な出力 |
| `--no-lexicon` | validate | 曖昧語チェックを行わない |
| `--show-suppressed` | validate | 抑制した指摘を理由付きで表示する |
| `--rev REV` | plan | 比較先のリビジョン (既定: `HEAD`) |
| `--edges a,b` | plan, explain | 辿るエッジ種別を限定する |
| `--depth N` | explain | 探索の深さ上限 |
| `--undirected` | explain | エッジの向きを無視して辿る |
| `--highlight ID,ID` | graph | 指定ノードを強調する |
| `--title` / `--assets` | site | ページ題名 / 描画ライブラリの参照先 (`cdn` or `local`) |

## 定義ファイルの規約 (宣言のみ)

定義ファイルは「クラスのインスタンス化を並べただけのもの」に限定する。

- **許可**: import 文、ノード型のインスタンス化、変数への代入 (参照用)
- **禁止**: for / while / if / 関数定義 / クラス定義 / 内包表記 / 演算 / 属性アクセス /
  f-string / ノード型以外の呼び出し / `reqmodel` 以外の import

この規約自体を `ast` による静的検査で機械的に担保する (`validate` の層0)。

その帰結として、**本ツールは定義ファイルを一切実行しない**。ノード集合は AST から直接復元する。
Python ファイルの diff とグラフの diff が一対一対応し、コード実行リスクなしに解析できる
(環境変数・現在時刻・乱数・ネットワークが入り込む余地がそもそも無い)。

```python
from reqmodel import Goal, Need, FunctionalRequirement, Source

src_employee = Source(id="SRC-EMP", text="申請者となる一般社員", kind="stakeholder")

need_photo_only = Need(
    id="N-1",
    text="申請者は、領収書を撮影するだけで経費を申請したい",
    status="approved",
    has_source=[src_employee],
)

fr_ocr = FunctionalRequirement(
    id="FR-1",
    text="領収書画像から金額と日付を抽出し、申請フォームの初期値として表示すること",
    satisfies=[need_photo_only],
    has_source=[src_employee],
    acceptance_criteria=["金額の抽出正解率が 95% 以上である"],
)
```

参照はただの変数参照なので、参照されるノードを先に書く。前方参照したいときは
変数の代わりに id 文字列 (`satisfies=["N-1"]`) を書いてもよい。
import 文は実行されないが、mypy と IDE 補完のために必ず書く。

## メタモデル

### ノード型 (8種)

| 型 | 意味 | 備考 |
|---|---|---|
| `Goal` | 事業・ステークホルダーの意図 (なぜ) | `decomposition="AND"\|"OR"` を持つ |
| `Need` | 何が満たされたいか | 語尾規則あり |
| `FunctionalRequirement` (FR) | システムが提供すべき機能 | 語尾規則・受け入れ基準 |
| `QualityRequirement` (QR) | 品質要求 (性能・可用性等) | 「非機能要求」の語は使わない |
| `Constraint` | 解決策の自由度を制限する条件 | 要求ではない |
| `Source` | 要求の源泉 | `kind` で分類 |
| `System` | 全体品質の張り先となるノード | 「稼働率 99.9%」等の受け皿 |
| `Decision` | conflict 解消の記録 | |

`Source` は単一型とし、`kind: "stakeholder" | "document" | "existing_system"` で分類する
(3種の構造的振る舞いが同一のため)。将来 Stakeholder 固有のエッジが必要になったら
`Stakeholder(Source)` としてサブクラス化すればよく、エッジ型定義は `Ref[Source]` のまま無傷。

FR と QR は型を分ける (qualifies を出せるのは QR のみ、孤立検出の規則が異なる)。
型分割の一般原則: **型ごとに異なる構造規則が存在するときだけ型を分ける**。

### 共通属性

`id` / `text` / `status` (`proposed` → `approved` → `implemented` → `verified`) / `priority` /
`suppress` ([指摘の抑制](#指摘の抑制-waiver))。
`priority` は小さいほど高優先で、2 以下を「高優先度」として扱う
(`reqmodel.model.HIGH_PRIORITY_THRESHOLD`)。
FR / QR には `acceptance_criteria: list[str]` が加わる。

### エッジ型と型規則

| エッジ | 型規則 | 意味 |
|---|---|---|
| `refines` | Goal→Goal, FR→FR | 分解・詳細化 (子 → 親) |
| `motivates` | Goal→Need | 動機づけ |
| `satisfies` | FR→Need | 充足 |
| `qualifies` | QR→FR, QR→System | 品質の付与 |
| `constrains` | Constraint→{FR, QR, Decision} | 制約 |
| `has_source` | {Goal, Need, FR, QR, Constraint}→Source | 源泉トレース |
| `conflicts` | FR↔FR, QR↔QR, FR↔QR | 対立の明示 |
| `resolves` | Decision→conflicts ペア | 対立解消 |

エッジは Pydantic のフィールドとして `satisfies: list[Ref[Need]]` の形で宣言してある。
**型規則はフィールド型そのもの**であり、mypy と IDE 補完が記述時点から効く。
実行時の検査 (層2) もこの注釈から機械的に導出するので、規則が二重管理にならない。

## 検証 (3層)

| 層 | 内容 | 実装 |
|---|---|---|
| 層0 | 宣言性 (AST 検査) | `astcheck.py` |
| 層1 | 構文 (語尾規則・ID 重複・必須属性) | Pydantic validator + `loader.py` |
| 層2 | 構造 (本丸) | `validate.py` |
| 層3 | 意味 | 曖昧語辞書のみ先行実装 (`lexicon.py`)。LLM 連携は後続 |

指摘の重大度は `error` / `severe` (重大警告) / `warning` / `info` の 4 段階。
指摘には、そのノードを宣言した場所 (`examples/sample.py:42`) が全層で付く。
層0・層1 は AST の行番号がそのまま出る。層2 は構造だけを見て指摘を作り、
出所の解決は `validate.attach_locations()` の 1 か所だけで行う。

層2 のチェック一覧:

| コード | 重大度 | 内容 |
|---|---|---|
| `structure.edge_type` | error | 型規則違反エッジ (例: Constraint→Goal) |
| `structure.dangling_ref` | error | 参照先ノードが存在しない |
| `structure.self_reference` | error | 自分自身への参照 |
| `structure.refines_cycle` | error | refines の閉路 (詳細化の破綻) |
| `structure.orphan_fr` | warning | どの Goal にも到達できない FR |
| `structure.orphan_need` | warning | どの FR からも satisfy されない Need |
| `structure.orphan_qr` | warning | qualifies の張り先が無い QR |
| `structure.unused_source` | info | どの要求からも参照されない Source |
| `structure.goal_decomposition` | warning | AND 分解で要求群に到達しない子がある / OR 分解でどの子も到達しない |
| `structure.goal_leaf` | warning | 子 Goal も Need も持たない Goal |
| `structure.conflict_unresolved` | warning / **severe** | 未解消の conflict (高優先度どうしなら severe) |
| `structure.resolve_no_conflict` | warning | conflicts が宣言されていないペアの resolves |
| `structure.missing_source` | warning | 源泉リンクの無い要求 |
| `structure.missing_acceptance_criteria` | warning | 受け入れ基準の無い FR / QR |
| `structure.status_inconsistent` | warning | approved 以上のノードが proposed のノードを参照 |
| `semantics.ambiguous_term` | warning | 曖昧語 (「高速に」「適切に」等) |
| `waiver.stale` | warning | 陳腐化した抑制 (対象の指摘が出ていない) |

「FR から Goal への到達」は `FR --refines--> FR --satisfies--> Need <--motivates-- Goal`
の経路で判定する。曖昧語辞書は `src/reqmodel/lexicon.py` で編集できる。

### 指摘の抑制 (waiver)

`--strict` は全か無かなので、既知で意図的な指摘が 1 件でも常在すると CI で使えない。
ノード属性 `suppress` に **(チェックコード, 理由)** の組を書くと、そのノードに出る
そのコードの指摘だけが消える。

```python
constraint_vpn = Constraint(
    id="C-9",
    text="社内 VPN の外からは接続させないこと",
    constrains=[fr_ocr],
    suppress=[("structure.missing_source", "情報システム部との口頭合意。文書化は次版")],
)
```

- **理由は必須。** 理由の無い抑制は層1 のエラーになる (`suppress=["..."]` は書けない)
- **エラーは抑制できない。** 抑制できるのは severe / warning / info、つまり `--strict`
  の成否を左右する指摘だけ。存在しないコードや抑制できないコードも層1 で弾かれる
  (コード表は `src/reqmodel/codes.py`)
- **消えても数は残る。** サマリは `結果: ... (抑制 2 件)` の形になる。中身は
  `req validate --show-suppressed` か `--json` の `suppressed` で読める
- **陳腐化を検出する。** 抑制を書いたのに対象の指摘が出ていなければ `waiver.stale`
  を warning として出す。定義が直った後に抑制だけが残り続けることを防ぐ

サイトでも同じで、抑制された指摘は指摘一覧から消え、統計に「抑制 N 件」が出る。
ノードを選ぶと、そのノードが抑制している指摘と理由が読める。

## 変更影響分析

```
impact(n) = ancestors(n) ∪ descendants(n)   # --edges でエッジ型を絞れる
```

`req plan` は git 前版の定義ファイルを (実行せずに) 読んで正規化し、ノード単位・
フィールド単位の差分と、変更されたノードの影響範囲を出す。

**出所 (file:line) は diff の比較対象に含めない**。定義を並べ替えただけ、上に 1 行
足しただけの変更が「グラフが変わった」として出てしまうと、構造 diff の意味が無くなる。
比較単位は `graph.node_to_json_obj()` (出所を含まないノード表現) で、出所は
`RequirementGraph.locations` に横持ちする。

`req explain` は影響部分グラフの各ノードの `text` (自然言語) と受け入れ基準を含めて
整形出力する。機械が網羅性を担保し、解釈は LLM に委ねるための入力を作る。

有向の到達可能性では「その FR がなぜ必要か (Goal)」までは辿れないため、
`--undirected` で向きを無視した近傍も集められる。

```console
$ req explain FR-3 -f examples/sample.py --undirected --depth 2
```

## 可視化

3 通りある。用途で使い分ける。

| 出力 | コマンド | 用途 |
|---|---|---|
| Mermaid | `req graph --format mermaid` | Markdown / PR 本文にそのまま貼る |
| DOT | `req graph --format dot` | Graphviz で画像に落とす |
| 静的サイト | `req site` | ブラウザで探索する。GitHub Pages で公開する |

`req site` が出す 1 枚の HTML は、グラフの描画に加えて次のことができる。

- ノードをクリックすると、**影響範囲を色分け表示** (選択=赤 / 上流=青 / 下流=緑 / 無関係=減光)
- ノード種別・エッジ種別の絞り込み。**絞り込みは影響範囲の計算にも効く**
  (`req explain --edges` と同じ考え方)
- 本文・受け入れ基準・出所 (file:line)・出入りのエッジ・そのノードへの指摘を右ペインに表示
- 「影響部分グラフをコピー」で `req explain` 相当のテキストをクリップボードへ (LLM 連携用)
- 検証結果の一覧。指摘をクリックすると該当ノードへ飛ぶ
- ドラッグでパン、ホイールでズーム。ノードは個別に掴んで動かせる
- 一覧や指摘から**画面外のノードを選ぶと、そこまで自動でパンする** (倍率は変えない)

出力ディレクトリには `index.html` のほか、`model.json` (正規化 JSON) と
`graph.mmd` / `graph.dot` も置かれる。`model.json` の各ノードには
`"location": "examples/sample.py:42"` が入るので、そこから定義に戻れる。

```console
$ req site examples/sample.py -o site --title "経費精算システムの要求グラフ"
$ python -m http.server -d site
```

### 描画エンジン

描画には **Cytoscape.js + dagre** (バージョン固定の UMD ビルド) を使う。
グラフはページ読み込み時に 1 度だけレイアウトし、その後の操作は
**要素の見せ消しとクラスの付け替えだけ**で行う。

- 絞り込みのチェックを 1 つ変えても再レイアウトは走らず、**ノードの位置が動かない**。
  読み手が覚えた「あのノードはこの辺」が壊れない
- 影響範囲のハイライトも同様。ノード選択で図全体が描き直されることはない
- パン・ズームはライブラリの組み込み機能

絞り込みで消えたノードの場所は空いたままになる。詰め直したいときはツールバーの
**「整列」** を押すと、表示中のノードだけで並べ直す。TD / LR の切り替えも並べ直す。

初期表示はグラフ全体を収める倍率にするが、極端に横長のグラフで文字が潰れないよう
下限 (0.45 倍) を設けてあり、そこから先は左上を起点にパンして見る。
全体を俯瞰したいときは「全体表示」を押す。

大きいグラフでは選択したノードが表示範囲の外にあることが多いので、左サイドバーの
一覧や指摘から選んだノードが画面外なら、そのノードが見える位置まで短くパンする。
**倍率は変えず、既に見えているノードでは動かさない** (グラフ上のノードを直接
クリックしたときは当然見えているので、ビューは動かない)。

既定では CDN を参照する。`--assets local` を渡し、出力先に
`cytoscape.min.js` と `cytoscape-dagre.js` を置けば、外部への通信が一切無い
自己完結のサイトになる (Pages のワークフローはこの方式で公開する)。
同梱するのはこの 2 ファイル (計 480KB 程度) だけでよい。dagre は
`cytoscape-dagre` に同梱されている。URL とファイル名は
`reqmodel.site.SITE_ASSETS` を唯一の出典とする。

形状・配色・影響範囲の色は `render.py` の `render_meta()` がページに渡す。
描画の定義をブラウザ側に複製しないための出口であり、色を変えるなら `render.py`
だけを触ればよい。

### ページの JS

出力は 1 枚の HTML だが、**ソースはテンプレートから分けてある**。

| ファイル | 役割 |
|---|---|
| `site_logic.js` | ロジック層。DOM も Cytoscape.js も触らない純関数だけ |
| `site_app.js` | 表示層。DOM と `cy` に触るのはここだけ |
| `site_template.html` | 骨組みと CSS。JS は `__APP_JS__` の 1 か所に入る |

`site.py` の `app_js()` が 2 つを連結して 1 つのモジュールにし、テンプレートへ
インライン化する。連結にあたって落とすのはファイル間の `import` / `export` 行だけで、
最小化もトランスパイルもしない。生成された HTML の中身は書いたままの JS である。

分ける目的は**テストできるようにすること**。`site_logic.js` は素の ES モジュールなので、
Node からそのまま読み込める。

```console
$ npm run lint    # node --check (依存パッケージは無い)
$ npm test        # node --test tests/js/*.test.mjs
```

`nodeContext()` (「影響部分グラフをコピー」の本文) は `req explain` と同じ文字列を
返さなければならない。ここが食い違うと、サイトから LLM に渡すコンテキストと CLI が
出すコンテキストが別物になる。`tests/test_site_js.py` が `examples/sample.py` の全ノードに
ついて Python の `explain_text()` と JS の `nodeContext()` を突き合わせ、一致を保証する
(絞り込み中は `req explain --edges ...` に対応する)。

## GitHub Pages への公開

`.github/workflows/pages.yml` が、`main` への push (と手動実行) をきっかけに
テスト → `req validate` → `req site` → デプロイまで行う。検証が通らなければ公開されない。

**リポジトリ側の設定が 1 つだけ必要**: Settings → Pages → Build and deployment の
Source を **GitHub Actions** にする。これは API やワークフローからは設定できない。

公開されるのは `examples/sample.py` のグラフ。自分の定義ファイルを公開するときは
ワークフロー中の `req validate` / `req site` の引数を差し替える。

## 開発

```console
$ pip install -e ".[dev]"
$ pytest
$ mypy
```

静的サイトの JS だけを回すなら Node (18 以上) で次を叩く。依存パッケージは無い。

```console
$ npm run lint
$ npm test
```

`pytest` からも同じものが走る (`tests/test_site_js.py`)。node が入っていない環境では
skip されるので、CI では `.github/workflows/ci.yml` が node を明示的に用意している。

## 指示書からの解釈

実装にあたり、指示書の記述をそのまま条件式にすると実務的に破綻する箇所が 2 つあり、
意図を汲んで次のように解釈した。

- **Need の語尾規則**: 指示書は「〜したい」。ただし「気づきたい」「知りたい」のような
  サ変以外の願望形を弾いてしまうため、**「〜たい」**で判定する。
- **FR の語尾規則**: 指示書は「〜すること」。同様に「読み取ること」「送ること」を弾くため、
  **「〜こと」**で判定する。

いずれも末尾の句点は許容する。厳密に「〜したい」「〜すること」に戻すなら
`src/reqmodel/model.py` の `_check_suffix` 2 か所を変えるだけでよい。

## 非スコープ (初期実装では作らない)

- RDB / 外部ストレージ、Web UI
- LLM API の直接呼び出し (`explain` はコンテキスト生成まで)
- i* のアクター依存モデル、KAOS の Obstacle
- 複数体系の統合メタモデル
