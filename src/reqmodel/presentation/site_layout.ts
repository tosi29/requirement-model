// @ts-nocheck
import { LABEL_FONT, LABEL_MAX_LENGTH, LABEL_WRAP_WIDTH, escapeAttr, escapeHtml, labelChunks, nodeSize, truncate, estimateTextWidth, wrapLabel } from "./site_text.ts";
import { compare, fieldLabel } from "./site_graph.ts";
// --- SVG 描画に渡す値 -------------------------------------------------------
//
// 生成するのはただのオブジェクトなので、ライブラリを読み込まなくてもテストできる。

/** Requirements 段に入る型。 */
const REQUIREMENT_TYPES = new Set([
  "FunctionalRequirement",
  "QualityRequirement",
  "Constraint",
]);

/** 帯 (枠) の定義。Goal / Need は型ごと、Requirements は表示用グループごとに作る。 */
export function bandDefs(data) {
  const top = ((data.meta || {}).bands || [])
    .filter((band) => data.nodes.some((node) => node.type === band.type))
    .map((band) => ({ ...band, key: band.type }));

  if (!Object.prototype.hasOwnProperty.call(data, "requirement_groups")) return top;

  const groups = [...(data.requirement_groups || [])].sort(
    (a, b) => (a.order || 0) - (b.order || 0) || compare(a.id, b.id),
  );
  const assigned = new Set();
  const requirementIds = new Set(
    data.nodes.filter((node) => REQUIREMENT_TYPES.has(node.type)).map((node) => node.id),
  );
  const requirementBands = [];
  for (const group of groups) {
    const members = [];
    for (const id of group.members || []) {
      if (!requirementIds.has(id) || assigned.has(id)) continue;
      assigned.add(id);
      members.push(id);
    }
    if (members.length) {
      requirementBands.push({
        key: `group:${group.id}`,
        label: group.label,
        groupId: group.id,
        members,
      });
    }
  }
  const unclassified = [...requirementIds].filter((id) => !assigned.has(id));
  if (unclassified.length) {
    requirementBands.push({
      key: "group:__unclassified__",
      label: "未分類",
      groupId: "__unclassified__",
      members: unclassified,
    });
  }
  return [...top, ...requirementBands];
}

/** 表示中ノードに対して可視にする帯枠の key。 */
export function visibleBandKeys(data, shownNodes) {
  const ids = new Set(shownNodes.map((node) => node.id));
  const types = new Set(shownNodes.map((node) => node.type));
  const keys = new Set();
  for (const band of bandDefs(data)) {
    const visible = band.members
      ? band.members.some((id) => ids.has(id))
      : types.has(band.type);
    if (visible) keys.add(band.type || band.key);
  }
  return keys;
}

/** 帯枠ノードの id。ノード id と衝突しない接頭辞を付ける。 */
export const bandId = (key) => `band:${key}`;

/**
 * 図の要素定義。ノードとエッジの全件を一度だけ作る。
 *
 * status をデータに載せておくと、スタイル側は属性セレクタ
 * (`node[status = "..."]`) で拾える。絞り込みで作り直す必要が無い。
 *
 * meta.bands に挙がった型 (Goal / Need) には帯枠を 1 つずつ足す。グループ化ノードは使わない。枠はただの背面描画で、位置と大きさは
 * `bandedLayout()` の結果 (frames) から与える。
 *
 * ノードの外形 (w / h) もここで決める。ラベルの外接矩形をそのまま使うと
 * ラベルの外接矩形になり、六角形や菱形では文字が図形の外に出る。measure は
 * ラベル 1 行の幅 (px) を返す関数で、省略すると概算 (`estimateTextWidth`) を使う。
 */
