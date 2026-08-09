# requirement-model

要求 (Goal, Need, Requirement, Constraint 等) を **型付き有向グラフ**として宣言的に記述し、
機械的な検証・変更影響分析・LLM 連携を可能にする Python 製ツール。

設計思想: **意味の判断は人間と LLM、構造の判断は機械**。
意味内容は自然言語のまま各ノードに保持し、構造 (型・エッジ・グラフ全体の性質) だけを形式化する。

語彙は IREB (CPRE) を主参考に、INCOSE の Need を加えた折衷。
IREB の連鎖は Goal → Requirement で `Need` を持たず、INCOSE は `Goal` を別階層に置く。
本ツールは両者を 1 つのグラフに載せ、`Need` を Goal と Requirement の間の必須の中継点にした
(FR から Goal への到達は Need 経由の経路でしか判定しない)。
どちらの体系にも無い接ぎ木なので、3 つの層の境界は[どの型に書くか](#どの型に書くか-主語で決める)で
明示的に定義する。

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
    ├─ explain  (影響部分グラフ抽出 → LLM 用コンテキスト生成)
    ├─ doc      (仕様書 / トレーサビリティ表の生成)
    └─ stats    (充足率・成熟度の分布などの健全性メトリクス)
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
$ req doc      [PATH ...] [--matrix] [-o FILE]  # 仕様書 / トレーサビリティ表の生成
$ req stats    [PATH ...] [--json]         # モデルの健全性メトリクス
$ req export   [PATH ...] [-o FILE]        # 正規化 JSON の出力
$ req site     [PATH ...] [-o DIR]         # 閲覧用の静的サイト生成 (GitHub Pages 用)
```

`PATH` を省略するとカレントの `requirements.py` または `requirements/` を探す。
ディレクトリを指定すると配下の `*.py` をまとめて 1 つのグラフとして扱う。
このリポジトリのルートにも `requirements.py` があり、引数を省略すると
[このツール自身の要求モデル](#このリポジトリ自身の要求モデル-dogfooding) が読まれる。

終了コードは、`validate` でエラーがあれば 1 (`--strict` を付けると警告でも 1)、
定義ファイルが見つからない等の使い方の誤りは 2。CI にそのまま置ける。

主なオプション:

| オプション | コマンド | 意味 |
|---|---|---|
| `--strict` | validate | warning / severe もエラー扱いにする |
| `--json` | validate, explain, stats | 機械可読な出力 |
| `--no-lexicon` | validate, stats | 曖昧語チェックを行わない |
| `--show-suppressed` | validate | 抑制した指摘を理由付きで表示する |
| `--rev REV` | plan | 比較先のリビジョン (既定: `HEAD`) |
| `--edges a,b` | plan, explain | 辿るエッジ種別を限定する |
| `--depth N` | explain | 探索の深さ上限 |
| `--undirected` | explain | エッジの向きを無視して辿る |
| `--with-sources` | graph, explain | 源泉を図に描く / 辿る ([既定では出さない](#源泉の扱い)) |
| `--highlight ID,ID` | graph | 指定ノードを強調する |
| `--matrix` | doc | 仕様書ではなくトレーサビリティマトリクスを出す |
| `--format md\|csv` | doc | 出力形式 (既定は `-o` の拡張子から判定。`csv` は `--matrix` 専用) |
| `--title` | doc | 文書のタイトル |
| `--title` / `--assets` | site | ページ題名 / 描画ライブラリの参照先 (`cdn` or `local`) |
| `--repo-url URL` / `--repo-ref REF` | site | 出所から定義ファイルへリンクする先 (既定の REF は `main`) |

## 定義ファイルの規約 (宣言のみ)

定義ファイルは「クラスのインスタンス化を並べただけのもの」に限定する。

- **許可**: import 文、ノード型のインスタンス化、変数への代入 (参照用)
- **禁止**: for / while / if / 関数定義 / クラス定義 / 内包表記 / 演算 / 属性アクセス /
  f-string / ノード型以外の呼び出し / `reqmodel` 以外の import

この規約自体を `ast` による静的検査で機械的に担保する (`validate` の層0)。

ノード参照用の変数名には、意味に基づく `UPPER_SNAKE_CASE` を使う
(`SRC_EMPLOYEE`, `NEED_PHOTO_ONLY`, `FR_OCR` など)。これらは再代入されない
グラフ上のシンボルであるため、通常の処理用変数と見分けやすくするための命名規約である。
ただし、この命名は AST 検査では強制しない。

その帰結として、**本ツールは定義ファイルを一切実行しない**。ノード集合は AST から直接復元する。
Python ファイルの diff とグラフの diff が一対一対応し、コード実行リスクなしに解析できる
(環境変数・現在時刻・乱数・ネットワークが入り込む余地がそもそも無い)。

```python
from reqmodel import Goal, Need, FunctionalRequirement, RequirementGroup, Source

SRC_EMPLOYEE = Source(id="SRC-EMP", text="申請者となる一般社員", kind="stakeholder")

NEED_PHOTO_ONLY = Need(
    id="Need-1",
    text="申請者は、領収書を撮影するだけで経費を申請したい",
    status="approved",
    has_source=[SRC_EMPLOYEE],
)

FR_OCR = FunctionalRequirement(
    id="FR-1",
    text="領収書画像から金額と日付を抽出し、申請フォームの初期値として表示すること",
    satisfies=[NEED_PHOTO_ONLY],
    has_source=[SRC_EMPLOYEE],
    acceptance_criteria=["金額の抽出正解率が 95% 以上である"],
)
```

参照はただの変数参照なので、参照されるノードを先に書く。前方参照したいときは
変数の代わりに id 文字列 (`satisfies=["Need-1"]`) を書いてもよい。
import 文は実行されないが、mypy と IDE 補完のために必ず書く。

### 表示用の要求グループ

`RequirementGroup` は静的サイトの Requirements 段で、FR / QR / Constraint を機能単位の枠へまとめるための**表示定義**である。要求ノード本体の意味や構造規則には関わらないため、`FunctionalRequirement` などへ `group` フィールドは持たせない。

```python
from reqmodel import FunctionalRequirement, Need, RequirementGroup

NEED_PHOTO_ONLY = Need(
    id="Need-1",
    text="申請者は、領収書を撮影するだけで経費を申請したい",
)
FR_OCR = FunctionalRequirement(
    id="FR-1",
    text="領収書画像から金額と日付を抽出すること",
    satisfies=[NEED_PHOTO_ONLY],
)

GROUP_CAPTURE = RequirementGroup(
    id="capture",
    label="領収書入力",
    order=10,
    members=[FR_OCR],
)
```

- `label` は枠タイトル、`order` は Requirements 段で左から並べる順序である。
- `members` は主所属のノードで、同じノードを複数グループへ書いても最初の 1 グループにだけ描く。
- グループ未指定の FR / QR / Constraint は消さず、`未分類` 枠に入る。
- Goal と Need は従来どおり上段・中段の帯へ型ごとに並び、Requirements 段だけが `RequirementGroup` で機能枠に分かれる。

## メタモデル

### ノード型 (6種)

| 型 | 意味 | 備考 |
|---|---|---|
| `Goal` | 事業・ステークホルダーの意図 (なぜ) | 子 Goal はすべて達成する必要がある |
| `Need` | 何が満たされたいか | 語尾規則あり・主語 (役割) を書く |
| `FunctionalRequirement` (FR) | システムが提供すべき機能 | 語尾規則・根拠 / 受け入れ基準 |
| `QualityRequirement` (QR) | 品質要求 (性能・可用性等) | 「非機能要求」の語は使わない |
| `Constraint` | 解決策の自由度を制限する条件 | 要求ではない |
| `Source` | 要求の源泉 (引用も含む) | `kind` で分類、`part_of` で引用を束ねる |

`Source` は単一型とし、`kind: "stakeholder" | "document" | "existing_system"` で分類する。

規程の条文やヒアリングでの発言といった**引用も Source として書く**。`part_of` で親の源泉に
ぶら下げ、`text` に引用文そのもの、`locator` にどこから引いたか (「第12条第3項」
「2026-03-12 第3回ヒアリング」) を書く。

```python
SRC_POLICY = Source(id="SRC-POLICY", text="経費精算規程 第4版", kind="document")

SRC_POLICY_RECEIPT = Source(
    id="SRC-POLICY-A12-3",
    text="1万円を超える支出には領収書の添付を要する",
    kind="document",
    locator="第12条第3項",
    part_of=[SRC_POLICY],
)
```

引用が id を持つので**同じ条文を複数の要求が根拠にできる**。これにより「この規程のどこが、
どの要求に効いているか」を引用単位で集約でき、`req doc` の源泉節がこの入れ子をそのまま出す。
引用を書かず `has_source=[SRC_POLICY]` と文書ごと指してもよい。粒度は書き手が選ぶ
([なぜノードにするか](docs/design/model.md#引用を-source-のノードにする))。

FR と QR は型を分ける (qualifies を出せるのは QR のみ、孤立検出の規則が異なる)。
型分割の一般原則は **型ごとに異なる構造規則が存在するときだけ型を分ける**
([なぜそうするか](docs/design/model.md#型を分ける基準))。

Need は「〜たい」、FR は「〜こと」で終わる必要がある (層1 の語尾規則。末尾の句点は許容)。

### どの型に書くか (主語で決める)

型の見分けは**文の主語**で決まる。語尾 (層1 の規則) は主語から従属的に決まる結果であって、
判断の起点ではない。

| 主語 | 述語 | 型 | 意味 |
|---|---|---|---|
| 世界・組織 (書かない) | 「〜する」「〜を減らす」 | `Goal` | 解決策が無くても成り立つ、世界の側の変化 |
| **役割 (必ず書く)**「申請者は、」 | 「〜たい」 | `Need` | 名指せる一つの役割が抱く願い |
| システム (書かない) | 「〜こと」 | `FR` / `QR` / `Constraint` | システムに課される義務 |

主語を書くのは `Need` だけである。`Goal` と要求系は主語が自明 (それぞれ世界とシステム) なので
書かない。**この非対称が型の境界**で、「その願いの主を一つの役割として名指せるか」が
`Goal` と `Need` を分ける問いになる。名指せるなら `Need`、事業や組織にしか帰属しないなら `Goal`。

システムを主語にした `Goal` は書けない。「機械が文脈を揃える」は解決策の存在を前提にしており、
世界の側の記述ではないため、`Goal` ではなく要求である。

要求系の 3 つは主語では分かれない。ここは構造が決める ([エッジ型と型規則](#エッジ型と型規則))。

- 他の FR の性質を述べている (`qualifies` を出せる) → `QR`
- 消すと機能が減る → `FR` / 消すと選択肢が増えるだけ → `Constraint`

この主語の規則は、**要求は世界について、仕様は機械について書く** (Jackson & Zave) の境界を
日本語の文法として書き下したものである。`Goal` / `Need` の境界の方は、**目標の分解は単一の
エージェントに割り当てられた時点で終わる** (KAOS / van Lamsweerde) に対応し、
`Need` / 要求系の境界は**割り当て先が環境の側かシステムの側か**の分岐に対応する。

**機械が検査しているのは語尾だけで、主語は検査していない。** 上の規約は
`requirements.py` と `examples/sample.py` の要求系ノードで守られているが、破っても `req validate` は何も言わない。

### 共通属性

`id` / `text` / `status` (`proposed` → `approved` → `implemented` → `verified`) /
`suppress` ([指摘の抑制](#指摘の抑制-waiver))。
FR / QR には検証に関わる 2 つの欄が加わる。

| 属性 | 何を書くか | 検査 |
|---|---|---|
| `evidence: list[str]` | 何をもって満たしたと判断したか (事後の事実) | `verified` なら必須 |
| `acceptance_criteria: list[str]` | text が測定可能に書けないときの操作化 (事前の基準) | 無し (任意) |

**主は `evidence` である。** 要求文が測定可能に書けていれば「何をもって満たしたと
するか」は text に入りきるので、事前の基準は任意とし、検査は「`verified` と主張した
なら根拠を出せ」の側にだけ置いた
([理由](docs/design/model.md#検証可能性を-evidence-側に置く))。
優先度は属性として持たない (理由は
[`docs/design/model.md`](docs/design/model.md#優先度を属性として持たない))。

### エッジ型と型規則

| エッジ | 型規則 | 意味 |
|---|---|---|
| `refines` | Goal→Goal, FR→FR | 分解・詳細化 (子 → 親) |
| `motivates` | Goal→Need | 動機づけ |
| `satisfies` | FR→Need | 充足 |
| `qualifies` | QR→FR | 品質の付与 |
| `constrains` | Constraint→{FR, QR} | 制約 |
| `has_source` | {Goal, Need, FR, QR, Constraint}→Source | 源泉トレース (図には描かない) |
| `part_of` | Source→Source | 引用と、その引用元 (子 → 親。図には描かない) |

**源泉の 2 本 (`has_source` / `part_of`) は図に描かない。** Source は数十件の要求から
参照されるハブなので、ノードとして置くと近傍が一気に広がり、レイアウトが源泉に
引っ張られる。源泉は「どの要求がどこから来たか」をノードの属性として読む情報で
あって、要求どうしの関係を辿る経路ではない ([源泉の扱い](#源泉の扱い))。

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
| `structure.part_of_cycle` | error | part_of の閉路 (引用の包含関係の破綻) |
| `structure.orphan_fr` | warning | どの Goal にも到達できない FR |
| `structure.orphan_need` | warning | どの FR からも satisfy されない Need |
| `structure.orphan_qr` | warning | qualifies の張り先が無い QR |
| `structure.unused_source` | info | どの要求からも参照されない Source (引用を持つ源泉は、子の側で報告するので除く) |
| `structure.goal_decomposition` | warning | 要求群に到達しない子 Goal がある |
| `structure.goal_leaf` | warning | 子 Goal も Need も持たない Goal |
| `structure.missing_source` | warning | 源泉リンクの無い要求 |
| `structure.unverified_claim` | warning | `verified` なのに `evidence` の無い FR / QR |
| `structure.status_inconsistent` | warning | approved 以上のノードが proposed のノードを参照 (`constrains` を除く) |
| `semantics.ambiguous_term` | warning | 曖昧語 (「高速に」「適切に」等) |
| `waiver.stale` | warning | 陳腐化した抑制 (対象の指摘が出ていない) |

「FR から Goal への到達」は `FR --refines--> FR --satisfies--> Need <--motivates-- Goal`
の経路で判定する。曖昧語辞書は `src/reqmodel/lexicon.py` で編集できる。

`structure.status_inconsistent` が見るのは `satisfies` / `refines` / `qualifies` /
`motivates` の 4 種で、**`constrains` は対象外**である (`validate.py` の `_STATUS_EDGES`。
制約は制約対象より先に決まりうるため。[理由](docs/design/model.md#constrains-を-structurestatus_inconsistent-の対象から外した))。

### 指摘の抑制 (waiver)

`--strict` は全か無かなので、既知で意図的な指摘が 1 件でも常在すると CI で使えない。
ノード属性 `suppress` に **(チェックコード, 理由)** の組を書くと、そのノードに出る
そのコードの指摘だけが消える。

```python
CONSTRAINT_VPN = Constraint(
    id="Constraint-9",
    text="社内 VPN の外からは接続させないこと",
    constrains=[FR_OCR],
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

`req explain` は影響部分グラフの各ノードの `text` (自然言語) と根拠・受け入れ基準を含めて
整形出力する。機械が網羅性を担保し、解釈は LLM に委ねるための入力を作る。
源泉エッジは辿らず、各ノードの属性行に畳む ([源泉の扱い](#源泉の扱い))。

有向の到達可能性では「その FR がなぜ必要か (Goal)」までは辿れないため、
`--undirected` で向きを無視した近傍も集められる。

```console
$ req explain FR-3 -f examples/sample.py --undirected --depth 2
```

## 仕様書とトレーサビリティ表の生成

モデルが唯一の真実である以上、レビュー会に配る仕様書も監査に出すトレース表も
モデルから導出する。仕様書を手で書くとモデルとの二重管理になる。

```console
$ req doc examples/sample.py -o spec.md              # 階層構造の仕様書 (Markdown)
$ req doc examples/sample.py --matrix -o trace.md    # トレーサビリティ表 (Markdown)
$ req doc examples/sample.py --matrix -o trace.csv   # 同上 (CSV)
```

出力形式は `-o` の拡張子から決まる (`.csv` なら CSV)。`--format md|csv` で明示もできる。

### 仕様書 (`req doc`)

Goal → Need → FR → QR の階層で並べ、各ノードの `text`・`status`・
根拠・受け入れ基準・トレースリンク・定義位置を出す。`examples/sample.py` からの抜粋:

```markdown
##### FR-1 領収書画像から金額と日付を抽出し、申請フォームの初期値として表示すること

- 種別: FunctionalRequirement / 状態: approved
- 充足するニーズ: Need-1
- 源泉: SRC-EMP (申請者となる一般社員)
- 付与されている品質要求: QR-1
- 受けている制約: Constraint-1
- 受け入れ基準:
    - 社内で収集した領収書画像 200 枚に対し、金額の抽出正解率が 95% 以上である
    - 抽出に失敗した項目は空欄で表示され、申請者が手入力で上書きできる
- 定義: examples/sample.py:128
```

`verified` の要求では、根拠が受け入れ基準より先に出る (事後の事実が主で、事前の
基準が従):

```markdown
###### QR-1 領収書画像の送信から抽出結果の表示までを、95 パーセンタイルで 5 秒以内とすること

- 種別: QualityRequirement / 状態: verified
- 根拠:
    - 本番同等環境で 100 回計測し (2026-02-20)、95 パーセンタイル値は 4.2 秒だった
- 受け入れ基準:
    - 本番同等環境で 100 回計測し、95 パーセンタイル値が 5.0 秒以下である
```

上位の Goal / Need も同じ形式で、トレースリンクの項目名だけが型ごとに変わる
(`動機づけるニーズ`、`これを充足する機能要求` など)。全文は
`req doc examples/sample.py` を叩けば出る。

節の構成は次の 5 つで固定する (該当が無ければ「該当なし。」と出る)。

| 節 | 内容 |
|---|---|
| 1. 要求階層 | Goal → Need → FR → QR。Goal の詳細化は DFS の並び順で表す |
| 2. 制約 | Constraint と、その制約対象 |
| 3. 源泉 | Source と、それを参照しているノード |
| 4. 上記に現れなかったノード | どの節にも入らなかったもの (ゴール未接続の Need 等) |

見出しの深さは Goal=h3 / Need=h4 / FR=h5 / QR=h6 に固定する。Goal の詳細化は
何段でも書けるため、深さをそのまま見出しレベルに写すと h6 を超えてしまうため。
同じノードが複数の親にぶら下がるとき (1 つの FR が 2 つの Need を満たす等) は、
最初の 1 か所だけ本文を出し、以降は `- (前掲) FR-1 …` として参照だけを置く。
**4 節があるので、どのノードも必ずどこかに現れる**。文書から要求が落ちない。

### トレーサビリティ表 (`req doc --matrix`)

エッジ型ごとに 1 枚、行を上流・列を下流に置いた表を出す。`✓` がトレースリンク。

```markdown
| Need × FR | FR-1 | FR-2 | FR-3 | FR-4 | FR-5 |
|---|---|---|---|---|---|
| Need-1 申請者は、領収書を撮影するだけで経費を申請したい | ✓ | ✓ |  |  |  |
| Need-2 経理担当者は、規程に反する申請を差し戻す前に検知したい |  |  | ✓ |  |  |
| Need-3 承認者は、自分が承認すべき申請にその日のうちに気づきたい |  |  |  | ✓ | ✓ |

- トレースの無い行: なし
- トレースの無い列: なし
```

出る表は 5 枚 (`Goal × Need` / `Need × FR` / `FR × QR` / `Source × 要求` /
`Constraint × 制約対象`)。表ごとに「トレースの無い行 / 列」を添えるので、
どこが未カバーかがそのまま読める。表の定義は `src/reqmodel/doc.py` の `MATRICES`。

CSV は「1 行 = 1 トレースリンク」の縦持ちにする。5 枚の格子を 1 ファイルに並べる
わけにいかないためで、表計算ソフトのピボットで格子に戻せる。トレース先の無い行は
列側を空欄にした 1 行として残るので、CSV だけを見ても未トレースが分かる。

```csv
matrix,edge,row_type,row_id,row_text,col_type,col_id,col_text
Goal × Need,motivates,Goal,Goal-1,経費精算にかかる全社の工数を半減する,,,
Goal × Need,motivates,Goal,Goal-2,申請 1 件あたりの入力の手間を減らす,Need,Need-1,申請者は、領収書を撮影するだけで経費を申請したい
```

`req doc` は検証をしない。「未カバー」は表に出すが、指摘として数えるのは
`req validate` の役目 (`structure.orphan_*`) であり、二重に判定しない。

## 健全性メトリクス

`req validate` は個別の指摘を列挙するだけで、全体の傾向 (充足率・成熟度の分布) は
読み取れない。`req stats` はモデルを数える。

```console
$ req stats examples/sample.py
```

4 つの節が出る。**1.** ノード数 (型 × 状態の表)、**2.** エッジ数 (種別ごと)、
**3.** 充足率・保有率、**4.** 曖昧語密度。3 の抜粋:

```markdown
## 3. 充足率・保有率

- Need の充足率 (satisfies されている): 100.0% (3/3)
- FR の根拠保有率 (evidence を持つ): 16.7% (1/6) 未達: FR-1, FR-3, FR-4, FR-5, FR-6
- QR の根拠保有率 (evidence を持つ): 50.0% (1/2) 未達: QR-2
- 源泉トレース率 (has_source を持つ要求): 100.0% (15/15)
```

率が 100% に満たないときは、その行に未達のノード id が並ぶ
(`0.0% (0/1) 未達: Need-1`。6 件目からは件数だけ)。母数が 0 のときの率は `-` とする。

**`req stats` は判定をしない。** 閾値を持たず、終了コードは常に 0 である。
「充足率 80% が良いのか」はモデルが置かれた文脈次第で、機械が決められるのは数と
割合までだからで、CI を落とす役目は `req validate --strict` に置く。

同じ理由で、抑制 (`suppress`) はメトリクスに影響しない。stats が測るのは CI の
成否ではなくモデルの素の状態なので、黙らせた曖昧語も 1 件として数える。

`--json` は同じ内容を機械可読にする。推移をグラフに描く、ダッシュボードに出す、
といった用途はこちらを使う。

```console
$ req stats examples/sample.py --json
```

最上位のキーは `files` / `totals` / `nodes` / `edges` / `ratios` / `ambiguity` の 6 つ。
`ratios` は 1 つの率が 1 要素になる。

```json
{"key": "need_satisfied", "label": "Need の充足率 (satisfies されている)",
 "covered": 3, "total": 3, "rate": 1.0, "missing": []}
```

`rate` は母数が 0 なら `null`、`ambiguity` は `--no-lexicon` を付けたとき
(測っていないとき) に `null` になる。0 と「測っていない」を混同させないため。

## 可視化

3 通りある。用途で使い分ける。

| 出力 | コマンド | 用途 |
|---|---|---|
| Mermaid | `req graph --format mermaid` | Markdown / PR 本文にそのまま貼る |
| DOT | `req graph --format dot` | Graphviz で画像に落とす |
| 静的サイト | `req site` | ブラウザで探索する。GitHub Pages で公開する |

### 源泉の扱い

**Source は図に描かず、参照元ノードの属性として出す。** `req graph` / `req explain` /
静的サイトの図のいずれも既定でそうなる。

理由は数にある。`requirements.py` は Source 6 件に対し `has_source` が 60 本あり、
**全エッジ 116 本の過半が源泉**になっている (図に残るのは 56 本)。Source は 1 件が平均
10 件の要求から参照されるハブなので、ノードとして置くとレイアウトがそこに引っ張られ、
要求どうしの関係が読めなくなる。

情報は失われない。`req explain` は源泉を辿らない代わりに、各ノードの属性行に畳む。
`part_of` の鎖 (引用 → 引用元) も 1 行に収める。

```
- [FunctionalRequirement] FR-3: 申請内容を経費精算規程の各ルールに照合し、…
    (status=approved)
    源泉: SRC-POLICY-A12-3 (1万円を超える支出には領収書の添付を要する) [第12条第3項] < SRC-POLICY (経費精算規程 第4版)
```

これは `req doc` が最初からしていたこと (`- 源泉: SRC-EMP (申請者となる一般社員)`) で、
図の側をそれに揃えたものである。静的サイトでは右ペインに**源泉**の欄が出る。

源泉をハブとして見たいとき (この条文がどの要求に効いているか) は、集約する側の
出力を使う。

- `req doc` の源泉節
- `req doc --matrix` の `Source × 要求` 表
- 静的サイトのテーブルビュー

図の上で見たいときは `--with-sources` を付ける。静的サイトでは左サイドバーで
`Source` と `has_source` / `part_of` にチェックを入れると出る (この状態は既定では
ないので URL に載り、そのまま共有できる)。

```console
$ req graph requirements.py --with-sources      # Source をノードとして描く
$ req explain FR-3 -f requirements.py --with-sources   # 源泉エッジも辿る
```

**型としての `Source` は変わらない。** `has_source` / `part_of` フィールド、
`structure.missing_source` / `structure.unused_source` / `structure.part_of_cycle`、
源泉トレース率、トレーサビリティ表はすべてそのままで、変わるのは図に描くかどうか
だけである。

Mermaid / DOT のノード識別子は `n1`, `n2`, … の連番で、`ordered_nodes()` (型順 → id 順)
の索引から振る (`presentation/render.py` の `_ids()`)。元の id を識別子に流用すると、非英数字を
潰した結果が衝突して `FR-1` と `FR_1` が図の上で 1 ノードに融合してしまう
(ラベルは後勝ち、エッジも合流する) ためで、連番なら衝突が構造的に起こり得ない。
元の id はラベルに出るので、読む側の情報は失われない。

`req site` が出す 1 枚の HTML は、グラフの描画に加えて次のことができる。

- ノードをクリックすると、**影響範囲を色分け表示** (選択=赤 / 上流=青 / 下流=緑 / 無関係=減光)
- 影響範囲の**深さと向き**を左サイドバーで指定する (`req explain --depth` / `--undirected` 相当)
- **検索ヒットを図の上でも暈しで示し、↑↓ と Enter でキーボードから選べる**
- **Goal / Need は不要な横方向の空白を詰めて帯 (枠) にまとめ、常に図の上に表示**する
- **Requirements の機能枠内でノードを折り返し**、各機能枠の幅を保って同じ段へ並べる
- グラフと**テーブル**の切り替え。表は棚卸し (全件を順に確認する作業) 用で、列見出しで並べ替える
- **status を枠線の線種で表示**する
- ノード種別・status・エッジ種別の絞り込み。**絞り込みは影響範囲の計算にも効く**
  (`req explain --edges` と同じ考え方)
- 本文・根拠・受け入れ基準・**源泉**・出所 (file:line)・出入りのエッジ・そのノードへの指摘を
  右ペインに表示。**出入りのエッジには相手ノードの本文を併記**する (飛ぶ前に何に
  繋がっているか読める)。源泉は図に描かないぶんここに出る ([源泉の扱い](#源泉の扱い))
- `--repo-url` を渡して生成すると、**出所が定義ファイルへのリンク**になる
- 「影響部分グラフをコピー」で `req explain` 相当のテキストをクリップボードへ (LLM 連携用)
- 検証結果の一覧。**重大度で絞り、チェックコードごとにまとめて**表示する。
  指摘をクリックすると該当ノードへ飛ぶ
- **いま見えているぶんだけ**を SVG / Mermaid (`.mmd`) で書き出す
- ドラッグでパン、ホイールでズーム。パンしても選択中のノードは解除されない
- 一覧や指摘から**画面外のノードを選ぶと、そこまで自動でパンする** (倍率は変えない)
- **フォーカス**: 選んだノードの近傍だけを図に描く。大きいモデルで文字が読める倍率を
  保つための表示戦略
- 選択・絞り込み・表示中のタブが **URL に載る**。URL を渡せば相手にも同じ画面が出る
- 配色は OS 設定に従い、ヘッダのボタンで**明 / 暗に固定**もできる。絞り込みは
  次に開いたときに戻る
- **SVG のノードを含むすべての操作要素をキーボードだけで辿れる**

出力ディレクトリには `index.html` のほか、`model.json` (正規化 JSON) と
`graph.mmd` / `graph.dot` も置かれる。`model.json` の各ノードには
`"location": "examples/sample.py:42"` が入るので、そこから定義に戻れる。

```console
$ req site examples/sample.py -o site --title "経費精算システムの要求グラフ"
$ python -m http.server -d site
```

> **なぜその作りなのか**は [`docs/design/site.md`](docs/design/site.md) にまとめてある
> (描画エンジンの選定、フォーカスと見送った候補、帯表示、日本語ラベルの折り返し、
> 表現の重ね順、表示状態の実装、JS の構成、ベンチ)。以下は画面の使い方に絞る。

### 図の読み方

**型は色と形、status は線種**で表す。2 つの軸が互いを潰さないように
割り当ててあるので、影響範囲を色で追いながら同時に status も読める。

| 軸 | 表現 | 割り当て |
|---|---|---|
| 型 | 形 + 塗り + 枠線の色 | `Goal` = 六角形 / 青、`Need` = 楕円 / 緑 … |
| status | 枠線の**線種** | `proposed` = 点線、`approved` = 破線、`implemented` = 実線、`verified` = 二重線 |

凡例には実際に効いているスタイルがそのまま出る。左サイドバーの
**status のチェックボックス**で絞り込め、種別・エッジ種別と同じ扱いなので、
外したノードは経路としても辿られなくなり、**影響範囲の計算結果が変わる**。

### 影響範囲の深さと向き

CLI の `req explain` は `--depth` で探索を何ホップかで切り、`--undirected` で
エッジの向きを無視して辿れる。同じ 2 つを左サイドバーの**影響範囲**に置いてある。

| 操作 | CLI | 効くところ |
|---|---|---|
| 探索の深さ (スライダ。既定は無制限) | `--depth N` | 色分け・詳細ペインの件数・コピー本文 |
| 向きを無視して辿る (チェック) | `--undirected` | 同上 |

- **画面とコピー本文は必ず一致する**。詳細ペインに出る `req explain ...` の行も
  設定に合わせて伸び縮みする
- 向きを無視したときは**上流と下流を区別しない** (図では 1 色 (紫) で塗る)。
  「この FR はなぜ作るのか」のように、有向の到達可能性では繋がらない文脈を集めるための表示である
- 深さ・向きを変えても**再レイアウトは走らない**。ノードの位置は動かない
- 絞り込み (種別・status・エッジ種別) とは重ねて効く。外したノードは
  経路として辿られないので、深さの数え方もそのぶん変わる

図に描く範囲を絞る**フォーカス**とは別物である。フォーカスは描画だけの絞り込みで、
影響範囲の件数やコピー本文には効かない。

### 検索のグラフ連動

検索欄はヒットしたノードを左の一覧に絞り込み、同時に**図の上でも暈しで示す**。

- 検索欄で **↑↓ を押すと候補を送り、Enter で選ぶ**。送っている最中の候補は一覧と図の
  両方で強く出て、画面外なら**そこまでパンする** (倍率は変えない)
- 候補の並びは左の一覧と同じ。端まで行くと巻き戻る
- 絞り込みで消えたノードはヒットに入らない。検索語が空ならヒットは 0 件
  (全件ハイライトしても意味が無いため)

### テーブルビュー

グラフは関係の把握に向くが、要求レビュー会での**棚卸し** (全件を順に確認していく作業)
には表のほうが向く。中央ペインのタブで切り替える。

| 列 | 中身 |
|---|---|
| id / type / 本文 / status | ノードの属性そのまま |
| 根拠 | `evidence` の件数 |
| 指摘 | そのノードに紐づく指摘の件数。最も重い severity の色が付く |

- **列見出しをクリックすると並べ替える**。type は種別の定義順、status は成熟度
  (`STATUS_RANK`) で並ぶ。辞書順には並べない
- 根拠・指摘が 0 件の行は 0 として並び、表示だけ `—` にする。並び替えの値そのものを
  持たない行 (成熟度表に無い status 等) は、昇順でも降順でも**末尾**に置く
- 同値の行は正規化 JSON の並び (型順 → id 順) で決まるので、押すたびに順番が入れ替わることは無い
- 数の列は 1 回目のクリックで**多い順**から始まる (指摘の多いものから潰す用)
- **絞り込み・検索・選択はグラフビューと共有する**
- **指摘の件数をクリックすると、そのノードへの指摘まで右ペインを送る**

### URL に載る表示状態 (パーマリンク)

「この FR を見て」と URL を渡したときに、相手の画面にも同じものが出るようにしてある。
表示状態は URL のハッシュが唯一の出典で、操作するたびに書き戻される。

```
index.html#node=FR-3&types=Goal,Need&dir=LR&view=table&q=領収書&sort=findings:desc
```

| 項目 | 中身 | 書かれないとき |
|---|---|---|
| `node` | 選択中のノード | 未選択 |
| `types` / `edges` | 表示中のノード種別 / エッジ種別 (定義順) | 全種別が ON |
| `status` | 表示中の status | 全部が ON |
| `dir` | グラフの向き (`LR`) | `TD` |
| `view` | 中央ペインのタブ (`table`) | グラフ |
| `focus` | フォーカスの深さ (`1` / `2` / `3` ホップ) | 切 (全体を描く) |
| `depth` | 影響範囲の探索の深さ (`1`〜`5` ホップ) | 無制限 |
| `undir` | 向きを無視して辿る (`1`) | 有向 |
| `q` | 検索語 | 空 |
| `sort` | テーブルの並び順 (`status:asc` / `findings:desc`) | `id:asc` |

**既定値は書かない**ので、載っている項目がそのまま「既定と違うところ」の一覧になる。
戻る/進むで表示状態を辿れる。ツールバーの**コピーアイコン**で、いまの表示状態の
URL をクリップボードへ。`#node=FR-3` だけを PR コメントや指摘一覧に貼れば、
そのノードへの**ディープリンク**になる。

なお**絞り込みと表示は `localStorage` にも残り、次に自分が開いたときに戻る**
(選択ノードと検索語は持ち越さない)。渡された URL のハッシュが最優先なので、
パーマリンクに相手の前回の絞り込みが混ざることはない。

### キーボード操作

**SVG のノードを含むすべての操作要素をキーボードで辿れる**。フォーカスの位置は `:focus-visible`
の輪郭で常に見える (マウス操作では出ない)。

| キー | 効果 |
|---|---|
| `/` | ノード検索の入力欄へ移る (文字を打ち込める場所にいるときを除く) |
| `↑` `↓` | 検索欄で候補を送る (図の上でも強調が動き、画面外ならそこまでパンする) |
| `Enter` / `Space` | SVG ノードを選ぶ。`Enter` は検索候補・一覧・表・指摘も開く |
| `←` `→` `Home` `End` | タブ (グラフ / テーブル、指摘の重大度) を移る |
| `Esc` | 選択を解除する → 検索語を消す → 入力欄から手を離す (この順) |

一覧・指摘・表の行はいずれも操作子 (`button` / `tabindex`) として出しているので、
tab キーだけで一巡できる。タブ群は選択中の 1 つだけが tab 順に乗り、間の移動は
←→ で行う (WAI-ARIA の tablist と同じ約束)。

### 定義ファイルへのリンク

出所 (`examples/sample.py:42`) は**生成時の作業ディレクトリからの相対パス**なので、
リポジトリの URL と参照を渡せば blob URL に組み立てられる。

```console
$ req site examples/sample.py -o site \
    --repo-url https://github.com/owner/repo --repo-ref "$(git rev-parse HEAD)"
```

右ペインの「出所」がリンクになり、`.../blob/<ref>/examples/sample.py#L42` を開く。
渡さなければ今まで通りただの文字列として出る。出所が絶対パスのとき
(リポジトリ内の位置が決まらないとき) はリンクにしない。

### 絞り込んだ図の書き出し

出力先に置かれる `graph.mmd` / `graph.dot` は**全体**のグラフである。画面で
絞り込んだ図をそのまま PR や資料に持っていけるよう、ツールバーから
**いま見えているぶんだけ**を書き出せる。

ツールバーのダウンロードアイコンを押し、プルダウンから形式を選ぶ。

| 形式 | 内容 |
|---|---|
| `SVG` | いま**図に描かれているもの**をそのまま 1 枚に。フォーカス中なら近傍だけ |
| `.mmd` | いま見えているノードとエッジの Mermaid。**絞り込みが無ければ `graph.mmd` と同一** |

サイトが書き出す図と CLI が出す図が別物にならないことは `tests/test_site_js.py` が
`examples/sample.py` で突き合わせている ([詳細](docs/design/site.md#書き出した図が-cli-と一致すること))。

### 大きいモデルでの表示 (フォーカス)

要求グラフは 1 つの Need に FR がぶら下がる形なので、図は極端に横長になる
(300 ノードのベンチ用モデルでアスペクト比 26:1)。全体を収める倍率では文字が読めない。

ツールバーの選択で深さ (1〜3 ホップ) を選ぶと、図に描くのは**選択ノードの近傍だけ**に
なり、その部分グラフだけで並べ直す。

フォーカスは**図の描画にしか効かない**。左の一覧・テーブル・上流/下流の件数・
「影響部分グラフをコピー」の本文は、フォーカス中も全体のまま変わらない。
深さと選択は URL に載る (`#node=FR-120&focus=1`) ので、「この要求の周りを見て」を
リンク 1 本で渡せる。

測定値と、見送ったほかの案は
[`docs/design/site.md`](docs/design/site.md#大きいグラフでの表示戦略-フォーカス) にある。

## このリポジトリ自身の要求モデル (dogfooding)

要求管理ツールでありながら自分の要求だけが要求管理されていない、という状態を避けるため、
**このツール自身の要求をルートの `requirements.py` に置いてある**。実装済みの機能と、
開いている issue の両方が対象である (54 ノード / 116 エッジ)。

`loader.DEFAULT_PATHS` がルートの `requirements.py` を見るので、リポジトリ内では
引数なしでそのままこのモデルを読む。CI (`.github/workflows/ci.yml`) も
`req validate --strict requirements.py` を回している。

```console
$ req validate --strict     # requirements.py が読まれる
$ req doc -o spec.md
$ req site -o site && python -m http.server -d site
```

自分に `--strict` を課すと、`verified` と書いた要求がすべて根拠を持ち、全要求が源泉を持ち、全 Need が satisfy され、
全 QR が張り先を持ち、全 Goal が要求群まで分解されている必要がある。**この制約を自分で
食らうことがモデル化の目的**で、実際に次のことが分かった。

- **外部の課題管理への参照を持つ場が無い。** 未着手の FR と GitHub issue を対応付けたいが、
  メタモデルにそのフィールドが無く、issue ごとに `Source` を作るのは意味的に歪む。
  現状は**ノード直前のコメント** (`# → issue #6`) に逃がしてある。コメントは AST に
  現れないのでモデルには入らない = 機械が辿れない
- **曖昧語辞書が語の使用と言及を区別しない。** 「安定」(ソートの安定性)、
  「高速」(曖昧語検査そのものの受け入れ基準に出てくる引用) が指摘される
- **`Goal` と `Need` を隔てる規則が語尾しか無く、自分の `Goal` 層が崩れていた。**
  `Need` の「〜たい」は層1 のエラーだが、`Goal` には本文の規則が一つも無い。その結果
  旧 Goal-2〜Goal-5 は動機づけている `Need` の言い換え (主語を落として願望形を
  「〜できる状態にする」に変えただけ) になり、旧 Goal-4 に至っては「**機械が**文脈を揃える」と
  システムを主語にしていた。中間 `Goal` 層を丸ごと消して 8 つの `Need` を旧 Goal-1 に
  直付けしても `--strict` は通り、この層は構造的な荷重を負っていなかった。
  一方で主語の規約 (`Need` だけが役割を書く) は両モデルの該当ノードすべてで守られており、
  **規約は存在するのに文書にも検査にも無かった**。型の選び方は
  [どの型に書くか](#どの型に書くか-主語で決める)に書き下し、`Goal` の本文もそれに従って
  直したが、**機械の検査は無いままである**
- **未着手の要求に張った制約が `structure.status_inconsistent` になっていた。**
  検査のほうを直し、`constrains` を対象外にした
  ([理由](docs/design/model.md#constrains-を-structurestatus_inconsistent-の対象から外した))。
  誤検出そのものが直った例

残る指摘は抑制 (waiver) で理由付きで残してあり、`req validate --show-suppressed` で読める。
**`--strict` を通すために表現を歪めてはいない**。2 件の抑制はすべて理由が書かれ、
対象の指摘が消えれば `waiver.stale` で気付ける。

## GitHub Pages への公開

`.github/workflows/pages.yml` が、`main` への push (と手動実行) をきっかけに
`req validate --strict` → `req site` → デプロイまで行う。検証が通らなければ公開されない。
ツール自体のテストは同じ push で `ci.yml` が回すので、こちらでは繰り返さない。

**リポジトリ側の設定が 1 つだけ必要**: Settings → Pages → Build and deployment の
Source を **GitHub Actions** にする。これは API やワークフローからは設定できない。

公開されるのは 2 つ。`build_site` は 1 回 1 ディレクトリなので、ワークフローで 2 回叩く
(別のグラフなので 1 回にまとめると id が衝突する)。

| 場所 | 中身 |
|---|---|
| `/` | このリポジトリ自身の要求モデル (`requirements.py`) |
| `/sample/` | 経費精算システムの例 (`examples/sample.py`)。使い方の見本 |

描画ライブラリの参照は相対パスなので、`--assets local` で公開するときは
**ページを置いたディレクトリごとに** ライブラリを置く。自分の定義ファイルを公開するときは
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
$ npm run bench   # 300 ノード級の合成グラフで探索の時間を測る
```

`pytest` からも同じものが走る (`tests/test_site_js.py`)。node が入っていない環境では
skip されるので、CI では `.github/workflows/ci.yml` が node を明示的に用意している。

## パッケージ構成

`reqmodel` は責務ごとに一方向の依存関係を持つサブパッケージへ分割している。

- `reqmodel.definition`: 定義ファイルの利用者が使うノード型・補助型
- `reqmodel.core`: メタモデル、正規化グラフ、既定の投影ポリシー
- `reqmodel.application`: 読み込み、検証、変更分析、説明・文書・統計生成のユースケース
- `reqmodel.presentation`: Mermaid / DOT、描画スタイル、静的サイト

CLI は引数解析と入出力を担当し、`application → core → definition` の向きでユースケースを
Python API として再利用できる。`presentation` も `core` を利用する。各責務の API は
これらの正規サブパッケージから import する。要求定義向けの
`from reqmodel import Goal, Need, FR, QR` はトップレベルの公開 API である。

## 設計判断の記録

規則や実装の「なぜ」は `docs/design/` に置いてある。

| 文書 | 中身 |
|---|---|
| [`docs/design/model.md`](docs/design/model.md) | 語尾規則を指示書より緩く取った理由、`constrains` を成熟度検査から外した理由、`Decision` と `conflicts` を置かない理由、型を分ける基準 |
| [`docs/design/site.md`](docs/design/site.md) | 描画エンジンの選定、フォーカスと見送った候補、帯表示、日本語ラベルの折り返し、表示状態の実装、JS の構成 |

## 非スコープ

**意図して持たないものは Constraint として `requirements.py` にモデル化してある。**
RDB / 外部ストレージを持たないこと、LLM API を直接呼ばず文脈生成に留めること、
定義ファイルを実行しないこと、実行時の依存を pydantic だけに保つこと、公開サイトを
外部への通信なしで表示できるようにすること — いずれも `req doc -o spec.md` の
「3. 制約」に一覧で出る。ここに散文で書き写すと二重管理になるので置かない。

モデルに載せていない非スコープは次の 3 つ。

- 要求を**編集する** Web UI (`req site` が出すのは閲覧専用の静的サイト)
- i* のアクター依存モデル、KAOS の Obstacle
- 複数体系の統合メタモデル

未着手の機能 (MCP サーバ、SARIF 出力、設定ファイル等) は非スコープではなく
`proposed` の要求として `requirements.py` に載っている。
