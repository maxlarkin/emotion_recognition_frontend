import { afterEach, describe, expect, it, vi } from "vitest";
import { connectStreamsSocket, type ConnectionEvent } from "./streamsSocket";

class FakeSocket {
  static all: FakeSocket[] = [];
  binaryType = "";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeSocket.all = [];
});

describe("connectStreamsSocket", () => {
  it("reports first open, drop and reconnect, and nothing after disconnect", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("location", { protocol: "http:", host: "localhost" });
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const events: ConnectionEvent[] = [];
    const msgs: unknown[] = [];
    const stop = connectStreamsSocket((m) => msgs.push(m), undefined, (e) => events.push(e));
    expect(FakeSocket.all[0].url).toBe("ws://localhost/ws/streams");
    FakeSocket.all[0].onopen?.();
    FakeSocket.all[0].onmessage?.({ data: JSON.stringify({ type: "stream_status", stream_id: "a", state: "running" }) });
    FakeSocket.all[0].onmessage?.({ data: "{bad" });
    FakeSocket.all[0].onclose?.();
    vi.advanceTimersByTime(1000); // backoff 1 s, then a new socket
    FakeSocket.all[1].onopen?.();
    expect(events).toEqual([{ type: "open", first: true }, { type: "closed" }, { type: "open", first: false }]);
    expect(msgs).toEqual([{ type: "stream_status", stream_id: "a", state: "running" }]);
    stop();
    expect(FakeSocket.all[1].closed).toBe(true);
    expect(events).toHaveLength(3); // no "closed" after our own disconnect
  });
});
