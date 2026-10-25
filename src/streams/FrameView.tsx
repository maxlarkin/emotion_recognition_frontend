// Analysed frame with face boxes positioned in percent of the frame (ui.md Face decision boxes).
import { useState } from "react";
import type { StreamFace } from "../api/types";
import { boxLabel } from "../ui/format";

/** JPEG size for a source resolution: longest side 640 (interfaces.md analysed frame). */
export function tileSize(res: [number, number] | null): [number, number] {
  const [w, h] = res ?? [1280, 720];
  const k = 640 / Math.max(w, h);
  return [Math.round(w * k), Math.round(h * k)];
}

/** The frame keeps a 16:9 box; the image sits inside it at its own aspect ratio, centred, and
 * the boxes are placed over that inner area (a 4:3 webcam frame is letterboxed, not stretched). */
export default function FrameView({
  frameUrl,
  faces,
  sourceResolution,
  compact = false,
  media,
  children,
}: {
  frameUrl: string | null;
  faces: readonly StreamFace[];
  sourceResolution: [number, number] | null;
  compact?: boolean;
  /** Replaces the image inside the aspect-ratio area (the file player's `<video>`). */
  media?: React.ReactNode;
  /** Overlays positioned against the whole 16:9 box (badges, status). */
  children?: React.ReactNode;
}) {
  const [natural, setNatural] = useState<[number, number] | null>(null);
  const [fw, fh] = natural ?? tileSize(sourceResolution);
  return (
    <div className={compact ? "frame compact" : "frame"}>
      {!frameUrl && !media && (
        <div className="frame-placeholder" aria-hidden="true">
          {compact ? "" : "[ кадр потока ]"}
        </div>
      )}
      <div className="frame-media" style={{ "--ar": fw / fh } as React.CSSProperties}>
        {media ??
          (frameUrl && (
            <img src={frameUrl} alt="" onLoad={(e) => setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
          ))}
        {faces.map((f) => (
          <div
            key={f.track_id}
            className={`face-box face-${f.decision}`}
            style={{
              left: `${(f.box[0] / fw) * 100}%`,
              top: `${(f.box[1] / fh) * 100}%`,
              width: `${(f.box[2] / fw) * 100}%`,
              height: `${(f.box[3] / fh) * 100}%`,
            }}
          >
            {!compact && <span className="face-tag">{boxLabel(f)}</span>}
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
