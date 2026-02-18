/**
 * AssistantPage — Phase 8 Intelligent Business Chatbot.
 *
 * Features:
 *   - SSE streaming responses from the Data Science Assistant
 *   - Tool call visualization (database queries, analysis, reports, knowledge)
 *   - Multi-session chat with sidebar
 *   - Markdown rendering with code blocks and tables
 *   - Feedback (thumbs up/down) per message
 *   - Typing indicator with live token streaming
 *   - Mobile-responsive with drawer sidebar
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import type { AppConfig } from "../types";
import { useChatStream } from "../hooks/useChatStream";
import SessionSidebar from "../components/chat/SessionSidebar";
import MessageBubble from "../components/chat/MessageBubble";
import ToolCallCard from "../components/chat/ToolCallCard";

interface AssistantPageProps {
  config: AppConfig;
}

export default function AssistantPage({ config }: AssistantPageProps) {
  const [input, setInput] = useState("");
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    sessions,
    activeSessionId,
    messages,
    streaming,
    error,
    streamingText,
    streamingToolCalls,
    isConnected,
    loadSessions,
    createSession,
    selectSession,
    deleteSession,
    sendMessage,
    retryLastMessage,
    submitFeedback,
  } = useChatStream();

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Scroll to bottom on new messages or streaming text
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, streamingToolCalls]);

  // Focus input after stream completes
  useEffect(() => {
    if (!streaming) {
      inputRef.current?.focus();
    }
  }, [streaming]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming) return;
    const msg = input.trim();
    setInput("");
    await sendMessage(msg);
  }, [input, streaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const suggestions = [
    `What are my top selling ${config.labels.productPlural.toLowerCase()}?`,
    `Show me a sales summary report`,
    `Which ${config.labels.productPlural.toLowerCase()} are running low?`,
    `Analyze demand trends for the last 30 days`,
    `What's my total revenue this month?`,
    `Give me a business overview`,
  ];

  return (
    <div className="page assistant-page-v2">
      {/* Session Sidebar */}
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={selectSession}
        onCreate={createSession}
        onDelete={deleteSession}
        mobileOpen={sessionDrawerOpen}
        onCloseMobile={() => setSessionDrawerOpen(false)}
      />

      {/* Main Chat Area */}
      <div className="chat-main">
        {/* Header */}
        <div className="chat-main-header">
          <button
            className="chat-session-toggle"
            onClick={() => setSessionDrawerOpen(true)}
            title="Show conversations"
          >
            ☰
          </button>
          <div className="chat-main-title">
            <h2>🧠 Data Science Assistant</h2>
            <span className="chat-main-subtitle">
              Ask about {config.labels.productPlural.toLowerCase()},{" "}
              {config.labels.orderPlural.toLowerCase()}, trends, reports, and
              more
            </span>
          </div>
          {/* Connection status indicator */}
          <span
            className={`chat-connection-dot ${isConnected ? "connected" : "disconnected"}`}
            title={isConnected ? "Connected" : "Reconnecting…"}
          />
        </div>

        {/* Messages */}
        <div className="chat-messages-v2">
          {/* Empty state */}
          {messages.length === 0 && !streaming && !activeSessionId && (
            <div className="chat-empty-v2">
              <div className="chat-empty-icon">🧠</div>
              <h3>Data Science Assistant</h3>
              <p>
                I can query your database, analyze trends, generate reports, and
                search your knowledge base. What would you like to know?
              </p>
              <div className="chat-suggestions-grid">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    className="chat-suggestion-btn"
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onFeedback={submitFeedback}
            />
          ))}

          {/* Streaming assistant response */}
          {streaming && (
            <div className="chat-message assistant">
              <div className="message-bubble streaming-bubble">
                {/* Active tool calls */}
                {streamingToolCalls.length > 0 && (
                  <div className="message-tool-calls">
                    {streamingToolCalls.map((tc) => (
                      <ToolCallCard key={tc.id} toolCall={tc} />
                    ))}
                  </div>
                )}

                {/* Streaming text */}
                {streamingText ? (
                  <div className="message-content">
                    <div className="message-markdown">
                      <p>{streamingText}</p>
                    </div>
                  </div>
                ) : streamingToolCalls.length === 0 ? (
                  <div className="message-content">
                    <span className="typing-indicator-v2">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Reconnecting banner */}
          {!isConnected && activeSessionId && (
            <div className="chat-reconnecting-banner">
              <span className="reconnecting-spinner" />
              Reconnecting…
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="chat-error-banner">
              <span>⚠️ {error}</span>
              <button
                onClick={() => {
                  retryLastMessage();
                }}
              >
                Retry
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="chat-input-v2">
          <div className="chat-input-row">
            <input
              ref={inputRef}
              type="text"
              placeholder="Ask a question about your business…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
              autoFocus
            />
            <button
              className="btn btn-primary chat-send-btn"
              onClick={handleSend}
              disabled={!input.trim() || streaming}
            >
              {streaming ? "…" : "Send"}
            </button>
          </div>
          <div className="chat-input-hint">
            Press Enter to send · Powered by Data Science Assistant
          </div>
        </div>
      </div>
    </div>
  );
}