export function graphElements(data, measure = estimateTextWidth) {
  const bands = bandDefs(data);
  const types = (data.meta || {}).types || {};
  return [
    ...data.nodes.map((node) => {
      const text = wrapLabel(truncate(node.text, LABEL_MAX_LENGTH), LABEL_WRAP_WIDTH, measure);
      const label = `${node.id}\n${text}`;
      const size = nodeSize(label, (types[node.type] || {}).fit, measure);
      return {
        data: {
          id: node.id,
          type: node.type,
          status: node.status,
          label,
          w: size.w,
          h: size.h,
        },
      };
    }),
    ...data.edges.map((edge, index) => ({
      data: {
        id: `e${index}`,
        index,
        source: edge.source,
        target: edge.target,
        name: edge.name,
      },
    })),
    ...bands.map((band) => ({
      //: w / h は applyBanding が実測で入れ直すまでの仮の値。
      data: {
        id: bandId(band.key),
        band: true,
        bandType: band.type || "RequirementGroup",
        bandKey: band.type || band.key,
        label: band.label,
        w: 10,
        h: 10,
      },
      classes: "band",
      selectable: false,
      grabbable: false,
    })),
  ];
}

// --- 凡例 ------------------------------------------------------------------

//: 凡例の見本は小さいので、太い枠 (verified の double 等) はここで頭打ちにする。
const LEGEND_MAX_BORDER = 3;

/**
 * 凡例に出す項目。図に効いているスタイルと同じ meta から作るので、
 * `render_meta()` に定義を足せば凡例にもそのまま並ぶ。
 *
 * 各 swatch は CSS の border 指定にそのまま写せる形にしてある
 * (`borderColor` が null ならテーマの文字色を使う、の意味)。
 */
export function legendGroups(meta, colorScheme = "light") {
  const dark = colorScheme === "dark";
  const groups = [
    {
      title: "種別",
      items: Object.entries(meta.types).map(([type, typeMeta]) => ({
        label: type,
        swatch: {
          background: dark ? typeMeta.dark_fill || typeMeta.fill : typeMeta.fill,
          borderColor: dark ? typeMeta.dark_stroke || typeMeta.stroke : typeMeta.stroke,
          borderStyle: "solid",
          borderWidth: 1,
        },
      })),
    },
  ];

  const statuses = Object.entries(meta.statuses || {});
  if (statuses.length) {
    groups.push({
      title: fieldLabel("status"),
      items: statuses.map(([status, statusMeta]) => ({
        label: status,
        swatch: {
          background: "transparent",
          borderColor: null,
          borderStyle: statusMeta.border_style,
          borderWidth: Math.min(statusMeta.border_width, LEGEND_MAX_BORDER),
        },
      })),
    });
  }

  return groups;
}

/**
 * ノードが表示範囲に収まっているか。extent も box も SVG のモデル座標
 * `{x1, y1, x2, y2}`。
 *
 * margin は端に貼り付いた状態を「見えている」と扱わないための余白。
 * ノードが視野より大きくて収めようが無いときは、中心が見えていれば十分とする
 * (そうしないと選ぶたびに毎回パンすることになる)。
 */
export function isNodeVisible(extent, box, margin = 0) {
  const inner = {
    x1: extent.x1 + margin,
    y1: extent.y1 + margin,
    x2: extent.x2 - margin,
    y2: extent.y2 - margin,
  };
  const fits =
    box.x2 - box.x1 <= inner.x2 - inner.x1 && box.y2 - box.y1 <= inner.y2 - inner.y1;
  if (fits) {
    return (
      box.x1 >= inner.x1 && box.x2 <= inner.x2 && box.y1 >= inner.y1 && box.y2 <= inner.y2
    );
  }
  const centerX = (box.x1 + box.x2) / 2;
  const centerY = (box.y1 + box.y2) / 2;
  return (
    centerX >= extent.x1 &&
    centerX <= extent.x2 &&
    centerY >= extent.y1 &&
    centerY <= extent.y2
  );
}

/** 最終ノード座標から、短い二次 Bézier の制御点を作る。 */
export function edgeControl(source, target, direction, offset = 0) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const control = {
    x: (source.x + target.x) / 2 + (-dy / length) * offset,
    y: (source.y + target.y) / 2 + (dx / length) * offset,
  };
  const sameRank = direction === "LR" ? Math.abs(dx) < 8 : Math.abs(dy) < 8;
  if (!sameRank) return control;
  const span = direction === "LR" ? Math.abs(dy) : Math.abs(dx);
  const bend = Math.min(48, Math.max(8, span * 0.12));
  if (direction === "LR") control.x -= bend;
  else control.y -= bend;
  return control;
}

