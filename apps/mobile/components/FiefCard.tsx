import { Pressable, StyleSheet, Text, View } from "react-native";
import { fiefCardModel, HOUSE_BY_ID, type FiefControl } from "@sot/core";
import { COLORS, HOUSE_COLOR } from "../lib/theme";

// Ported from apps/web/src/components/FiefCard.tsx (house share bars + Contested badge via fiefCardModel).
export function FiefCard({ control, onClose }: { control: FiefControl | null; onClose: () => void }) {
  const model = fiefCardModel(control);
  const leader = model.leaderHouseId ? HOUSE_BY_ID[model.leaderHouseId] : null;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.panel}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>This Fief</Text>
            {leader ? (
              <Text style={[styles.leaderLine, { color: HOUSE_COLOR[leader.id] }]}>{leader.name} holds this land</Text>
            ) : (
              <Text style={styles.leaderLineEmpty}>No House holds this land</Text>
            )}
          </View>
          <View style={styles.headerRight}>
            {model.contested && (
              <View style={styles.contestedChip}>
                <Text style={styles.contestedText}>Contested</Text>
              </View>
            )}
            <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ marginTop: 12, gap: 8 }}>
          {model.rows.map((row) => {
            const house = HOUSE_BY_ID[row.houseId];
            return (
              <View key={row.houseId}>
                <View style={styles.rowLine}>
                  <Text style={row.percent > 0 ? styles.rowNameActive : styles.rowNameEmpty}>{house.name}</Text>
                  <Text style={styles.rowPercent}>{row.percent}%</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${row.percent}%`, backgroundColor: HOUSE_COLOR[house.id] }]} />
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 16, alignItems: "center", zIndex: 900, paddingHorizontal: 16 },
  panel: { width: "100%", maxWidth: 480, backgroundColor: COLORS.vellumRaised, borderWidth: 3, borderColor: COLORS.vellumLine, padding: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  eyebrow: { color: COLORS.brass, fontSize: 13, textTransform: "uppercase", letterSpacing: 1 },
  leaderLine: { marginTop: 4, fontSize: 12, fontWeight: "700" },
  leaderLineEmpty: { marginTop: 4, fontSize: 12, color: COLORS.inkFaint },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  contestedChip: { backgroundColor: "rgba(240,114,103,0.15)", paddingHorizontal: 10, paddingVertical: 4 },
  contestedText: { color: COLORS.crimsonStrong, fontSize: 12, textTransform: "uppercase" },
  closeBtn: { backgroundColor: COLORS.vellum, paddingHorizontal: 10, paddingVertical: 4 },
  closeBtnText: { color: COLORS.inkFaint, fontSize: 14 },
  rowLine: { flexDirection: "row", justifyContent: "space-between" },
  rowNameActive: { color: COLORS.inkSoft, fontSize: 13 },
  rowNameEmpty: { color: COLORS.inkFaint, fontSize: 13 },
  rowPercent: { color: COLORS.inkSoft, fontSize: 13 },
  barTrack: { marginTop: 4, height: 8, width: "100%", borderWidth: 1, borderColor: COLORS.vellumLine, backgroundColor: COLORS.vellum },
  barFill: { height: "100%" },
});
