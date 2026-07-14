"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useCopy } from "@/lib/copy";
import { useStore } from "@/lib/store";
import { useEscape } from "@/lib/useEscape";
import { useNow } from "@/lib/useNow";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function NotificationInbox({ onOpenFief }: { onOpenFief: (fiefId: string) => void }) {
  const { state } = useStore();
  const t = useCopy();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (state.authStatus !== "ready") return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("notificationBell")}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="pixel-chip relative flex h-8 w-8 items-center justify-center bg-vellum text-ink-soft"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
          <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 8H3c0-1 3-1 3-8Z" />
          <path d="M10 21h4" />
        </svg>
        {state.notifications.unreadCount > 0 && (
          <span className="absolute -right-2 -top-2 min-w-5 bg-crimson px-1 font-mono text-[11px] leading-5 text-white" aria-hidden="true">
            {state.notifications.unreadCount > 99 ? "99+" : state.notifications.unreadCount}
          </span>
        )}
        <span className="sr-only">
          {state.notifications.unreadCount > 0 ? `, ${state.notifications.unreadCount} unread` : ""}
        </span>
      </button>
      {open && (
        <NotificationDialog
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
          onOpenFief={(fiefId) => {
            setOpen(false);
            onOpenFief(fiefId);
          }}
        />
      )}
    </>
  );
}

function NotificationDialog({ onClose, onOpenFief }: {
  onClose: () => void;
  onOpenFief: (fiefId: string) => void;
}) {
  useEscape(onClose);
  const { state, markNotificationsRead } = useStore();
  const t = useCopy();
  const now = useNow();
  const panelRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef(false);

  useEffect(() => {
    panelRef.current?.focus();
    if (!markedRef.current && state.notifications.unreadCount > 0) {
      markedRef.current = true;
      void markNotificationsRead().catch(() => {});
    }
  }, [markNotificationsRead, state.notifications.unreadCount]);

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-[1004] flex items-start justify-center bg-black/60 p-4 pt-16 sm:items-center sm:p-6">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-title"
        onKeyDown={trapFocus}
        className="pixel-panel max-h-[80vh] w-full max-w-md overflow-y-auto p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="notification-title" className="font-display text-[12px] text-ink">{t("notificationBell")}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="pixel-chip bg-vellum px-2.5 py-1 font-mono text-sm text-ink-faint">×</button>
        </div>
        {state.notifications.notifications.length === 0 ? (
          <p className="py-8 text-center font-mono text-[14px] text-ink-faint">{t("notificationEmpty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {state.notifications.notifications.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  disabled={!notification.link}
                  onClick={() => notification.link && onOpenFief(notification.link)}
                  className="pixel-chip w-full bg-vellum p-3 text-left disabled:cursor-default"
                >
                  <span className="block font-display text-[10px] leading-relaxed text-ink">{notification.title}</span>
                  <span className="mt-1 block font-mono text-[14px] leading-snug text-ink-soft">{notification.body}</span>
                  <span className="mt-1.5 block font-mono text-[12px] text-ink-faint">{relativeTime(notification.createdAt, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function relativeTime(createdAt: number, now: number): string {
  const elapsed = Math.max(0, now - createdAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
