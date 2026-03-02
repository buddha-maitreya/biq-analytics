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

// No-op in production — prevents JSON serialization overhead on mobile
const devLog = process.env.NODE_ENV !== "production" ? console.log : (..._args: any[]) => {};
import type { AppConfig } from "../types";
import { useChatStream } from "../hooks/useChatStream";
import type { ToolCall } from "../hooks/useChatStream";
import SessionSidebar from "../components/chat/SessionSidebar";
import MessageBubble, { renderMarkdown } from "../components/chat/MessageBubble";
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
  onOpenSidebar?: () => void;
}

export default function AssistantPage({ config, onOpenSidebar }: AssistantPageProps) {
  const {
    sessions,
    activeSessionId,
    hasMoreSessions,
    messages,
    streamingText,
    streamingToolCalls,
    streaming,
    isConnected,
    error,
    loadSessions,
    loadMoreSessions,
    createSession,
    selectSession,
    deleteSession,
    sendMessage,
    retryLastMessage,
    cancelStream,
    submitFeedback,
  } = useChatStream();

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
      scan_document: "📷 The Scanner is processing...",
      export_report: "📄 Exporting report...",
      get_business_snapshot: "🧠 The Brain is analyzing...",
    };
    return map[active.name] ?? `⚙️ Running ${active.name}...`;
  };

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Auto-scroll on new messages — debounced to avoid fighting with mobile keyboard.
  // Only auto-scroll if user is already near the bottom (within 150px).
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const container = messagesEndRef.current?.parentElement;
      if (container) {
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
        if (isNearBottom) {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      }
    }, 100);
    return () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current); };
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
  const handleFileUpload = async (file: File, sessionIdOverride?: string) => {
    devLog("[UPLOAD:1] handleFileUpload called", { fileName: file?.name, fileSize: file?.size, fileType: file?.type, sessionIdOverride, activeSessionId });
    if (!file) {
      console.warn("[UPLOAD:1] No file provided — aborting");
      return;
    }
    // Auto-create session if needed (caller can pass one to avoid races)
    let sessionId = sessionIdOverride ?? activeSessionId;
    if (!sessionId) {
      devLog("[UPLOAD:2] No session — creating one");
      sessionId = await createSession();
      if (!sessionId) {
        console.error("[UPLOAD:2] Session creation returned null — aborting upload");
        throw new Error("Failed to create chat session for upload");
      }
      devLog("[UPLOAD:2] Session created", { sessionId });
    }

    const url = `/api/chat/sessions/${sessionId}/attachments`;
    devLog("[UPLOAD:3] Uploading to", url, { fileName: file.name, fileSize: file.size, fileType: file.type });

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name),
        },
      });
    } catch (networkErr: any) {
      console.error("[UPLOAD:3] fetch() threw (network error)", { error: networkErr?.message, stack: networkErr?.stack });
      throw new Error(`Network error uploading ${file.name}: ${networkErr?.message || "Connection failed"}`);
    }

    devLog("[UPLOAD:4] Response received", { status: res.status, statusText: res.statusText, contentType: res.headers.get("content-type") });

    if (!res.ok) {
      let errMsg = `Upload failed (HTTP ${res.status} ${res.statusText})`;
      try {
        const text = await res.text();
        console.error("[UPLOAD:4] Error response body", text);
        try {
          const j = JSON.parse(text);
          errMsg = j.error || errMsg;
        } catch {
          if (text.length < 500) errMsg += `: ${text}`;
        }
      } catch {}
      throw new Error(errMsg);
    }

    let json: any;
    try {
      json = await res.json();
    } catch (parseErr: any) {
      console.error("[UPLOAD:5] Failed to parse JSON response", { error: parseErr?.message });
      throw new Error(`Upload succeeded but response was not valid JSON: ${parseErr?.message}`);
    }

    devLog("[UPLOAD:5] Upload successful", { attachmentId: json.data?.id, filename: json.data?.filename });

    const att = json.data;
    if (!att?.id) {
      console.error("[UPLOAD:5] Response missing attachment data", json);
      throw new Error("Upload response missing attachment data");
    }
    const isImage = att.contentType?.startsWith("image/");
    setPendingAttachments((prev) => [...prev, {
      id: att.id,
      filename: att.filename,
      contentType: att.contentType,
      sizeBytes: att.sizeBytes,
      previewUrl: isImage ? att.downloadUrl : undefined,
    }]);
    return sessionId;
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    devLog("[UPLOAD:0] handleFileInput triggered", { fileCount: files?.length, streaming, uploading, activeSessionId });
    if (!files || files.length === 0) {
      console.warn("[UPLOAD:0] No files selected — user may have cancelled picker");
      return;
    }
    // CRITICAL: Copy files BEFORE clearing the input. `files` is a live reference
    // to e.target.files — setting value="" empties the FileList immediately.
    const fileList = Array.from(files);
    e.target.value = ""; // reset so same file can be re-selected
    devLog("[UPLOAD:0] Files to upload:", fileList.map(f => ({ name: f.name, size: f.size, type: f.type })));

    setUploading(true);
    setUploadError(null);

    try {
      // Ensure session exists once before uploading all files
      let sessionId = activeSessionId;
      if (!sessionId) {
        devLog("[UPLOAD:0] No active session — creating one for upload");
        sessionId = await createSession();
        if (!sessionId) {
          const msg = "Failed to create chat session — cannot upload files";
          console.error("[UPLOAD:0]", msg);
          setUploadError(msg);
          setUploading(false);
          return;
        }
        devLog("[UPLOAD:0] Session created for upload", { sessionId });
      }
      // Upload files sequentially to avoid race conditions
      let successCount = 0;
      for (const file of fileList) {
        try {
          await handleFileUpload(file, sessionId);
          successCount++;
          devLog(`[UPLOAD:0] File ${successCount}/${fileList.length} uploaded: ${file.name}`);
        } catch (err: any) {
          const msg = err?.message || `Upload failed for ${file.name}`;
          console.error("[UPLOAD:0] File upload error", { file: file.name, error: msg, stack: err?.stack });
          setUploadError(msg);
        }
      }
      if (successCount > 0) {
        devLog(`[UPLOAD:0] Upload complete: ${successCount}/${fileList.length} files succeeded`);
      }
    } catch (outerErr: any) {
      const msg = outerErr?.message || "Unexpected upload error";
      console.error("[UPLOAD:0] Outer error in handleFileInput", { error: msg, stack: outerErr?.stack });
      setUploadError(msg);
    } finally {
      setUploading(false);
    }
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
        hasMore={hasMoreSessions}
        onSelect={selectSession}
        onCreate={createSession}
        onDelete={deleteSession}
        onLoadMore={loadMoreSessions}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      {/* Main chat area */}
      <div className="chat-main">
        {/* Header */}
        <div className="chat-header">
          {onOpenSidebar && (
            <button
              className="chat-nav-toggle"
              onClick={onOpenSidebar}
              aria-label="Open navigation menu"
            >
              <span /><span /><span />
            </button>
          )}
          <button
            className="chat-sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open conversations"
            title="Chat history"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="15" y2="10"/></svg>
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
                    {renderMarkdown(streamingText)}
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

        {/* Upload error notification */}
        {uploadError && (
          <div className="chat-upload-error" style={{
            padding: "8px 14px",
            margin: "0 16px 8px",
            background: "var(--danger-bg, #fef2f2)",
            color: "var(--danger-text, #dc2626)",
            borderRadius: "8px",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            border: "1px solid var(--danger-border, #fecaca)",
          }}>
            <span>⚠️ {uploadError}</span>
            <button
              onClick={() => setUploadError(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "inherit" }}
              title="Dismiss"
            >✕</button>
          </div>
        )}

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
          <input ref={fileInputRef} type="file" accept="image/*,.pdf,.csv,.json,.txt,.md,.xlsx,.xls" multiple onChange={handleFileInput} style={{ display: "none" }} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple onChange={handleFileInput} style={{ display: "none" }} />

          {/* Attach button */}
          <button
            className="btn btn-icon chat-attach-btn"
            onClick={() => {
              devLog("[UPLOAD:BTN] Attach button clicked", { streaming, uploading, fileInputRef: !!fileInputRef.current });
              setUploadError(null);
              if (!fileInputRef.current) {
                console.error("[UPLOAD:BTN] fileInputRef is null — hidden input not mounted");
                setUploadError("File input not ready — please try again");
                return;
              }
              fileInputRef.current.click();
            }}
            disabled={streaming || uploading}
            title="Attach file (images, documents, spreadsheets)"
          >
            {uploading ? "⏳" : "📎"}
          </button>

          {/* Camera button (opens camera on mobile, file picker on desktop) */}
          <button
            className="btn btn-icon chat-attach-btn"
            onClick={() => {
              devLog("[UPLOAD:BTN] Camera button clicked", { streaming, uploading, cameraInputRef: !!cameraInputRef.current });
              setUploadError(null);
              if (!cameraInputRef.current) {
                console.error("[UPLOAD:BTN] cameraInputRef is null — hidden input not mounted");
                setUploadError("Camera input not ready — please try again");
                return;
              }
              cameraInputRef.current.click();
            }}
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
              onClick={cancelStream}
              title="Stop generation"
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
