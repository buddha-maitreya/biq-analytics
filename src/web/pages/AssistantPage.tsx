import React, { useState, useRef, useEffect } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../types";

interface AssistantPageProps {
  config: AppConfig;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function AssistantPage({ config }: AssistantPageProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = {
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // Try business assistant agent first
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.content }),
      });
      const data = await res.json();

      const assistantMsg: Message = {
        role: "assistant",
        content: data.data?.reply ?? data.error ?? "No response",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page assistant-page">
      <div className="page-header">
        <h2>🤖 AI Assistant</h2>
        <span className="text-muted">
          Ask about {config.labels.productPlural.toLowerCase()}, {config.labels.orderPlural.toLowerCase()}, inventory, and more
        </span>
      </div>

      <div className="chat-container">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-empty">
              <h3>How can I help?</h3>
              <div className="suggestion-grid">
                {[
                  `What are my top selling ${config.labels.productPlural.toLowerCase()}?`,
                  "Which products are running low on stock?",
                  `How many ${config.labels.orderPlural.toLowerCase()} were placed this week?`,
                  "What's my total revenue?",
                ].map((s, i) => (
                  <button
                    key={i}
                    className="suggestion-btn"
                    onClick={() => {
                      setInput(s);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`chat-message ${msg.role}`}>
              <div className="message-bubble">
                <p>{msg.content}</p>
                <span className="message-time">
                  {msg.timestamp.toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-message assistant">
              <div className="message-bubble loading-bubble">
                <span className="typing-indicator">●●●</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input">
          <input
            type="text"
            placeholder="Ask a question about your business..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            disabled={loading}
          />
          <button
            className="btn btn-primary"
            onClick={sendMessage}
            disabled={!input.trim() || loading}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
