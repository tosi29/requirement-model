/**
 * `mermaidText()` を Python 側から呼ぶための橋渡し。
 *
 * 標準入力に `{"data": <site_data()>, "types": [...], "edges": [...]}` を渡すと、
 * その絞り込みでの Mermaid を標準出力に返す。types / edges を省略すると
 * 絞り込み無し (= `render_mermaid()` と同じ結果になるはず)。
 *
 * これ自体はテストではない (`tests/test_site_js.py` から呼ばれる)。
 */

import { createView, mermaidText } from "../../src/reqmodel/site_logic.js";

const { data, types, edges } = JSON.parse(await new Response(process.stdin).text());

const view = createView(data, {
  types: new Set(types ?? data.types),
  edges: new Set(edges ?? data.edge_names),
});

process.stdout.write(mermaidText(view));
