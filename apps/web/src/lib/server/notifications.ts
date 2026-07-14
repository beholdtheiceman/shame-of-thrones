import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, users, type NotifyPrefs } from "@/db/schema";
import { seasonWindow } from "@sot/core";

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  contested: true,
  banner_fallen: true,
  season_start: true,
};

export function normalizedNotifyPrefs(prefs: Partial<NotifyPrefs> | null | undefined): NotifyPrefs {
  return {
    contested: prefs?.contested !== false,
    banner_fallen: prefs?.banner_fallen !== false,
    season_start: prefs?.season_start !== false,
  };
}

export async function notificationsPayload(userId: string, now = Date.now()) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("notification user not found");

  const prefs = normalizedNotifyPrefs(user.notifyPrefs);
  if (prefs.season_start) {
    const [latestSeasonStart] = await db.select({ createdAt: notifications.createdAt })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.category, "season_start")
      ))
      .orderBy(desc(notifications.createdAt))
      .limit(1);
    const season = seasonWindow(now);
    if (!latestSeasonStart || latestSeasonStart.createdAt.getTime() < season.start) {
      await db.insert(notifications).values({
        userId,
        category: "season_start",
        title: "A New Season Dawns",
        body: "The banners are raised anew. Take your House to the Porcelain Crown.",
        link: null,
        createdAt: new Date(now),
      });
    }
  }

  const [rows, [unread]] = await Promise.all([
    db.select().from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50),
    db.select({ count: sql<number>`count(*)::int` }).from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);

  return {
    notifications: rows.map((row) => ({
      id: row.id,
      category: row.category,
      title: row.title,
      body: row.body,
      link: row.link,
      createdAt: row.createdAt.getTime(),
      readAt: row.readAt?.getTime() ?? null,
    })),
    unreadCount: unread?.count ?? 0,
  };
}

export async function markNotificationsRead(userId: string, ids?: string[], now = Date.now()) {
  if (ids && ids.length === 0) return;
  await db.update(notifications)
    .set({ readAt: new Date(now) })
    .where(and(
      eq(notifications.userId, userId),
      isNull(notifications.readAt),
      ...(ids ? [inArray(notifications.id, ids)] : [])
    ));
}

export async function updateNotifyPrefs(userId: string, prefs: NotifyPrefs) {
  const [updated] = await db.update(users)
    .set({ notifyPrefs: normalizedNotifyPrefs(prefs) })
    .where(eq(users.id, userId))
    .returning({ notifyPrefs: users.notifyPrefs });
  if (!updated) throw new Error("notification user not found");
  return normalizedNotifyPrefs(updated.notifyPrefs);
}
