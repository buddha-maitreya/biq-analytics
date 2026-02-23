# PWA Roadmap — Business IQ Enterprise

> **Status:** Planning
> **Priority:** Future — not urgent
> **Goal:** Turn Business IQ Enterprise into an installable Progressive Web App with offline capability and native app feel on mobile devices.

---

## Current State

| Aspect | Status |
|--------|--------|
| `manifest.json` | Does not exist |
| Service Worker | Does not exist |
| PWA meta tags | Missing (`theme-color`, `apple-mobile-web-app-*`, `apple-touch-icon`) |
| App icons (192/512) | Missing — only inline SVG favicon exists |
| `public/` directory | Does not exist under `src/web/` |
| Offline support | None (except IndexedDB scan queue on Scan page) |
| PWA dependencies | None (`vite-plugin-pwa`, `workbox`, etc.) |
| URL routing | State-based (`useState<Page>`) — no `react-router`, no URL paths |
| Frontend build | Agentuity wraps Vite internally; no direct `vite.config.ts` access |
| HTTPS | ✅ Agentuity cloud deployments are HTTPS by default |

---

## Phase 1 — PWA Foundation

Make the app installable on mobile and desktop browsers.

### 1.1 Create `src/web/public/` Directory

Vite convention: files in `public/` are copied to the build output root unchanged.

```
src/web/public/
├── manifest.json
├── sw.js
├── icon-192x192.png
├── icon-512x512.png
├── icon-maskable-192x192.png
└── icon-maskable-512x512.png
```

### 1.2 Web App Manifest

**`src/web/public/manifest.json`**

```json
{
  "name": "Business IQ Enterprise",
  "short_name": "Business IQ",
  "description": "AI-powered Inventory & Sales Management",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "orientation": "any",
  "categories": ["business", "productivity"],
  "icons": [
    {
      "src": "/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "/icon-maskable-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icon-maskable-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

**Design decisions:**
- `display: "standalone"` — hides browser chrome, looks like a native app
- `background_color: "#0f172a"` — matches the app's dark theme splash
- `theme_color: "#0f172a"` — address bar color on Android
- Separate `maskable` icons — Android adaptive icons need safe-zone padding
- `start_url: "/"` — works because the SPA serves `index.html` for all paths

### 1.3 HTML Meta Tags

Add to `src/web/index.html` `<head>`:

```html
<!-- PWA -->
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#0f172a">

<!-- iOS -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Business IQ">
<link rel="apple-touch-icon" href="/icon-192x192.png">

<!-- Windows -->
<meta name="msapplication-TileColor" content="#0f172a">
<meta name="msapplication-TileImage" content="/icon-192x192.png">
```

### 1.4 App Icons

Generate icon set from the Business IQ logo (or a new PWA-specific icon):

| File | Size | Purpose |
|------|------|---------|
| `icon-192x192.png` | 192×192 | Standard icon (Android, desktop) |
| `icon-512x512.png` | 512×512 | Splash screen (Android), high-res |
| `icon-maskable-192x192.png` | 192×192 | Android adaptive icon (safe zone padded) |
| `icon-maskable-512x512.png` | 512×512 | Android adaptive icon (high-res) |

**Icon generation:** Use the business logo from settings (`businessLogoUrl`) or a default BIQ branded icon. Tools: `sharp` (already in deps) or online PWA icon generators.

---

## Phase 2 — Service Worker

### 2.1 Manual Service Worker

Since Agentuity wraps Vite internally and may not support custom Vite plugins, use a **manual service worker** approach rather than `vite-plugin-pwa`.

**`src/web/public/sw.js`** — Cache-first for static assets, network-first for API:

```javascript
const CACHE_NAME = 'biq-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
];

