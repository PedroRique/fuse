// ponytail: network-only on purpose. The board is server-authoritative and the
// offline guard blocks mutations, so caching pages would only show stale fuses.
// Upgrade path: precache an offline fallback page if one is ever designed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch {}
  event.waitUntil(self.registration.showNotification(payload.title || "Fuse", {
    body: payload.body || "Open Fuse to check your tasks.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: payload.tag || "fuse-alert",
    data: { url: payload.url || "/board" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    let url = new URL(event.notification.data?.url || "/board", self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== "/board") url = new URL("/board",self.location.origin);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      const navigated = await client.navigate(url.href);
      if (navigated) { await navigated.focus(); return; }
    }
    await self.clients.openWindow(url.href);
  })());
});
