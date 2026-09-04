import { LABEL_FONT, estimateTextWidth } from "./site_text.ts";
import type { Point, RenderTypeMetadata } from "./site_types.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
type Attrs = Record<string, unknown>;
interface Palette { fg: string; bg: string; panel: string; border: string; muted: string; dark: boolean }

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
  function labelMeasurer(): (text: unknown) => number {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return estimateTextWidth;
    context.font = `${LABEL_FONT.size}px ${LABEL_FONT.family}`;
    return (text) => context.measureText(String(text)).width;
  }
  function renderLabel(parent: Element, label: unknown, x: number, y: number, size = LABEL_FONT.size, weight: string | null = null): void {
    const lines = String(label).split("\n");
    const step = size * LABEL_FONT.lineHeight;
    const top = y - ((lines.length - 1) * step) / 2 + size * 0.35;
    lines.forEach((line, index) => parent.append(svgEl("text", { x, y: top + index * step, "text-anchor": "middle", "font-size": size, "font-weight": weight, class: "node-label" }), document.createTextNode(line)));
  }
  const shapeEl = (shape: string): SVGElement => shape === "ellipse" ? svgEl("ellipse") : shape === "diamond" || shape === "hexagon" ? svgEl("polygon") : svgEl("rect");
  const polygonCoords = (shape: string, w: number, h: number): Point[] => shape === "diamond"
    ? [{ x: 0, y: -h / 2 }, { x: w / 2, y: 0 }, { x: 0, y: h / 2 }, { x: -w / 2, y: 0 }]
    : [{ x: -w * .36, y: -h / 2 }, { x: w * .36, y: -h / 2 }, { x: w / 2, y: 0 }, { x: w * .36, y: h / 2 }, { x: -w * .36, y: h / 2 }, { x: -w / 2, y: 0 }];
  function updateShape(element: SVGElement, shape: string, box: { x: number; y: number; width: number; height: number }): void {
    const { x, y, width: w, height: h } = box;
    if (element instanceof SVGEllipseElement) setAttrs(element, { cx: x, cy: y, rx: w / 2, ry: h / 2 });
    else if (element instanceof SVGPolygonElement) setAttrs(element, { points: polygonCoords(shape, w, h).map(p => `${p.x + x},${p.y + y}`).join(" ") });
    else setAttrs(element, { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 8, ry: 8 });
  }
  return { svgEl, htmlEl, setAttrs, classed, labelMeasurer, renderLabel, shapeEl, polygonCoords, updateShape, palette, typeColors };
}
