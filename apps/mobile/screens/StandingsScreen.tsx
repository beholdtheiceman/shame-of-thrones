import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HOUSE_BY_ID, type HouseId, type WindowKey } from "@sot/core";
import { api, type StandingsDTO } from "../lib/api";
import { useStore } from "../lib/store";
import { COLORS, HOUSE_COLOR } from "../lib/theme";

// Ported from apps/web/src/components/Standings.tsx — RN primitives, no DOM.
// StandingsDTO is computed server-side; this screen only renders it.

type Board = "council" | "houses";
const WINDOW_LABELS: { key: WindowKey; label: string }[] = [
  { key: "week", label: "This Week" },
  { key: "season", label: "This Season" },
  { key: "all", label: "All-Time" },
];

export default function StandingsScreen() {
  const { state } = useStore();
  const anonymous = state.authStatus === "anonymous";
  const myHouse = state.profile?.houseId ?? null;

  const [board, setBoard] = useState<Board>("council");
  const [windowKey, setWindowKey] = useState<WindowKey>("week");
  const [mine, setMine] = useState(false);
  const houseParam: HouseId | "all" = mine && myHouse ? myHouse : "all";
  const requestKey = `${windowKey}:${houseParam}`;
  const [result, setResult] = useState<{ key: string; data: StandingsDTO | null; error: boolean }>({
    key: "", data: null, error: false,
  });
  const data = result.key === requestKey ? result.data : null;
  const error = result.key === requestKey ? result.error : false;

  useEffect(() => {
    let live = true;
    api
      .standings(windowKey, houseParam)
      .then((d) => {
        if (live) setResult({ key: requestKey, data: d, error: false });
      })
      .catch(() => live && setResult({ key: requestKey, data: null, error: true }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey, houseParam, requestKey]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.segRow}>
          <SegBtn on={board === "council"} onPress={() => setBoard("council")}>Small Council</SegBtn>
          <SegBtn on={board === "houses"} onPress={() => setBoard("houses")}>House Standings</SegBtn>
        </View>

        {error && (
          <Text style={styles.errorPanel}>
            The ravens could not reach the Citadel. Try again once you are back on the map.
          </Text>
        )}

        {!error && board === "council" && (
          <>
            <View style={styles.segRowWrap}>
              {WINDOW_LABELS.map((w) => (
                <SegBtn key={w.key} on={windowKey === w.key} onPress={() => setWindowKey(w.key)}>
                  {w.label}
                </SegBtn>
              ))}
            </View>
            {!anonymous && myHouse && (
              <View style={styles.segRow}>
                <SegBtn on={!mine} onPress={() => setMine(false)}>All Houses</SegBtn>
                <SegBtn on={mine} onPress={() => setMine(true)}>My House</SegBtn>
              </View>
            )}
            <CouncilList data={data} viewerName={anonymous ? null : state.profile?.name ?? null} />
            {anonymous && (
              <Text style={styles.hint}>Sign in to take your seat on the Small Council.</Text>
            )}
          </>
        )}

        {!error && board === "houses" && <HouseList data={data} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function SegBtn({ on, onPress, children }: { on: boolean; onPress: () => void; children: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.segBtn, on && styles.segBtnOn]}>
      <Text style={[styles.segBtnText, on && styles.segBtnTextOn]}>{children}</Text>
    </Pressable>
  );
}

function Chip({ houseId }: { houseId: string }) {
  const color = HOUSE_COLOR[houseId] ?? COLORS.inkFaint;
  return <View style={[styles.chip, { backgroundColor: color }]} />;
}

function CouncilList({ data, viewerName }: { data: StandingsDTO | null; viewerName: string | null }) {
  if (!data) return <Text style={styles.loading}>Summoning the Council…</Text>;
  if (data.council.rows.length === 0) {
    return <Text style={styles.errorPanel}>No deeds recorded here yet — be the first.</Text>;
  }
  return (
    <View style={styles.panel}>
      {data.council.rows.map((r, i) => (
        <Row
          key={r.name}
          pos={r.position}
          name={r.name}
          houseId={r.houseId}
          points={r.points}
          me={r.name === viewerName}
          last={i === data.council.rows.length - 1 && !data.council.viewerRow}
        />
      ))}
      {data.council.viewerRow && (
        <Row
          pos={data.council.viewerRow.position}
          name={data.council.viewerRow.name}
          houseId={data.council.viewerRow.houseId}
          points={data.council.viewerRow.points}
          me
          last
        />
      )}
    </View>
  );
}

function Row({
  pos, name, houseId, points, me, last,
}: {
  pos: number; name: string; houseId: string; points: number; me?: boolean; last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowDivider, me && styles.rowMe]}>
      <Text style={styles.rowPos}>{pos}</Text>
      <Chip houseId={houseId} />
      <Text style={[styles.rowName, me && styles.rowNameMe]} numberOfLines={1}>
        {me ? `${name} (You)` : name}
      </Text>
      <Text style={[styles.rowPoints, me && styles.rowNameMe]}>{points.toLocaleString()}</Text>
    </View>
  );
}

