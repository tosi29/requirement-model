/**
 * `mermaidText()` を Python 側から呼ぶための橋渡し。
 *
 * 標準入力に `{"data": <site_data()>, "types": [...], "edges": [...]}` を渡すと、
 * その絞り込みでの Mermaid を標準出力に返す。types / edges を省略するとページの
 * 初期状態 (Source と源泉エッジが外れた状態 = `render_mermaid()` と同じ結果に
 * なるはず)。
 *
 * これ自体はテストではない (`tests/test_site_js.py` から呼ばれる)。
 */

import {
  createView,
  initialSelection,
  mermaidText,
} from "../../src/reqmodel/presentation/site_logic.js";

const { data, types, edges } = JSON.parse(await new Response(process.stdin).text());

const view = createView(data, {
  types: new Set(types ?? initialSelection(data, data.types, "types")),
  edges: new Set(edges ?? initialSelection(data, data.edge_names, "edges")),
});

process.stdout.write(mermaidText(view));
