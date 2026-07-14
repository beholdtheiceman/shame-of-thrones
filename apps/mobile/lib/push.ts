import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

/**
 * Requests notification permission, fetches an Expo push token, and POSTs it
 * to /api/push/register. Fire-and-forget: every failure mode (permission
 * denied, no projectId configured, offline, server error) is swallowed here
 * so this can never crash the app or block sign-in / app-start.
 */
export async function registerForPush(): Promise<void> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    await api.registerPush(tokenResponse.data, Platform.OS);
  } catch {
    // Best-effort only — see doc comment above.
  }
}
