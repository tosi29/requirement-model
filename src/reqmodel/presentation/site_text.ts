/**
 * 静的サイトのロジック層。
 *
 * DOM にも描画 API にも一切触れない純関数だけを置く。ここに置いたものは
 * Node からそのまま import してテストできる (`tests/js/`)。ページに載せるときは
 * `site.py` が `site_app.ts` と一緒に 1 枚の HTML へインライン化する。
 *
 * `nodeContext()` の出力は CLI の `req explain` (`explain.py`) と一致させる。
 * ここを崩すと「サイトからコピーしたコンテキスト」と「CLI が出すコンテキスト」が
 * 食い違うので、`tests/test_site_js.py` で両者を突き合わせている。
 */

// --- 文字列 ----------------------------------------------------------------

/** 表示用に長い本文を切り詰める。 */
export function truncate(text: string, limit = 42): string {
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 属性値に入れる文字列。引用符まで潰す。 */
export function escapeAttr(text: unknown): string {
  return escapeHtml(String(text)).replace(/"/g, "&quot;");
}

/**
 * リンクとして DOM に設定してよい URL だけを返す。
 *
 * Reference は任意文字列を保持できるため、HTML escape では防げない
 * `javascript:` などの実行可能 scheme をここで落とし、HTTP(S) の外部リンクだけを許可する。
 */
export function safeHref(value: unknown): string | null {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return ["https:", "http:"].includes(url.protocol) ? String(value) : null;
  } catch {
    return null;
  }
}

// --- ラベルの折り返し ------------------------------------------------------
//
// SVG の text は自動折り返ししない。かといって
// 文字数で機械的に折ると「24 / 時間」のように数値と単位が離れる。ここでは
//
//   1. 文を「文節らしいまとまり」(chunk) に切り、
//   2. 実測幅で入るだけ 1 行に詰める
//
// の 2 段でやる。切る位置の判断は 1. に閉じているので、幅の決め方 (2.) を
// 変えても組み方の癖は変わらない。

/** ラベルの字体。canvas での実測と SVG の描画で同じものを使う。 */
export const LABEL_FONT = {
  size: 10,
  lineHeight: 1.25,
  family:
    '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", "Segoe UI", sans-serif',
};

/** ノード本文として表示する最大文字数。極端に長い本文だけ省略する。 */
export const LABEL_MAX_LENGTH = 60;

/** 1 行の上限幅 (px)。全角 16 文字ぶん。 */
export const LABEL_WRAP_WIDTH = 160;

//: 全角幅で数える文字 (CJK と全角記号)。
const WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;

/**
 * 幅の概算 (px)。ブラウザでは canvas の実測を渡す (`measure` 引数) ので、これは
 * その代わり。全角を 1em・半角を 0.55em として数えるだけ。
 */
export function estimateTextWidth(text: string, fontSize = LABEL_FONT.size): number {
  let width = 0;
  for (const char of text) width += (WIDE_CHAR.test(char) ? 1 : 0.55) * fontSize;
  return width;
}

//: 行頭に置かない文字 (句読点・閉じ括弧・長音など)。前の行の末尾に残す。
const NO_LINE_START = "、。，．,.)）〕］｝」』〉》!?！？:：;；・…‥ー〜%％";
//: 行末に置かない文字 (開き括弧)。次の行の先頭へ送る。
const NO_LINE_END = "(（〔［｛「『〈《";
//: 半角の語。数値の中の区切り (99.9) は割らない。
const WORD_RUN = /^[0-9A-Za-z]+(?:[.,\-_/][0-9A-Za-z]+)*[%％]?/;
//: 単位を後ろに従える「数値」。"24" → "24 時間"、"99.9%" → "99.9% 以上"。
const NUMBER = /^[0-9]+(?:[.,][0-9]+)*[%％]?$/;
//: 仮名・漢字・ラテン文字のいずれか。1 つも無い行は数字か記号だけの行。
const HAS_CONTENT = /[A-Za-z\u3041-\u30ff\u3400-\u9fff]/;

const charClass = (char) => {
  if (/\s/.test(char)) return "space";
  if (/[0-9A-Za-z]/.test(char)) return "word";
  if (/[\u3041-\u309f]/.test(char)) return "kana";
  if (/[\u30a1-\u30ff\uff66-\uff9f]/.test(char)) return "kata";
  if (/[\u3005\u3006\u3400-\u9fff]/.test(char)) return "kanji";
  return "other";
};

/** 文字種の続く限りをひとまとまりにする。約物は 1 文字ずつ。 */
function tokenize(text) {
  const tokens = [];
  let rest = text;
  while (rest) {
    const word = rest.match(WORD_RUN);
    if (word) {
      tokens.push({ cls: "word", text: word[0] });
      rest = rest.slice(word[0].length);
      continue;
    }
    const char = [...rest][0];
    rest = rest.slice(char.length);
    const cls = charClass(char);
    const last = tokens[tokens.length - 1];
    if (last && last.cls === cls && cls !== "other") last.text += char;
    else tokens.push({ cls, text: char });
  }
  return tokens;
}

/** 前のまとまりに続けて置く (= ここでは折らない) か。 */
function joins(last, token) {
  if (!last) return true;
  if (NO_LINE_START.includes([...token.text][0])) return true;
  if (NO_LINE_END.includes(last.text.slice(-1))) return true;
  //: 送り仮名と助詞は、直前の語から離さない。
  if (token.cls === "kana") return ["kanji", "kata", "word"].includes(last.cls);
  //: 空白を挟まず続く半角の語 ("第4版" の 4) も同じ語の一部として扱う。
  if (token.cls === "word") return ["kanji", "kata"].includes(last.cls);
  //: 数値は単位を連れていく。
  if (NUMBER.test(last.text)) return ["kanji", "kata", "word"].includes(token.cls);
  return false;
}

/**
 * 折り返し候補で切ったまとまり。区切りの空白は、その手前のまとまりの末尾に
 * 付けたまま返す (行末に来たら落とし、行の途中なら空白として残すため)。
 */
export function labelChunks(text: string): string[] {
  const tokens = tokenize(text);
  const chunks = [];
  let current = "";
  let last = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.cls === "space") {
      const next = tokens[i + 1];
      //: 数値と単位の間の空白 ("24 時間") では切らない。
      if (last && NUMBER.test(last.text) && next && joins(last, next)) {
        current += token.text + next.text;
        last = next;
        i += 1;
        continue;
      }
      if (current) chunks.push(current + token.text);
      current = "";
      last = null;
      continue;
    }
    if (joins(last, token)) current += token.text;
    else {
      chunks.push(current);
      current = token.text;
    }
    last = token;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** 幅に入るところまでを 1 文字単位で切る。1 つのまとまりが長すぎるときの最後の手段。 */
function hardSplit(text, maxWidth, measure) {
  let head = "";
  for (const char of text) {
    if (head && measure(head + char) > maxWidth) break;
    head += char;
  }
  return head === text ? null : { head, tail: text.slice(head.length) };
}

/** 数字と記号だけの行を無くす。単独で落ちた数値は隣の行に戻す。 */
function mergeLonelyNumbers(lines) {
  const merged = [];
  for (const line of lines) {
    if (merged.length && !HAS_CONTENT.test(line)) merged[merged.length - 1] += line;
    else merged.push(line);
  }
  if (merged.length > 1 && !HAS_CONTENT.test(merged[0])) {
    merged[1] = merged[0] + merged[1];
    merged.shift();
  }
  return merged;
}

/**
 * ラベル 1 つぶんの折り返し。返すのは "\n" で繋いだ 1 つの文字列。
 *
 * measure は 1 行の幅 (px) を返す関数。ブラウザでは canvas の実測を渡す。
 */
export function wrapLabel(
  text: string,
  maxWidth = LABEL_WRAP_WIDTH,
  measure: (text: string) => number = estimateTextWidth,
): string {
  const lines = [];
  let line = "";
  for (const chunk of labelChunks(text)) {
    if (line && measure((line + chunk).trimEnd()) > maxWidth) {
      lines.push(line.trimEnd());
      line = "";
    }
    line += chunk;
    while (measure(line.trimEnd()) > maxWidth) {
      const cut = hardSplit(line.trimEnd(), maxWidth, measure);
      if (!cut) break;
      lines.push(cut.head);
      line = cut.tail;
    }
  }
  if (line.trimEnd()) lines.push(line.trimEnd());
  return mergeLonelyNumbers(lines).join("\n");
}

//: meta.types[].fit が無いとき (旧いデータ) の既定。矩形として扱う。
const DEFAULT_FIT = { wmul: 1, wpad: 20, hmul: 1, hpad: 14 };

/**
 * ラベル (改行入り) を内側に収めるノードの外形。
 *
 * fit は `render_meta()` の `types[].fit`。図形ごとの係数の由来は Python 側
 * (`_SHAPE_FIT`) に書いてある。ここでは表を持たない。
 */
export function nodeSize(
  label: string,
  fit: { wmul: number; wpad: number; hmul: number; hpad: number } | null | undefined,
  measure: (text: string) => number = estimateTextWidth,
): { w: number; h: number } {
  const lines = label.split("\n");
  const textWidth = Math.max(...lines.map((line) => measure(line)));
  const textHeight = lines.length * LABEL_FONT.size * LABEL_FONT.lineHeight;
  const box = fit || DEFAULT_FIT;
  return {
    w: Math.round(textWidth * box.wmul + box.wpad),
    h: Math.round(textHeight * box.hmul + box.hpad),
  };
}
