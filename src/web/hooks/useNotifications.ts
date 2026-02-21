/**
 * useNotifications — Real-time notification feed using @agentuity/react.
 *
 * Uses the SDK's useEventStream() hook for server-push notifications
 * instead of polling. SSE connection auto-reconnects with backoff.
 *
 * Backend: GET /api/notifications/stream (SSE)
 *
 * @example
 * ```tsx
 * const { notifications, unreadCount, isConnected, markRead } = useNotifications();
 * ```
 */

import { useEventStream } from "@agentuity/react";
import { useAPI } from "@agentuity/react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationEvent {
  type: "initial" | "new" | "read" | "cleared";
  notifications?: Notification[];
  notification?: Notification;
  notificationId?: string;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // SSE stream for real-time push
  const { data, isConnected, error } = useEventStream<NotificationEvent>(
    "/api/notifications/stream",
  );

  // REST endpoint for marking as read
  const { invoke: markReadApi } = useAPI("POST /api/notifications/read");

  // Track last processed event to avoid duplicates
  const lastEventRef = useRef<NotificationEvent | undefined>(undefined);

  // Process incoming SSE events
  useEffect(() => {
    if (!data || data === lastEventRef.current) return;
    lastEventRef.current = data;

    switch (data.type) {
      case "initial":
        if (data.notifications) {
          setNotifications(data.notifications);
        }
        break;
      case "new":
        if (data.notification) {
          setNotifications((prev) => [data.notification!, ...prev]);
        }
        break;
      case "read":
        if (data.notificationId) {
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === data.notificationId ? { ...n, isRead: true } : n,
            ),
          );
        }
        break;
      case "cleared":
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        break;
    }
  }, [data]);

  const markRead = useCallback(
    async (notificationId: string) => {
      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, isRead: true } : n,
        ),
      );
      try {
        await markReadApi({ notificationId });
      } catch {
        // Revert on failure
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notificationId ? { ...n, isRead: false } : n,
          ),
        );
      }
    },
    [markReadApi],
  );

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return {
    notifications,
    unreadCount,
    isConnected,
    error,
    markRead,
  };
}
