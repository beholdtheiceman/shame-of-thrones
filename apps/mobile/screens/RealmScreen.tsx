import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HOUSES, REALM_CENTER, type HouseId } from "@sot/core";
import { ApiError } from "../lib/api";
import { signInWithGoogle, signOut } from "../lib/auth";
import { useStore } from "../lib/store";
import { COLORS, HOUSE_COLOR } from "../lib/theme";
import { AddThroneFlow } from "../components/AddThroneFlow";
import { FiefCard } from "../components/FiefCard";
import { OfflineBanner } from "../components/OfflineBanner";
import RealmMap from "../components/RealmMap";
import { ThroneSheet } from "../components/ThroneSheet";

/** Header auth control — the Foundation screen's Google sign-in / Wandering
 * Peasant / sign-out affordances, relocated here per the task brief. */
function AuthHeader() {
  const { state, refresh } = useStore();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setBusy(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
      await refresh();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Shame of Thrones</Text>
        {state.authStatus === "ready" || state.authStatus === "needs_profile" ? (
          <Pressable onPress={handleSignOut} disabled={busy}>
            <Text style={styles.headerLink}>Sign out</Text>
          </Pressable>
        ) : null}
      </View>
      {state.authStatus === "anonymous" && !dismissed && (
        <View style={styles.authRow}>
          <Pressable onPress={handleGoogleSignIn} disabled={busy} style={styles.authBtn}>
            <Text style={styles.authBtnText}>Sign in with Google</Text>
          </Pressable>
          <Pressable onPress={() => setDismissed(true)} disabled={busy}>
            <Text style={styles.headerLink}>Continue as Wandering Peasant</Text>
          </Pressable>
        </View>
      )}
      {authError && <Text style={styles.authError}>{authError}</Text>}
    </View>
  );
}

/** Minimal inline "Character Creation" for authStatus === "needs_profile".
 * apps/web/src/components/Onboarding.tsx is the full themed version; porting
 * it in full wasn't in this task's component list, so this is a compact
 * native equivalent reusing HOUSES + store.setProfile (same copy/flow). */
