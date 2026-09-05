/**
 * `nodeContext()` を Python 側から呼ぶための橋渡し。
 *
 * 標準入力に `{"data": <site_data()>, "requests": [{"id": ..., "edges": [...],
 * "depth": N, "undirected": true}]}` を渡すと、各要求に対する `nodeContext()` の
 * 出力を JSON 配列で標準出力に返す。edges を省略するとページの初期状態
 * (源泉エッジだけ外れた状態 = `req explain ID` と同じ)、depth を省略すると
 * 無制限、undirected を省略すると有向として扱う。
 *
 * これ自体はテストではない (`tests/test_site_js.py` から呼ばれる)。
 */

import {
  createView,
  initialSelection,
  nodeContext,
} from "../../src/reqmodel/presentation/site_logic.ts";

const input = JSON.parse(await new Response(process.stdin).text());
const { data, requests } = input;

const output = requests.map(({ id, types, edges, depth, undirected }) =>
  nodeContext(
    createView(data, {
      types: new Set(types ?? initialSelection(data, data.types, "types")),
      edges: new Set(edges ?? initialSelection(data, data.edge_names, "edges")),
      depth: depth ?? 0,
      undirected: Boolean(undirected),
    }),
    id,
  ),
);

process.stdout.write(JSON.stringify(output));
