import { useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { RATING_TAGS, VERDICT_SCALE, type Throne } from "@sot/core";
import { ApiError, recordMetric } from "../lib/api";
import { useStore } from "../lib/store";
import { COLORS } from "../lib/theme";

/**
 * Ported from apps/web/src/components/SittingFlow.tsx. The web version derives
 * `verified` from a browser geolocation proximity check; native has no location
 * dependency installed for this sub-project, so per the task brief this becomes
 * a manual "I'm here in person" toggle instead (still feeds the same
 * `verified` field / Influence-weighting logic in submitRating).
 */
export function SittingFlow({
  throne,
  onCancel,
  onSubmitted,
}: {
  throne: Pick<Throne, "id" | "name">;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const { submitRating } = useStore();
  const [verdict, setVerdict] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [testimony, setTestimony] = useState("");
  const [verified, setVerified] = useState(true);
  const [blockedNote, setBlockedNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [influenceClaimed, setInfluenceClaimed] = useState(false);
  const [blessingApplied, setBlessingApplied] = useState(false);
  const [ratingQueued, setRatingQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Time-to-rate starts when the Sitting flow opens (component mount) —
  // mirrors apps/web/src/components/SittingFlow.tsx.
  const flowStart = useRef(Date.now());

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  async function handleSubmit() {
    if (verdict === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitRating({ throneId: throne.id, verdict, tags, testimony, verified });
      void recordMetric("time_to_rate", { ms: Date.now() - flowStart.current });
      if (result.testimonyBlocked) setBlockedNote(true);
      if (result.queued) {
        setRatingQueued(true);
      } else {
        setInfluenceClaimed(true);
        setBlessingApplied(result.blessed);
      }
      setTimeout(onSubmitted, 700);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "the ravens were lost");
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>▸ The Sitting</Text>
        <Pressable onPress={onCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
      </View>
      <Text style={styles.throneName}>{throne.name}</Text>

      <View style={styles.verifiedRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.verifiedLabel}>I'm here in person</Text>
          <Text style={styles.verifiedHint}>
            {verified ? "Verified — counts for full Influence" : "Hearsay — counts for less Influence"}
          </Text>
        </View>
        <Switch
          value={verified}
          onValueChange={setVerified}
          trackColor={{ false: COLORS.vellum, true: COLORS.brass }}
          thumbColor={COLORS.inkSoft}
        />
      </View>

      <View style={styles.verdictRow}>
        {VERDICT_SCALE.map((v) => (
          <Pressable key={v.value} onPress={() => setVerdict(v.value)} style={styles.verdictItem}>
            <View style={[styles.verdictGlyph, { backgroundColor: verdict === v.value ? COLORS.brass : COLORS.vellum }]}>
              <Text style={styles.verdictGlyphText}>{v.glyph}</Text>
            </View>
            <Text style={[styles.verdictLabel, { color: verdict === v.value ? COLORS.brass : COLORS.inkFaint }]}>
              {v.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.tagWrap}>
        {RATING_TAGS.map((tag) => (
          <Pressable
            key={tag}
            onPress={() => toggleTag(tag)}
            style={[styles.tagChip, { backgroundColor: tags.includes(tag) ? COLORS.brass : COLORS.vellum }]}
          >
            <Text style={{ color: tags.includes(tag) ? COLORS.onBrass : COLORS.inkSoft, fontSize: 13 }}>{tag}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Scroll of Testimony (optional)</Text>
      <TextInput
        value={testimony}
        onChangeText={setTestimony}
        maxLength={280}
        multiline
        numberOfLines={3}
        placeholder="Speak, traveler. What horrors or wonders did you find?"
        placeholderTextColor={COLORS.inkFaint}
        style={styles.textArea}
      />
      <Text style={styles.charCount}>{testimony.length}/280</Text>

      {error && <Text style={styles.error}>{error}</Text>}
      {influenceClaimed && (
        <>
          <View style={styles.claimedChip}>
            <Text style={styles.claimedText}>Influence claimed!</Text>
          </View>
          {blessingApplied && <Text style={styles.blessed}>Underdog Blessing applied (+25% Influence)</Text>}
        </>
      )}
      {ratingQueued && (
        <View style={styles.queuedChip}>
          <Text style={styles.queuedText}>Your deed will be sung when the ravens return.</Text>
        </View>
      )}
      {blockedNote && (
        <Text style={styles.blockedNote}>The Maester declines to record those words. Your verdict stands.</Text>
      )}

      <Pressable
        disabled={verdict === null || submitting}
        onPress={handleSubmit}
        style={[styles.submitBtn, (verdict === null || submitting) && styles.disabled]}
      >
        <Text style={styles.submitBtnText}>Strike Your Banner</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: COLORS.brass, fontSize: 15, textTransform: "uppercase", letterSpacing: 1 },
  cancelBtn: { backgroundColor: COLORS.vellum, paddingHorizontal: 10, paddingVertical: 6 },
  cancelBtnText: { color: COLORS.inkFaint, fontSize: 13 },
  throneName: { marginTop: 8, color: COLORS.ink, fontSize: 15 },
  verifiedRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  verifiedLabel: { color: COLORS.inkSoft, fontSize: 14 },
  verifiedHint: { marginTop: 2, color: COLORS.inkFaint, fontSize: 12 },
  verdictRow: { marginTop: 16, flexDirection: "row", justifyContent: "space-between", gap: 4 },
  verdictItem: { flex: 1, alignItems: "center", gap: 6 },
  verdictGlyph: { height: 40, width: 40, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: COLORS.vellumLine },
  verdictGlyphText: { fontSize: 18 },
  verdictLabel: { fontSize: 10.5, textAlign: "center" },
  tagWrap: { marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tagChip: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 2, borderColor: COLORS.vellumLine },
  fieldLabel: { marginTop: 16, color: COLORS.inkFaint, fontSize: 13, textTransform: "uppercase" },
  textArea: { marginTop: 6, borderWidth: 2, borderColor: COLORS.vellumLine, backgroundColor: COLORS.vellum, color: COLORS.ink, padding: 10, minHeight: 70, textAlignVertical: "top" },
  charCount: { marginTop: 4, textAlign: "right", color: COLORS.inkFaint, fontSize: 11 },
  error: { marginTop: 16, color: COLORS.crimson, fontSize: 14 },
  claimedChip: { marginTop: 16, backgroundColor: COLORS.brass, paddingVertical: 8, alignItems: "center" },
  claimedText: { color: COLORS.onBrass, fontSize: 14 },
  blessed: { marginTop: 4, color: COLORS.brass, fontSize: 12 },
  queuedChip: { marginTop: 16, backgroundColor: COLORS.vellum, paddingVertical: 8, alignItems: "center" },
  queuedText: { color: COLORS.inkSoft, fontSize: 14 },
  blockedNote: { marginTop: 8, color: COLORS.crimson, fontSize: 13 },
  submitBtn: { marginTop: 16, backgroundColor: COLORS.brass, paddingVertical: 14, alignItems: "center", borderWidth: 2, borderColor: COLORS.vellumLine },
  submitBtnText: { color: COLORS.onBrass, fontWeight: "700", letterSpacing: 1, fontSize: 12 },
  disabled: { opacity: 0.5 },
});
