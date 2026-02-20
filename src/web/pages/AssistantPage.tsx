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

/** Pending attachment before send */
interface PendingAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  previewUrl?: string;
}

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
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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
    if ((!text && pendingAttachments.length === 0) || streaming) return;
    const attachmentIds = pendingAttachments.map((a) => a.id);
    setInput("");
    setPendingAttachments([]);
    await sendMessage(text || "Please analyze the attached file(s).", attachmentIds.length > 0 ? attachmentIds : undefined);
  };

  /** Upload a file and add it as a pending attachment */
  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      // Auto-create session if needed
      let sessionId = activeSessionId;
      if (!sessionId) {
        sessionId = await createSession();
        if (!sessionId) { setUploading(false); return; }
      }

      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("biq_token");
      const res = await fetch(`/api/chat/sessions/${sessionId}/attachments`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        let errMsg = `Upload failed (${res.status})`;
        try { const j = await res.json(); errMsg = j.error || errMsg; } catch {}
        throw new Error(errMsg);
      }
      const json = await res.json();
      const att = json.data;
      const isImage = att.contentType?.startsWith("image/");
      setPendingAttachments((prev) => [...prev, {
        id: att.id,
        filename: att.filename,
        contentType: att.contentType,
        sizeBytes: att.sizeBytes,
        previewUrl: isImage ? att.downloadUrl : undefined,
      }]);
    } catch (err: any) {
      alert(err?.message || "File upload failed");
    }
    setUploading(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = ""; // reset so same file can be re-selected
  };

  const removeAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
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

        {/* Pending attachments preview */}
        {pendingAttachments.length > 0 && (
          <div className="chat-attachments-preview">
            {pendingAttachments.map((att) => (
              <div key={att.id} className="chat-attachment-chip">
                {att.previewUrl ? (
                  <img src={att.previewUrl} alt={att.filename} className="attachment-thumb" />
                ) : (
                  <span className="attachment-icon">📄</span>
                )}
                <span className="attachment-name">{att.filename}</span>
                <button className="attachment-remove" onClick={() => removeAttachment(att.id)} title="Remove">✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="chat-input">
          {/* Hidden file inputs */}
          <input ref={fileInputRef} type="file" accept="image/*,.pdf,.csv,.json,.txt,.md,.xlsx,.xls" onChange={handleFileInput} style={{ display: "none" }} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileInput} style={{ display: "none" }} />

          {/* Attach button */}
          <button
            className="btn btn-icon chat-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming || uploading}
            title="Attach file (images, documents, spreadsheets)"
          >
            {uploading ? "⏳" : "📎"}
          </button>

          {/* Camera button (opens camera on mobile, file picker on desktop) */}
          <button
            className="btn btn-icon chat-attach-btn"
            onClick={() => cameraInputRef.current?.click()}
            disabled={streaming || uploading}
            title="Take photo — scan barcode, invoice, stock sheet"
          >
            📷
          </button>

          <input
            type="text"
            placeholder={pendingAttachments.length > 0 ? "Add instructions for the attached file(s)..." : "Ask a question about your business..."}
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
              disabled={(!input.trim() && pendingAttachments.length === 0) || streaming}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
