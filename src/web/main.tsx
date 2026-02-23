import React from "react";
import ReactDOM from "react-dom/client";
import { AgentuityProvider } from "@agentuity/react";
import { AuthProvider } from "@agentuity/auth/react";
import { authClient } from "./lib/auth";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AgentuityProvider>
      <AuthProvider authClient={authClient} refreshInterval={300_000}>
        <App />
      </AuthProvider>
    </AgentuityProvider>
  </React.StrictMode>
);

// ── Register Service Worker (production only) ──
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/public/sw.js", { scope: "/" })
      .then((registration) => {
        // Check for updates periodically (every 60 minutes)
        setInterval(() => registration.update(), 60 * 60 * 1000);

        // Listen for new service worker waiting
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // New version available — dispatch event for UI toast
              window.dispatchEvent(new CustomEvent("sw-update-available", { detail: registration }));
            }
          });
        });
      })
      .catch((err) => {
        console.warn("SW registration failed:", err);
      });
  });
}
