# メタモデルと検査規則の設計判断

README の[メタモデル](../../README.md#メタモデル)と[検証 (3層)](../../README.md#検証-3層)が
規則そのものを書くのに対し、ここは**なぜその規則なのか**を残す。
規則を変えるとき、同じ議論を繰り返さないための文書。

## 語尾規則を指示書より緩く取った

初回の実装指示書 (issue #1) の記述をそのまま条件式にすると実務的に破綻する箇所が
2 つあり、意図を汲んで次のように解釈した。

- **Need の語尾規則**: 指示書は「〜したい」。ただし「気づきたい」「知りたい」のような
  サ変以外の願望形を弾いてしまうため、**「〜たい」**で判定する。
- **FR の語尾規則**: 指示書は「〜すること」。同様に「読み取ること」「送ること」を弾くため、
  **「〜こと」**で判定する。

いずれも末尾の句点は許容する。厳密に「〜したい」「〜すること」に戻すなら
`src/reqmodel/model.py` の `_check_suffix` 2 か所を変えるだけでよい。

## `constrains` を `structure.status_inconsistent` の対象から外した

`structure.status_inconsistent` が見るのは `satisfies` / `refines` / `qualifies` /
`motivates` の 4 種で、**`constrains` は対象外**である (`validate.py` の `_STATUS_EDGES`)。

制約は制約対象より先に決まりうる。「MCP サーバを作るなら依存を増やさない範囲で」は
着手前に決まっているからこそ意味があり、承認済みの Constraint が proposed の要求を
指すのは成熟度の逆転ではない。制約側の status を下げれば黙るが、それは実態に反する。

これは[このリポジトリ自身の要求モデル](../../README.md#このリポジトリ自身の要求モデル-dogfooding)を
`--strict` に通す過程で見つかった誤検出である。approved な Constraint が proposed な
FR を `constrains` した結果が報告され、抑制ではなく検査そのものを直した (#47)。

## 型を分ける基準

**型ごとに異なる構造規則が存在するときだけ型を分ける**。

- FR と QR は分ける。`qualifies` を出せるのは QR のみで、孤立検出の規則も異なる
- `Source` は単一型とし、`kind: "stakeholder" | "document" | "existing_system"` で
  分類する。3 種の構造的振る舞いが同一のため。将来 Stakeholder 固有のエッジが
  必要になったら `Stakeholder(Source)` としてサブクラス化すればよく、エッジ型定義は
  `Ref[Source]` のまま無傷
