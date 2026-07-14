import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api, ApiError } from "../lib/api";
import { COLORS } from "../lib/theme";

// Ported from apps/web/src/components/ReportModal.tsx (same reasons/copy).
const REASONS = [
  { value: "wrong_info", label: "The details are wrong" },
  { value: "closed", label: "This throne is closed or gone" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "not_public_restroom", label: "Not a public restroom" },
  { value: "harassment", label: "Harassment" },
  { value: "spam", label: "Spam" },
] as const;

export function ReportModal({
  subjectKind,
  subjectId,
  subjectLabel,
  onClose,
}: {
  subjectKind: "throne" | "rating" | "photo";
  subjectId: string;
  subjectLabel: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.report({ subjectKind, subjectId, reason, note: note.trim() || undefined });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "connection error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          {sent ? (
            <>
              <Text style={styles.title}>▸ Raven Sent</Text>
              <Text style={styles.body}>The Maesters will review {subjectLabel}.</Text>
              <Pressable style={styles.primaryBtn} onPress={onClose}>
                <Text style={styles.primaryBtnText}>Close</Text>
              </Pressable>
            </>
          ) : (
            <ScrollView>
              <Text style={styles.title}>▸ Report to the Maesters</Text>
              <Text style={styles.subLabel}>{subjectLabel}</Text>
              <View style={{ marginTop: 12, gap: 8 }}>
                {REASONS.map((r) => (
                  <Pressable
                    key={r.value}
                    onPress={() => setReason(r.value)}
                    style={[styles.chip, { backgroundColor: reason === r.value ? COLORS.brass : COLORS.vellum }]}
                  >
                    <Text style={{ color: reason === r.value ? COLORS.onBrass : COLORS.inkSoft }}>{r.label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={note}
                onChangeText={setNote}
                maxLength={280}
                multiline
                numberOfLines={2}
                placeholder="Anything the Maesters should know? (optional)"
                placeholderTextColor={COLORS.inkFaint}
                style={styles.textArea}
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <View style={styles.row}>
                <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={onClose}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, { flex: 1 }, (!reason || submitting) && styles.disabled]}
                  disabled={!reason || submitting}
                  onPress={handleSubmit}
                >
                  <Text style={styles.primaryBtnText}>Send Raven</Text>
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  panel: { backgroundColor: COLORS.vellumRaised, borderWidth: 3, borderColor: COLORS.vellumLine, padding: 20, maxHeight: "85%" },
  title: { color: COLORS.brass, fontSize: 15, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  subLabel: { marginTop: 4, color: COLORS.inkFaint, fontSize: 13 },
  body: { marginTop: 8, color: COLORS.inkSoft, fontSize: 15 },
  chip: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 2, borderColor: COLORS.vellumLine },
  textArea: { marginTop: 12, borderWidth: 2, borderColor: COLORS.vellumLine, backgroundColor: COLORS.vellum, color: COLORS.ink, padding: 10, minHeight: 60, textAlignVertical: "top" },
  error: { marginTop: 8, color: COLORS.crimson, fontSize: 13 },
  row: { marginTop: 16, flexDirection: "row", gap: 8 },
  primaryBtn: { backgroundColor: COLORS.brass, paddingVertical: 12, alignItems: "center", borderWidth: 2, borderColor: COLORS.vellumLine },
  primaryBtnText: { color: COLORS.onBrass, fontWeight: "700", textTransform: "uppercase", fontSize: 12 },
  secondaryBtn: { backgroundColor: COLORS.vellum, paddingVertical: 12, alignItems: "center", borderWidth: 2, borderColor: COLORS.vellumLine },
  secondaryBtnText: { color: COLORS.inkSoft, fontWeight: "700", textTransform: "uppercase", fontSize: 12 },
  disabled: { opacity: 0.5 },
});