/** 二次 Bézier の SVG path。 */
export function quadraticPath(start, control, end) {
  const coord = (value) => Math.round(value * 100) / 100;
  return `M ${coord(start.x)} ${coord(start.y)} Q ${coord(control.x)} ${coord(control.y)} ${coord(end.x)} ${coord(end.y)}`;
}

/** 二次 Bézier 上の点。ラベル位置にも描画と同じ曲線を使う。 */
export function quadraticPoint(start, control, end, t = 0.5) {
  const rest = 1 - t;
  return {
    x: rest * rest * start.x + 2 * rest * t * control.x + t * t * end.x,
    y: rest * rest * start.y + 2 * rest * t * control.y + t * t * end.y,
  };
}

/** dagre のレイアウト設定。direction は "TD" か "LR"。 */
export function layoutOptions(direction) {
  return {
    name: "dagre",
    rankDir: direction === "LR" ? "LR" : "TB",
    nodeSep: 24,
    rankSep: 56,
    edgeSep: 12,
    animate: false,
    fit: true,
    padding: 18,
  };
}

// --- 帯レイアウト -----------------------------------------------------------
//
// エッジの向きが混在している (motivates は Goal→Need と下向き、satisfies は
// FR→Need と上向き) ため、dagre に任せるだけでは Goal と FR が同じ高さに並ぶ。
// meta.bands に挙がった型 (Goal / Need) を主軸方向の帯にまとめ、常に図の上
// (LR なら左) に出す。dagre の結果は副軸方向の並び順にだけ使い、絶対座標や
// 不要な空白は引き継がない。

//: 帯の中の行間 (refines で親子になった Goal の段差)。
const BAND_ROW_GAP = 30;
//: 帯の中の横の間隔。dagre の nodeSep (24) に合わせる。
const BAND_SIBLING_GAP = 26;
//: 帯と帯・帯とその他の間隔。枠の余白とラベルのぶん広めに取る。
const BAND_GAP = 96;
//: ノードの外接矩形から枠までの余白。
const BAND_FRAME_PAD = 14;
//: RequirementGroup 内をカードとして詰めるときの既定最大幅。
const REQUIREMENT_GROUP_MAX_WIDTH = 600;
const REQUIREMENT_GROUP_GAP = 48;

/**
 * 帯の中の行分け。refines (子 → 親) で親を上の行に置く。
 * 親子が無い型 (Need) は 1 行になる。閉路は validate が指摘するので、
 * ここでは無限ループしないことだけを保証する。
 */
