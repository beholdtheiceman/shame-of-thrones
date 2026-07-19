import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const houseEnum = pgEnum("house_id", ["flush", "bidet", "plunger", "porcelain"]);
export const throneStatusEnum = pgEnum("throne_status", ["rumored", "verified"]);
export const throneCategoryEnum = pgEnum("throne_category", [
  "cafe", "restaurant", "park", "transit", "library", "retail", "municipal", "gas_station", "other",
]);
export const influenceReasonEnum = pgEnum("influence_reason", [
  "rating", "first_of_name", "new_throne", "confirmation", "hearsay", "reversal",
]);
export const userRoleEnum = pgEnum("user_role", ["user", "moderator"]);
export const reviewKindEnum = pgEnum("review_kind", ["rating", "new_throne", "confirmation", "report", "testimony", "photo"]);
export const reviewSeverityEnum = pgEnum("review_severity", ["low", "medium", "high"]);
export const reviewStatusEnum = pgEnum("review_status", ["pending", "resolved"]);
export const reportSubjectEnum = pgEnum("report_subject", ["throne", "rating", "photo"]);
export const photoStatusEnum = pgEnum("photo_status", ["pending", "approved", "rejected"]);
export const reportReasonEnum = pgEnum("report_reason", [
  "wrong_info", "closed", "inappropriate", "not_public_restroom", "harassment", "spam",
]);
export const entitlementSourceEnum = pgEnum("entitlement_source", ["purchase", "grant", "pass"]);
export const notificationCategoryEnum = pgEnum("notification_category", [
  "contested", "banner_fallen", "season_start",
]);

export interface NotifyPrefs {
  contested: boolean;
  banner_fallen: boolean;
  season_start: boolean;
}

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  googleSubject: text("google_subject").notNull().unique(),
  displayName: text("display_name").notNull().unique(),
  houseId: houseEnum("house_id").notNull(),
  role: userRoleEnum("role").notNull().default("user"),
  badges: jsonb("badges").$type<string[]>().notNull().default([]),
  notifyPrefs: jsonb("notify_prefs").$type<NotifyPrefs>().notNull().default({
    contested: true,
    banner_fallen: true,
    season_start: true,
  }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastHouseSwitchAt: timestamp("last_house_switch_at", { withTimezone: true }),
  suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  cohort: text("cohort"), // closed-beta launch city; NULL when open signup
  equipped: jsonb("equipped").$type<Record<string, string>>().notNull().default({}),
});

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    cohort: text("cohort").notNull(), // launch city
    createdBy: uuid("created_by").notNull().references(() => users.id),
    redeemedBy: uuid("redeemed_by").references(() => users.id),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invites_redeemed_idx").on(t.redeemedBy)]
);

export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    source: entitlementSourceEnum("source").notNull(),
    platform: text("platform"), // "ios" | "android" | "admin" | null
    // Store transaction id. Nullable (admin grants have none), unique so
    // duplicate webhook deliveries are idempotent.
    storeTxnId: text("store_txn_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("entitlements_user_idx").on(t.userId),
    // A user owns a given sku at most once while it is not revoked.
    uniqueIndex("entitlements_user_sku_active")
      .on(t.userId, t.sku)
      .where(sql`${t.revokedAt} is null`),
  ]
);

export const thrones = pgTable(
  "thrones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    category: throneCategoryEnum("category").notNull(),
    status: throneStatusEnum("status").notNull().default("rumored"),
    publicAccessAttested: boolean("public_access_attested").notNull().default(false),
    amenities: jsonb("amenities")
      .$type<{
        accessible: boolean; babyChanging: boolean; genderNeutral: boolean;
        freeAccess: boolean; open24h: boolean;
      }>()
      .notNull(),
    addedBy: uuid("added_by").notNull().references(() => users.id),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: uuid("hidden_by").references(() => users.id),
    source: text("source"),          // "refuge" | "osm"; NULL = user-added
    sourceId: text("source_id"),     // upstream record id
  },
  (t) => [
    uniqueIndex("thrones_source_unique")
      .on(t.source, t.sourceId)
      .where(sql`${t.source} is not null`),
  ]
);

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    throneId: uuid("throne_id").notNull().references(() => thrones.id),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    bytes: bytea("bytes").notNull(),
    contentType: text("content_type").notNull(),
    status: photoStatusEnum("status").notNull().default("pending"),
    aiVerdict: jsonb("ai_verdict").$type<{ personDetected: boolean; nsfw: boolean; relevant: boolean; note: string }>(),
    rejectedReason: text("rejected_reason"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("photos_throne_status_idx").on(t.throneId, t.status)]
);

