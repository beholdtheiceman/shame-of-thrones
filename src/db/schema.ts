import {
  boolean,
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

export const houseEnum = pgEnum("house_id", ["flush", "bidet", "plunger", "porcelain"]);
export const throneStatusEnum = pgEnum("throne_status", ["rumored", "verified"]);
export const throneCategoryEnum = pgEnum("throne_category", [
  "cafe", "restaurant", "park", "transit", "library", "retail", "municipal", "gas_station", "other",
]);
export const influenceReasonEnum = pgEnum("influence_reason", [
  "rating", "first_of_name", "new_throne", "confirmation", "hearsay", "reversal",
]);
export const userRoleEnum = pgEnum("user_role", ["user", "moderator"]);
export const reviewKindEnum = pgEnum("review_kind", ["rating", "new_throne", "confirmation", "report", "testimony"]);
export const reviewSeverityEnum = pgEnum("review_severity", ["low", "medium", "high"]);
export const reviewStatusEnum = pgEnum("review_status", ["pending", "resolved"]);
export const reportSubjectEnum = pgEnum("report_subject", ["throne", "rating"]);
export const reportReasonEnum = pgEnum("report_reason", [
  "wrong_info", "closed", "inappropriate", "not_public_restroom", "harassment", "spam",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  googleSubject: text("google_subject").notNull().unique(),
  displayName: text("display_name").notNull().unique(),
  houseId: houseEnum("house_id").notNull(),
  role: userRoleEnum("role").notNull().default("user"),
  badges: jsonb("badges").$type<string[]>().notNull().default([]),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastHouseSwitchAt: timestamp("last_house_switch_at", { withTimezone: true }),
  suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
  bannedAt: timestamp("banned_at", { withTimezone: true }),
});

export const thrones = pgTable("thrones", {
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
});

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

export type ReviewSignal =
  | { signal: "new_account"; accountAgeDays: number }
  | { signal: "rate_soft"; writesLastHour: number }
  | { signal: "impossible_travel"; kmh: number; fromThroneId: string; minutes: number }
  | { signal: "new_throne" }
  | { signal: "user_report"; reason: string; reporterCount: number }
  | { signal: "testimony_blocked"; category: string }
  | { signal: "testimony_flagged"; category?: string }
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
