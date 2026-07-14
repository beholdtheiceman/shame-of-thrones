import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HOUSES, HOUSE_BY_ID, HOUSE_SWITCH_WINDOW_MS, type BadgeId, type HouseId } from "@sot/core";
import type { NotifyPrefsDTO } from "../lib/api";
import { ApiError } from "../lib/api";
import { signInWithGoogle, signOut } from "../lib/auth";
import { registerForPush } from "../lib/push";
import { useStore } from "../lib/store";
import { COLORS, HOUSE_COLOR } from "../lib/theme";

// Ported from apps/web/src/components/ProfilePanel.tsx — RN primitives.
// Sign-in/out affordances folded in per the task brief (web keeps those in
// its own header; mobile's Profile tab is the natural home for them).

const BADGE_META: Record<BadgeId, { icon: string; title: string; desc: string }> = {
  first_of_their_name: { icon: "🏅", title: "First of Their Name", desc: "Logged the first-ever rating at a throne." },
  cartographer: { icon: "🗺️", title: "The Cartographer", desc: "Charted a new throne for the Realm." },
  nights_watch: { icon: "🌙", title: "The Night's Watch", desc: "Rated a throne in the small hours (before 5am)." },
  oathkeeper: { icon: "🛡️", title: "Oathkeeper", desc: "Kept a 4-week streak of verified deeds." },
};

const PREF_ROWS: { key: keyof NotifyPrefsDTO; label: string }[] = [
  { key: "contested", label: "A fief becomes contested" },
  { key: "banner_fallen", label: "My House loses a fief" },
  { key: "season_start", label: "A new Season begins" },
];

export default function ProfileScreen() {
  const { state, refresh } = useStore();
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setBusy(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
      await refresh();
      void registerForPush();
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

  if (state.authStatus !== "ready") {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.signedOutBody}>
          <Text style={styles.eyebrow}>▸ Your Standing</Text>
          <Text style={styles.signedOutCopy}>
            {state.authStatus === "needs_profile"
              ? "Finish character creation on the Realm tab to see your standing."
              : "Sign in to take your seat on the Small Council."}
          </Text>
          {state.authStatus === "anonymous" && (
            <Pressable onPress={handleGoogleSignIn} disabled={busy} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Sign in with Google</Text>
            </Pressable>
          )}
          {authError && <Text style={styles.error}>{authError}</Text>}
        </View>
      </SafeAreaView>
    );
  }

  return <ProfileBody onSignOut={handleSignOut} busy={busy} />;
}