function HouseList({ data }: { data: StandingsDTO | null }) {
  if (!data) return <Text style={styles.loading}>Counting the banners…</Text>;
  return (
    <View style={styles.houseList}>
      {data.houses.map((h) => {
        const house = HOUSE_BY_ID[h.houseId];
        const color = HOUSE_COLOR[h.houseId] ?? COLORS.inkFaint;
        const pct = Math.round(h.share * 100);
        return (
          <View key={h.houseId} style={styles.housePanel}>
            <View style={styles.houseHeaderRow}>
              <View style={styles.houseHeaderLeft}>
                <Chip houseId={h.houseId} />
                <Text style={styles.houseName}>{house?.name ?? h.houseId}</Text>
                {h.blessed && (
                  <View style={styles.blessedChip}>
                    <Text style={styles.blessedChipText}>⭐ Blessed ×1.25</Text>
                  </View>
                )}
              </View>
              <Text style={styles.houseShare}>
                {pct}% · {h.fiefsLed} {h.fiefsLed === 1 ? "fief" : "fiefs"}
              </Text>
            </View>
            <View style={styles.houseBarTrack}>
              <View style={[styles.houseBarFill, { width: `${pct}%`, backgroundColor: color }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.vellum },
  content: { padding: 16, paddingBottom: 32 },
  segRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  segRowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: COLORS.vellumRaised, borderWidth: 2, borderColor: COLORS.vellumLine },
  segBtnOn: { backgroundColor: COLORS.brass, borderColor: COLORS.brass },
  segBtnText: { color: COLORS.inkSoft, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  segBtnTextOn: { color: COLORS.onBrass, fontWeight: "700" },
  errorPanel: { padding: 16, backgroundColor: COLORS.vellumRaised, color: COLORS.inkSoft, fontSize: 13 },
  hint: { marginTop: 12, color: COLORS.inkFaint, fontSize: 12 },
  loading: { color: COLORS.inkFaint, fontSize: 13 },
  panel: { backgroundColor: COLORS.vellumRaised, borderWidth: 2, borderColor: COLORS.vellumLine },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: COLORS.vellumLine },
  rowMe: { backgroundColor: "rgba(232,193,76,0.15)" },
  rowPos: { width: 28, color: COLORS.inkFaint, fontSize: 13, textAlign: "right" },
  chip: { height: 16, width: 16, flexShrink: 0 },
  rowName: { flex: 1, color: COLORS.inkSoft, fontSize: 13 },
  rowNameMe: { color: COLORS.brass },
  rowPoints: { color: COLORS.inkSoft, fontSize: 13 },
  houseList: { gap: 8 },
  housePanel: { backgroundColor: COLORS.vellumRaised, borderWidth: 2, borderColor: COLORS.vellumLine, padding: 12 },
  houseHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  houseHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  houseName: { color: COLORS.inkSoft, fontSize: 13 },
  houseShare: { color: COLORS.inkSoft, fontSize: 13 },
  blessedChip: { backgroundColor: COLORS.brass, paddingHorizontal: 6, paddingVertical: 2 },
  blessedChipText: { color: COLORS.onBrass, fontSize: 10, fontWeight: "700" },
  houseBarTrack: { marginTop: 8, height: 8, backgroundColor: COLORS.vellumLine },
  houseBarFill: { height: "100%" },
});
