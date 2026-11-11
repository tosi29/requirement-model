/**
 * `nodeContext()` を Python 側から呼ぶための橋渡し。
 *
 * 標準入力に `{"data": <site_data()>, "requests": [{"id": ..., "edges": [...],
 * "depth": N, "undirected": true}]}` を渡すと、各要求に対する `nodeContext()` の
 * 出力を JSON 配列で標準出力に返す。edges を省略するとページの初期状態
 * (`req explain ID` と同じ)、depth を省略すると
 * 無制限、undirected を省略すると有向として扱う。
 *
 * これ自体はテストではない (`tests/test_site_js.py` から呼ばれる)。
 */

import { text } from "node:stream/consumers";
import {
  createView,
  defaultState,
  nodeContext,
} from "../../src/reqmodel/presentation/site_logic.ts";
import type { SiteData } from "../../src/reqmodel/presentation/site_types.ts";

interface ContextInput {
  data: SiteData;
  requests: {
    id: string;
    types?: string[];
    edges?: string[];
    depth?: number;
    undirected?: boolean;
  }[];
}

const { data, requests }: ContextInput = JSON.parse(await text(process.stdin));

const initial = defaultState(data);
const output = requests.map(({ id, types, edges, depth, undirected }) =>
  nodeContext(
    createView(data, {
      ...initial,
      types: types ? new Set(types) : initial.types,
      edges: edges ? new Set(edges) : initial.edges,
      depth: depth ?? 0,
      undirected: Boolean(undirected),
    }),
    id,
  ),
);

process.stdout.write(JSON.stringify(output));