function bandRows(members, edges) {
  const ids = new Set(members.map((node) => node.id));
  const parents = new Map();
  for (const edge of edges) {
    if (edge.name !== "refines" || !ids.has(edge.source) || !ids.has(edge.target)) continue;
    if (!parents.has(edge.source)) parents.set(edge.source, []);
    parents.get(edge.source).push(edge.target);
  }
  const depth = new Map();
  const depthOf = (id, trail) => {
    if (depth.has(id)) return depth.get(id);
    if (trail.has(id)) return 0;
    trail.add(id);
    const above = (parents.get(id) || []).map((parent) => depthOf(parent, trail));
    const value = above.length ? Math.max(...above) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  const rows = [];
  for (const node of members) {
    const row = depthOf(node.id, new Set());
    (rows[row] ||= []).push(node);
  }
  return rows.filter(Boolean);
}

/**
 * dagre の結果を帯に並べ直した位置と、帯を囲む枠。
 *
 * bands は `bandDefs()` の並び (上からの帯の順)、placed は表示中の (帯枠以外の)
 * ノードと寸法 `{ id, type, x, y, w, h }`、edges は表示中のエッジ。
 *
 * 返り値は `{ positions, frames }`。positions は id → `{ x, y }` の Map で、
 * 全ノードぶん返す (帯に入らないノードは形を保ったまま帯の下へ平行移動する)。
 * frames は型 → `{ x, y, w, h }` (枠の中心と大きさ) の Map。
 * 帯のノードが 1 つも無ければ両方とも空。
 *
 * RequirementGroup 自体は 1 行のまま保ち、その全体幅を Goal / Need の共通幅にも
 * 使う。グループ内のノードだけを指定された最大幅で折り返す。
 */
export function bandedLayout(bands, placed, edges, direction, options = {}) {
  const positions = new Map();
  const frames = new Map();
  const membersOf = bands.map((band) => {
    const ids = band.members ? new Set(band.members) : null;
    return placed.filter((node) => (ids ? ids.has(node.id) : node.type === band.type));
  });
  if (!membersOf.some((members) => members.length)) return { positions, frames };

  //: TD では y が主軸 (帯の積み方向)・x が副軸。LR では逆になる。
  const vertical = direction !== "LR";
  const pri = (node) => (vertical ? node.y : node.x);
  const sec = (node) => (vertical ? node.x : node.y);
  const priSize = (node) => (vertical ? node.h : node.w);
  const secSize = (node) => (vertical ? node.w : node.h);
  const at = (secValue, priValue) =>
    vertical ? { x: secValue, y: priValue } : { x: priValue, y: secValue };
  const positionSec = (id) => {
    const position = positions.get(id);
    return vertical ? position.x : position.y;
  };
  const topOf = (nodes) => Math.min(...nodes.map((node) => pri(node) - priSize(node) / 2));
  const groupMaxWidth = Math.max(1, options.groupMaxWidth || REQUIREMENT_GROUP_MAX_WIDTH);

  /** 1 グループを原点基準で詰める。dagre の座標は順序にだけ使う。 */
  const layoutGroup = (members, maxWidth) => {
    const contentLimit = Math.max(1, maxWidth - BAND_FRAME_PAD * 2);
    const positions = new Map();
    let rowTop = 0;
    let contentWidth = 0;
    for (const depthRow of bandRows(members, edges)) {
      depthRow.sort((a, b) => sec(a) - sec(b));
      let line = [];
      let lineWidth = 0;
      const finishLine = () => {
        if (!line.length) return;
        const height = Math.max(...line.map(priSize));
        let offset = 0;
        for (const node of line) {
          const size = secSize(node);
          positions.set(node.id, { sec: offset + size / 2, pri: rowTop + height / 2 });
          offset += size + BAND_SIBLING_GAP;
        }
        contentWidth = Math.max(contentWidth, lineWidth);
        rowTop += height + BAND_ROW_GAP;
        line = [];
        lineWidth = 0;
      };
      for (const node of depthRow) {
        const nextWidth = lineWidth + (line.length ? BAND_SIBLING_GAP : 0) + secSize(node);
        if (line.length && nextWidth > contentLimit) finishLine();
        line.push(node);
        lineWidth += (line.length > 1 ? BAND_SIBLING_GAP : 0) + secSize(node);
      }
      finishLine();
    }
    return {
      positions,
      width: contentWidth + BAND_FRAME_PAD * 2,
      height: rowTop - BAND_ROW_GAP + BAND_FRAME_PAD * 2,
    };
  };

  // 1. 型帯は縦に積み、RequirementGroup は同じ Requirements 段の中で横に並べる。
  const banded = new Set();
  const spans = new Map();
  let cursor = topOf(placed);
  let index = 0;
  while (index < bands.length) {
    if (bands[index].members) {
      const sectionFrom = cursor;
      const sectionStart = Math.min(...placed.map((node) => sec(node) - secSize(node) / 2));
      const sectionBandIndexes = [];
      let groupLeft = sectionStart;
      let sectionTo = sectionFrom;
      while (index < bands.length && bands[index].members) {
        const members = membersOf[index];
        if (!members.length) {
          index += 1;
          continue;
        }
        for (const node of members) banded.add(node.id);
        const group = layoutGroup(members, groupMaxWidth);
        for (const node of members) {
          const local = group.positions.get(node.id);
          positions.set(
            node.id,
            at(
              groupLeft + BAND_FRAME_PAD + local.sec,
              sectionFrom + BAND_FRAME_PAD + local.pri,
            ),
          );
        }
        spans.set(index, {
          from: sectionFrom,
          to: sectionFrom + group.height,
          secMin: groupLeft,
          secMax: groupLeft + group.width,
        });
        sectionBandIndexes.push(index);
        sectionTo = Math.max(sectionTo, sectionFrom + group.height);
        groupLeft += group.width + REQUIREMENT_GROUP_GAP;
        index += 1;
      }
      for (const bandIndex of sectionBandIndexes) spans.get(bandIndex).to = sectionTo;
      cursor = sectionTo + BAND_GAP;
      continue;
    }

    const members = membersOf[index];
    if (!members.length) {
      index += 1;
      continue;
    }
    for (const node of members) banded.add(node.id);
    const from = cursor;
    for (const row of bandRows(members, edges)) {
      const height = Math.max(...row.map(priSize));
      //: dagre の並び順だけを保ち、帯の左端から一定間隔で 1 行に詰め直す。
      row.sort((a, b) => sec(a) - sec(b));
      let occupied = Math.min(...placed.map((node) => sec(node) - secSize(node) / 2));
      for (const node of row) {
        const half = secSize(node) / 2;
        const center = occupied + half;
        positions.set(node.id, at(center, cursor + height / 2));
        occupied = center + half + BAND_SIBLING_GAP;
      }
      cursor += height + BAND_ROW_GAP;
    }
    spans.set(index, { from, to: cursor - BAND_ROW_GAP });
    cursor += BAND_GAP - BAND_ROW_GAP;
    index += 1;
  }

  // 2. 帯に入らないノードは、形を保ったまま帯の下へ送る。
  const rest = placed.filter((node) => !banded.has(node.id));
  if (rest.length) {
    const shift = cursor - topOf(rest);
    for (const node of rest) {
      positions.set(node.id, at(sec(node), pri(node) + shift));
    }
  }

  // 3. 図の全幅 (副軸方向の範囲) を測る。型帯の枠幅と、中身を寄せる中心になる。
  const secCenter = (node) => positionSec(node.id);
  let secMin = Infinity;
  let secMax = -Infinity;
  for (const node of placed) {
    secMin = Math.min(secMin, secCenter(node) - secSize(node) / 2);
    secMax = Math.max(secMax, secCenter(node) + secSize(node) / 2);
  }
  let requirementSecMin = Infinity;
  let requirementSecMax = -Infinity;
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
    if (!bands[bandIndex].members || !spans.has(bandIndex)) continue;
    const span = spans.get(bandIndex);
    requirementSecMin = Math.min(requirementSecMin, span.secMin);
    requirementSecMax = Math.max(requirementSecMax, span.secMax);
    secMin = Math.min(secMin, span.secMin);
    secMax = Math.max(secMax, span.secMax);
  }
  const secMiddle = (secMin + secMax) / 2;
  const bandMiddle = Number.isFinite(requirementSecMin)
    ? (requirementSecMin + requirementSecMax) / 2
    : secMiddle;
  let typeSecSize = 0;
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
    if (bands[bandIndex].members || !membersOf[bandIndex].length) continue;
    let min = Infinity;
    let max = -Infinity;
    for (const node of membersOf[bandIndex]) {
      min = Math.min(min, secCenter(node) - secSize(node) / 2);
      max = Math.max(max, secCenter(node) + secSize(node) / 2);
    }
    typeSecSize = Math.max(typeSecSize, max - min + BAND_FRAME_PAD * 2);
  }
  const commonSecSize = Number.isFinite(requirementSecMin)
    ? requirementSecMax - requirementSecMin
    : typeSecSize;

  // 4. 型帯は全幅の中央へ寄せ、RequirementGroup 枠は各グループの外接矩形に掛ける。
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
    const members = membersOf[bandIndex];
    if (!members.length) continue;
    const span = spans.get(bandIndex);
    if (!span) continue;

    if (bands[bandIndex].members) {
      frames.set(bands[bandIndex].key, {
        ...at((span.secMin + span.secMax) / 2, (span.from + span.to) / 2),
        w: vertical
          ? span.secMax - span.secMin
          : span.to - span.from,
        h: vertical
          ? span.to - span.from
          : span.secMax - span.secMin,
      });
      continue;
    }

    let min = Infinity;
    let max = -Infinity;
    for (const node of members) {
      min = Math.min(min, secCenter(node) - secSize(node) / 2);
      max = Math.max(max, secCenter(node) + secSize(node) / 2);
    }
    const shift = bandMiddle - (min + max) / 2;
    for (const node of members) {
      const position = positions.get(node.id);
      positions.set(
        node.id,
        vertical
          ? { x: position.x + shift, y: position.y }
          : { x: position.x, y: position.y + shift },
      );
    }
    const framePriSize = span.to - span.from + BAND_FRAME_PAD * 2;
    frames.set(bands[bandIndex].type || bands[bandIndex].key, {
      ...at(bandMiddle, (span.from + span.to) / 2),
      w: vertical ? commonSecSize : framePriSize,
      h: vertical ? framePriSize : commonSecSize,
    });
  }
  return { positions, frames };
}

