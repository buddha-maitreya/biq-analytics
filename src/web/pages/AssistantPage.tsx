/**
 * AssistantPage — SSE-streaming AI Assistant with session management.
 *
 * Wires together:
 * - useChatStream hook (SSE + session CRUD + send)
 * - SessionSidebar (conversation list)
 * - MessageBubble (rich markdown + tool cards + feedback)
 * - ToolCallCard (per-tool renderers shown during streaming)
 * - Connection status dot + reconnecting banner
 * - Token usage display on assistant messages
 */

import React, { useState, useRef, useEffect } from "react";
import type { AppConfig } from "../types";
import { useChatStream } from "../hooks/useChatStream";
import type { ToolCall } from "../hooks/useChatStream";
import SessionSidebar from "../components/chat/SessionSidebar";
import MessageBubble from "../components/chat/MessageBubble";
import ToolCallCard from "../components/chat/ToolCallCard";

interface AssistantPageProps {
  config: AppConfig;
}

export default function AssistantPage({ config }: AssistantPageProps) {
  const {
    sessions,
    activeSessionId,
    messages,
    streamingText,
    streamingToolCalls,
    streaming,
    isConnected,
    error,
    loadSessions,
    createSession,
    selectSession,
    deleteSession,
    sendMessage,
    retryLastMessage,
    submitFeedback,
  } = useChatStream();

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Map tool names to agent display labels */
  const getAgentLabel = (toolCalls: ToolCall[]): string | null => {
    const active = toolCalls.find((tc) => tc.status === "running");
    if (!active) return null;
    const map: Record<string, string> = {
      query_database: "🧠 The Brain is querying...",
      analyze_trends: "📊 The Analyst is computing...",
      generate_report: "📝 The Writer is drafting...",
      search_knowledge: "📚 The Librarian is searching...",
      get_business_snapshot: "🧠 The Brain is analyzing...",
    };
    return map[active.name] ?? `⚙️ Running ${active.name}...`;
  };

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Auto-scroll on new messages / streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, streamingToolCalls]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    await sendMessage(text);
  };

  const handleSuggestion = async (text: string) => {
    if (streaming) return;
    setInput("");
    await sendMessage(text);
  };

  const suggestions = [
    `What are my top selling ${config.labels.productPlural.toLowerCase()}?`,
    "Which products are running low on stock?",
    `How many ${config.labels.orderPlural.toLowerCase()} were placed this week?`,
    "What's my total revenue this month?",
    "Show me a sales trend analysis",
    "Give me a business snapshot",
  ];

  const hasMessages = messages.length > 0 || streamingText || streamingToolCalls.length > 0;

  return (
    <div className="page assistant-page">
      {/* Session sidebar */}
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={selectSession}
        onCreate={createSession}
        onDelete={deleteSession}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      {/* Main chat area */}
      <div className="chat-main">
        {/* Header */}
        <div className="chat-header">
          <button
            className="chat-sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open conversations"
          >
            ☰
          </button>
          <h2>🤖 Executive AI Assistant</h2>
          <div className="chat-header-right">
            <span
              className={`chat-connection-dot ${isConnected ? "connected" : "disconnected"}`}
              title={isConnected ? "Connected" : "Disconnected"}
            />
          </div>
        </div>

        {/* Reconnecting banner */}
        {!isConnected && activeSessionId && (
          <div className="chat-reconnecting-banner">
            Reconnecting…
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="chat-error-banner">
            <span>{error}</span>
            <button onClick={retryLastMessage} className="btn btn-sm">
              Retry
            </button>
          </div>
        )}

        {/* Messages area */}
        <div className="chat-messages">
          {!hasMessages && (
            <div className="chat-empty">
              <h3>How can I help?</h3>
              <p className="text-muted">
                Ask about {config.labels.productPlural.toLowerCase()},{" "}
                {config.labels.orderPlural.toLowerCase()}, inventory, and more
              </p>
              <div className="suggestion-grid">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    className="suggestion-btn"
                    onClick={() => handleSuggestion(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Persisted messages */}
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onFeedback={msg.role === "assistant" ? submitFeedback : undefined}
            />
          ))}

          {/* Streaming: live tool calls */}
          {streamingToolCalls.length > 0 && (
            <div className="chat-message assistant">
              <div className="message-bubble">
                <div className="message-tool-calls">
                  {streamingToolCalls.map((tc: ToolCall) => (
                    <ToolCallCard key={tc.id} toolCall={tc} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Streaming: live text */}
          {streamingText && (
            <div className="chat-message assistant">
              <div className="message-bubble">
                <div className="message-content">
                  <div className="message-markdown streaming-text">
                    {streamingText}
                    <span className="streaming-cursor">▍</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Thinking indicator — shows which agent is working */}
          {streaming && !streamingText && streamingToolCalls.length === 0 && (
            <div className="chat-message assistant">
              <div className="message-bubble loading-bubble">
                <span className="typing-indicator">●●●</span>
                <span className="agent-thinking-label">🧠 The Brain is thinking...</span>
              </div>
            </div>
          )}

          {/* Agent routing indicator during tool execution */}
          {streaming && streamingToolCalls.length > 0 && (
            <div className="streaming-agent-indicator">
              {getAgentLabel(streamingToolCalls as ToolCall[]) ?? "⚙️ Processing..."}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="chat-input">
          <input
            type="text"
            placeholder="Ask a question about your business..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={streaming}
          />
          {streaming ? (
            <button
              className="btn btn-danger"
              onClick={() => {
                // Abort current stream by creating a new session (soft cancel)
                abortRef.current?.abort();
                window.location.reload();
              }}
              title="Cancel generation"
            >
              ■ Stop
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleSend}
              disabled={!input.trim() || streaming}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
