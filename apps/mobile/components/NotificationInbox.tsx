import { useEffect, useRef, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { NotificationDTO } from "@sot/core";
import { useStore } from "../lib/store";
import { COLORS } from "../lib/theme";

// Ported from apps/web/src/components/NotificationInbox.tsx — RN Modal
// stands in for the web dialog; focus-trap/escape handling isn't
// applicable on native, so this keeps just the list + mark-read behavior.

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

/** Bell button + unread badge. Renders nothing until signed in, matching the
 * web component's `authStatus !== "ready"` guard. */
export function NotificationBell({ onOpenFief }: { onOpenFief: (fiefId: string) => void }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);

  if (state.authStatus !== "ready") return null;

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.bell} accessibilityLabel="Raven dispatches">
        <Text style={styles.bellGlyph}>🔔</Text>
        {state.notifications.unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {state.notifications.unreadCount > 99 ? "99+" : state.notifications.unreadCount}
            </Text>
          </View>
        )}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <NotificationDialog
          onClose={() => setOpen(false)}
          onOpenFief={(fiefId) => {
            setOpen(false);
            onOpenFief(fiefId);
          }}
        />
      </Modal>
    </>
  );
}

function NotificationDialog({ onClose, onOpenFief }: { onClose: () => void; onOpenFief: (fiefId: string) => void }) {
  const { state, markNotificationsRead } = useStore();
  const markedRef = useRef(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!markedRef.current && state.notifications.unreadCount > 0) {
      markedRef.current = true;
      void markNotificationsRead().catch(() => {});
    }
  }, [markNotificationsRead, state.notifications.unreadCount]);

  return (
    <View style={styles.overlay}>
      <View style={styles.panel}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Raven dispatches</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close">
            <Text style={styles.closeBtn}>×</Text>
          </Pressable>
        </View>
        {state.notifications.notifications.length === 0 ? (
          <Text style={styles.empty}>No ravens have arrived.</Text>
        ) : (
          <FlatList
            data={state.notifications.notifications}
            keyExtractor={(n) => n.id}
            style={styles.list}
            renderItem={({ item }: { item: NotificationDTO }) => (
              <Pressable
                disabled={!item.link}
                onPress={() => item.link && onOpenFief(item.link)}
                style={[styles.item, item.readAt === null && styles.itemUnread]}
              >
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemBody}>{item.body}</Text>
                <Text style={styles.itemTime}>{relativeTime(item.createdAt, now)}</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bell: { height: 32, width: 32, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.vellum, borderWidth: 2, borderColor: COLORS.vellumLine },
  bellGlyph: { fontSize: 16 },
  badge: { position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, paddingHorizontal: 3, borderRadius: 9, backgroundColor: COLORS.crimson, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-start", padding: 16, paddingTop: 64 },
  panel: { maxHeight: "80%", backgroundColor: COLORS.vellumRaised, borderWidth: 2, borderColor: COLORS.vellumLine, padding: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: COLORS.ink, fontSize: 14, fontWeight: "700" },
  closeBtn: { color: COLORS.inkFaint, fontSize: 18, paddingHorizontal: 8 },
  empty: { paddingVertical: 32, textAlign: "center", color: COLORS.inkFaint, fontSize: 14 },
  list: { marginTop: 12 },
  item: { backgroundColor: COLORS.vellum, padding: 12, marginBottom: 8 },
  itemUnread: { borderLeftWidth: 3, borderLeftColor: COLORS.brass },
  itemTitle: { color: COLORS.ink, fontSize: 12, fontWeight: "700" },
  itemBody: { marginTop: 4, color: COLORS.inkSoft, fontSize: 14 },
  itemTime: { marginTop: 6, color: COLORS.inkFaint, fontSize: 12 },
});