function ProfileBody({ onSignOut, busy }: { onSignOut: () => void; busy: boolean }) {
  const { state, switchHouse, updateNotifyPrefs } = useStore();
  const { profile, rank, streak } = state;
  const [switchingHouse, setSwitchingHouse] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  const standings = useMemo(() => {
    const totals = new Map<HouseId, { influence: number; fiefsHeld: number }>();
    for (const h of HOUSES) totals.set(h.id, { influence: 0, fiefsHeld: 0 });
    for (const control of state.realm?.fiefs ?? []) {
      for (const s of control.shares) {
        const entry = totals.get(s.houseId)!;
        entry.influence += s.influence;
      }
      if (control.leader) totals.get(control.leader.houseId)!.fiefsHeld += 1;
    }
    return HOUSES.map((h) => ({ house: h, ...totals.get(h.id)! })).sort(
      (a, b) => b.fiefsHeld - a.fiefsHeld || b.influence - a.influence
    );
  }, [state.realm?.fiefs]);

  if (!profile || !rank) return null;
  const house = HOUSE_BY_ID[profile.houseId];
  const now = Date.now();
  const canSwitch = !profile.lastHouseSwitchAt || now - profile.lastHouseSwitchAt > HOUSE_SWITCH_WINDOW_MS;

  async function handleSwitchHouse(houseId: HouseId) {
    setSwitchingHouse(true);
    setSwitchError(null);
    try {
      await switchHouse(houseId);
    } catch (e) {
      setSwitchError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "connection error — please try again");
    } finally {
      setSwitchingHouse(false);
    }
  }

  async function togglePref(key: keyof NotifyPrefsDTO) {
    setSavingPrefs(true);
    setPrefsError(null);
    try {
      await updateNotifyPrefs({ ...profile!.notifyPrefs, [key]: !profile!.notifyPrefs[key] });
    } catch (e) {
      setPrefsError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "connection error — please try again");
    } finally {
      setSavingPrefs(false);
    }
  }

  const badges = (profile.badges as string[]).filter((b): b is BadgeId => b in BADGE_META);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>▸ Your Standing</Text>
          <Pressable onPress={onSignOut} disabled={busy}>
            <Text style={styles.headerLink}>Sign out</Text>
          </Pressable>
        </View>
        <Text style={styles.name}>{profile.name}</Text>

        <View style={styles.panel}>
          <View style={styles.rankRow}>
            <Text style={styles.rankName}>{rank.name}</Text>
            <Text style={styles.rankNext}>{rank.nextName ?? "Max rank"}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(rank.progress * 100)}%` }]} />
          </View>
          <Text style={styles.xpText}>{rank.xp}{rank.ceiling ? ` / ${rank.ceiling}` : ""} XP</Text>
          {streak && streak.weeks > 0 && (
            <Text style={styles.streakText}>
              🔥 {streak.weeks}-week streak
              {!streak.thisWeekActive && <Text style={styles.streakAtRisk}> · at risk — rate this week to keep it</Text>}
            </Text>
          )}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelLabel}>Sworn to</Text>
          <View style={styles.houseRow}>
            <View style={[styles.houseBanner, { backgroundColor: HOUSE_COLOR[house.id] }]} />
            <Text style={styles.houseName}>{house.name}</Text>
          </View>
          <View style={styles.houseGrid}>
            {HOUSES.filter((h) => h.id !== profile.houseId).map((h) => (
              <Pressable
                key={h.id}
                disabled={!canSwitch || switchingHouse}
                onPress={() => void handleSwitchHouse(h.id)}
                style={[styles.switchBtn, (!canSwitch || switchingHouse) && styles.disabled]}
              >
                <Text style={styles.switchBtnText}>Ride for {h.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>
            Houses may be switched once per Season{!canSwitch && " — you've already switched recently"}.
          </Text>
          {switchError && <Text style={styles.error}>{switchError}</Text>}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelLabel}>Raven alerts</Text>
          <View style={styles.prefsList}>
            {PREF_ROWS.map((row) => (
              <View key={row.key} style={styles.prefRow}>
                <Text style={styles.prefLabel}>{row.label}</Text>
                <Switch
                  value={profile.notifyPrefs[row.key]}
                  disabled={savingPrefs}
                  onValueChange={() => void togglePref(row.key)}
                  trackColor={{ false: COLORS.vellumLine, true: COLORS.brass }}
                  thumbColor={COLORS.ink}
                />
              </View>
            ))}
          </View>
          {prefsError && <Text style={styles.error}>{prefsError}</Text>}
        </View>

        {badges.length > 0 && (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Badges</Text>
            <View style={styles.badgeList}>
              {badges.map((b) => (
                <View key={b} style={styles.badgeRow}>
                  <View style={styles.badgeIcon}>
                    <Text style={styles.badgeIconText}>{BADGE_META[b].icon}</Text>
                  </View>
                  <View style={styles.badgeTextWrap}>
                    <Text style={styles.badgeTitle}>{BADGE_META[b].title}</Text>
                    <Text style={styles.badgeDesc}>{BADGE_META[b].desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.panel}>
          <Text style={styles.panelLabel}>Realm Standings — race for the Porcelain Crown</Text>
          <View style={styles.standingsList}>
            {standings.map((s, i) => (
              <View key={s.house.id} style={styles.standingRow}>
                <Text style={styles.standingPos}>{i + 1}</Text>
                <View style={[styles.houseBanner, { backgroundColor: HOUSE_COLOR[s.house.id] }]} />
                <Text style={styles.standingName}>{s.house.name}</Text>
                <Text style={styles.standingFiefs}>{s.fiefsHeld} fief{s.fiefsHeld === 1 ? "" : "s"}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.vellum },
  content: { padding: 16, paddingBottom: 32 },
  signedOutBody: { flex: 1, padding: 24, paddingTop: 48 },
  signedOutCopy: { marginTop: 12, color: COLORS.inkSoft, fontSize: 15 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLink: { color: COLORS.inkFaint, fontSize: 12, textDecorationLine: "underline" },
  eyebrow: { color: COLORS.brass, fontSize: 13, textTransform: "uppercase", letterSpacing: 1 },
  name: { marginTop: 6, color: COLORS.ink, fontSize: 20, fontWeight: "700" },
  panel: { marginTop: 16, backgroundColor: COLORS.vellumRaised, borderWidth: 2, borderColor: COLORS.vellumLine, padding: 14 },
  panelLabel: { color: COLORS.inkFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  rankRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  rankName: { color: COLORS.ink, fontSize: 15, fontWeight: "700" },
  rankNext: { color: COLORS.inkFaint, fontSize: 13 },
  progressTrack: { marginTop: 10, height: 10, backgroundColor: COLORS.vellumLine, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: COLORS.brass },
  xpText: { marginTop: 6, textAlign: "right", color: COLORS.inkFaint, fontSize: 13 },
  streakText: { marginTop: 8, color: COLORS.inkSoft, fontSize: 13 },
  streakAtRisk: { color: COLORS.inkFaint },
  houseRow: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  houseBanner: { height: 16, width: 28 },
  houseName: { color: COLORS.ink, fontSize: 15, fontWeight: "700" },
  houseGrid: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  switchBtn: { flexGrow: 1, minWidth: "45%", backgroundColor: COLORS.vellum, borderWidth: 1, borderColor: COLORS.vellumLine, paddingHorizontal: 10, paddingVertical: 8 },
  switchBtnText: { color: COLORS.inkSoft, fontSize: 13 },
  disabled: { opacity: 0.4 },
  hint: { marginTop: 10, color: COLORS.inkFaint, fontSize: 12 },
  error: { marginTop: 8, color: COLORS.crimson, fontSize: 13 },
  prefsList: { marginTop: 10, gap: 10 },
  prefRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  prefLabel: { color: COLORS.inkSoft, fontSize: 14, flexShrink: 1, marginRight: 8 },
  badgeList: { marginTop: 10, gap: 10 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  badgeIcon: { height: 32, width: 32, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.brass },
  badgeIconText: { fontSize: 15 },
  badgeTextWrap: { flexShrink: 1 },
  badgeTitle: { color: COLORS.ink, fontSize: 14 },
  badgeDesc: { color: COLORS.inkFaint, fontSize: 12, marginTop: 2 },
  standingsList: { marginTop: 12, gap: 10 },
  standingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  standingPos: { width: 16, color: COLORS.inkFaint, fontSize: 14 },
  standingName: { flex: 1, color: COLORS.ink, fontSize: 14 },
  standingFiefs: { color: COLORS.inkSoft, fontSize: 13 },
  primaryBtn: { marginTop: 20, backgroundColor: COLORS.brass, paddingVertical: 14, alignItems: "center", borderWidth: 2, borderColor: COLORS.vellumLine },
  primaryBtnText: { color: COLORS.onBrass, fontWeight: "700", letterSpacing: 1, fontSize: 13 },
});