// Install — pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — network-first for API, cache-first for assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // API requests — network only (don't cache dynamic data)
  if (url.pathname.startsWith('/api/')) return;

  // SSE streams — never cache
  if (event.request.headers.get('accept')?.includes('text/event-stream')) return;

  // Static assets — cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful responses for assets
        if (response.ok && url.pathname.match(/\.(js|css|png|svg|woff2?)$/)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback — serve app shell for navigation requests
      if (event.request.mode === 'navigate') {
        return caches.match('/');
      }
    })
  );
});
```

### 2.2 Service Worker Registration

Add to `src/web/main.tsx` (after React root creation):

```typescript
// Register service worker for PWA support
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker registered, scope:', reg.scope);
        // Check for updates periodically
        setInterval(() => reg.update(), 60 * 60 * 1000); // hourly
      })
      .catch((err) => console.warn('[PWA] SW registration failed:', err));
  });
}
```

**Key decisions:**
- Only register in production (`import.meta.env.PROD`) — avoid caching issues in dev
- Hourly update check ensures users get new deployments
- Network-first for `/api/*` — never serve stale business data from cache
- Cache-first for hashed assets (`/assets/*`) — Vite content-hashes filenames, safe to cache forever
- Navigation requests fall back to cached `/` (SPA shell) when offline

---

## Phase 3 — Install Prompt UI

### 3.1 React Install Banner Component

**`src/web/components/InstallPrompt.tsx`**

A bottom-sheet style banner that appears on mobile when the app is installable:

```
┌──────────────────────────────────────────┐
│  📱 Install Business IQ for quick access │
│                                          │
│  [Install]  [Maybe Later]                │
└──────────────────────────────────────────┘
```

**Features:**
- [ ] Intercept `beforeinstallprompt` event and stash the deferred prompt
- [ ] Show banner only on mobile devices (user-agent detection)
- [ ] Don't show if already installed (`display-mode: standalone` media query)
- [ ] Don't show if dismissed within last 7 days (localStorage)
- [ ] Smart timing — show after 5 seconds of engagement, not immediately
- [ ] "Install" button triggers the native browser install prompt
- [ ] "Maybe Later" dismisses with 7-day cooldown
- [ ] Track install success via `appinstalled` event
- [ ] iOS fallback — show manual instructions ("Tap Share → Add to Home Screen")
- [ ] Animate in from bottom with slide-up transition
- [ ] Match app's dark theme styling

### 3.2 iOS-Specific Instructions

Since iOS Safari doesn't fire `beforeinstallprompt`, show manual steps:

```
┌──────────────────────────────────────────┐
│  📱 Install Business IQ                  │
│  Tap Share ⎙ then "Add to Home Screen"   │
│                                          │
│  [Got it]                                │
└──────────────────────────────────────────┘
```

### 3.3 Install State Detection

```typescript
const useInstallState = () => {
  const isInstalled =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const isIOS =
    /iPhone|iPad|iPod/i.test(navigator.userAgent);

  const isDismissed = (() => {
    const ts = localStorage.getItem('pwa-install-dismissed');
    return ts ? Date.now() - Number(ts) < 7 * 24 * 60 * 60 * 1000 : false;
  })();

  return { isInstalled, isMobile, isIOS, isDismissed };
};
```

---

## Phase 4 — Offline Support

### 4.1 Offline Detection UI

- [ ] Global offline indicator bar (top of screen, red/yellow)
- [ ] Matches existing scan page offline indicator pattern
- [ ] Shows "You're offline — some features may be unavailable"
- [ ] Auto-dismisses when connection restores

### 4.2 Offline-Capable Features

| Feature | Offline Strategy | Priority |
|---------|-----------------|----------|
| App shell (layout, nav) | SW cache — always available | P1 |
| Dashboard (cached data) | Show last-known data with "stale" indicator | P2 |
| Scan page | Already has IndexedDB offline queue ✅ | Done |
| Product lookup | Cache recent products in IndexedDB | P3 |
| Chat | Show "Offline — chat unavailable" message | P1 |
| Reports | Cache last-viewed report for offline viewing | P3 |

### 4.3 Background Sync

When back online, sync queued actions:

- [ ] Leverage existing scan offline queue (IndexedDB → `POST /api/scan/batch`)
- [ ] Extend pattern to other write operations (order creation, stock adjustments)
- [ ] Use `navigator.serviceWorker.ready.then(reg => reg.sync.register('queue-sync'))` for Background Sync API where supported

---

## Phase 5 — Native App Feel

### 5.1 Splash Screen

Android auto-generates splash from manifest (`name`, `background_color`, `icons`). For iOS:

- [ ] `<link rel="apple-touch-startup-image">` for various device sizes
- [ ] Or generate dynamically with a canvas-based approach

### 5.2 Navigation UX

Since the app uses state-based routing (no URLs):
- [ ] Consider adding `history.pushState()` for major page transitions so the browser back button works naturally in standalone mode
- [ ] Handle `popstate` events to navigate back within the SPA
- [ ] This prevents users from accidentally exiting the app when pressing "back"

### 5.3 Push Notifications (Future)

- [ ] `Notification.requestPermission()` on user opt-in
- [ ] SW handles `push` events from the server
- [ ] Use cases: approval requests, low stock alerts, order status changes
- [ ] Requires a push notification service (Web Push Protocol)

---

## Phase 6 — Update Management

### 6.1 Cache Versioning

Bump `CACHE_NAME` version (`biq-v1` → `biq-v2`) on each deploy. The `activate` event handler cleans old caches automatically.

### 6.2 Update Notification

- [ ] Detect new service worker version via `reg.onupdatefound`
- [ ] Show toast: "A new version is available — [Refresh]"
- [ ] On click, call `reg.waiting.postMessage({ type: 'SKIP_WAITING' })` + `window.location.reload()`
- [ ] Don't force-refresh — let user choose when to update

### 6.3 Cache Busting Strategy

- Vite already content-hashes JS/CSS filenames (`/assets/index-abc123.js`)
- SW caches these with cache-first — new deploys get new filenames automatically
- Only `/` (index.html) and `/manifest.json` need network-first or stale-while-revalidate

---

## Implementation Checklist

### Phase 1 — Foundation
- [ ] Create `src/web/public/` directory
- [ ] Generate icon set (192, 512, maskable variants)
- [ ] Create `manifest.json` with app metadata
- [ ] Add PWA meta tags to `index.html` (manifest link, theme-color, iOS tags)
- [ ] Verify `public/` files appear in build output (`src/generated/client/`)

### Phase 2 — Service Worker
- [ ] Create `sw.js` with cache-first static + network-first API strategy
- [ ] Register SW in `main.tsx` (production only)
- [ ] Verify SW installs and caches app shell
- [ ] Test offline fallback (navigate while offline → app shell loads)
- [ ] Test that API calls are never served from cache (always network)

### Phase 3 — Install Prompt
- [ ] Build `InstallPrompt.tsx` React component
- [ ] Intercept `beforeinstallprompt` and stash deferred prompt
- [ ] Mobile detection + already-installed check
- [ ] 7-day dismissal cooldown via localStorage
- [ ] Smart timing (5-second delay after load)
- [ ] iOS fallback instructions
- [ ] Wire into `App.tsx` (render above page content)
- [ ] Test on Android Chrome (native prompt)
- [ ] Test on iOS Safari (manual instructions)

### Phase 4 — Offline
- [ ] Global offline indicator bar component
- [ ] Offline messaging for chat/reports pages
- [ ] Dashboard stale-data indicator (optional)

### Phase 5 — Native Feel
- [ ] Add `history.pushState()` for page navigation (back button support)
- [ ] Handle `popstate` for in-app back navigation
- [ ] iOS splash screen images (optional)

### Phase 6 — Updates
- [ ] SW update detection (`onupdatefound`)
- [ ] "New version available" toast with refresh button
- [ ] Cache version bump process documented

---

## Testing Plan

| Test | Method |
|------|--------|
| Manifest valid | Chrome DevTools → Application → Manifest |
| SW registered | Chrome DevTools → Application → Service Workers |
| Installable | Lighthouse PWA audit (score 100) |
| Install prompt | Test on Android Chrome (real device or emulator) |
| iOS install | Test on iPhone Safari |
| Offline app shell | Disconnect network → navigate → app loads |
| Offline scan queue | Disconnect → scan → reconnect → queue syncs |
| Cache update | Deploy new version → SW detects update → toast shown |
| Standalone mode | Install → open from home screen → no browser chrome |

---

## Dependencies

| Package | Purpose | Required? |
|---------|---------|-----------|
| `sharp` | Icon generation (already installed) | Optional — can generate icons externally |
| `vite-plugin-pwa` | Auto-generate SW + manifest | No — using manual approach |
| `workbox-*` | Advanced caching strategies | No — manual SW is sufficient for MVP |

**Zero new dependencies required** — the manual approach uses only browser APIs.

---

## Platform Notes

| Platform | Install Support | Notes |
|----------|----------------|-------|
| Android Chrome | ✅ `beforeinstallprompt` + native prompt | Best support — automatic install banner |
| iOS Safari | ⚠️ Manual only | No `beforeinstallprompt`; must guide user via Share → Add to Home Screen |
| Desktop Chrome | ✅ Install button in address bar | Also supports `beforeinstallprompt` |
| Desktop Edge | ✅ Install button in address bar | Same as Chrome (Chromium-based) |
| Firefox | ❌ No install support | PWA manifests are recognized but no install UX |
| Samsung Internet | ✅ `beforeinstallprompt` | Works like Chrome on Android |

---

*This roadmap is sequenced by dependency. Phase 1 is the minimum for installability. Phases 2–6 add progressive enhancements. No new npm dependencies required.*
