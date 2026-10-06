import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function worker() {
  type TestEvent = {
    data?: { json: () => unknown };
    notification?: { close: () => void; data: { url: string } };
    waitUntil: (pending: Promise<unknown>) => void;
  };
  const listeners: Record<string, (event: TestEvent) => void> = {};
  const notifications: unknown[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://fuse.example" },
    addEventListener: (name: string, fn: (event: TestEvent) => void) => { listeners[name] = fn; },
    registration: { showNotification: async (...args: unknown[]) => { notifications.push(args); } },
    clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } },
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL });
  return { listeners, notifications, opened };
}
describe("push service worker", () => {
  it("displays a visible fallback when push data is malformed", async () => {
    const w = worker();
    let pending: Promise<unknown> | undefined;
    w.listeners.push({ data: { json: () => { throw new Error("bad payload"); } }, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
    expect(w.notifications.length).toBe(1);
    expect((w.notifications[0] as unknown[])[0]).toBe("Fuse");
  });
  it("opens the task and rejects external notification destinations", async () => {
    const w = worker();
    for (const url of ["/board?task=abc", "https://malicious.example/board"]) {
      let pending: Promise<unknown> | undefined;
      w.listeners.notificationclick({ notification: { close() {}, data: { url } }, waitUntil: (p: Promise<unknown>) => { pending = p; } });
      await pending;
    }
    expect(w.opened).toEqual(["https://fuse.example/board?task=abc", "https://fuse.example/board"]);
  });
});