export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    throneId: uuid("throne_id").notNull().references(() => thrones.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    verdict: integer("verdict").notNull(),
    tags: text("tags").array().notNull().default([]),
    verified: boolean("verified").notNull(),
    testimony: text("testimony"),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: uuid("hidden_by").references(() => users.id),
    testimonyHiddenAt: timestamp("testimony_hidden_at", { withTimezone: true }),
    testimonyHiddenBy: uuid("testimony_hidden_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ratings_throne_idx").on(t.throneId), index("ratings_user_idx").on(t.userId)]
);

export const influenceEvents = pgTable(
  "influence_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fiefId: text("fief_id").notNull(),
    houseId: houseEnum("house_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id),
    points: integer("points").notNull(),
    reason: influenceReasonEnum("reason").notNull(),
    throneId: uuid("throne_id").notNull().references(() => thrones.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("influence_fief_idx").on(t.fiefId), index("influence_user_idx").on(t.userId)]
);

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    category: notificationCategoryEnum("category").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("notifications_user_read_idx").on(t.userId, t.readAt),
    index("notifications_user_category_link_created_idx").on(
      t.userId,
      t.category,
      t.link,
      t.createdAt
    ),
  ]
);

export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: text("platform"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_tokens_user_idx").on(t.userId)]
);

export type ReviewSignal =
  | { signal: "new_account"; accountAgeDays: number }
  | { signal: "rate_soft"; writesLastHour: number }
  | { signal: "impossible_travel"; kmh: number; fromThroneId: string; minutes: number }
  | { signal: "new_throne" }
  | { signal: "user_report"; reason: string; reporterCount: number }
  | { signal: "testimony_blocked"; category: string }
  | { signal: "testimony_flagged"; category?: string }
  | { signal: "photo_rejected"; reason: string }
  | { signal: "photo_pending"; relevant: boolean }
  | { signal: "screen_unavailable" };

export const ageAttestations = pgTable("age_attestations", {
  googleSubject: text("google_subject").primaryKey(),
  over13ConfirmedAt: timestamp("over13_confirmed_at", { withTimezone: true }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
});

export const reviewQueue = pgTable(
  "review_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: reviewKindEnum("kind").notNull(),
    subjectId: uuid("subject_id").notNull(), // rating id or throne id — spans tables, no FK
    userId: uuid("user_id").notNull().references(() => users.id),
    signals: jsonb("signals").$type<ReviewSignal[]>().notNull(),
    severity: reviewSeverityEnum("severity").notNull(),
    aiAssessment: text("ai_assessment"),
    aiSeverity: reviewSeverityEnum("ai_severity"),
    aiTriagedAt: timestamp("ai_triaged_at", { withTimezone: true }),
    aiError: text("ai_error"),
    status: reviewStatusEnum("status").notNull().default("pending"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("review_status_created_idx").on(t.status, t.createdAt),
    index("review_user_idx").on(t.userId),
  ]
);

export const metricsEvents = pgTable(
  "metrics_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(), // "time_to_rate" | "nwt_outcome"
    userId: uuid("user_id").references(() => users.id), // nullable (anon allowed)
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("metrics_events_name_idx").on(t.name)]
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reporterId: uuid("reporter_id").notNull().references(() => users.id),
    subjectKind: reportSubjectEnum("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(), // throne or rating id — spans tables, no FK
    reason: reportReasonEnum("reason").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reports_reporter_subject_idx").on(t.reporterId, t.subjectKind, t.subjectId),
    index("reports_subject_idx").on(t.subjectKind, t.subjectId),
  ]
);
