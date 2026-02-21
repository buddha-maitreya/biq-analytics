/**
 * useLiveMetrics — Real-time dashboard metrics using @agentuity/react.
 *
 * Uses the SDK's useWebsocket() hook for bidirectional communication
 * with the metrics endpoint. The server pushes metric updates, and the
 * client can request specific metric subscriptions.
 *
 * This hook demonstrates the useWebsocket pattern from @agentuity/react:
 * - Auto-reconnection with exponential backoff
 * - Message queuing while disconnected
 * - Bidirectional typed messaging
 *
 * Backend: WS /api/metrics/ws (WebSocket)
 *
 * @example
 * ```tsx
 * const { metrics, isConnected, subscribe } = useLiveMetrics();
 * ```
 */

import { useWebsocket } from "@agentuity/react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface DashboardMetrics {
  todaySales: number;
  todayOrders: number;
  lowStockCount: number;
  activeCustomers: number;
  pendingInvoices: number;
  revenueThisMonth: number;
  updatedAt: string;
}

interface MetricsMessage {
  type: "metrics" | "alert" | "pong";
  metrics?: Partial<DashboardMetrics>;
  alert?: {
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
  };
}

interface MetricsCommand {
  type: "subscribe" | "ping";
  metrics?: string[];
}

export function useLiveMetrics() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    todaySales: 0,
    todayOrders: 0,
    lowStockCount: 0,
    activeCustomers: 0,
    pendingInvoices: 0,
    revenueThisMonth: 0,
    updatedAt: new Date().toISOString(),
  });

  const [alerts, setAlerts] = useState<
    Array<{ severity: string; title: string; message: string; receivedAt: string }>
  >([]);

  const { isConnected, send, data, error } = useWebsocket<MetricsMessage, MetricsCommand>(
    "/api/metrics/ws",
    { maxMessages: 50 },
  );

  // Track last processed message
  const lastDataRef = useRef<MetricsMessage | undefined>(undefined);

  useEffect(() => {
    if (!data || data === lastDataRef.current) return;
    lastDataRef.current = data;

    switch (data.type) {
      case "metrics":
        if (data.metrics) {
          setMetrics((prev) => ({
            ...prev,
            ...data.metrics,
            updatedAt: new Date().toISOString(),
          }));
        }
        break;
      case "alert":
        if (data.alert) {
          setAlerts((prev) => [
            { ...data.alert!, receivedAt: new Date().toISOString() },
            ...prev.slice(0, 49), // Keep last 50
          ]);
        }
        break;
    }
  }, [data]);

  const subscribe = useCallback(
    (metricNames: string[]) => {
      send({ type: "subscribe", metrics: metricNames });
    },
    [send],
  );

  return {
    metrics,
    alerts,
    isConnected,
    error,
    subscribe,
  };
}
