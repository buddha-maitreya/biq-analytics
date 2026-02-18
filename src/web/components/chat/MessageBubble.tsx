/**
 * MessageBubble — Renders a single chat message (user or assistant).
 * Assistant messages include markdown rendering, tool call cards, and feedback buttons.
 */

import React from "react";
import type { ChatMessage } from "../../hooks/useChatStream";
import ToolCallCard from "./ToolCallCard";

interface MessageBubbleProps {
  message: ChatMessage;
  onFeedback?: (messageId: string, rating: "up" | "down") => void;
}

export default function MessageBubble({
  message,
  onFeedback,
}: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`chat-message ${message.role}`}>
      <div className="message-bubble">
        {/* Tool calls (shown before the text for assistant messages) */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="message-tool-calls">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Message content */}
        <div className="message-content">
          {isUser ? (
            <p>{message.content}</p>
          ) : (
            <div className="message-markdown">
              {renderMarkdown(message.content)}
            </div>
          )}
        </div>

        {/* Footer: time + feedback */}
        <div className="message-footer">
          <span className="message-time">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>

          {!isUser && onFeedback && (
            <div className="message-feedback">
              <button
                className={`feedback-btn ${
                  message.metadata?.feedbackRating === "up" ? "active" : ""
                }`}
                onClick={() => onFeedback(message.id, "up")}
                title="Helpful"
              >
                👍
              </button>
              <button
                className={`feedback-btn ${
                  message.metadata?.feedbackRating === "down" ? "active" : ""
                }`}
                onClick={() => onFeedback(message.id, "down")}
                title="Not helpful"
              >
                👎
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Markdown Renderer ──────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={i} className="message-code-block" data-lang={codeLang}>
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        codeLang = "";
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headers
    if (line.startsWith("#### ")) {
      elements.push(<h5 key={i}>{renderInline(line.slice(5))}</h5>);
    } else if (line.startsWith("### ")) {
      elements.push(<h4 key={i}>{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={i}>{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={i}>{renderInline(line.slice(2))}</h2>);
    }
    // Horizontal rule
    else if (line.match(/^[-*_]{3,}$/)) {
      elements.push(<hr key={i} />);
    }
    // Bullet lists
    else if (line.match(/^\s*[-*+]\s/)) {
      elements.push(
        <li key={i}>{renderInline(line.replace(/^\s*[-*+]\s/, ""))}</li>
      );
    }
    // Numbered lists
    else if (line.match(/^\s*\d+\.\s/)) {
      elements.push(
        <li key={i}>{renderInline(line.replace(/^\s*\d+\.\s/, ""))}</li>
      );
    }
    // Table rows (simplified)
    else if (line.startsWith("|")) {
      // Skip separator rows like |---|---|
      if (line.match(/^\|[\s-:|]+\|$/)) continue;
      const cells = line
        .split("|")
        .filter((c) => c.trim())
        .map((c) => c.trim());
      elements.push(
        <div key={i} className="message-table-row">
          {cells.map((cell, j) => (
            <span key={j} className="message-table-cell">
              {renderInline(cell)}
            </span>
          ))}
        </div>
      );
    }
    // Empty line
    else if (line.trim() === "") {
      elements.push(<br key={i} />);
    }
    // Regular paragraph
    else {
      elements.push(<p key={i}>{renderInline(line)}</p>);
    }
  }

  // Close unclosed code block
  if (inCodeBlock && codeLines.length) {
    elements.push(
      <pre key="final-code" className="message-code-block">
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  // Process: **bold**, *italic*, `code`, [link](url)
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code: `text`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={key++} className="message-inline-code">
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text*
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Regular character
    // Collect plain text until next special char
    const plainMatch = remaining.match(/^[^`*[]+/);
    if (plainMatch) {
      parts.push(<span key={key++}>{plainMatch[0]}</span>);
      remaining = remaining.slice(plainMatch[0].length);
    } else {
      // Single special char that didn't match a pattern
      parts.push(<span key={key++}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    }
  }

  return <>{parts}</>;
}
