import React, { useState, useEffect, useCallback, useRef } from "react";

/**
 * PWA Install Prompt — intercepts `beforeinstallprompt` event on supported
 * browsers, with a manual "Add to Home Screen" fallback for iOS Safari.
 * 
 * Includes a 7-day dismiss cooldown stored in localStorage.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "biq-pwa-dismiss";
const DISMISS_DAYS = 7;

function isDismissed(): boolean {
  try {
    const ts = localStorage.getItem(DISMISS_KEY);
    if (!ts) return false;
    const elapsed = Date.now() - Number(ts);
    return elapsed < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function setDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

/** Detect iOS Safari (no native beforeinstallprompt) */
function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window) && /Safari/.test(ua);
}

/** Detect if already running as installed PWA */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Don't show if already installed or recently dismissed
    if (isStandalone() || isDismissed()) return;

    // iOS fallback
    if (isIOSSafari()) {
      setIsIOS(true);
      setShow(true);
      return;
    }

    // Chrome/Edge/Samsung — intercept native prompt
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setShow(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt.current) return;
    await deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    if (outcome === "accepted") {
      setShow(false);
    }
    deferredPrompt.current = null;
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed();
    setShow(false);
  }, []);

  if (!show) return null;

  return (
    <div className="pwa-install-banner">
      <div className="pwa-install-content">
        <div className="pwa-install-icon">📲</div>
        <div className="pwa-install-text">
          {isIOS ? (
            <>
              <strong>Install Business IQ</strong>
              <span>Tap <strong>Share</strong> → <strong>Add to Home Screen</strong></span>
            </>
          ) : (
            <>
              <strong>Install Business IQ</strong>
              <span>Add to your home screen for quick access</span>
            </>
          )}
        </div>
      </div>
      <div className="pwa-install-actions">
        {!isIOS && (
          <button className="btn btn-primary btn-sm" onClick={handleInstall}>
            Install
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={handleDismiss}>
          {isIOS ? "Got it" : "Not now"}
        </button>
      </div>
    </div>
  );
}

/**
 * PWA Update Toast — shown when a new service worker is waiting.
 * Listens for `sw-update-available` custom event dispatched by main.tsx.
 */
export function UpdateToast() {
  const [showUpdate, setShowUpdate] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      registrationRef.current = (e as CustomEvent).detail;
      setShowUpdate(true);
    };
    window.addEventListener("sw-update-available", handler);
    return () => window.removeEventListener("sw-update-available", handler);
  }, []);

  const handleUpdate = useCallback(() => {
    const reg = registrationRef.current;
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    setShowUpdate(false);
    // Reload after new SW takes over
    navigator.serviceWorker?.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  }, []);

  if (!showUpdate) return null;

  return (
    <div className="pwa-update-toast">
      <span>🔄 A new version is available</span>
      <button className="btn btn-primary btn-sm" onClick={handleUpdate}>
        Update
      </button>
      <button className="pwa-toast-close" onClick={() => setShowUpdate(false)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
