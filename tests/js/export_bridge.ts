/**
 * `mermaidText()` を Python 側から呼ぶための橋渡し。
 *
 * 標準入力に `{"data": <site_data()>, "types": [...], "edges": [...]}` を渡すと、
 * その絞り込みでの Mermaid を標準出力に返す。types / edges を省略するとページの
 * 初期状態 (`render_mermaid()` と同じ結果になるはず)。
 *
 * これ自体はテストではない (`tests/test_site_js.py` から呼ばれる)。
 */

import { text } from "node:stream/consumers";
import {
  createView,
  defaultState,
  mermaidText,
} from "../../src/reqmodel/presentation/site_logic.ts";
import type { SiteData } from "../../src/reqmodel/presentation/site_types.ts";

interface ExportInput {
  data: SiteData;
  types?: string[];
  edges?: string[];
}

const { data, types, edges }: ExportInput = JSON.parse(await text(process.stdin));

const initial = defaultState(data);
const view = createView(data, {
  ...initial,
  types: types ? new Set(types) : initial.types,
  edges: edges ? new Set(edges) : initial.edges,
});

process.stdout.write(mermaidText(view));
