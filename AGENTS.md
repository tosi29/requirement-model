# AI エージェント作業規約

この文書は、AI エージェントがこのリポジトリを変更するときの入口である。
既存文書の仕様や設計理由はここへ複製せず、次の原典を確認すること。

## 参照先

- `README.md`: 現在の仕様、利用方法、検査規則
- `docs/design/`: 設計判断とその理由
- `requirements.py`: このツール自身の要求モデル
- 対象の GitHub Issue: 変更の背景と完了条件

原典と実装に食い違いがあれば、推測で一方へ合わせず、変更意図を確認する。

## 基本原則

- 意味の判断は人間と LLM、構造の判断は機械が担当する。
- 要求定義ファイルは実行せず、AST から読み取る。
- 正規化 JSON を検証・分析・表示の共通表現とする。
- 同じ情報を複数箇所で管理しない。

## GitHub でのコミュニケーション

GitHub Issue や Pull Request の作成、およびそれらへのコメントは日本語で行う。

## アーキテクチャ境界

依存方向を次の一方向に保つ。

```text
presentation
     ↓
    core
     ↓
definition
```

- `definition`: 利用者が直接使う公開型
- `core`: グラフ、正規化、検証、分析、探索
- `presentation`: Mermaid、DOT、静的サイト、色、形状、UI

`definition` から `core` や `presentation` へ依存させない。
表示上の都合だけで公開ノード型へフィールドを追加しない。

## 互換性

内部構成を変更しても、明示的な破壊的変更でない限り次の import を維持する。

```python
from reqmodel import Goal, Need, FR, QR, Constraint, Source, System
```

既存の要求定義、CLI、終了コード、チェックコード、正規化 JSON を意図せず変更しない。
公開された振る舞いを変更する場合は、関連するテストと文書も同時に更新する。

## メタモデル変更

ノード型、フィールド、エッジ、status、検査規則を変更するときは、次を確認する。

- 現在の構造上の事実を表しているか。
- 正誤を機械が区別できるか。
- 既存の型やエッジから導出できないか。
- 表示や作業管理だけを目的としていないか。
- 新しい型に既存型と異なる構造規則があるか。

変更の影響を loader、正規化 JSON、グラフ、検証、分析、CLI、文書、表示まで追う。

## Dogfooding

利用者向け機能、制約、品質保証を変更した場合は、`requirements.py` の更新要否を確認する。
単なる内部リファクタリングでは、無理に要求ノードを追加しない。
`--strict` を通すためだけに要求表現を歪めない。

## 完了前の検証

開発依存を導入し、次を実行する。

```console
pip install -e ".[dev]"
pytest -q
mypy

req validate --strict requirements.py
req validate --strict examples/sample.py
req validate --strict examples/bench.py

npm run lint
npm test
```

各定義ファイルは別のグラフなので、まとめて検証しない。
JavaScript の探索や表示性能へ影響する場合は `npm run bench` も実行する。
実行できない検証があれば、理由と未確認の範囲を作業報告へ明記する。
