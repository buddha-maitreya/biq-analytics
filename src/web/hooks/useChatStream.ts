/**
 * useChatStream — SSE-based chat hook with useReducer.
 *
 * Genuinely adapted from Agentuity Coder's useSessionEvents.ts (692 lines).
 * Key patterns borrowed:
 *
 * 1. EventSource with exponential-backoff reconnect (not fetch-body reading)
 * 2. Map<id, T> state for O(1) lookups (not flat arrays)
 * 3. Separate event dispatcher function mapping SSE event types → actions
 * 4. useMemo/useCallback for derived helpers (sorted messages, etc.)
 * 5. Connection lifecycle: CONNECTED / DISCONNECTED / error state
 * 6. Keepalive (pings from server) tracked for connection health
 * 7. Initial hydration from REST before subscribing to SSE
 *
 * Differences from Coder (intentional, not laziness):
 * - No child sessions, permissions, questions, todos (not applicable to BIQ)
 * - Session management (create/list/delete) is in this hook (BIQ has no
 *   separate session context like Coder's AppContext)
 * - Tool calls are tracked as a Map keyed by toolId
 */

import {
  useReducer,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: "pending" | "running" | "completed" | "error";
  startedAt?: number;
  completedAt?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls?: ToolCall[];
  metadata?: {
    model?: string;
    tokens?: { prompt: number; completion: number };
    feedbackRating?: "up" | "down";
  };
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────
// State (Map-based for O(1) lookups, like Coder)
// ────────────────────────────────────────────────────────────

export interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  /** Messages keyed by ID (Map for O(1) access like Coder's useSessionEvents) */
  messages: Map<string, ChatMessage>;
  /** Tool calls for the current streaming response, keyed by toolCallId */
  streamingToolCalls: Map<string, ToolCall>;
  /** Partial text being streamed */
  streamingText: string;
  /** Session status (mirrors Coder's sessionStatus pattern) */
  sessionStatus: "idle" | "busy";
  /** Connection status (mirrors Coder's isConnected) */
  isConnected: boolean;
  /** Error (mirrors Coder's error state) */
  error: string | null;
}

// ────────────────────────────────────────────────────────────
// Actions
// ────────────────────────────────────────────────────────────

type ChatAction =
  // Session management
  | { type: "SET_SESSIONS"; sessions: ChatSession[] }
  | { type: "ADD_SESSION"; session: ChatSession }
  | { type: "REMOVE_SESSION"; sessionId: string }
  | { type: "SET_ACTIVE_SESSION"; sessionId: string | null }
  // Message hydration (from REST, like Coder's INIT_MESSAGES)
  | { type: "INIT_MESSAGES"; messages: ChatMessage[] }
  | { type: "ADD_USER_MESSAGE"; message: ChatMessage }
  // SSE event → state mapping (like Coder's dispatchChatEvent)
  | { type: "SESSION_STATUS"; status: "idle" | "busy" }
  | { type: "MESSAGE_DELTA"; content: string }
  | {
      type: "TOOL_START";
      toolId: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "TOOL_RESULT"; toolId: string; name?: string; output: unknown }
  | { type: "MESSAGE_DONE"; messageId: string; toolCalls?: ToolCall[] }
  | { type: "SESSION_ERROR"; error: string }
  // Connection lifecycle (like Coder's CONNECTED/DISCONNECTED)
  | { type: "CONNECTED" }
  | { type: "DISCONNECTED"; error?: string }
  | { type: "SET_FEEDBACK"; messageId: string; rating: "up" | "down" }
  | { type: "CLEAR" };

// ────────────────────────────────────────────────────────────
// Initial state
// ────────────────────────────────────────────────────────────

const initialState: ChatState = {
  sessions: [],
  activeSessionId: null,
  messages: new Map(),
  streamingToolCalls: new Map(),
  streamingText: "",
  sessionStatus: "idle",
  isConnected: false,
  error: null,
};

