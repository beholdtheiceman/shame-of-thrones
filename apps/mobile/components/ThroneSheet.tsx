import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { displayTier, HOUSE_BY_ID, THRONE_CATEGORY_LABEL } from "@sot/core";
import { api, ApiError, type ThroneDTO } from "../lib/api";
import { API_BASE_URL } from "../lib/config";
import { useStore } from "../lib/store";
import { COLORS, HOUSE_COLOR } from "../lib/theme";
import { ReportModal } from "./ReportModal";
import { SittingFlow } from "./SittingFlow";

const AMENITY_LABEL: Record<string, string> = {
  accessible: "Accessible",
  babyChanging: "Baby changing",
  genderNeutral: "Gender-neutral",
  freeAccess: "Free access",
  open24h: "Open 24h",
};

/**
 * Ported from apps/web/src/components/ThroneSheet.tsx. Photo *upload* is a
 * non-goal for this sub-project (plan §Non-goals — "full camera UX later"),
 * so this shows the existing photo list only; the web upload <input> has no
 * native equivalent wired up here.
 */
export function ThroneSheet({ throne, onClose }: { throne: ThroneDTO; onClose: () => void }) {
  const { state, confirmThrone } = useStore();
  const [mode, setMode] = useState<"detail" | "sitting">("detail");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<{ kind: "throne" | "rating" | "photo"; id: string; label: string } | null>(null);
  const [photos, setPhotos] = useState<Awaited<ReturnType<typeof api.listPhotos>>["photos"]>([]);

  const loadPhotos = useCallback(async () => {
    try {
      const result = await api.listPhotos(throne.id);
      setPhotos(result.photos);
    } catch {
      setPhotos([]);
    }
  }, [throne.id]);

  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos]);

  const score = throne.score;
  const count = throne.ratingCount;
  const tier = score !== null ? displayTier(score) : null;

  const recentRatings = useMemo(
    () =>
      (state.realm?.ratings ?? [])
        .filter((r) => r.throneId === throne.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 4),
    [state.realm?.ratings, throne.id]
  );

  const now = Date.now();
  const daysSinceConfirmed = Math.floor((now - throne.lastConfirmedAt) / 86_400_000);
  const forgotten = daysSinceConfirmed > 120;
  const amenities = Object.entries(throne.amenities).filter(([, v]) => v);

  async function handleConfirm() {
    setConfirmError(null);
    try {
      await confirmThrone(throne.id);
    } catch (e) {
      setConfirmError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "the ravens were lost");
    }
  }

  return (
    <Modal animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          {mode === "sitting" ? (
            <SittingFlow throne={throne} onCancel={() => setMode("detail")} onSubmitted={() => setMode("detail")} />
          ) : (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              <View style={styles.headerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.category}>{THRONE_CATEGORY_LABEL[throne.category]}</Text>
                  <Text style={styles.name}>{throne.name}</Text>
                </View>
                <View style={styles.headerRight}>
                  {state.authStatus === "ready" && (
                    <Pressable onPress={() => setReporting({ kind: "throne", id: throne.id, label: throne.name })}>
                      <Text style={styles.reportLink}>Report</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.closeBtn}>
                    <Text style={styles.closeBtnText}>✕</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.chipRow}>
                {throne.status === "rumored" ? (
                  <View style={[styles.chip, { backgroundColor: "rgba(232,193,76,0.2)" }]}>
                    <Text style={[styles.chipText, { color: COLORS.brassStrong }]}>Rumored</Text>
                  </View>
                ) : (
                  <View style={[styles.chip, { backgroundColor: "rgba(99,212,131,0.2)" }]}>
                    <Text style={[styles.chipText, { color: COLORS.emerald }]}>✓ Verified</Text>
                  </View>
                )}
                {tier && (
                  <View style={[styles.chip, styles.tierChip]}>
                    <Text style={[styles.chipText, { color: COLORS.brassStrong }]}>
                      {tier.glyph} {tier.label}
                    </Text>
                  </View>
                )}
                {forgotten && (
                  <View style={[styles.chip, { backgroundColor: "rgba(240,114,103,0.1)" }]}>
                    <Text style={[styles.chipText, { color: COLORS.crimsonStrong }]}>Forgotten by the Realm</Text>
                  </View>
                )}
              </View>
              {score !== null ? (
                <Text style={styles.scoreLine}>
                  {score.toFixed(1)} · {count} {count === 1 ? "sitting" : "sittings"}
                </Text>
              ) : (
                <Text style={styles.scoreLineEmpty}>Unrated</Text>
              )}

              {throne.status === "rumored" && (
                <Pressable style={styles.confirmBtn} onPress={handleConfirm}>
                  <Text style={styles.confirmBtnText}>Confirm this throne is real (+3 Influence)</Text>
                </Pressable>
              )}
              {confirmError && <Text style={styles.error}>{confirmError}</Text>}

              {amenities.length > 0 && (
                <View style={styles.amenityRow}>
                  {amenities.map(([k]) => (
                    <View key={k} style={styles.amenityChip}>
                      <Text style={styles.amenityText}>{AMENITY_LABEL[k]}</Text>
                    </View>
                  ))}
                </View>
              )}

              {recentRatings.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <Text style={styles.sectionLabel}>Recent testimony</Text>
                  <View style={{ marginTop: 8, gap: 10 }}>
                    {recentRatings.map((r) => (
                      <View key={r.id} style={styles.ratingCard}>
                        <View style={styles.ratingCardHeader}>
                          <Text style={styles.ratingAuthor}>
                            {r.authorName} · <Text style={{ color: HOUSE_COLOR[r.houseId] }}>{HOUSE_BY_ID[r.houseId].name}</Text>
                          </Text>
                          <View style={{ flexDirection: "row", alignItems: "center" }}>
                            <Text style={styles.ratingVerdict}>{r.verdict}/5</Text>
                            {state.authStatus === "ready" && (
                              <Pressable
                                onPress={() => setReporting({ kind: "rating", id: r.id, label: `a rating at ${throne.name}` })}
                              >
                                <Text style={styles.reportLinkSmall}>Report</Text>
                              </Pressable>
                            )}
                          </View>
                        </View>
                        {r.testimony ? <Text style={styles.ratingTestimony}>&ldquo;{r.testimony}&rdquo;</Text> : null}
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View style={{ marginTop: 20 }}>
                <Text style={styles.sectionLabel}>Offer a Portrait</Text>
                {photos.some((p) => p.status === "approved") && (
                  <View style={styles.photoGrid}>
                    {photos
                      .filter((p) => p.status === "approved")
                      .map((p) => (
                        <View key={p.id}>
                          <Image source={{ uri: `${API_BASE_URL}/api/photos/${p.id}` }} style={styles.photo} />
                          {state.authStatus === "ready" && (
                            <Pressable
                              onPress={() => setReporting({ kind: "photo", id: p.id, label: `a portrait of ${throne.name}` })}
                            >
                              <Text style={styles.reportLinkSmall}>Report</Text>
                            </Pressable>
                          )}
                        </View>
                      ))}
                  </View>
                )}
                {photos.filter((p) => p.mine && p.status !== "approved").length > 0 && (
                  <View style={styles.amenityRow}>
                    {photos
                      .filter((p) => p.mine && p.status !== "approved")
                      .map((p) => (
                        <View key={p.id} style={styles.amenityChip}>
                          <Text style={styles.amenityText}>
                            {p.status === "pending" ? "awaits the Maesters' review" : "refused"}
                          </Text>
                        </View>
                      ))}
                  </View>
                )}
              </View>

              <Pressable style={styles.sitBtn} onPress={() => setMode("sitting")}>
                <Text style={styles.sitBtnText}>Sit Here</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
      {reporting && (
        <ReportModal
          subjectKind={reporting.kind}
          subjectId={reporting.id}
          subjectLabel={reporting.label}
          onClose={() => setReporting(null)}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  panel: { backgroundColor: COLORS.vellumRaised, borderWidth: 3, borderColor: COLORS.vellumLine, maxHeight: "85%" },
  scrollContent: { padding: 20 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  category: { color: COLORS.brass, fontSize: 13, textTransform: "uppercase", letterSpacing: 1 },
  name: { marginTop: 4, color: COLORS.ink, fontSize: 15 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  reportLink: { color: COLORS.inkFaint, fontSize: 11, textTransform: "uppercase", textDecorationLine: "underline" },
  reportLinkSmall: { marginLeft: 8, color: COLORS.inkFaint, fontSize: 10, textTransform: "uppercase", textDecorationLine: "underline" },
  closeBtn: { backgroundColor: COLORS.vellum, paddingHorizontal: 10, paddingVertical: 4 },
  closeBtnText: { color: COLORS.inkFaint, fontSize: 14 },
  chipRow: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: { paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 13, textTransform: "uppercase" },
  tierChip: { backgroundColor: COLORS.vellum, borderWidth: 1, borderColor: COLORS.brass },
  scoreLine: { marginTop: 8, color: COLORS.inkSoft, fontSize: 15 },
  scoreLineEmpty: { marginTop: 8, color: COLORS.inkFaint, fontSize: 15 },
  confirmBtn: { marginTop: 12, backgroundColor: COLORS.brass, paddingVertical: 10, alignItems: "center", borderWidth: 2, borderColor: COLORS.vellumLine },
  confirmBtnText: { color: COLORS.onBrass, fontSize: 14, textTransform: "uppercase" },
  error: { marginTop: 12, color: COLORS.crimson, fontSize: 13 },
  amenityRow: { marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  amenityChip: { backgroundColor: COLORS.vellum, paddingHorizontal: 10, paddingVertical: 6 },
  amenityText: { color: COLORS.inkSoft, fontSize: 13 },
  sectionLabel: { color: COLORS.inkFaint, fontSize: 13, textTransform: "uppercase" },
  ratingCard: { backgroundColor: COLORS.vellum, padding: 10 },
  ratingCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ratingAuthor: { color: COLORS.inkFaint, fontSize: 13 },
  ratingVerdict: { color: COLORS.inkFaint, fontSize: 13 },
  ratingTestimony: { marginTop: 4, color: COLORS.inkSoft, fontStyle: "italic", fontSize: 14 },
  photoGrid: { marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { height: 96, width: 96 },
  sitBtn: { marginTop: 20, backgroundColor: COLORS.brass, paddingVertical: 14, alignItems: "center", borderWidth: 2, borderColor: COLORS.vellumLine },
  sitBtnText: { color: COLORS.onBrass, fontWeight: "700", letterSpacing: 1, fontSize: 12 },
});