function InlineOnboarding() {
  const { setProfile } = useStore();
  const [name, setName] = useState("");
  const [houseId, setHouseId] = useState<HouseId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length >= 2 && houseId !== null && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !houseId) return;
    setSubmitting(true);
    setError(null);
    try {
      await setProfile(name.trim(), houseId);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? "that name is already sworn to another"
          : e instanceof Error
            ? e.message
            : "the ravens were lost"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.onboardingOverlay}>
        <ScrollView contentContainerStyle={styles.onboardingPanel}>
          <Text style={styles.eyebrow}>▸ Character Creation</Text>
          <Text style={styles.onboardingBody}>
            Choose the name the Realm will know you by, then pledge to a House. You may switch Houses once per Season.
          </Text>

          <Text style={styles.fieldLabel}>Your name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="ser.yourname"
            placeholderTextColor={COLORS.inkFaint}
            maxLength={24}
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>Choose your House</Text>
          <View style={styles.houseGrid}>
            {HOUSES.map((h) => (
              <Pressable
                key={h.id}
                onPress={() => setHouseId(h.id)}
                style={[styles.houseCard, houseId === h.id && styles.houseCardActive]}
              >
                <View style={[styles.houseSwatch, { backgroundColor: HOUSE_COLOR[h.id] }]} />
                <Text style={styles.houseName}>{h.name}</Text>
                <Text style={styles.houseWords}>&ldquo;{h.words}&rdquo;</Text>
              </Pressable>
            ))}
          </View>

          <Pressable disabled={!canSubmit} onPress={handleSubmit} style={[styles.primaryBtn, !canSubmit && styles.disabled]}>
            <Text style={styles.primaryBtnText}>▸ Press Start</Text>
          </Pressable>
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function RealmScreen() {
  const { state } = useStore();
  const [selectedThroneId, setSelectedThroneId] = useState<string | null>(null);
  const [selectedFiefId, setSelectedFiefId] = useState<string | null>(null);
  const [addingThrone, setAddingThrone] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({
    lat: REALM_CENTER[0],
    lng: REALM_CENTER[1],
  });

  const thrones = state.realm?.thrones ?? [];
  const fiefs = state.realm?.fiefs ?? [];
  const selectedThrone = thrones.find((t) => t.id === selectedThroneId) ?? null;
  const selectedFief = selectedFiefId ? (fiefs.find((f) => f.fiefId === selectedFiefId) ?? null) : null;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <AuthHeader />
      <View style={styles.mapArea}>
        <RealmMap
          thrones={thrones}
          fiefs={fiefs}
          selectedThroneId={selectedThroneId}
          onSelectThrone={(id) => {
            setSelectedFiefId(null);
            setSelectedThroneId(id);
          }}
          onSelectFief={(fiefId) => {
            setSelectedThroneId(null);
            setSelectedFiefId(fiefId);
          }}
          onBackgroundClick={() => {
            setSelectedThroneId(null);
            setSelectedFiefId(null);
          }}
          onCenterChange={setMapCenter}
        />
        <OfflineBanner />
        {state.authStatus === "ready" && (
          <Pressable style={styles.addBtn} onPress={() => setAddingThrone(true)}>
            <Text style={styles.addBtnText}>+ Chart a Throne</Text>
          </Pressable>
        )}
        {selectedFief && <FiefCard control={selectedFief} onClose={() => setSelectedFiefId(null)} />}
      </View>

      {selectedThrone && <ThroneSheet throne={selectedThrone} onClose={() => setSelectedThroneId(null)} />}
      {addingThrone && <AddThroneFlow coords={mapCenter} onClose={() => setAddingThrone(false)} />}
      {state.authStatus === "needs_profile" && <InlineOnboarding />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.vellum },
  header: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: COLORS.vellumRaised, borderBottomWidth: 2, borderBottomColor: COLORS.vellumLine, gap: 6 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { color: COLORS.brass, fontSize: 17, fontWeight: "700" },
  headerLink: { color: COLORS.inkFaint, fontSize: 12, textDecorationLine: "underline" },
  authRow: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  authBtn: { backgroundColor: COLORS.brass, paddingHorizontal: 12, paddingVertical: 8 },
  authBtnText: { color: COLORS.onBrass, fontSize: 13, fontWeight: "700" },
  authError: { color: COLORS.crimson, fontSize: 12 },
  mapArea: { flex: 1, position: "relative" },
  addBtn: {
    position: "absolute",
    right: 16,
    bottom: 24,
    backgroundColor: COLORS.vellumRaised,
    borderWidth: 2,
    borderColor: COLORS.brass,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  addBtnText: { color: COLORS.brass, fontSize: 13, textTransform: "uppercase", fontWeight: "700" },
  onboardingOverlay: { flex: 1, backgroundColor: COLORS.vellum },
  onboardingPanel: { padding: 24, paddingTop: 48 },
  eyebrow: { color: COLORS.brass, fontSize: 15, textTransform: "uppercase", letterSpacing: 1 },
  onboardingBody: { marginTop: 8, color: COLORS.inkSoft, fontSize: 15 },
  fieldLabel: { marginTop: 20, color: COLORS.inkFaint, fontSize: 13, textTransform: "uppercase" },
  input: { marginTop: 6, borderWidth: 2, borderColor: COLORS.vellumLine, backgroundColor: COLORS.vellumRaised, color: COLORS.ink, padding: 10, fontSize: 16 },
  houseGrid: { marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  houseCard: { width: "47%", backgroundColor: COLORS.vellumRaised, borderWidth: 2, borderColor: "transparent", padding: 12 },
  houseCardActive: { borderColor: COLORS.brass },
  houseSwatch: { height: 12, width: 24, marginBottom: 8 },
  houseName: { color: COLORS.ink, fontSize: 13, fontWeight: "700" },
  houseWords: { marginTop: 4, color: COLORS.inkFaint, fontSize: 12, fontStyle: "italic" },
  primaryBtn: { marginTop: 24, backgroundColor: COLORS.brass, paddingVertical: 14, alignItems: "center", borderWidth: 2, borderColor: COLORS.vellumLine },
  primaryBtnText: { color: COLORS.onBrass, fontWeight: "700", letterSpacing: 1, fontSize: 12 },
  disabled: { opacity: 0.5 },
  error: { marginTop: 12, textAlign: "center", color: COLORS.crimson, fontSize: 13 },
});