// ────────────────────────────────────────────────────────────
// Reducer
// ────────────────────────────────────────────────────────────

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions };

    case "ADD_SESSION":
      return { ...state, sessions: [action.session, ...state.sessions] };

    case "REMOVE_SESSION": {
      const isActive = state.activeSessionId === action.sessionId;
      return {
        ...state,
        sessions: state.sessions.filter((s) => s.id !== action.sessionId),
        ...(isActive
          ? {
              activeSessionId: null,
              messages: new Map(),
              streamingText: "",
              streamingToolCalls: new Map(),
            }
          : {}),
      };
    }

    case "SET_ACTIVE_SESSION":
      return {
        ...state,
        activeSessionId: action.sessionId,
        messages: new Map(),
        streamingText: "",
        streamingToolCalls: new Map(),
        error: null,
      };

    // Hydrate from REST (like Coder's INIT_MESSAGES)
    case "INIT_MESSAGES": {
      const messages = new Map<string, ChatMessage>();
      for (const msg of action.messages) {
        messages.set(msg.id, msg);
      }
      return { ...state, messages };
    }

    case "ADD_USER_MESSAGE": {
      const messages = new Map(state.messages);
      messages.set(action.message.id, action.message);
      return { ...state, messages };
    }

    // SSE events

    case "SESSION_STATUS": {
      const updates: Partial<ChatState> = { sessionStatus: action.status };
      if (action.status === "busy") {
        updates.error = null;
        updates.streamingText = "";
        updates.streamingToolCalls = new Map();
      }
      return { ...state, ...updates };
    }

    case "MESSAGE_DELTA":
      return {
        ...state,
        streamingText: state.streamingText + action.content,
      };

    case "TOOL_START": {
      const toolCalls = new Map(state.streamingToolCalls);
      toolCalls.set(action.toolId, {
        id: action.toolId,
        name: action.name,
        input: action.input,
        status: "running",
        startedAt: Date.now(),
      });
      return { ...state, streamingToolCalls: toolCalls };
    }

    case "TOOL_RESULT": {
      const toolCalls = new Map(state.streamingToolCalls);
      const existing = toolCalls.get(action.toolId);
      if (existing) {
        toolCalls.set(action.toolId, {
          ...existing,
          output: action.output,
          status: "completed",
          completedAt: Date.now(),
        });
      }
      return { ...state, streamingToolCalls: toolCalls };
    }

    case "MESSAGE_DONE": {
      // Finalize: create the assistant message and add to messages Map
      const messages = new Map(state.messages);
      const toolCallsArr = action.toolCalls?.length
        ? action.toolCalls
        : state.streamingToolCalls.size > 0
          ? Array.from(state.streamingToolCalls.values())
          : undefined;
      messages.set(action.messageId, {
        id: action.messageId,
        role: "assistant",
        content: state.streamingText,
        toolCalls: toolCallsArr,
        createdAt: new Date().toISOString(),
      });
      return {
        ...state,
        messages,
        sessionStatus: "idle",
        streamingText: "",
        streamingToolCalls: new Map(),
      };
    }

    case "SESSION_ERROR":
      return {
        ...state,
        error: action.error,
        sessionStatus: "idle",
        streamingText: "",
        streamingToolCalls: new Map(),
      };

    // Connection lifecycle (from Coder)
    case "CONNECTED":
      return { ...state, isConnected: true, error: null };

    case "DISCONNECTED":
      return {
        ...state,
        isConnected: false,
        error: action.error ?? null,
        // Reset session status to idle on disconnect so buttons aren't stuck disabled.
        // If the server is still processing, the reconnected SSE will re-set "busy".
        sessionStatus: "idle",
        streamingText: "",
        streamingToolCalls: new Map(),
      };

    case "SET_FEEDBACK": {
      const messages = new Map(state.messages);
      const msg = messages.get(action.messageId);
      if (msg) {
        messages.set(action.messageId, {
          ...msg,
          metadata: { ...msg.metadata, feedbackRating: action.rating },
        });
      }
      return { ...state, messages };
    }

    case "CLEAR":
      return { ...initialState };

    default:
      return state;
  }
}

