// Minimal external store for useSyncExternalStore: a version counter bumped on change.
import { useSyncExternalStore } from "react";

export class Store {
  private listeners = new Set<() => void>();
  private version = 0;
  private pending = 0;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = (): number => this.version;

  /** Notify now. */
  emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Coalesce bursts (stream results arrive many times per second) into one render per `ms`. */
  emitThrottled(ms = 250): void {
    if (this.pending) return;
    this.pending = window.setTimeout(() => {
      this.pending = 0;
      this.emit();
    }, ms);
  }
}

export function useStore(store: Store): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}
