// Real `/ws/streams` client (interfaces.md, RTSP streams): text JSON messages plus binary analysed
// frames (0x11 | u16 id length | id | u32 frame_id | JPEG). Reconnects with a short backoff.
import type { StreamsMessage } from "./types";

export const STREAM_FRAME = 0x11;

export interface StreamFrame {
  stream_id: string;
  frame_id: number;
  jpeg: Uint8Array;
}

export function decodeStreamFrame(buf: ArrayBuffer): StreamFrame | null {
  const view = new DataView(buf);
  if (buf.byteLength < 7 || view.getUint8(0) !== STREAM_FRAME) return null;
  const idLen = view.getUint16(1, true);
  if (buf.byteLength < 3 + idLen + 4) return null;
  const stream_id = new TextDecoder().decode(new Uint8Array(buf, 3, idLen));
  const frame_id = view.getUint32(3 + idLen, true);
  return { stream_id, frame_id, jpeg: new Uint8Array(buf, 7 + idLen) };
}

/** Connection changes: `open` after every (re)connect (`first` only once), `closed` when it drops. */
export type ConnectionEvent = { type: "open"; first: boolean } | { type: "closed" };

export function connectStreamsSocket(
  onMessage: (m: StreamsMessage) => void,
  onFrame?: (f: StreamFrame) => void,
  onConnection?: (e: ConnectionEvent) => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer = 0;
  let opened = false;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws/streams`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      retry = 0;
      onConnection?.({ type: "open", first: !opened });
      opened = true;
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        try {
          onMessage(JSON.parse(e.data) as StreamsMessage);
        } catch {
          // ignore malformed text
        }
      } else if (onFrame) {
        const f = decodeStreamFrame(e.data as ArrayBuffer);
        if (f) onFrame(f);
      }
    };
    ws.onclose = () => {
      if (closed) return;
      onConnection?.({ type: "closed" });
      timer = window.setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
    };
  };
  open();
  return () => {
    closed = true;
    window.clearTimeout(timer);
    ws?.close();
  };
}
