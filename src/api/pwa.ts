/**
 * PWA routes — serves manifest.json and sw.js from the app origin.
 *
 * Agentuity serves /public/* from its CDN (cdn.agentuity.com), but the app
 * runs on *.agentuity.run. Service workers and web app manifests MUST be
 * same-origin, so we serve them via API routes instead of static files.
 */
import { createRouter } from "@agentuity/runtime";

const router = createRouter();

// ── Web App Manifest ──
router.get("/manifest.json", (c) => {
  const manifest = {
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

  return c.json(manifest, 200, {
    "Content-Type": "application/manifest+json",
    "Cache-Control": "public, max-age=86400",
  });
});

// ── Service Worker ──
// Must include Service-Worker-Allowed header to extend scope beyond /api/
router.get("/sw.js", (c) => {
  const sw = `/**
 * Business IQ Enterprise — Service Worker
 *
 * Strategy: Network-first for API calls, cache-first for static assets.
 * Provides offline shell and caches critical resources.
 */

const CACHE_NAME = "biq-v1";
const STATIC_CACHE = "biq-static-v1";

/** Resources to pre-cache on install */
const PRECACHE_URLS = [
  "/",
  "/public/icons/icon-192.svg",
  "/public/icons/icon-512.svg",
];

// ── Install: pre-cache shell resources ──
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  // Activate immediately (don't wait for old tabs to close)
  self.skipWaiting();
});

// ── Activate: clean up old caches ──
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((name) => name !== CACHE_NAME && name !== STATIC_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for assets ──
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip WebSocket upgrade requests
  if (event.request.headers.get("upgrade") === "websocket") return;

  // API requests → network-first with no cache
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() => {
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
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
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
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
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
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
`;

  return new Response(sw, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-cache",
    },
  });
});

export default router;
