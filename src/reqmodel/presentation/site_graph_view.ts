import { LABEL_FONT, estimateTextWidth } from "./site_text.ts";
import type {
  Box, Extent, GraphNodeElement, Point, RenderTypeMetadata, SiteData,
} from "./site_types.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
type Attrs = Record<string, unknown>;
interface Palette { fg: string; bg: string; panel: string; border: string; muted: string; dark: boolean }
interface BandElement extends Box { bandType?: string; shape: SVGGraphicsElement }
interface ThemePrimitives {
  palette(): Palette;
  typeColors(meta: RenderTypeMetadata, palette: Palette): { fill?: string; stroke?: string };
  setAttrs(element: Element, attrs: Attrs): void;
  updateShape(element: SVGGraphicsElement, shape: string, box: { w: number; h: number }): void;
}

/** CSS 変数と render metadata を、構築済み SVG DOM に反映する。 */
export function applyGraphTheme(
  graphEl: HTMLElement,
  data: SiteData,
  nodeItems: Iterable<GraphNodeElement>,
  bandItems: Iterable<BandElement>,
  primitives: ThemePrimitives,
): void {
  const pal = primitives.palette();
  graphEl.style.setProperty("--graph-fg", pal.fg);
  graphEl.style.setProperty("--graph-bg", pal.bg);
  graphEl.style.setProperty("--graph-panel", pal.panel);
  graphEl.style.setProperty("--graph-border", pal.border);
  graphEl.style.setProperty("--graph-muted", pal.muted);
  const impact = data.meta.impact_colors;
  graphEl.style.setProperty("--impact-selected", impact?.selected || pal.fg);
  graphEl.style.setProperty("--impact-upstream", impact?.upstream || pal.fg);
  graphEl.style.setProperty("--impact-downstream", impact?.downstream || pal.fg);
  graphEl.style.setProperty("--impact-related", impact?.related || pal.fg);
  graphEl.style.setProperty("--search-hit", data.meta.search?.hit || pal.fg);
  for (const item of nodeItems) {
    const typeMeta = data.meta.types[item.type] || {};
    const statusMeta = data.meta.statuses[item.status] || { border_width: 1.5, border_style: "solid" };
    const colors = primitives.typeColors(typeMeta, pal);
    item.shapeName = typeMeta.shape || "round-rectangle";
    primitives.updateShape(item.shape, item.shapeName, item);
    primitives.updateShape(item.statusRing, item.shapeName, item);
    primitives.setAttrs(item.shape, {
      fill: colors.fill, stroke: colors.stroke,
      "stroke-width": statusMeta.border_width || 1.5,
      "stroke-dasharray": statusMeta.border_style === "dashed" ? "6 4"
        : statusMeta.border_style === "dotted" ? "1 3" : "",
    });
    primitives.setAttrs(item.statusRing, { fill: "none", stroke: colors.stroke, "stroke-width": 1 });
  }
  for (const item of bandItems) {
    const bandType = item.bandType || "RequirementGroup";
    const colors = primitives.typeColors(data.meta.types[bandType] || {}, pal);
    primitives.setAttrs(item.shape, {
      fill: bandType === "RequirementGroup" ? pal.panel : colors.fill,
      stroke: colors.stroke || pal.border,
    });
  }
}

export interface PanZoomController {
  bind(svg: SVGSVGElement, viewport: SVGRectElement, onBackgroundClick: () => void): void;
  fit(box: Extent, readable?: boolean): void;
  reveal(box: Box, margin?: number): void;
  zoomBy(factor: number): void;
  reset(): void;
}

