// Overlay geometry and drawing: boxes come in pixels of the sent JPEG and are drawn over the
// live <video> (object-fit: contain), so a lagging box shows up as visible lag.
import { boxLabel, EMOTION_WORD } from "../ui/format";
import type { FaceResult } from "./protocol";

/** Canvas cannot use CSS variables directly: read the tokens.css values (fallbacks for tests). */
function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

type Decided = FaceResult & { decision?: string };

function boxStyle(face: Decided): { stroke: string; tagBg: string; tagFg: string; dashed: boolean } {
  const accent = token("--accent", "#4C8DFF");
  const white = token("--text-primary", "#FFFFFF");
  if (face.decision === "alert") {
    const alert = token("--alert-bg", "#FF8A3D");
    return { stroke: alert, tagBg: alert, tagFg: token("--alert-fg", "#0B1220"), dashed: false };
  }
  if (face.decision === "abstain") return { stroke: token("--status-offline", "#8C99B0"), tagBg: token("--tag-muted", "#3A4A66"), tagFg: white, dashed: true };
  return { stroke: accent, tagBg: accent, tagFg: white, dashed: false };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a srcW x srcH video is shown inside a boxW x boxH element with object-fit: contain. */
export function containRect(srcW: number, srcH: number, boxW: number, boxH: number): Rect {
  if (srcW <= 0 || srcH <= 0 || boxW <= 0 || boxH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** Box in JPEG pixels (jpegW x jpegH) -> rectangle in the displayed video area. */
export function scaleBox(box: readonly number[], jpegW: number, jpegH: number, shown: Rect): Rect {
  const sx = shown.w / jpegW;
  const sy = shown.h / jpegH;
  return { x: shown.x + box[0] * sx, y: shown.y + box[1] * sy, w: box[2] * sx, h: box[3] * sy };
}

/** "радость 81%" */
export function faceLabel(face: Pick<FaceResult, "fused_label" | "confidence">): string {
  const pct = Math.round(Math.min(1, Math.max(0, face.confidence)) * 100);
  return `${EMOTION_WORD[face.fused_label]} ${pct}%`;
}

/** No result for this long: the overlay (and panel) is stale and gets cleared. */
export const STALE_MS = 1000;

export function isStale(lastResultAt: number, now: number, staleMs: number = STALE_MS): boolean {
  return now - lastResultAt > staleMs;
}

/** Clears the canvas (CSS-pixel coordinates, already scaled for devicePixelRatio) and draws faces. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  faces: readonly FaceResult[],
  jpegW: number,
  jpegH: number,
  shown: Rect,
): void {
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.lineWidth = 2;
  ctx.font = "600 13px 'IBM Plex Sans', system-ui, sans-serif";
  ctx.textBaseline = "bottom";
  for (const face of faces) {
    const r = scaleBox(face.box, jpegW, jpegH, shown);
    const st = boxStyle(face);
    ctx.strokeStyle = st.stroke;
    ctx.setLineDash?.(st.dashed ? [6, 4] : []);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash?.([]);
    const text = boxLabel(face);
    const tw = ctx.measureText(text).width + 12;
    const th = 22;
    const ty = r.y - th >= 0 ? r.y - th : r.y; // above the box, or inside it at the top edge
    ctx.fillStyle = st.tagBg;
    ctx.fillRect(r.x - 1, ty, tw, th);
    ctx.fillStyle = st.tagFg;
    ctx.fillText(text, r.x + 4.5, ty + th - 4);
  }
}