// --- 書き出し (Mermaid / SVG) ------------------------------------------------
//
// 出力先に置かれる `graph.mmd` / `graph.dot` は**全体**のグラフである。画面で
// 絞り込んだ図をそのまま PR や資料に持っていけるよう、いま見えているぶんだけを
// ページ側で書き出す。
//
// Mermaid は `render.py` の `render_mermaid()` と同じ書式で組む。絞り込みが無い
// ときは一字一句同じになり、`tests/test_site_js.py` が両者を突き合わせる。
// 形状・配色は meta が唯一の出典なので、ここには表を持たない。

//: ラベルの上限文字数 (`render.py` の max_label と同じ既定)。
const EXPORT_LABEL_LIMIT = 40;

/** `render.py` の `_truncate()`。空白を潰してから切る。 */
function collapse(text, limit) {
  const collapsed = String(text).split(/\s+/).filter(Boolean).join(" ");
  const chars = [...collapsed];
  if (limit > 0 && chars.length > limit) return chars.slice(0, limit - 1).join("") + "…";
  return collapsed;
}

/**
 * `render.py` の `_ids()`。ノード id → Mermaid の識別子 (`n1`, `n2`, …)。
 *
 * 元の id から作ると、記号を潰した結果が衝突する (`FR-1` と `FR_1` が同じ
 * 識別子になり、図の上で 1 ノードに融合する)。描く順の索引で連番を振れば
 * 衝突は起こり得ず、元の id はラベルに出るので情報も失われない。
 */
