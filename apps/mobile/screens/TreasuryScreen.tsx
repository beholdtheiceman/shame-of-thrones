import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COSMETICS, equippedFor } from "@sot/core";
import type { PurchasesStoreProduct } from "react-native-purchases";
import { fetchBannerProducts, purchaseSku, purchasesReady, restorePurchases } from "../lib/purchases";
import { useStore } from "../lib/store";
import { COLORS, HOUSE_COLOR } from "../lib/theme";

// Ported from apps/web/src/components/Treasury.tsx — RN primitives, no
// clip-path (RN has no CSS clip-path support), so the banner crest becomes a
// simple rounded swatch labeled with the cosmetic's art token.

export default function TreasuryScreen() {
  const { state, equipCosmetic, refresh } = useStore();
  const { profile, cosmetics } = state;
  const [products, setProducts] = useState<Record<string, PurchasesStoreProduct>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!purchasesReady()) return;
    fetchBannerProducts()
      .then(setProducts)
      .catch(() => setProducts({}));
  }, []);

  const owned = useMemo(() => new Set(cosmetics?.owned ?? []), [cosmetics]);
  const equippedSku = equippedFor(cosmetics?.equipped ?? {}, "banner_style")?.sku;
  const houseColor = profile ? HOUSE_COLOR[profile.houseId] ?? COLORS.brass : COLORS.brass;

  async function onEquip(sku: string | null) {
    setBusy(sku ?? "clear");
    setError(null);
    try {
      await equipCosmetic("banner_style", sku);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  async function onBuy(sku: string) {
    setBusy(sku);
    setError(null);
    try {
      await purchaseSku(sku);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  async function onRestore() {
    setBusy("restore");
    setError(null);
    try {
      await restorePurchases();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.signedOutBody}>
          <Text style={styles.eyebrow}>▸ The Treasury</Text>
          <Text style={styles.signedOutCopy}>Swear an oath to enter the Treasury.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>▸ The Treasury</Text>
        <Text style={styles.title}>Banners of the Realm</Text>
        <Text style={styles.subtitle}>
          Cosmetic banners only — they change how your crest looks, never your standing.
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.list}>
          {COSMETICS.map((c) => {
            const isOwned = owned.has(c.sku);
            const isEquipped = equippedSku === c.sku;
            const priceLabel = products[c.sku]?.priceString ?? `$${c.priceUsd.toFixed(2)}`;
            return (
              <View key={c.sku} style={styles.panel}>
                <View style={[styles.swatch, { backgroundColor: houseColor }]}>
                  <Text style={styles.swatchLabel}>{c.art}</Text>
                </View>
                <View style={styles.textWrap}>
                  <Text style={styles.name}>{c.name}</Text>
                  <Text style={styles.desc}>{c.description}</Text>
                </View>
                {isOwned ? (
                  <Pressable
                    disabled={busy !== null || isEquipped}
                    onPress={() => void onEquip(isEquipped ? null : c.sku)}
                    style={[styles.actionBtn, (busy !== null || isEquipped) && styles.disabled]}
                  >
                    <Text style={styles.actionBtnText}>{isEquipped ? "Equipped" : "Equip"}</Text>
                  </Pressable>
                ) : purchasesReady() ? (
                  <Pressable
                    disabled={busy !== null}
                    onPress={() => void onBuy(c.sku)}
                    style={[styles.actionBtn, busy !== null && styles.disabled]}
                  >
                    <Text style={styles.actionBtnText}>Buy · {priceLabel}</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.actionBtn, styles.disabled]}>
                    <Text style={styles.actionBtnText}>Available soon</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <Pressable disabled={busy !== null} onPress={() => void onRestore()} style={styles.restoreBtn}>
          <Text style={styles.restoreBtnText}>Restore Purchases</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.vellum },
  content: { padding: 16, paddingBottom: 32 },
  signedOutBody: { flex: 1, padding: 24, paddingTop: 48 },
  signedOutCopy: { marginTop: 12, color: COLORS.inkSoft, fontSize: 15 },
  eyebrow: { color: COLORS.brass, fontSize: 13, textTransform: "uppercase", letterSpacing: 1 },
  title: { marginTop: 6, color: COLORS.ink, fontSize: 18, fontWeight: "700" },
  subtitle: { marginTop: 6, color: COLORS.inkFaint, fontSize: 13 },
  error: { marginTop: 10, color: COLORS.crimson, fontSize: 13 },
  list: { marginTop: 16, gap: 10 },
  panel: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: COLORS.vellumRaised, borderWidth: 2, borderColor: COLORS.vellumLine, padding: 14,
  },
  swatch: { height: 32, width: 56, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  swatchLabel: { color: COLORS.onBrass, fontSize: 9, textTransform: "uppercase", fontWeight: "700" },
  textWrap: { flex: 1 },
  name: { color: COLORS.ink, fontSize: 14 },
  desc: { marginTop: 2, color: COLORS.inkFaint, fontSize: 12 },
  actionBtn: { backgroundColor: COLORS.brass, paddingHorizontal: 12, paddingVertical: 8, flexShrink: 0 },
  actionBtnText: { color: COLORS.onBrass, fontSize: 12, fontWeight: "700" },
  disabled: { opacity: 0.4 },
  restoreBtn: {
    marginTop: 20, alignItems: "center", paddingVertical: 12,
    borderWidth: 1, borderColor: COLORS.vellumLine,
  },
  restoreBtnText: { color: COLORS.inkFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
});
