import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { THRONE_CATEGORY_LABEL, type Amenities, type ThroneCategory } from "@sot/core";
import { ApiError } from "../lib/api";
import { useStore } from "../lib/store";
import { COLORS } from "../lib/theme";

// Same category list as apps/web/src/components/AddThroneFlow.tsx — no "residence" option.
const CATEGORIES: ThroneCategory[] = [
  "cafe",
  "restaurant",
  "park",
  "transit",
  "library",
  "retail",
  "municipal",
  "gas_station",
  "other",
];

const AMENITY_OPTIONS: [keyof Amenities, string][] = [
  ["accessible", "Accessible"],
  ["babyChanging", "Baby changing"],
  ["genderNeutral", "Gender-neutral"],
  ["freeAccess", "Free access"],
  ["open24h", "Open 24h"],
];

/**
 * Ported from apps/web/src/components/AddThroneFlow.tsx's AddThroneForm. Web
 * places the pin by a map tap; native uses the current map center (threaded
 * in from RealmScreen/RealmMap) per the task brief.
 */
export function AddThroneFlow({ coords, onClose }: { coords: { lat: number; lng: number }; onClose: () => void }) {
  const { addThrone } = useStore();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ThroneCategory>("cafe");
  const [amenities, setAmenities] = useState<Amenities>({
    accessible: false,
    babyChanging: false,
    genderNeutral: false,
    freeAccess: true,
    open24h: false,
  });
  const [attested, setAttested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleAmenity(key: keyof Amenities) {
    setAmenities((a) => ({ ...a, [key]: !a[key] }));
  }

  async function handleSubmit() {
    if (name.trim().length < 2) return;
    setSubmitting(true);
    setError(null);
    try {
      await addThrone({ name: name.trim(), lat: coords.lat, lng: coords.lng, category, amenities, publicAccessAttested: true });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "the ravens were lost");
      setSubmitting(false);
    }
  }

  const canSubmit = name.trim().length >= 2 && attested && !submitting;

  return (
    <Modal animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <ScrollView>
            <Text style={styles.eyebrow}>▸ Charting a New Throne</Text>
            <Text style={styles.title}>Name the throne</Text>

            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Corner Bodega Restroom"
              placeholderTextColor={COLORS.inkFaint}
              maxLength={60}
              style={styles.input}
            />

            <Text style={styles.sectionLabel}>Category</Text>
            <View style={styles.wrapRow}>
              {CATEGORIES.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  style={[styles.chip, { backgroundColor: category === c ? COLORS.brass : COLORS.vellum }]}
                >
                  <Text style={{ color: category === c ? COLORS.onBrass : COLORS.inkSoft, fontSize: 13 }}>
                    {THRONE_CATEGORY_LABEL[c]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>Private residences may not be charted as Thrones.</Text>

            <Text style={styles.sectionLabel}>Amenities</Text>
            <View style={styles.wrapRow}>
              {AMENITY_OPTIONS.map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => toggleAmenity(key)}
                  style={[styles.chip, { backgroundColor: amenities[key] ? COLORS.brass : COLORS.vellum }]}
                >
                  <Text style={{ color: amenities[key] ? COLORS.onBrass : COLORS.inkSoft, fontSize: 13 }}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={() => setAttested((v) => !v)}
              style={[styles.attestBtn, { backgroundColor: attested ? COLORS.brass : COLORS.vellum }]}
            >
              <Text style={{ color: attested ? COLORS.onBrass : COLORS.inkSoft, fontSize: 15 }}>{attested ? "☑" : "☐"}</Text>
              <Text style={[styles.attestText, { color: attested ? COLORS.onBrass : COLORS.inkSoft }]}>
                I attest this throne is in a publicly accessible place — not a private residence.
              </Text>
            </Pressable>

            <Text style={styles.hint}>
              New thrones enter the Realm as <Text style={{ color: COLORS.inkSoft, fontWeight: "700" }}>Rumored</Text> until
              confirmed.
            </Text>
            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.row}>
              <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, { flex: 1 }, !canSubmit && styles.disabled]}
                disabled={!canSubmit}
                onPress={handleSubmit}
              >
                <Text style={styles.primaryBtnText}>Chart It</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  panel: { backgroundColor: COLORS.vellumRaised, borderWidth: 3, borderColor: COLORS.vellumLine, padding: 20, maxHeight: "88%" },
  eyebrow: { color: COLORS.brass, fontSize: 15, textTransform: "uppercase", letterSpacing: 1 },
  title: { marginTop: 8, color: COLORS.ink, fontSize: 13 },
  input: { marginTop: 12, borderWidth: 2, borderColor: COLORS.vellumLine, backgroundColor: COLORS.vellum, color: COLORS.ink, padding: 10, fontSize: 16 },
  sectionLabel: { marginTop: 16, color: COLORS.inkFaint, fontSize: 13, textTransform: "uppercase" },
  wrapRow: { marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 2, borderColor: COLORS.vellumLine },
  hint: { marginTop: 6, color: COLORS.inkFaint, fontSize: 13 },
  attestBtn: { marginTop: 16, flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10 },
  attestText: { flex: 1, fontSize: 13 },
  error: { marginTop: 12, color: COLORS.crimson, fontSize: 13 },
  row: { marginTop: 16, flexDirection: "row", gap: 8 },
  primaryBtn: { backgroundColor: COLORS.brass, paddingVertical: 12, alignItems: "center", borderWidth: 2, borderColor: COLORS.vellumLine },
  primaryBtnText: { color: COLORS.onBrass, fontWeight: "700", textTransform: "uppercase", fontSize: 12 },
  secondaryBtn: { backgroundColor: COLORS.vellum, paddingVertical: 12, alignItems: "center", borderWidth: 2, borderColor: COLORS.vellumLine },
  secondaryBtnText: { color: COLORS.inkSoft, fontWeight: "700", textTransform: "uppercase", fontSize: 12 },
  disabled: { opacity: 0.5 },
});
