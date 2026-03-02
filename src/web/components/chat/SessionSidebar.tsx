/**
 * SessionSidebar — List of chat sessions with create/delete/select.
 * Shows as a slide-over drawer on mobile.
 */

import React from "react";
import type { ChatSession } from "../../hooks/useChatStream";

interface SessionSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  hasMore: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onLoadMore: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const SessionSidebar = React.memo(function SessionSidebar({
  sessions,
  activeSessionId,
  hasMore,
  onSelect,
  onCreate,
  onDelete,
  onLoadMore,
  mobileOpen,
  onCloseMobile,
}: SessionSidebarProps) {
  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="session-sidebar-backdrop" onClick={onCloseMobile} />
      )}

      <aside
        className={`session-sidebar ${mobileOpen ? "session-sidebar-mobile-open" : ""}`}
      >
        <div className="session-sidebar-header">
          <h3>Conversations</h3>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              onCreate();
              onCloseMobile();
            }}
          >
            + New
          </button>
        </div>

        <div className="session-sidebar-list">
          {sessions.length === 0 && (
            <div className="session-sidebar-empty">
              No conversations yet.
              <br />
              Start a new one!
            </div>
          )}

          {sessions.map((session) => (
            <div
              key={session.id}
              className={`session-sidebar-item ${
                session.id === activeSessionId ? "active" : ""
              }`}
              onClick={() => {
                onSelect(session.id);
                onCloseMobile();
              }}
            >
              <div className="session-sidebar-item-title">
                {session.title || "New conversation"}
              </div>
              <div className="session-sidebar-item-date">
                {formatRelativeDate(session.updatedAt)}
              </div>
              <button
                className="session-sidebar-item-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
                title="Delete conversation"
              >
                ×
              </button>
            </div>
          ))}

          {hasMore && (
            <button
              className="session-sidebar-load-more"
              onClick={onLoadMore}
            >
              Load more
            </button>
          )}
        </div>
      </aside>
    </>
  );
});

export default SessionSidebar;

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
