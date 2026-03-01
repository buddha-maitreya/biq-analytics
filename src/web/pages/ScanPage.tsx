import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../types";

// ── Barcode Detection (polyfill for all browsers via ZXing WASM) ──
// The `barcode-detector` package provides a W3C BarcodeDetector polyfill
// powered by ZXing-C++ WASM, making camera scanning work on ALL browsers
// (Safari, Firefox, Chrome, Edge) — not just Chromium.
import { BarcodeDetector } from "barcode-detector/ponyfill";

interface ScanPageProps {
  config: AppConfig;
}

// ── Types ────────────────────────────────────────────────────

interface ScanResult {
  success: boolean;
  scanEventId?: string;
  transactionId?: string;
  product?: {
    id: string;
    name: string;
    sku: string;
    barcode: string;
    price: number;
    unit: string;
    category?: string;
  };
  previousStock?: number;
  newStock?: number;
  duplicate?: boolean;
  error?: string;
  code?: string;
}

interface LookupResult {
  found: boolean;
  product?: {
    id: string;
    name: string;
    sku: string;
    barcode: string;
    price: number;
    unit: string;
    category?: { name: string };
    imageUrl?: string;
  };
  stock?: Array<{
    warehouseId: string;
    warehouseName: string;
    quantity: number;
    reservedQuantity: number;
  }>;
}

interface ScanEvent {
  id: string;
  barcode: string;
  status: string;
  deviceType: string;
  quantity: number;
  scanType: string;
  errorMessage?: string;
  createdAt: string;
  product?: { name: string; sku: string };
  warehouse?: { name: string; code: string };
  user?: { name: string };
}

interface Warehouse {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
}

// ── Offline Queue ────────────────────────────────────────────
// Scans queued when offline are stored in IndexedDB and synced
// when connectivity is restored via POST /api/scan/batch.

interface OfflineScan {
  barcode: string;
  warehouseId: string;
  deviceType: string;
  quantity: number;
  scanType: string;
  idempotencyKey: string;
  queuedAt: number;
}

const OFFLINE_DB_NAME = "biq-scan-queue";
const OFFLINE_STORE = "pending-scans";

function openOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { keyPath: "idempotencyKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueOfflineScan(scan: OfflineScan): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).put(scan);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function getOfflineScans(): Promise<OfflineScan[]> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readonly");
    const req = tx.objectStore(OFFLINE_STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function clearOfflineScans(): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function removeOfflineScan(key: string): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ── Scanner View Modes ───────────────────────────────────────

type ScanMode = "scanner" | "history" | "lookup";

// ── Status Flash ─────────────────────────────────────────────

interface StatusFlash {
  type: "success" | "error" | "warning" | "info";
  message: string;
  detail?: string;
  timestamp: number;
}

export default function ScanPage({ config }: ScanPageProps) {
  const [mode, setMode] = useState<ScanMode>("scanner");
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [scanType, setScanType] = useState<string>("scan_add");
  const [warehouseId, setWarehouseId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [statusFlash, setStatusFlash] = useState<StatusFlash | null>(null);
  const [recentScans, setRecentScans] = useState<ScanResult[]>([]);
  const [lookupBarcode, setLookupBarcode] = useState("");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  // Offline queue state
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineCount, setOfflineCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Hardware scanner state
  const [hardwareScannerActive, setHardwareScannerActive] = useState(false);

  // History state
  const [historyFilter, setHistoryFilter] = useState("");
  const [historyPage, setHistoryPage] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  // Camera detection loop refs — prevent stale closures and runaway rAF
  const detectLoopActiveRef = useRef(false);
  const scanCooldownRef = useRef(false);
  const lastDetectedRef = useRef("");
  // Always-current versions of state values for callbacks inside the detect loop
  const handleScanRef = useRef<(code: string) => void>(() => {});
  const warehouseIdRef = useRef(warehouseId);
  const quantityRef = useRef(quantity);
  const scanTypeRef = useRef(scanType);
  const hardwareScannerActiveRef = useRef(hardwareScannerActive);

  // Fetch warehouses
  const { data: whData } = useAPI<any>("GET /api/warehouses");
  const warehouses: Warehouse[] = useMemo(() => {
    const list = whData?.data ?? [];
    return list;
  }, [whData]);

  // Fetch scan history
  const historyUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (historyFilter) params.set("barcode", historyFilter);
    if (warehouseId) params.set("warehouseId", warehouseId);
    params.set("limit", "50");
    params.set("offset", String(historyPage * 50));
    return `GET /api/scan/history?${params}`;
  }, [historyFilter, warehouseId, historyPage]);

  const { data: historyData, isLoading: historyLoading, refetch: refetchHistory } = useAPI<any>(historyUrl);
  const scanHistory: ScanEvent[] = historyData?.data?.events ?? [];
  const historyTotal: number = historyData?.data?.total ?? 0;

  // Auto-select default warehouse
  useEffect(() => {
    if (!warehouseId && warehouses.length > 0) {
      const defaultWh = warehouses.find((w) => w.isDefault);
      setWarehouseId(defaultWh?.id ?? warehouses[0].id);
    }
  }, [warehouses, warehouseId]);

  // Keep scan-config refs in sync so the detection loop always reads fresh values
  useEffect(() => { warehouseIdRef.current = warehouseId; }, [warehouseId]);
  useEffect(() => { quantityRef.current = quantity; }, [quantity]);
  useEffect(() => { scanTypeRef.current = scanType; }, [scanType]);
  useEffect(() => { hardwareScannerActiveRef.current = hardwareScannerActive; }, [hardwareScannerActive]);

  // Auto-dismiss status flash after 4 seconds
  useEffect(() => {
    if (statusFlash) {
      const timer = setTimeout(() => setStatusFlash(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [statusFlash]);

  // Focus barcode input on mode switch
  useEffect(() => {
    if (mode === "scanner" && barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  }, [mode]);

  // ── Online/Offline Detection ───────────────────────────────

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      // Auto-sync queued scans when connectivity is restored
      syncOfflineScans();
    };
    const goOffline = () => setIsOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // Load offline queue count on mount
    getOfflineScans().then((scans) => setOfflineCount(scans.length)).catch(() => {});

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── SSE Real-Time Stock Updates ────────────────────────────
  // Connects to /api/scan/events for live stock change notifications.
  // When a scan is processed (by this user or another), the server
  // broadcasts the stock change via SSE.

  useEffect(() => {
    if (!isOnline) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    const connect = () => {
      es = new EventSource("/api/scan/events");

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "stock_update") {
            // If we're on the scanner tab, flash the stock change
            const update = data.properties;
            if (update && mode === "scanner") {
              setStatusFlash({
                type: "info",
                message: `📦 Stock updated: ${update.productName ?? "Product"}`,
                detail: update.warehouseName
                  ? `${update.warehouseName}: ${update.previousStock} → ${update.newStock}`
                  : `${update.previousStock} → ${update.newStock}`,
                timestamp: Date.now(),
              });
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      es.onerror = () => {
        es?.close();
        // Exponential backoff reconnect (max 30s)
        reconnectTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30_000);
          connect();
        }, retryDelay);
      };

      es.onopen = () => {
        retryDelay = 1000; // Reset on successful connect
      };
    };

    connect();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [isOnline, mode]);

  // ── Hardware Scanner (onscan.js) ───────────────────────────
  // Detects USB/Bluetooth barcode scanners that operate in keyboard-
  // wedge mode. onscan.js distinguishes rapid scanner input from
  // normal human typing by measuring input speed + suffix detection.

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    // Dynamically import onscan.js (browser-only, not SSR-safe)
    import("onscan.js").then((onScanModule) => {
      const onScan = onScanModule.default ?? onScanModule;

      // Don't attach if already attached
      if (onScan.isAttachedTo(document)) return;

      onScan.attachTo(document, {
        suffixKeyCodes: [13],           // Enter key ends scan
        reactToPaste: true,             // Support paste-mode scanners
        minLength: 4,                   // Minimum barcode length
        avgTimeByChar: 50,              // Max 50ms per char (scanner speed)
        onScan: (scannedCode: string, _qty: number) => {
          // Only process if we're on the scanner tab and not in an input
          if (mode !== "scanner") return;

          // Ignore if a text input is focused (let manual entry handle it)
          const focused = document.activeElement;
          if (focused && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA" || focused.tagName === "SELECT")) {
            return;
          }

          setBarcode(scannedCode);
          setHardwareScannerActive(true);
          // Call via ref — avoids stale closure when warehouseId/quantity/scanType change
          handleScanRef.current(scannedCode);
          // Reset indicator after brief delay
          setTimeout(() => setHardwareScannerActive(false), 2000);
        },
      });

      cleanup = () => {
        if (onScan.isAttachedTo(document)) {
          onScan.detachFrom(document);
        }
      };
    }).catch(() => {
      // onscan.js not available — fall back to manual + camera only
    });

    return () => {
      cleanup?.();
    };
  }, [mode]);

  // ── Camera Scanner (barcode-detector polyfill) ─────────────

  const stopCamera = useCallback(() => {
    detectLoopActiveRef.current = false;
    scanCooldownRef.current = false;
    lastDetectedRef.current = "";
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      // Use { ideal: "environment" } to avoid hard-failing on devices that
      // don't expose the rear camera as "environment" (iOS Safari quirk).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }

      video.srcObject = stream;

      // Wait for the first frame before starting detection —
      // detector.detect() errors silently if video isn't ready yet.
      await new Promise<void>((resolve) => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { resolve(); return; }
        const onReady = () => { video.removeEventListener("canplay", onReady); resolve(); };
        video.addEventListener("canplay", onReady);
      });
      await video.play();
      setCameraActive(true);

      // Start the 5fps detection loop (ZXing WASM via barcode-detector ponyfill)
      detectLoopActiveRef.current = true;
      lastDetectedRef.current = "";
      scanCooldownRef.current = false;

      const detector = new BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "qr_code", "data_matrix"],
      });

      const tick = async () => {
        if (!detectLoopActiveRef.current || !streamRef.current) return;
        // Guard: skip if video doesn't have a decoded frame yet
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !scanCooldownRef.current) {
          try {
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0) {
              const detected = barcodes[0].rawValue;
              // Deduplicate via ref (not stale state)
              if (detected && detected !== lastDetectedRef.current) {
                lastDetectedRef.current = detected;
                scanCooldownRef.current = true;
                setBarcode(detected);
                // Auto-submit — camera stays open for seamless continuous scanning
                handleScanRef.current(detected);
                // Resume detection after 2s cooldown
                setTimeout(() => {
                  scanCooldownRef.current = false;
                  lastDetectedRef.current = "";
                }, 2000);
              }
            }
          } catch {
            // Detection error (frame not ready, WASM busy) — continue
          }
        }
        // 5fps polling — avoids flooding ZXing WASM with 60 concurrent requests
        if (detectLoopActiveRef.current) {
          setTimeout(tick, 200);
        }
      };

      tick();
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      const detail =
        name === "NotAllowedError" ? "Camera permission denied — allow access in browser settings" :
        name === "NotFoundError" ? "No camera found on this device" :
        name === "NotReadableError" ? "Camera is in use by another app — close it and try again" :
        name === "OverconstrainedError" ? "Camera constraints not supported — try a different browser" :
        err instanceof Error ? err.message : "Please allow camera access in browser settings";
      setStatusFlash({
        type: "error",
        message: "Camera unavailable",
        detail,
        timestamp: Date.now(),
      });
    }
  }, []);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      detectLoopActiveRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // ── Scan Submission ────────────────────────────────────────

  const handleScan = useCallback(async (barcodeValue?: string) => {
    const code = barcodeValue ?? barcode;
    // Read warehouse/quantity/scanType via refs — safe from stale closures
    // when called from the camera detection loop or onscan.js handler.
    const wid = warehouseIdRef.current;
    const qty = quantityRef.current;
    const stype = scanTypeRef.current;
    const hwActive = hardwareScannerActiveRef.current;

    if (!code.trim() || !wid) {
      setStatusFlash({
        type: "warning",
        message: "Enter a barcode and select a warehouse",
        timestamp: Date.now(),
      });
      return;
    }

    const idempotencyKey = `web-${Date.now()}-${code.trim()}`;
    const scanPayload = {
      barcode: code.trim(),
      warehouseId: wid,
      deviceType: hwActive ? "usb_scanner" : "web",
      quantity: qty,
      scanType: stype,
      idempotencyKey,
    };

    setScanning(true);

    // ── Offline Queue: store scan locally if offline ──
    if (!navigator.onLine) {
      try {
        await enqueueOfflineScan({ ...scanPayload, queuedAt: Date.now() });
        const count = (await getOfflineScans()).length;
        setOfflineCount(count);
        setStatusFlash({
          type: "info",
          message: `📴 Queued offline: ${code.trim()}`,
          detail: `${count} scan${count !== 1 ? "s" : ""} pending — will sync when online`,
          timestamp: Date.now(),
        });
        setBarcode("");
        setQuantity(1);
        setTimeout(() => barcodeInputRef.current?.focus(), 100);
      } catch {
        setStatusFlash({
          type: "error",
          message: "Failed to queue scan offline",
          timestamp: Date.now(),
        });
      } finally {
        setScanning(false);
      }
      return;
    }

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scanPayload),
      });

      const json = await res.json();
      const result: ScanResult = json.data;

      if (result.success) {
        setStatusFlash({
          type: result.duplicate ? "warning" : "success",
          message: result.duplicate
            ? `Duplicate scan — ${result.product?.name ?? code}`
            : `✓ Scanned: ${result.product?.name ?? code}`,
          detail: result.product
            ? `${result.previousStock} → ${result.newStock} ${result.product.unit}s`
            : undefined,
          timestamp: Date.now(),
        });
      } else {
        setStatusFlash({
          type: "error",
          message: result.error ?? "Scan failed",
          detail: result.code === "PRODUCT_NOT_FOUND"
            ? "No product matches this barcode"
            : result.code === "INSUFFICIENT_STOCK"
            ? "Not enough stock for this operation"
            : undefined,
          timestamp: Date.now(),
        });
      }

      setRecentScans((prev) => [result, ...prev].slice(0, 20));
      setBarcode("");
      setQuantity(1);

      // Refresh history if on that tab
      if (mode === "history") refetchHistory?.();

      // Refocus input for continuous scanning
      setTimeout(() => barcodeInputRef.current?.focus(), 100);
    } catch (err) {
      // Network failure — queue offline
      try {
        await enqueueOfflineScan({ ...scanPayload, queuedAt: Date.now() });
        const count = (await getOfflineScans()).length;
        setOfflineCount(count);
        setIsOnline(false);
        setStatusFlash({
          type: "warning",
          message: `📴 Network error — queued offline`,
          detail: `${count} scan${count !== 1 ? "s" : ""} pending sync`,
          timestamp: Date.now(),
        });
        setBarcode("");
        setQuantity(1);
      } catch {
        setStatusFlash({
          type: "error",
          message: "Network error — could not queue offline",
          detail: err instanceof Error ? err.message : "Check your connection",
          timestamp: Date.now(),
        });
      }
    } finally {
      setScanning(false);
    }
  }, [barcode, mode, refetchHistory]);

  // Keep handleScanRef in sync so detection loop and onscan.js always call latest version
  useEffect(() => { handleScanRef.current = handleScan; }, [handleScan]);

  // ── Offline Sync ───────────────────────────────────────────
  // Sync queued offline scans via POST /api/scan/batch

  const syncOfflineScans = useCallback(async () => {
    if (syncing) return;
    const pending = await getOfflineScans().catch(() => []);
    if (pending.length === 0) return;

    setSyncing(true);
    try {
      const res = await fetch("/api/scan/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scans: pending.map(({ queuedAt, ...scan }) => scan),
        }),
      });

      const json = await res.json();
      const result = json.data;

      // Remove successfully synced scans from IndexedDB
      if (result?.results) {
        for (const r of result.results) {
          if (r.success || r.duplicate) {
            await removeOfflineScan(r.idempotencyKey ?? "").catch(() => {});
          }
        }
      } else {
        // If batch succeeded without per-item results, clear all
        await clearOfflineScans();
      }

      const remaining = await getOfflineScans().catch(() => []);
      setOfflineCount(remaining.length);

      setStatusFlash({
        type: remaining.length > 0 ? "warning" : "success",
        message: remaining.length > 0
          ? `⚡ Synced ${pending.length - remaining.length}/${pending.length} scans`
          : `⚡ All ${pending.length} offline scans synced!`,
        detail: remaining.length > 0
          ? `${remaining.length} scan${remaining.length !== 1 ? "s" : ""} failed — will retry`
          : undefined,
        timestamp: Date.now(),
      });

      // Refresh history
      refetchHistory?.();
    } catch {
      setStatusFlash({
        type: "error",
        message: "Sync failed — will retry later",
        detail: `${pending.length} scans still queued`,
        timestamp: Date.now(),
      });
    } finally {
      setSyncing(false);
    }
  }, [syncing, refetchHistory]);

  // ── Barcode Lookup ─────────────────────────────────────────

  const handleLookup = useCallback(async () => {
    if (!lookupBarcode.trim()) return;
    setLookupLoading(true);
    setLookupResult(null);
    try {
      const res = await fetch(`/api/scan/lookup/${encodeURIComponent(lookupBarcode.trim())}`);
      const json = await res.json();
      setLookupResult(json.data);
    } catch {
      setLookupResult({ found: false });
    } finally {
      setLookupLoading(false);
    }
  }, [lookupBarcode]);

  // ── Keyboard shortcut: Enter to scan ───────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScan();
    }
  }, [handleScan]);

  const handleLookupKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleLookup();
    }
  }, [handleLookup]);

  // ── Format helpers ─────────────────────────────────────────

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "completed": return { bg: "#dcfce7", fg: "#166534" };
      case "failed": return { bg: "#fee2e2", fg: "#991b1b" };
      case "duplicate": return { bg: "#fef3c7", fg: "#92400e" };
      default: return { bg: "#e0e7ff", fg: "#3730a3" };
    }
  };

  const scanTypeLabel = (type: string) => {
    switch (type) {
      case "scan_add": return "Add Stock";
      case "scan_remove": return "Remove Stock";
      case "scan_count": return "Stock Count";
      case "scan_transfer": return "Transfer";
      default: return type;
    }
  };

  const selectedWarehouse = warehouses.find((w) => w.id === warehouseId);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h2>Scanner</h2>
          <span className="text-muted">
            Scan barcodes to update inventory in real-time
          </span>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="scan-tabs">
        <button
          className={`scan-tab ${mode === "scanner" ? "scan-tab-active" : ""}`}
          onClick={() => setMode("scanner")}
        >
          📷 Scan
        </button>
        <button
          className={`scan-tab ${mode === "lookup" ? "scan-tab-active" : ""}`}
          onClick={() => setMode("lookup")}
        >
          🔍 Lookup
        </button>
        <button
          className={`scan-tab ${mode === "history" ? "scan-tab-active" : ""}`}
          onClick={() => setMode("history")}
        >
          📋 History
        </button>
      </div>

      {/* Status Flash */}
      {statusFlash && (
        <div className={`scan-flash scan-flash-${statusFlash.type}`}>
          <div className="scan-flash-message">{statusFlash.message}</div>
          {statusFlash.detail && <div className="scan-flash-detail">{statusFlash.detail}</div>}
          <button className="scan-flash-dismiss" onClick={() => setStatusFlash(null)}>✕</button>
        </div>
      )}

      {/* Connectivity & Offline Queue Status Bar */}
      {(!isOnline || offlineCount > 0) && (
        <div className={`scan-status-bar ${isOnline ? "scan-status-bar-pending" : "scan-status-bar-offline"}`}>
          <div className="scan-status-bar-content">
            <span className="scan-status-indicator">
              {isOnline ? "🟡" : "🔴"} {isOnline ? "Online" : "Offline"}
            </span>
            {offlineCount > 0 && (
              <span className="scan-status-queue">
                {offlineCount} scan{offlineCount !== 1 ? "s" : ""} queued
              </span>
            )}
          </div>
          {isOnline && offlineCount > 0 && (
            <button
              className="scan-sync-btn"
              onClick={syncOfflineScans}
              disabled={syncing}
            >
              {syncing ? (
                <><span className="spinner" style={{ width: 14, height: 14 }} /> Syncing...</>
              ) : (
                "⚡ Sync Now"
              )}
            </button>
          )}
        </div>
      )}

      {/* Hardware Scanner Indicator */}
      {hardwareScannerActive && (
        <div className="scan-hardware-badge">
          🔗 Hardware scanner detected
        </div>
      )}

      {/* ═══ Scanner Mode ═══ */}
      {mode === "scanner" && (
        <div className="scan-main">
          {/* Config Row */}
          <div className="scan-config-row">
            <div className="scan-config-field">
              <label>Warehouse</label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="scan-select"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code}){w.isDefault ? " ★" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="scan-config-field">
              <label>Action</label>
              <select
                value={scanType}
                onChange={(e) => setScanType(e.target.value)}
                className="scan-select"
              >
                <option value="scan_add">Add Stock (+)</option>
                <option value="scan_remove">Remove Stock (−)</option>
                <option value="scan_count">Stock Count</option>
                <option value="scan_transfer">Transfer</option>
              </select>
            </div>
            <div className="scan-config-field scan-qty-field">
              <label>Qty</label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="scan-qty-input"
              />
            </div>
          </div>

          {/* Camera View */}
          <div className="scan-camera-area">
            {cameraActive ? (
              <div className="scan-camera-container">
                <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
                <div className="scan-crosshair" />
                <button className="scan-camera-stop" onClick={stopCamera}>
                  ✕ Close Camera
                </button>
              </div>
            ) : (
              <button className="scan-camera-start" onClick={startCamera}>
                <span className="scan-camera-icon">📷</span>
                <span>Open Camera Scanner</span>
                <span className="text-muted" style={{ fontSize: "0.75rem" }}>
                  Uses device camera to detect barcodes
                </span>
              </button>
            )}
          </div>

          {/* Manual Entry */}
          <div className="scan-input-row">
            <div className="scan-input-group">
              <span className="scan-input-icon">⌨️</span>
              <input
                ref={barcodeInputRef}
                type="text"
                className="scan-input"
                placeholder="Type or scan barcode..."
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
              {barcode && (
                <button className="scan-input-clear" onClick={() => setBarcode("")}>✕</button>
              )}
            </div>
            <button
              className="scan-submit-btn"
              onClick={() => handleScan()}
              disabled={scanning || !barcode.trim() || !warehouseId}
            >
              {scanning ? (
                <span className="spinner" style={{ width: 18, height: 18 }} />
              ) : (
                "Scan"
              )}
            </button>
          </div>
          <div className="scan-tip">
            💡 {hardwareScannerActive
              ? "🔗 Hardware scanner active — aim and scan"
              : "USB/Bluetooth scanners auto-detected · Camera works on all browsers · Scans queue offline"}
          </div>

          {/* Recent Scans */}
          {recentScans.length > 0 && (
            <div className="scan-recent">
              <h4 className="scan-section-title">Recent Scans (this session)</h4>
              <div className="scan-recent-list">
                {recentScans.map((scan, idx) => (
                  <div
                    key={idx}
                    className={`scan-recent-item ${scan.success ? (scan.duplicate ? "scan-recent-warning" : "scan-recent-success") : "scan-recent-error"}`}
                  >
                    <div className="scan-recent-main">
                      <span className="scan-recent-icon">
                        {scan.success ? (scan.duplicate ? "⚠" : "✓") : "✕"}
                      </span>
                      <div>
                        <div className="scan-recent-name">
                          {scan.product?.name ?? scan.error ?? "Unknown"}
                        </div>
                        {scan.product && (
                          <div className="scan-recent-detail">
                            {scan.product.sku} · {scan.product.barcode} · {scan.previousStock} → {scan.newStock} {scan.product.unit}s
                          </div>
                        )}
                      </div>
                    </div>
                    {scan.product?.price != null && (
                      <span className="scan-recent-price">
                        {config.currency} {Number(scan.product.price).toFixed(2)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ Lookup Mode ═══ */}
      {mode === "lookup" && (
        <div className="scan-main">
          <div className="scan-input-row">
            <div className="scan-input-group">
              <span className="scan-input-icon">🔍</span>
              <input
                type="text"
                className="scan-input"
                placeholder="Enter barcode to look up..."
                value={lookupBarcode}
                onChange={(e) => setLookupBarcode(e.target.value)}
                onKeyDown={handleLookupKeyDown}
                autoFocus
              />
            </div>
            <button
              className="scan-submit-btn"
              onClick={handleLookup}
              disabled={lookupLoading || !lookupBarcode.trim()}
            >
              {lookupLoading ? (
                <span className="spinner" style={{ width: 18, height: 18 }} />
              ) : (
                "Look Up"
              )}
            </button>
          </div>

          {lookupResult && (
            <div className="scan-lookup-result">
              {lookupResult.found && lookupResult.product ? (
                <>
                  <div className="scan-product-card">
                    <div className="scan-product-header">
                      <h3 className="scan-product-name">{lookupResult.product.name}</h3>
                      <span className="status-pill" style={{ backgroundColor: "#dcfce7", color: "#166534" }}>Found</span>
                    </div>
                    <div className="scan-product-details">
                      <div className="scan-product-field">
                        <span className="scan-product-label">SKU</span>
                        <code className="sku-code">{lookupResult.product.sku}</code>
                      </div>
                      <div className="scan-product-field">
                        <span className="scan-product-label">Barcode</span>
                        <code className="sku-code">{lookupResult.product.barcode}</code>
                      </div>
                      <div className="scan-product-field">
                        <span className="scan-product-label">Price</span>
                        <span>{config.currency} {Number(lookupResult.product.price).toFixed(2)}</span>
                      </div>
                      <div className="scan-product-field">
                        <span className="scan-product-label">Unit</span>
                        <span>{lookupResult.product.unit}</span>
                      </div>
                      {lookupResult.product.category && (
                        <div className="scan-product-field">
                          <span className="scan-product-label">Category</span>
                          <span className="category-badge-inv">{lookupResult.product.category.name}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Stock Levels */}
                  {lookupResult.stock && lookupResult.stock.length > 0 && (
                    <div className="scan-stock-table">
                      <h4 className="scan-section-title">Stock by Warehouse</h4>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Warehouse</th>
                            <th className="text-right">Available</th>
                            <th className="text-right">Reserved</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lookupResult.stock.map((s) => (
                            <tr key={s.warehouseId}>
                              <td>{s.warehouseName}</td>
                              <td className="text-right font-semibold">{s.quantity}</td>
                              <td className="text-right text-muted">{s.reservedQuantity}</td>
                              <td>
                                <span
                                  className="status-pill"
                                  style={s.quantity > 0
                                    ? { backgroundColor: "#dcfce7", color: "#166534" }
                                    : { backgroundColor: "#fee2e2", color: "#991b1b" }
                                  }
                                >
                                  {s.quantity > 0 ? "In Stock" : "Out of Stock"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <div className="scan-not-found">
                  <span className="scan-not-found-icon">🚫</span>
                  <h4>Product Not Found</h4>
                  <p className="text-muted">No product matches barcode "{lookupBarcode}"</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ History Mode ═══ */}
      {mode === "history" && (
        <div className="scan-main">
          <div className="toolbar">
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Filter by barcode..."
                value={historyFilter}
                onChange={(e) => { setHistoryFilter(e.target.value); setHistoryPage(0); }}
              />
              {historyFilter && (
                <button className="search-clear" onClick={() => setHistoryFilter("")}>✕</button>
              )}
            </div>
            <span className="toolbar-count">
              {historyTotal} scan{historyTotal !== 1 ? "s" : ""} total
            </span>
          </div>

          {historyLoading ? (
            <div className="loading-state">
              <div className="spinner" />
              <p>Loading scan history...</p>
            </div>
          ) : scanHistory.length > 0 ? (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Barcode</th>
                    <th>Product</th>
                    <th>Type</th>
                    <th className="text-right">Qty</th>
                    <th>Warehouse</th>
                    <th>Device</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scanHistory.map((ev) => {
                    const sc = statusColor(ev.status);
                    return (
                      <tr key={ev.id}>
                        <td>
                          <div className="cell-main">{fmtTime(ev.createdAt)}</div>
                          <div className="cell-sub">{fmtDate(ev.createdAt)}</div>
                        </td>
                        <td><code className="sku-code">{ev.barcode}</code></td>
                        <td>
                          {ev.product ? (
                            <>
                              <div className="cell-main">{ev.product.name}</div>
                              <div className="cell-sub">{ev.product.sku}</div>
                            </>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>{scanTypeLabel(ev.scanType)}</td>
                        <td className="text-right font-semibold">{ev.quantity}</td>
                        <td>
                          {ev.warehouse ? (
                            <>
                              <div className="cell-main">{ev.warehouse.name}</div>
                              <div className="cell-sub">{ev.warehouse.code}</div>
                            </>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          <span className="scan-device-badge">{ev.deviceType}</span>
                        </td>
                        <td>
                          <span className="status-pill" style={{ backgroundColor: sc.bg, color: sc.fg }}>
                            {ev.status}
                          </span>
                          {ev.errorMessage && (
                            <div className="cell-sub text-danger" style={{ maxWidth: 200 }}>
                              {ev.errorMessage}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {historyTotal > 50 && (
                <div className="scan-pagination">
                  <button
                    className="scan-page-btn"
                    disabled={historyPage === 0}
                    onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                  >
                    ← Previous
                  </button>
                  <span className="text-muted">
                    Page {historyPage + 1} of {Math.ceil(historyTotal / 50)}
                  </span>
                  <button
                    className="scan-page-btn"
                    disabled={(historyPage + 1) * 50 >= historyTotal}
                    onClick={() => setHistoryPage((p) => p + 1)}
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="card text-center text-muted" style={{ padding: 32 }}>
              {historyFilter ? "No scans match your filter" : "No scan history yet — start scanning!"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