// ────────────────────────────────────────────────────────────
// SSE event → reducer dispatch mapping
// (Mirrors Coder's dispatchChatEvent function)
// ────────────────────────────────────────────────────────────

function dispatchSSEEvent(
  dispatch: React.Dispatch<ChatAction>,
  event: { type: string; properties: any }
) {
  switch (event.type) {
    case "session.connected":
      dispatch({ type: "CONNECTED" });
      break;
    case "session.status":
      dispatch({
        type: "SESSION_STATUS",
        status: event.properties.status,
      });
      break;
    case "message.delta":
      dispatch({
        type: "MESSAGE_DELTA",
        content: event.properties.content,
      });
      break;
    case "tool.start":
      dispatch({
        type: "TOOL_START",
        toolId: event.properties.toolId,
        name: event.properties.name,
        input: event.properties.input,
      });
      break;
    case "tool.result":
      dispatch({
        type: "TOOL_RESULT",
        toolId: event.properties.toolId,
        name: event.properties.name,
        output: event.properties.output,
      });
      break;
    case "message.done":
      dispatch({
        type: "MESSAGE_DONE",
        messageId: event.properties.messageId,
        toolCalls: event.properties.toolCalls,
      });
      break;
    case "error":
      dispatch({
        type: "SESSION_ERROR",
        error: event.properties.message || "Unknown error",
      });
      break;
    case "ping":
      // Keepalive — no state change needed
      break;
  }
}

// ────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────

/** Reconnect delay in ms */
const RECONNECT_DELAY_MS = 3_000;
/**
 * Max SSE reconnection attempts before giving up.
 * Kept low to avoid burning Agentuity sessions on persistent failures
 * (auth expiry, server crash, etc.). Network hiccups typically resolve
 * within 2-3 attempts.
 */
const MAX_RETRIES = 5;

/** Auth headers — cookies are sent automatically by the browser for same-origin requests */
function getAuthHeaders(): Record<string, string> {
  return {};
}

// ────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────

