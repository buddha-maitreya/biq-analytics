/**
 * PWA assets served as inline content via app.ts routes.
 *
 * These files cannot live in src/web/public/ because the Agentuity CLI generates
 * unquoted TypeScript property names for files with dots (e.g. manifest.json, sw.js)
 * in src/generated/routes.ts, breaking the deployment typecheck. Instead, the
 * manifest and service worker are served as explicit routes registered in app.ts
 * which run at the root level (no auth middleware).
 */

/** PWA web manifest — served at /manifest.json */
export const PWA_MANIFEST = {
  name: "Business IQ Enterprise",
  short_name: "Business IQ",
  description: "Enterprise Inventory & Sales Management Platform",
  start_url: "/",
  display: "standalone",
  background_color: "#0f172a",
  theme_color: "#3b82f6",
  orientation: "any",
  icons: [
    {
      src: "/public/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/public/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/public/icons/icon-maskable-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/public/icons/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/public/icons/icon-192.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
  ],
  categories: ["business", "productivity"],
  screenshots: [],
  prefer_related_applications: false,
};

/** Service worker script — served at /sw.js */
export const SERVICE_WORKER_SCRIPT = `/**
 * Business IQ Enterprise — Service Worker
 *
 * Strategy: Network-first for API calls, cache-first for static assets.
 * Provides offline shell and caches critical resources.
 */

var CACHE_NAME = "biq-v1";
var STATIC_CACHE = "biq-static-v1";

/** Resources to pre-cache on install */
var PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/public/icons/icon-192.svg",
  "/public/icons/icon-512.svg",
];

// ── Install: pre-cache shell resources ──
self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  // Activate immediately (don't wait for old tabs to close)
  self.skipWaiting();
});

// ── Activate: clean up old caches ──
self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names
          .filter(function(name) { return name !== CACHE_NAME && name !== STATIC_CACHE; })
          .map(function(name) { return caches.delete(name); })
      );
    })
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for assets ──
self.addEventListener("fetch", function(event) {
  var url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip WebSocket upgrade requests
  if (event.request.headers.get("upgrade") === "websocket") return;

  // API requests → network-first with no cache
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(
          JSON.stringify({ error: "You are offline. Please check your connection." }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      })
    );
    return;
  }

  // Static assets (icons, manifest, fonts) → cache-first
  if (
    url.pathname.startsWith("/public/") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".woff")
  ) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(STATIC_CACHE).then(function(cache) { cache.put(event.request, clone); });
          }
          return response;
        });
      })
    );
    return;
  }

  // App shell (HTML, JS, CSS) → network-first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
        }
        return response;
      })
      .catch(function() {
        return caches.match(event.request).then(function(cached) {
          if (cached) return cached;
          // For navigation requests, return cached index page (SPA)
          if (event.request.mode === "navigate") {
            return caches.match("/");
          }
          return new Response("Offline", { status: 503 });
        });
      })
  );
});

// ── Message handler: skip waiting on demand ──
self.addEventListener("message", function(event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
`;