function exportIds(nodes) {
  return new Map(nodes.map((node, index) => [node.id, `n${index + 1}`]));
}

/** `render.py` の `_mermaid_escape()`。 */
function mermaidEscape(text) {
  return text
    .replace(/\\/g, "＼")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;");
}

/**
 * いま見えているグラフの Mermaid。`render_mermaid()` と同じ書式。
 *
 * 形状は `meta.types[].mermaid`、配色は `meta.types[].fill / stroke`、破線に
 * するエッジ種別は `meta.dashed_edges` から取る (どれも `render.py` が出典)。
 * classDef は全型ぶん出す (絞り込みで消えている型も含む) ので、絞り込みの
 * 有無で classDef の並びは変わらない。
 */
export function mermaidText(view, maxLabel = EXPORT_LABEL_LIMIT) {
  const meta = view.data.meta || {};
  const types = meta.types || {};
  const dashed = new Set(meta.dashed_edges || []);
  const ids = exportIds(view.nodes);
  const lines = ["flowchart TD"];

  for (const node of view.nodes) {
    const shape = (types[node.type] || {}).mermaid || { open: "[", close: "]" };
    const label = [
      `<b>${node.id}</b> [${node.type}]`,
      mermaidEscape(collapse(node.text, maxLabel)),
    ].join("<br/>");
    lines.push(`    ${ids.get(node.id)}${shape.open}"${label}"${shape.close}`);
  }

  lines.push("");
  for (const edge of view.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    const arrow = dashed.has(edge.name) ? "-.->" : "-->";
    lines.push(`    ${ids.get(edge.source)} ${arrow}|${edge.name}| ${ids.get(edge.target)}`);
  }

  lines.push("");
  for (const [type, typeMeta] of Object.entries(types)) {
    lines.push(`    classDef ${type} fill:${typeMeta.fill},stroke:${typeMeta.stroke}`);
  }
  for (const node of view.nodes) lines.push(`    class ${ids.get(node.id)} ${node.type}`);

  return lines.join("\n") + "\n";
}

// --- SVG --------------------------------------------------------------------
//
// 図の見た目 (位置・大きさ・折り返し済みのラベル) は表示層が持っているので、
// 表示層が実測値を集めて scene として渡し、ここは**組み立てだけ**を行う。
//
// 形状は画面表示と同じ近似である。書き出しの用途 (資料に
// 貼る) では、位置関係とラベルと配色が保たれていれば足りる。近似の範囲は
// 各定数のコメントに書く。

