// Simple Service Worker for Offline-First caching of static assets
const CACHE_NAME = "anebilin-cache-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/vite.svg",
];

self.addEventListener("install", (e) => {
  (e as any).waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener("activate", (e) => {
  (e as any).waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
});

self.addEventListener("fetch", (e) => {
  const req = (e as any).request;
  // Only handle GET requests and local/http URLs
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) {
    return;
  }
  (e as any).respondWith(
    caches.match(req).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(req).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }
        const cacheCopy = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, cacheCopy);
        });
        return networkResponse;
      }).catch(() => {
        // Offline fallback
        return caches.match("/");
      });
    })
  );
});
