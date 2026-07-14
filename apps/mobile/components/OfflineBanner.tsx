import { Pressable, StyleSheet, Text, View } from "react-native";
import { useStore } from "../lib/store";
import { COLORS } from "../lib/theme";

// Ported from apps/web/src/components/OfflineBanner.tsx (same copy/logic).
function age(ms: number): string {
  const min = Math.max(1, Math.round((Date.now() - ms) / 60_000));
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

export function OfflineBanner() {
  const { state, clearQueueNotice } = useStore();
  if (!state.offline && state.queuedCount === 0 && !state.queueDropped) return null;
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.chip}>
        <Text style={styles.text}>
          {state.offline && (
            <Text style={styles.text}>
              The ravens cannot fly — you see the Realm as it was
              {state.snapshotSavedAt ? ` (${age(state.snapshotSavedAt)})` : ""}
            </Text>
          )}
          {state.queuedCount > 0 && (
            <Text style={styles.text}>{state.offline ? " · " : ""}{state.queuedCount} ✉</Text>
          )}
        </Text>
        {state.queueDropped && (
          <View style={styles.droppedRow}>
            <Text style={styles.dropped}> · A queued deed was refused by the Maesters.</Text>
            <Pressable onPress={clearQueueNotice} accessibilityLabel="Dismiss notice">
              <Text style={styles.dismiss}>✕</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 8, left: 0, right: 0, alignItems: "center", zIndex: 950 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.vellumRaised,
    borderWidth: 2,
    borderColor: COLORS.vellumLine,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  text: { color: COLORS.inkSoft, fontSize: 12, textAlign: "center" },
  droppedRow: { flexDirection: "row", alignItems: "center" },
  dropped: { color: COLORS.crimsonStrong, fontSize: 12 },
  dismiss: { marginLeft: 8, color: COLORS.inkFaint, fontSize: 12, textDecorationLine: "underline" },
});