/** pan / zoom の可変状態と pointer/wheel interaction をグラフ view 内に閉じ込める。 */
export function createPanZoom(graphEl: HTMLElement, graphLayer: SVGGElement): PanZoomController {
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  const transform = () => graphLayer.setAttribute("transform", `translate(${pan.x} ${pan.y}) scale(${zoom})`);
  const fit = (box: Extent, readable = false) => {
    const width = graphEl.clientWidth || 800;
    const height = graphEl.clientHeight || 480;
    zoom = Math.min((width - 36) / (box.x2 - box.x1 || 1), (height - 36) / (box.y2 - box.y1 || 1));
    if (readable) zoom = Math.max(.45, zoom);
    pan = { x: 18 - box.x1 * zoom, y: 18 - box.y1 * zoom };
    transform();
  };
  const zoomBy = (factor: number) => {
    const next = Math.max(.1, Math.min(3, zoom * factor));
    const cx = (graphEl.clientWidth || 800) / 2;
    const cy = (graphEl.clientHeight || 480) / 2;
    const mx = (cx - pan.x) / zoom;
    const my = (cy - pan.y) / zoom;
    zoom = next;
    pan = { x: cx - mx * zoom, y: cy - my * zoom };
    transform();
  };
  return {
    bind(svg, viewport, onBackgroundClick) {
      let ignoreClick = false;
      let drag: { x: number; y: number; pan: Point; moved: boolean } | null = null;
      svg.addEventListener("click", (event) => {
        if (ignoreClick) { ignoreClick = false; return; }
        if (event.target === svg || event.target === viewport) onBackgroundClick();
      });
      svg.addEventListener("pointerdown", (event) => {
        if ((event.target as Element).closest(".node:not(.band)")) return;
        drag = { x: event.clientX, y: event.clientY, pan: { ...pan }, moved: false };
        svg.setPointerCapture(event.pointerId);
      });
      svg.addEventListener("pointermove", (event) => {
        if (!drag) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) >= 3) drag.moved = true;
        pan = { x: drag.pan.x + dx, y: drag.pan.y + dy };
        transform();
      });
      svg.addEventListener("pointerup", () => {
        if (drag?.moved) {
          ignoreClick = true;
          setTimeout(() => { ignoreClick = false; }, 0);
        }
        drag = null;
      });
      svg.addEventListener("pointercancel", () => { drag = null; ignoreClick = false; });
      svg.addEventListener("wheel", (event) => {
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
      }, { passive: false });
    },
    fit,
    reveal(box, margin = 40) {
      const extent = {
        x1: -pan.x / zoom,
        y1: -pan.y / zoom,
        x2: (graphEl.clientWidth - pan.x) / zoom,
        y2: (graphEl.clientHeight - pan.y) / zoom,
      };
      const target = { x1: box.x - box.w / 2, y1: box.y - box.h / 2,
        x2: box.x + box.w / 2, y2: box.y + box.h / 2 };
      const inner = { x1: extent.x1 + margin / zoom, y1: extent.y1 + margin / zoom,
        x2: extent.x2 - margin / zoom, y2: extent.y2 - margin / zoom };
      const fits = target.x2 - target.x1 <= inner.x2 - inner.x1 && target.y2 - target.y1 <= inner.y2 - inner.y1;
      const visible = fits
        ? target.x1 >= inner.x1 && target.x2 <= inner.x2 && target.y1 >= inner.y1 && target.y2 <= inner.y2
        : box.x >= extent.x1 && box.x <= extent.x2 && box.y >= extent.y1 && box.y <= extent.y2;
      if (visible) return;
      pan = { x: graphEl.clientWidth / 2 - box.x * zoom, y: graphEl.clientHeight / 2 - box.y * zoom };
      transform();
    },
    zoomBy,
    reset() { zoom = 1; pan = { x: 0, y: 0 }; transform(); },
  };
}