//: 図の周りに空ける余白 (px)。
export const SVG_PADDING = 24;

//: 多角形を、外形の矩形に内接する頂点 (-1..1 の座標) で写したもの。
const SVG_POLYGONS = {
  hexagon: [-1, 0, -0.5, -1, 0.5, -1, 1, 0, 0.5, 1, -0.5, 1],
  rhomboid: [-1, -1, 0.333, -1, 1, 1, -0.333, 1],
  diamond: [0, -1, 1, 0, 0, 1, -1, 0],
  tag: [-1, -1, 0.25, -1, 1, 0, 0.25, 1, -1, 1],
};

//: 角を落とす比率 (cut-rectangle)。画面表示と同じく、書き出しでは
//: 大きさに対する比で近似する。
const SVG_CUT_RATIO = 0.16;
//: 角の丸め (round-rectangle) と、樽の膨らみ (barrel) の代わりの丸め。
const SVG_CORNER = 8;
const SVG_BARREL_RATIO = 0.3;

//: status の線種 → SVG の stroke-dasharray。二重線 (verified) は SVG に無いので
//: 実線で近似する (太さは meta の border_width が残るので区別は付く)。
const SVG_DASH = { dotted: "1 3", dashed: "6 4", solid: "", double: "" };

const attrs = (values) =>
  Object.entries(values)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([name, value]) => `${name}="${escapeAttr(value)}"`)
    .join(" ");

const element = (name, values, children) => {
  const head = [name, attrs(values)].filter(Boolean).join(" ");
  return children === undefined ? `<${head}/>` : `<${head}>${children}</${name}>`;
};

const round = (value) => Math.round(value * 100) / 100;

/** 図形 1 つぶんの要素。box は中心と外形 `{ x, y, w, h }`。 */
function shapeElement(shape, box, style) {
  const { x, y, w, h } = box;
  const polygon = (points) =>
    element("polygon", {
      points: points
        .map((value, index) => round(index % 2 ? y + (value * h) / 2 : x + (value * w) / 2))
        .join(" "),
      ...style,
    });

  if (shape === "ellipse") {
    return element("ellipse", { cx: round(x), cy: round(y), rx: round(w / 2), ry: round(h / 2), ...style });
  }
  if (SVG_POLYGONS[shape]) return polygon(SVG_POLYGONS[shape]);
  if (shape === "cut-rectangle") {
    const cut = Math.min(w, h) * SVG_CUT_RATIO;
    const cx = cut / (w / 2);
    const cy = cut / (h / 2);
    return polygon([
      -1 + cx, -1, 1 - cx, -1, 1, -1 + cy, 1, 1 - cy, 1 - cx, 1, -1 + cx, 1, -1, 1 - cy, -1, -1 + cy,
    ]);
  }
  const radius = shape === "barrel" ? Math.min(w, h) * SVG_BARREL_RATIO : SVG_CORNER;
  return element("rect", {
    x: round(x - w / 2),
    y: round(y - h / 2),
    width: round(w),
    height: round(h),
    rx: round(Math.min(radius, Math.min(w, h) / 2)),
    ...style,
  });
}

/** 改行入りのラベル。中心 (x, y) に上下中央で置く。 */
function labelElement(label, x, y, { size = LABEL_FONT.size, fill, weight } = {}) {
  const lines = String(label).split("\n");
  const step = size * LABEL_FONT.lineHeight;
  const top = y - ((lines.length - 1) * step) / 2 + size * 0.35;
  const spans = lines
    .map((line, index) =>
      element("tspan", { x: round(x), y: round(top + index * step) }, escapeHtml(line)),
    )
    .join("");
  return element(
    "text",
    {
      "text-anchor": "middle",
      "font-family": LABEL_FONT.family,
      "font-size": size,
      "font-weight": weight,
      fill,
    },
    spans,
  );
}

/**
 * いま図に描かれているものを SVG 1 枚にする。
 *
 * scene は表示層 (`site_app.ts`) が SVG 描画状態から集めた実測値:
 *
 * - `nodes`: `{ id, type, status, label, x, y, w, h }`
 * - `edges`: `{ name, dashed, x1, y1, x2, y2 }` (端点はノードの縁の座標)
 * - `bands`: `{ type, label, x, y, w, h }` (Goal / Need の帯枠)
 * - `meta`: `render_meta()` の内容、`palette`: テーマ依存の色
 *
 * ノードが 1 つも無ければ空の図 (背景だけ) を返す。
 */
