/**
 * `nodeContext()` を Python 側から呼ぶための橋渡し。
 *
 * 標準入力に `{"data": <site_data()>, "requests": [{"id": ..., "edges": [...]}]}`
 * を渡すと、各要求に対する `nodeContext()` の出力を JSON 配列で標準出力に返す。
 * edges を省略すると全種別 (絞り込み無し) として扱う。
 *
 * これ自体はテストではない (`tests/test_site_js.py` から呼ばれる)。
 */

import { createView, nodeContext } from "../../src/reqmodel/site_logic.js";

const input = JSON.parse(await new Response(process.stdin).text());
const { data, requests } = input;

const output = requests.map(({ id, types, edges }) =>
  nodeContext(
    createView(data, {
      types: new Set(types ?? data.types),
      edges: new Set(edges ?? data.edge_names),
    }),
    id,
  ),
);

process.stdout.write(JSON.stringify(output));