/** SVG graph rendering's DOM boundary. State and orchestration remain in site_app. */
export function createGraphViewPrimitives() {
  const cssVar = (name: string) => getComputedStyle(document.body).getPropertyValue(name).trim();
  const palette = (): Palette => ({
    fg: cssVar("--fg"), bg: cssVar("--bg"), panel: cssVar("--panel"),
    border: cssVar("--border"), muted: cssVar("--muted"),
    dark: getComputedStyle(document.documentElement).colorScheme === "dark",
  });
  const typeColors = (meta: RenderTypeMetadata, pal: Palette) => ({
    fill: pal.dark ? meta.dark_fill || meta.fill : meta.fill,
    stroke: pal.dark ? meta.dark_stroke || meta.stroke : meta.stroke,
  });
  function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
    const element = document.createElementNS(SVG_NS, name);
    setAttrs(element, attrs);
    return element;
  }
  function htmlEl<K extends keyof HTMLElementTagNameMap>(name: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(name);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") element.className = String(value);
      else if (key === "checked" && element instanceof HTMLInputElement) element.checked = Boolean(value);
      else if (key === "value" && "value" in element) (element as HTMLInputElement).value = String(value);
      else element.setAttribute(key, String(value));
    }
    element.append(...children.filter((child): child is Node | string => child !== undefined && child !== null));
    return element;
  }
  function setAttrs(element: Element, attrs: Attrs): void {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === "") element.removeAttribute(key);
      else element.setAttribute(key, String(value));
    }
  }
  const classed = (element: Element, name: string, enabled: unknown): void => { element.classList.toggle(name, Boolean(enabled)); };
  function labelMeasurer(): (text: string) => number {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return estimateTextWidth;
    context.font = `${LABEL_FONT.size}px ${LABEL_FONT.family}`;
    return (text) => context.measureText(String(text)).width;
  }
  function renderLabel(parent: SVGTextElement, label: unknown, x: number, y: number, size = LABEL_FONT.size, weight: string | null = null): void {
    const lines = String(label).split("\n");
    const step = size * LABEL_FONT.lineHeight;
    const top = y - ((lines.length - 1) * step) / 2 + size * 0.35;
    parent.replaceChildren();
    lines.forEach((line, index) => {
      const tspan = svgEl("tspan", { x, y: top + index * step });
      tspan.textContent = line;
      parent.append(tspan);
    });
    setAttrs(parent, {
      "text-anchor": "middle",
      "font-family": LABEL_FONT.family,
      "font-size": size,
      "font-weight": weight,
    });
  }
  const shapeEl = (shape: string): SVGGraphicsElement => {
    if (shape === "ellipse") return svgEl("ellipse");
    if (shape === "barrel") return svgEl("path");
    if (["hexagon", "rhomboid", "diamond", "tag", "cut-rectangle"].includes(shape)) return svgEl("polygon");
    return svgEl("rect");
  };
  const polygonCoords = (shape: string, w: number, h: number): Point[] => {
    const points = ({
      hexagon: [-1, 0, -.5, -1, .5, -1, 1, 0, .5, 1, -.5, 1],
      rhomboid: [-1, -1, .333, -1, 1, 1, -.333, 1],
      diamond: [0, -1, 1, 0, 0, 1, -1, 0],
      tag: [-1, -1, .25, -1, 1, 0, .25, 1, -1, 1],
    } as Record<string, number[]>)[shape] ?? (() => {
      const x = (Math.min(w, h) * .16) / (w / 2);
      const y = (Math.min(w, h) * .16) / (h / 2);
      return [-1 + x, -1, 1 - x, -1, 1, -1 + y, 1, 1 - y,
        1 - x, 1, -1 + x, 1, -1, 1 - y, -1, -1 + y];
    })();
    const scaled: Point[] = [];
    for (let index = 0; index < points.length; index += 2) {
      scaled.push({ x: points[index] * w / 2, y: points[index + 1] * h / 2 });
    }
    return scaled;
  };
  function updateShape(element: SVGGraphicsElement, shape: string, box: { w: number; h: number }): void {
    const { w, h } = box;
    if (element.tagName === "ellipse") setAttrs(element, { cx: 0, cy: 0, rx: w / 2, ry: h / 2 });
    else if (element.tagName === "polygon") setAttrs(element, { points: polygonCoords(shape, w, h).map(({ x, y }) => `${x},${y}`).join(" ") });
    else if (element.tagName === "path") {
      const curve = Math.min(w * .12, h * .45);
      setAttrs(element, { d: `M ${-w / 2 + curve} ${-h / 2} L ${w / 2 - curve} ${-h / 2} C ${w / 2} ${-h / 2} ${w / 2} ${h / 2} ${w / 2 - curve} ${h / 2} L ${-w / 2 + curve} ${h / 2} C ${-w / 2} ${h / 2} ${-w / 2} ${-h / 2} ${-w / 2 + curve} ${-h / 2} Z` });
    } else setAttrs(element, { x: -w / 2, y: -h / 2, width: w, height: h,
      rx: shape === "round-rectangle" ? 8 : Math.min(w, h) * .3 });
  }
  return { svgEl, htmlEl, setAttrs, classed, labelMeasurer, renderLabel, shapeEl, polygonCoords, updateShape, palette, typeColors };
}
