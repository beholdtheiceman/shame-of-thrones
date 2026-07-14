import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { pushTokens } from "@/db/schema";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Best-effort Expo push send. Never throws — a push failure must never
 * break notification generation or the request that triggered it. Does
 * not log token values.
 */
export async function sendPushToUser(
  userId: string,
  msg: { title: string; body: string; data?: Record<string, unknown> }
): Promise<void> {
  try {
    const tokens = await db
      .select({ token: pushTokens.token })
      .from(pushTokens)
      .where(eq(pushTokens.userId, userId));
    if (tokens.length === 0) return;

    const messages = tokens.map((row) => ({
      to: row.token,
      title: msg.title,
      body: msg.body,
      data: msg.data,
    }));

    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(messages),
    });
  } catch {
    // best-effort: swallow all errors (DB lookup, network, etc.)
  }
}
