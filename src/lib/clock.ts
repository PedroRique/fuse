"use client";

import { useSyncExternalStore } from "react";

/**
 * One global ticker for the whole app. Components subscribe individually,
 * so a countdown re-renders its own card, never the whole canvas.
 * The offset aligns the client with the server clock (skew + dev time travel).
 */
let offsetMs = 0;
let current = 0;
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;

const read = () => Date.now() + offsetMs;

function tick() {
  current = read();
  listeners.forEach((l) => l());
}

function onVisible() {
  if (document.visibilityState === "visible") tick();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!interval) {
    current = read();
    interval = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && interval) {
      clearInterval(interval);
      interval = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

export function syncServerClock(serverNowIso: string) {
  offsetMs = Date.parse(serverNowIso) - Date.now();
  tick();
}

export const getNow = read;

const snapshot = () => current || (current = read());

/** 0 during SSR/hydration: render nothing time-dependent until mounted. */
export const useNow = () => useSyncExternalStore(subscribe, snapshot, () => 0);

/** false on the server and during hydration, true afterwards. */
export const useHydrated = () => useSyncExternalStore(noopSubscribe, () => true, () => false);
const noopSubscribe = () => () => {};

/** Re-renders only when the selected (primitive) value changes. */
export function useClockValue<T extends string | number | boolean | null>(select: (now: number) => T, fallback: T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(snapshot()),
    () => fallback,
  );
}
