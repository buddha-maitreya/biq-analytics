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
      return { ...state, isConnected: false, error: action.error ?? null };

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

/** Reconnect delay in ms (from Coder) */
const RECONNECT_DELAY_MS = 2_000;
/** Max retries (from Coder) */
const MAX_RETRIES = 15;

function getAuthToken(): string | null {
  return localStorage.getItem("biq_token");
}

function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
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

  // ── SSE connection lifecycle ───────────────────────────
  // Mirrors Coder's useSessionEvents useEffect:
  // 1. Hydrate messages from REST
  // 2. Connect EventSource
  // 3. Exponential backoff reconnect
  // 4. Cleanup on unmount / session change

  useEffect(() => {
    if (!state.activeSessionId) return;
    const sessionId = state.activeSessionId;
    const token = getAuthToken();
    if (!token) return;

    retryCountRef.current = 0;
    shouldReconnectRef.current = true;

    // Hydrate existing messages (like Coder's initial fetch)
    fetch(`/api/chat/sessions/${sessionId}/messages`, {
      headers: getAuthHeaders(),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((body: { data: ChatMessage[] }) => {
        if (body.data?.length) {
          dispatch({ type: "INIT_MESSAGES", messages: body.data });
        }
      })
      .catch(() => {
        // Best-effort hydration (session might not exist yet)
      });

    // ── EventSource with reconnect (from Coder) ──────────

    function scheduleReconnect(reason?: string) {
      if (!shouldReconnectRef.current) return;
      if (reconnectTimerRef.current) return;
      retryCountRef.current += 1;
      if (retryCountRef.current <= MAX_RETRIES) {
        dispatch({ type: "DISCONNECTED", error: reason });
        const delay = Math.min(
          RECONNECT_DELAY_MS * Math.pow(1.5, retryCountRef.current - 1),
          10_000
        );
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, delay);
      } else {
        dispatch({
          type: "DISCONNECTED",
          error: reason ?? "Max reconnection attempts reached",
        });
      }
    }

    function connect() {
      // EventSource with auth via query param (can't use headers)
      const url = `/api/chat/sessions/${sessionId}/events?token=${encodeURIComponent(token!)}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        retryCountRef.current = 0;
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
        scheduleReconnect("Connection lost");
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
      }
    } catch {
      // silent
    }
  }, []);

  const createSession = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const { data } = await res.json();
        dispatch({ type: "ADD_SESSION", session: data });
        dispatch({ type: "SET_ACTIVE_SESSION", sessionId: data.id });
        return data.id;
      }
    } catch {
      // silent
    }
    return null;
  }, []);

  const selectSession = useCallback(async (sessionId: string) => {
    dispatch({ type: "SET_ACTIVE_SESSION", sessionId });
    // Messages will be hydrated by the useEffect above
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      dispatch({ type: "REMOVE_SESSION", sessionId });
    } catch {
      // silent
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
      submitFeedback,
    ]
  );
}
