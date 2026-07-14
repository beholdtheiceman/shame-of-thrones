import { useEffect, useState } from "react";
import { Button, SafeAreaView, Text, View } from "react-native";
import type { MeDTO } from "@sot/core";
import { configureGoogle, getToken, signInWithGoogle, signOut } from "./lib/auth";
import { fetchMe } from "./lib/api";

export default function App() {
  const [me, setMe] = useState<MeDTO | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { configureGoogle(); getToken().then((t) => setSignedIn(!!t)); }, []);

  async function load() {
    try { setError(null); setMe(await fetchMe()); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 24, gap: 12, justifyContent: "center" }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Shame of Thrones</Text>
      {!signedIn ? (
        <>
          <Button title="Sign in with Google"
            onPress={async () => { try { await signInWithGoogle(); setSignedIn(true); await load(); } catch (e) { setError((e as Error).message); } }} />
          <Button title="Continue as Wandering Peasant" onPress={load} />
        </>
      ) : (
        <Button title="Load my profile" onPress={load} />
      )}
      {me && (
        <View>
          <Text>Name: {me.profile?.name ?? "(no profile)"}</Text>
          <Text>House: {me.profile?.houseId ?? "—"}</Text>
          <Text>Rank: {me.rank?.name ?? "—"}</Text>
          <Text>Streak: {me.streak ? `${me.streak.weeks}w` : "—"}</Text>
        </View>
      )}
      {signedIn && <Button title="Sign out" onPress={async () => { await signOut(); setSignedIn(false); setMe(null); }} />}
      {error && <Text style={{ color: "crimson" }}>{error}</Text>}
    </SafeAreaView>
  );
}
