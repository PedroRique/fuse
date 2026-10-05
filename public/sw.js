// ponytail: network-only on purpose. The board is server-authoritative and the
// offline guard blocks mutations, so caching pages would only show stale fuses.
// Upgrade path: precache an offline fallback page if one is ever designed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