export function graphSvg(scene) {
  const nodes = scene.nodes || [];
  const edges = scene.edges || [];
  const bands = scene.bands || [];
  const meta = scene.meta || {};
  const palette = scene.palette || {};
  const types = meta.types || {};
  const statuses = meta.statuses || {};

  const xs = [];
  const ys = [];
  for (const box of [...nodes, ...bands]) {
    xs.push(box.x - box.w / 2, box.x + box.w / 2);
    ys.push(box.y - box.h / 2, box.y + box.h / 2);
  }
  for (const edge of edges) {
    xs.push(edge.x1, edge.x2);
    ys.push(edge.y1, edge.y2);
  }
  const minX = (xs.length ? Math.min(...xs) : 0) - SVG_PADDING;
  const minY = (ys.length ? Math.min(...ys) : 0) - SVG_PADDING;
  const width = (xs.length ? Math.max(...xs) : 0) + SVG_PADDING - minX;
  const height = (ys.length ? Math.max(...ys) : 0) + SVG_PADDING - minY;

  const body = [];

  body.push(
    element("rect", {
      x: round(minX),
      y: round(minY),
      width: round(width),
      height: round(height),
      fill: palette.bg || "#ffffff",
    }),
  );

  //: 帯枠はノード・エッジの下に敷く (画面と同じ重なり順)。
  for (const band of bands) {
    const typeMeta = types[band.type] || {};
    body.push(
      shapeElement("round-rectangle", band, {
        fill: typeMeta.fill || "none",
        "fill-opacity": 0.3,
        stroke: typeMeta.stroke || palette.border,
        "stroke-width": 1,
        "stroke-dasharray": SVG_DASH.dashed,
      }),
    );
    body.push(
      labelElement(band.label, band.x, band.y - band.h / 2 - 6, {
        size: 11,
        weight: "bold",
        fill: typeMeta.stroke || palette.muted,
      }),
    );
  }

  for (const edge of edges) {
    body.push(
      element("line", {
        x1: round(edge.x1),
        y1: round(edge.y1),
        x2: round(edge.x2),
        y2: round(edge.y2),
        stroke: palette.border,
        "stroke-width": 1.2,
        "stroke-dasharray": edge.dashed ? SVG_DASH.dashed : "",
        "marker-end": "url(#req-arrow)",
      }),
    );
    //: エッジ名は線の上に置く。背景を敷けないので、縁取り (paint-order) で抜く。
    body.push(
      element(
        "text",
        {
          x: round((edge.x1 + edge.x2) / 2),
          y: round((edge.y1 + edge.y2) / 2),
          "text-anchor": "middle",
          "font-family": LABEL_FONT.family,
          "font-size": 9,
          fill: palette.muted,
          stroke: palette.bg,
          "stroke-width": 3,
          "paint-order": "stroke",
        },
        escapeHtml(edge.name),
      ),
    );
  }

  for (const node of nodes) {
    const typeMeta = types[node.type] || {};
    const statusMeta = statuses[node.status] || {};
    body.push(
      shapeElement(typeMeta.shape, node, {
        fill: typeMeta.fill || "#ffffff",
        stroke: typeMeta.stroke || palette.fg,
        "stroke-width": statusMeta.border_width || 1.5,
        "stroke-dasharray": SVG_DASH[statusMeta.border_style] || "",
      }),
    );
    //: ラベルの色は図の塗り (明るい固定色) に対して読める色。テーマには従わない。
    body.push(labelElement(node.label, node.x, node.y, { fill: "#1f2328" }));
  }

  const defs = element(
    "defs",
    {},
    element(
      "marker",
      {
        id: "req-arrow",
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: "auto-start-reverse",
      },
      element("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: palette.border }),
    ),
  );

  return (
    element(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: `${round(minX)} ${round(minY)} ${round(width)} ${round(height)}`,
        width: round(width),
        height: round(height),
      },
      `\n${element("title", {}, escapeHtml(scene.title || "要求グラフ"))}\n${defs}\n${body.join("\n")}\n`,
    ) + "\n"
  );
}
