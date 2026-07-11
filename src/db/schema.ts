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
  uuid,
} from "drizzle-orm/pg-core";

export const houseEnum = pgEnum("house_id", ["flush", "bidet", "plunger", "porcelain"]);
export const throneStatusEnum = pgEnum("throne_status", ["rumored", "verified"]);
export const throneCategoryEnum = pgEnum("throne_category", [
  "cafe", "restaurant", "park", "transit", "library", "retail", "municipal", "gas_station", "other",
]);
export const influenceReasonEnum = pgEnum("influence_reason", [
  "rating", "first_of_name", "new_throne", "confirmation", "hearsay",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  googleSubject: text("google_subject").notNull().unique(),
  displayName: text("display_name").notNull().unique(),
  houseId: houseEnum("house_id").notNull(),
  badges: jsonb("badges").$type<string[]>().notNull().default([]),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastHouseSwitchAt: timestamp("last_house_switch_at", { withTimezone: true }),
});

export const thrones = pgTable("thrones", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  category: throneCategoryEnum("category").notNull(),
  status: throneStatusEnum("status").notNull().default("rumored"),
  amenities: jsonb("amenities")
    .$type<{
      accessible: boolean; babyChanging: boolean; genderNeutral: boolean;
      freeAccess: boolean; open24h: boolean;
    }>()
    .notNull(),
  addedBy: uuid("added_by").notNull().references(() => users.id),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }).notNull().defaultNow(),
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