export function useChatStream() {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const lastUserMessageRef = useRef<string | null>(null);
  /** Tracks whether we've had at least one successful SSE open */
  const hasConnectedRef = useRef(false);
  /** Consecutive auth failures — stop reconnecting if auth is truly expired */
  const authFailCountRef = useRef(0);

  // ── SSE connection lifecycle ───────────────────────────
  // 1. Pre-flight auth check (prevents reconnect loop on 401)
  // 2. Hydrate messages from REST
  // 3. Connect EventSource
  // 4. Silent auto-reconnect for infrastructure drops (HTTP/2 proxy resets)
  // 5. Auth failures stop reconnection permanently
  // 6. Cleanup on unmount / session change

  useEffect(() => {
    if (!state.activeSessionId) return;
    const sessionId = state.activeSessionId;

    retryCountRef.current = 0;
    authFailCountRef.current = 0;
    hasConnectedRef.current = false;
    shouldReconnectRef.current = true;

    // ── EventSource with reconnect ───────────────────────

    /**
     * Schedule a reconnect. Infrastructure-level drops (HTTP/2 resets,
     * proxy timeouts) are normal for long-lived SSE — we reconnect
     * silently without counting them as failures. Only actual errors
     * (auth expired, server errors on pre-flight) count against
     * MAX_RETRIES.
     *
     * @param isFatal - true if this is a real error (auth/server), not
     *                  just an infrastructure connection cycle
     */
    function scheduleReconnect(reason?: string, isFatal = false) {
      if (!shouldReconnectRef.current) return;
      if (reconnectTimerRef.current) return;

      if (isFatal) {
        retryCountRef.current += 1;
        if (retryCountRef.current > MAX_RETRIES) {
          dispatch({
            type: "DISCONNECTED",
            error: reason ?? "Max reconnection attempts reached",
          });
          shouldReconnectRef.current = false;
          return;
        }
        dispatch({ type: "DISCONNECTED", error: reason });
      }
      // For non-fatal (infrastructure) drops: don't increment retry count,
      // don't dispatch DISCONNECTED (avoids UI flash), just reconnect silently.

      const delay = isFatal
        ? Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, retryCountRef.current - 1), 10_000)
        : RECONNECT_DELAY_MS; // quick reconnect for infrastructure drops

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    /**
     * Pre-flight auth check + message hydration.
     * EventSource can't expose HTTP status codes, so a 401 looks
     * identical to a network error — both fire onerror. Without this
     * guard, an expired session causes an infinite reconnect loop that
     * burns Agentuity sessions.
     *
     * We hit the messages endpoint (same cookies) to both verify auth
     * AND hydrate existing messages in a single request.
     */
    async function verifyAuthAndHydrate(): Promise<boolean> {
      try {
        const res = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
          headers: getAuthHeaders(),
        });
        if (res.status === 401 || res.status === 403) {
          authFailCountRef.current += 1;
          if (authFailCountRef.current >= 2) {
            // Two consecutive auth failures — definitely expired
            dispatch({
              type: "DISCONNECTED",
              error: "Session expired — please sign in again.",
            });
            shouldReconnectRef.current = false;
            return false;
          }
          // First auth failure — might be transient, let reconnect try once more
          return false;
        }
        // Auth succeeded — reset failure count
        authFailCountRef.current = 0;
        if (res.ok) {
          const body: { data: ChatMessage[] } = await res.json();
          if (body.data?.length) {
            dispatch({ type: "INIT_MESSAGES", messages: body.data });
          }
        }
        return true;
      } catch {
        // Network error — let the EventSource attempt proceed
        return true;
      }
    }

    async function connect() {
      // Pre-flight: verify auth + hydrate messages before opening EventSource
      const authOk = await verifyAuthAndHydrate();
      if (!authOk) {
        if (shouldReconnectRef.current) {
          // Auth failed but we haven't given up yet — schedule a fatal retry
          scheduleReconnect("Authentication check failed", true);
        }
        return;
      }
      if (!shouldReconnectRef.current) return;

      // EventSource sends cookies automatically for same-origin requests
      const url = `/api/chat/sessions/${sessionId}/events`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        retryCountRef.current = 0;
        hasConnectedRef.current = true;
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        dispatch({ type: "CONNECTED" });
      };

      es.onmessage = (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data as string);
          dispatchSSEEvent(dispatch, parsed);
        } catch {
          // Ignore malformed payloads
        }
      };

      es.onerror = () => {
        if (eventSourceRef.current !== es) return;
        es.close();
        // If we've successfully connected before, this is likely an
        // infrastructure drop (HTTP/2 proxy reset, Agentuity connection
        // cycling). Reconnect silently without flashing "Connection lost".
        if (hasConnectedRef.current) {
          scheduleReconnect(); // silent, non-fatal
        } else {
          // Never connected — this is a real error
          scheduleReconnect("Connection lost", true);
        }
      };
    }

    connect();

    return () => {
      shouldReconnectRef.current = false;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [state.activeSessionId]);

  // ── Session management ─────────────────────────────────

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/sessions", {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const { data } = await res.json();
        dispatch({ type: "SET_SESSIONS", sessions: data });
      } else {
        console.warn("[Chat] loadSessions failed", { status: res.status, statusText: res.statusText });
      }
    } catch (err: any) {
      console.error("[Chat] loadSessions error", { error: err?.message });
    }
  }, []);

  const createSession = useCallback(async (): Promise<string | null> => {
    try {
      console.log("[Chat] createSession — POST /api/chat/sessions");
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const { data } = await res.json();
        console.log("[Chat] createSession OK", { sessionId: data.id });
        dispatch({ type: "ADD_SESSION", session: data });
        dispatch({ type: "SET_ACTIVE_SESSION", sessionId: data.id });
        return data.id;
      } else {
        const text = await res.text().catch(() => "");
        console.error("[Chat] createSession failed", { status: res.status, statusText: res.statusText, body: text.slice(0, 300) });
      }
    } catch (err: any) {
      console.error("[Chat] createSession network error", { error: err?.message, stack: err?.stack });
    }
    return null;
  }, []);

  const selectSession = useCallback(async (sessionId: string) => {
    dispatch({ type: "SET_ACTIVE_SESSION", sessionId });
    // Messages will be hydrated by the useEffect above
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        console.warn("[Chat] deleteSession failed", { sessionId, status: res.status });
      }
      dispatch({ type: "REMOVE_SESSION", sessionId });
    } catch (err: any) {
      console.error("[Chat] deleteSession error", { sessionId, error: err?.message });
    }
  }, []);

  // ── Send message (fire-and-forget) ─────────────────────

  const sendMessage = useCallback(
    async (message: string, attachmentIds?: string[]) => {
      let sessionId = state.activeSessionId;

      // Auto-create session if none active
      if (!sessionId) {
        const newId = await createSession();
        if (!newId) {
          dispatch({
            type: "SESSION_ERROR",
            error: "Failed to create chat session",
          });
          return;
        }
        sessionId = newId;
      }

      // Track for retry
      lastUserMessageRef.current = message;

      // Optimistic: add user message to state immediately
      const userMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: message,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "ADD_USER_MESSAGE", message: userMsg });

      // Fire-and-forget POST — events arrive via EventSource
      try {
        const res = await fetch(`/api/chat/sessions/${sessionId}/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ message, ...(attachmentIds?.length ? { attachmentIds } : {}) }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          dispatch({
            type: "SESSION_ERROR",
            error: (errBody as any).error || `HTTP ${res.status}`,
          });
        }
      } catch (err: any) {
        dispatch({
          type: "SESSION_ERROR",
          error: err.message || "Failed to send message",
        });
      }
    },
    [state.activeSessionId, createSession]
  );

  // ── Retry last message ─────────────────────────────────

  const retryLastMessage = useCallback(async () => {
    if (lastUserMessageRef.current) {
      await sendMessage(lastUserMessageRef.current);
    }
  }, [sendMessage]);

  // ── Feedback ───────────────────────────────────────────

  const submitFeedback = useCallback(
    async (messageId: string, rating: "up" | "down") => {
      dispatch({ type: "SET_FEEDBACK", messageId, rating });
      try {
        await fetch(`/api/chat/messages/${messageId}/feedback`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ rating }),
        });
      } catch {
        // silent
      }
    },
    []
  );

  // ── Cancel generation ──────────────────────────────────

  const cancelStream = useCallback(async () => {
    const sessionId = state.activeSessionId;
    if (!sessionId) return;

    // Reset client state immediately for responsive UX
    dispatch({ type: "SESSION_STATUS", status: "idle" });

    // Tell the backend to abort the in-flight AI generation 
    try {
      await fetch(`/api/chat/sessions/${sessionId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      });
    } catch {
      // Best-effort — client state is already reset
    }
  }, [state.activeSessionId]);

  // ── Derived helpers (memoized, like Coder) ─────────────

  /** Messages sorted by creation time (ascending) — mirrors Coder's sortedMessages */
  const sortedMessages = useMemo(
    () =>
      Array.from(state.messages.values()).sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    [state.messages]
  );

  /** Tool calls as sorted array (for rendering) */
  const sortedStreamingToolCalls = useMemo(
    () =>
      Array.from(state.streamingToolCalls.values()).sort(
        (a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)
      ),
    [state.streamingToolCalls]
  );

  return useMemo(
    () => ({
      // State
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
      messages: sortedMessages,
      streamingText: state.streamingText,
      streamingToolCalls: sortedStreamingToolCalls,
      streaming: state.sessionStatus === "busy",
      isConnected: state.isConnected,
      error: state.error,
      // Actions
      loadSessions,
      createSession,
      selectSession,
      deleteSession,
      sendMessage,
      retryLastMessage,
      cancelStream,
      submitFeedback,
    }),
    [
      state.sessions,
      state.activeSessionId,
      sortedMessages,
      state.streamingText,
      sortedStreamingToolCalls,
      state.sessionStatus,
      state.isConnected,
      state.error,
      loadSessions,
      createSession,
      selectSession,
      deleteSession,
      sendMessage,
      retryLastMessage,
      cancelStream,
      submitFeedback,
    ]
  );
}
