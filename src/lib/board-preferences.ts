"use client";

import { useSyncExternalStore } from "react";
import type { BoardSort } from "@/domain/layout";

const KEY = "fuse.board-preferences.v1";
const EVENT = "fuse:board-preferences";
type Preferences = { sort: BoardSort; hideCompleted: boolean };
const defaults: Preferences = { sort: "deadline", hideCompleted: false };
let fallback: string | null = null;

export function parsePreferences(raw: string | null): Preferences {
  try {
    const value = JSON.parse(raw ?? "null");
    return { sort: ["deadline", "severity", "fuse"].includes(value?.sort) ? value.sort : defaults.sort, hideCompleted: value?.hideCompleted === true };
  } catch { return defaults; }
}

function read() {
  if (fallback !== null) return fallback;
  try { return window.localStorage.getItem(KEY); } catch { return fallback; }
}
function subscribe(listener: () => void) {
  const storage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) { fallback = e.newValue; listener(); } };
  window.addEventListener("storage", storage);
  window.addEventListener(EVENT, listener);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(EVENT, listener); };
}

export function useBoardPreferences() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const preferences = parsePreferences(raw);
  const update = (patch: Partial<Preferences>) => {
    fallback = JSON.stringify({ ...parsePreferences(read()), ...patch });
    try { window.localStorage.setItem(KEY, fallback); } catch { /* Keep preferences for this session when storage is blocked. */ }
    window.dispatchEvent(new Event(EVENT));
  };
  return { ...preferences, update };
}
