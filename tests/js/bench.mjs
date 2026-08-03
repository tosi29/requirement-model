/**
 * `site_logic.js` の探索まわりのベンチ。`npm run bench` で走る (テストではない)。
 *
 * 300 ノード級の合成グラフ (`largeFixture()`。examples/bench.py と同じ形) に対して、
 * ページ上で実際に回る経路を回数ぶん回して時間を測る。
 *
 *   node tests/js/bench.mjs [ノード数の倍率]
 *
 * 隣接マップを入れる前の実装 (全エッジ走査) も同じ入力で測り、比を出す。
 * 実装を直したときに「速くなったつもり」で終わらせないための、唯一の物差し。
 */

import { createView, focusSet, reach } from "../../src/reqmodel/presentation/site_logic.js";
import { allOn, largeFixture } from "./fixture.mjs";

/** 隣接マップを使わない、書き換え前の reach()。比較対象として残してある。 */
function reachByScan(view, start, forward) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of view.edges) {
      const from = forward ? edge.source : edge.target;
      const to = forward ? edge.target : edge.source;
      if (from !== current || to === start || seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

const scale = Number(process.argv[2] || 1);
const data = largeFixture({
  goals: Math.round(12 * scale),
  needs: Math.round(24 * scale),
  frs: Math.round(200 * scale),
  qrs: Math.round(60 * scale),
});
const state = allOn(data);
const view = createView(data, state);

/** fn を全ノードぶん回す時間 (ms)。3 回測って最小を採る。 */
function measure(fn) {
  let best = Infinity;
  for (let round = 0; round < 3; round++) {
    const started = performance.now();
    for (const node of view.nodes) fn(node.id);
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

const ms = (value) => `${value.toFixed(1)} ms`;

console.log(`規模: ${data.nodes.length} ノード / ${data.edges.length} エッジ`);
console.log(`createView() 1 回: ${ms(measure(() => createView(data, state)) / view.nodes.length)}`);

//: ノードを 1 つ選ぶたびに上流・下流の 2 回 (詳細ペインとハイライトで使い回す)。
const scan = measure((id) => {
  reachByScan(view, id, true);
  reachByScan(view, id, false);
});
const adjacency = measure((id) => {
  reach(view, id, true);
  reach(view, id, false);
});
console.log(`reach() 全ノード × 上下流:`);
console.log(`  全エッジ走査 (旧): ${ms(scan)}`);
console.log(`  隣接マップ (現) : ${ms(adjacency)}  (${(scan / adjacency).toFixed(1)} 倍)`);

for (const depth of [1, 2, 3]) {
  console.log(`focusSet(深さ ${depth}) 全ノード: ${ms(measure((id) => focusSet(view, id, depth)))}`);
}
