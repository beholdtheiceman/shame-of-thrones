import * as SecureStore from "expo-secure-store";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { API_BASE_URL, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from "./config";

const KEY = "sot_native_bearer";

export function configureGoogle() {
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID });
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function signOut(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

export async function signInWithGoogle(): Promise<string> {
  await GoogleSignin.hasPlayServices();
  const result = await GoogleSignin.signIn();
  const idToken = (result as { data?: { idToken?: string }; idToken?: string }).data?.idToken
    ?? (result as { idToken?: string }).idToken;
  if (!idToken) throw new Error("no idToken from Google");

  const res = await fetch(`${API_BASE_URL}/api/auth/native`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error(`native auth failed (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  await SecureStore.setItemAsync(KEY, token);
  return token;
}
