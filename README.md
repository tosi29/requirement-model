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
| `--rev REV` | plan | 比較先のリビジョン (既定: `HEAD`) |
| `--edges a,b` | plan, explain | 辿るエッジ種別を限定する |
| `--depth N` | explain | 探索の深さ上限 |
| `--undirected` | explain | エッジの向きを無視して辿る |
| `--highlight ID,ID` | graph | 指定ノードを強調する |
| `--title` / `--mermaid` | site | ページ題名 / 描画ライブラリの参照先 |

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

`id` / `text` / `status` (`proposed` → `approved` → `implemented` → `verified`) / `priority`。
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

「FR から Goal への到達」は `FR --refines--> FR --satisfies--> Need <--motivates-- Goal`
の経路で判定する。曖昧語辞書は `src/reqmodel/lexicon.py` で編集できる。

## 変更影響分析

```
impact(n) = ancestors(n) ∪ descendants(n)   # --edges でエッジ型を絞れる
```

`req plan` は git 前版の定義ファイルを (実行せずに) 読んで正規化し、ノード単位・
フィールド単位の差分と、変更されたノードの影響範囲を出す。

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
- 本文・受け入れ基準・出入りのエッジ・そのノードへの指摘を右ペインに表示
- 「影響部分グラフをコピー」で `req explain` 相当のテキストをクリップボードへ (LLM 連携用)
- 検証結果の一覧。指摘をクリックすると該当ノードへ飛ぶ

出力ディレクトリには `index.html` のほか、`model.json` (正規化 JSON) と
`graph.mmd` / `graph.dot` も置かれる。

```console
$ req site examples/sample.py -o site --title "経費精算システムの要求グラフ"
$ python -m http.server -d site
```

描画には Mermaid (バージョン固定の UMD ビルド) を使う。既定では CDN を参照するが、
`--mermaid mermaid.min.js` を渡して同じディレクトリに UMD ビルドを置けば、
外部への通信が一切無い自己完結のサイトになる。Pages のワークフローはこの方式で公開する。

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
