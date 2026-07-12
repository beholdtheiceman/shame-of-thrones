# Phase 1 Cycle B: Photo Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Throne photos with the PRD §5.8 hard rules — Claude-vision classification, auto-reject on any person/NSFW, human approval before any public visibility — per `docs/superpowers/specs/2026-07-12-phase1-photo-pipeline-design.md` (incl. the bytea storage amendment).

**Architecture:** Photo bytes live in Postgres (bytea via drizzle `customType`); the ONLY read path is `GET /api/photos/[id]`, which enforces status/role, so nothing unmoderated can leak. One synchronous Haiku vision call classifies at upload (fail **closed**: classification failure leaves the photo pending = invisible). Queue rows reuse the existing review/triage/moderation machinery; `approve_photo`/`reject_photo` join `POST /api/moderate`; approved photos become reportable.

**Tech Stack:** unchanged (Next 16, Drizzle/Neon, zod, Vitest, `@anthropic-ai/sdk` vision + structured output).

**Division of labor:** unchanged — Codex codes + `npx.cmd tsc --noEmit`; Claude migrates BOTH DBs, tests, commits, browser-verifies, deploys (pre-authorized).

---

### Task 1: Schema + migration

**Files:** modify `src/db/schema.ts`, `src/lib/server/signals.ts` (SIGNAL_SEVERITY keys), `src/lib/server/review.ts` (DTO kind/subjectKind unions), `src/test/db.ts`; test `src/test/schema.test.ts` (append).

- [ ] **Step 1: Failing tests** — append to `src/test/schema.test.ts`:

```ts
import { photos } from "@/db/schema";

describe("cycle B schema", () => {
  beforeEach(resetDb);

  it("photos store bytes and default to pending", async () => {
    const [u] = await db.insert(users).values({
      googleSubject: "sub-ph", displayName: "Ph", houseId: "flush",
    }).returning();
    const [t] = await db.insert(thrones).values({
      name: "PT", lat: 1, lng: 1, category: "cafe",
      amenities: { accessible: false, babyChanging: false, genderNeutral: false, freeAccess: true, open24h: false },
      addedBy: u.id, publicAccessAttested: true,
    }).returning();
    const [p] = await db.insert(photos).values({
      throneId: t.id, uploadedBy: u.id, bytes: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg",
    }).returning();
    expect(p.status).toBe("pending");
    expect(Buffer.from(p.bytes).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(p.aiVerdict).toBeNull();
  });
});
```

- [ ] **Step 2 (Claude): verify fail** — `npx vitest run src/test/schema.test.ts`.

- [ ] **Step 3: Implement** — `src/db/schema.ts`:

```ts
import { customType } from "drizzle-orm/pg-core"; // merge into existing import

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const photoStatusEnum = pgEnum("photo_status", ["pending", "approved", "rejected"]);
```

Extend existing enums in place: `reviewKindEnum` values += `"photo"`; `reportSubjectEnum` values += `"photo"`.

`ReviewSignal` union += two variants:

```ts
| { signal: "photo_rejected"; reason: string }
| { signal: "photo_pending"; relevant: boolean }
```

New table:

```ts
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
```

`src/lib/server/signals.ts` — `SIGNAL_SEVERITY` += `photo_rejected: "high", photo_pending: "low"`.
`src/lib/server/review.ts` — `ReviewItemDTO.kind` += `"photo"`; `subjectKind` becomes `"throne" | "rating" | "photo"` (mapping logic lands in Task 5; keep tsc green with the widened type).
`src/test/db.ts` — TRUNCATE list += `photos`.

- [ ] **Step 4 (Claude): migrate BOTH DBs** — `npm run db:generate -- --name phase1-cycle-b`, inspect, `npm run db:migrate`, then the `.env.test` variant (memory: test-db-needs-own-migrations).
- [ ] **Step 5 (Claude): verify pass + commit** — `git commit -m "feat: cycle-B schema — photos table, photo review kinds"`

---

### Task 2: Vision screening module

**Files:** create `src/lib/server/photoScreen.ts`; test `src/test/photo-screen.test.ts`.

- [ ] **Step 1: Failing tests** — `src/test/photo-screen.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { screenPhoto, type VisionClient } from "@/lib/server/photoScreen";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

describe("screenPhoto", () => {
  it("passes through the client's verdict", async () => {
    const fake: VisionClient = {
      async classify() { return { personDetected: true, nsfw: false, relevant: true, note: "a face is visible at the sink" }; },
    };
    const v = await screenPhoto(JPEG, "image/jpeg", fake);
    expect(v?.personDetected).toBe(true);
  });

  it("fails CLOSED on error — returns null (photo stays pending/invisible)", async () => {
    const failing: VisionClient = {
      async classify() { throw new Error("vision down"); },
    };
    expect(await screenPhoto(JPEG, "image/jpeg", failing)).toBeNull();
  });
});
```

- [ ] **Step 2 (Claude): verify fail.**

- [ ] **Step 3: Implement** — `src/lib/server/photoScreen.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";

export interface VisionVerdict {
  personDetected: boolean;
  nsfw: boolean;
  relevant: boolean;
  note: string;
}
export interface VisionClient {
  classify(imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<VisionVerdict>;
}

const SYSTEM = `You classify photos uploaded to "Shame of Thrones", a public-restroom-rating
game. Policy (hard rules): photos may show restroom ENTRANCES, SIGNAGE, and SINK AREAS only.
- personDetected: true if ANY person, face, or identifiable body part is visible, even
  partially, even in a mirror. Zero tolerance — when unsure, say true.
- nsfw: true for any sexual/explicit content whatsoever.
- relevant: true if the photo plausibly shows a restroom entrance, signage, sink area, or
  the venue exterior; false for unrelated subjects (memes, screenshots, food, etc.).
- note: one sentence for the human moderator describing what the photo shows.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    personDetected: { type: "boolean" },
    nsfw: { type: "boolean" },
    relevant: { type: "boolean" },
    note: { type: "string" },
  },
  required: ["personDetected", "nsfw", "relevant", "note"],
  additionalProperties: false,
} as const;

export function anthropicVisionClient(): VisionClient {
  const model = process.env.TRIAGE_MODEL ?? "claude-haiku-4-5";
  return {
    async classify(imageBase64, mediaType) {
      const client = new Anthropic(); // lazy — a missing key becomes a caught failure
      const response = await client.messages.create({
        model,
        max_tokens: 512,
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: "Classify this photo per the policy." },
          ],
        }],
      });
      const raw = response.content.find((b) => b.type === "text")?.text ?? "";
      return JSON.parse(raw) as VisionVerdict;
    },
  };
}

/** Fail-CLOSED wrapper: null means "could not classify" — the caller must leave
 * the photo pending (invisible) for human review. Opposite of the testimony
 * screen's fail-open, because the PRD forbids unmoderated public photos. */
export async function screenPhoto(
  bytes: Buffer,
  contentType: string,
  client: VisionClient = anthropicVisionClient()
): Promise<VisionVerdict | null> {
  try {
    return await client.classify(
      bytes.toString("base64"),
      contentType as "image/jpeg" | "image/png" | "image/webp"
    );
  } catch {
    return null;
  }
}
```

- [ ] **Step 4 (Claude): verify pass + commit** — `git commit -m "feat: photo vision screening — fail-closed classification"`

---

### Task 3: Photos lib + upload route

**Files:** create `src/lib/server/photos.ts`, `src/app/api/photos/route.ts`; test `src/test/photos.test.ts`.

- [ ] **Step 1: Failing tests** — `src/test/photos.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { photos, reviewQueue } from "@/db/schema";
import { PhotoError, submitPhoto } from "@/lib/server/photos";
import type { VisionClient } from "@/lib/server/photoScreen";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const okVision: VisionClient = {
  async classify() { return { personDetected: false, nsfw: false, relevant: true, note: "an entrance" }; },
};

describe("submitPhoto", () => {
  beforeEach(resetDb);

  it("clean photo lands pending (NOT approved) with a low queue row", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const { photoId, status } = await submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), okVision);
    expect(status).toBe("pending");
    const [p] = await db.select().from(photos).where(eq(photos.id, photoId));
    expect(p.status).toBe("pending");
    expect(p.aiVerdict?.relevant).toBe(true);
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "photo");
    expect(q.severity).toBe("low");
    expect(q.aiAssessment).toBe("an entrance");
  });

  it("person detected → auto-rejected, high queue row, bytes kept", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const vision: VisionClient = {
      async classify() { return { personDetected: true, nsfw: false, relevant: true, note: "a person at the sink" }; },
    };
    const { status, photoId } = await submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), vision);
    expect(status).toBe("rejected");
    const [p] = await db.select().from(photos).where(eq(photos.id, photoId));
    expect(p.rejectedReason).toBe("person_detected");
    expect(p.bytes.length).toBeGreaterThan(0);
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "photo");
    expect(q.severity).toBe("high");
  });

  it("nsfw → rejected AND bytes wiped", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const vision: VisionClient = {
      async classify() { return { personDetected: false, nsfw: true, relevant: false, note: "explicit" }; },
    };
    const { photoId } = await submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), vision);
    const [p] = await db.select().from(photos).where(eq(photos.id, photoId));
    expect(p.status).toBe("rejected");
    expect(p.rejectedReason).toBe("nsfw");
    expect(p.bytes.length).toBe(0);
  });

  it("vision failure fails CLOSED: pending, screen_unavailable queue row", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const vision: VisionClient = { async classify() { throw new Error("down"); } };
    const { status } = await submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), vision);
    expect(status).toBe("pending");
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "photo");
    expect(q.signals).toEqual([{ signal: "screen_unavailable" }]);
  });

  it("validates type, size, and the 3-per-throne cap", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    await expect(
      submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/gif" }, Date.now(), okVision)
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      submitPhoto(user, { throneId: throne.id, bytes: Buffer.alloc(5 * 1024 * 1024 + 1), contentType: "image/jpeg" }, Date.now(), okVision)
    ).rejects.toMatchObject({ status: 413 });
    for (let i = 0; i < 3; i++) {
      await submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), okVision);
    }
    await expect(
      submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), okVision)
    ).rejects.toMatchObject({ status: 429 });
  });

  it("hidden or missing throne 404s", async () => {
    const user = await makeUser();
    await expect(
      submitPhoto(user, { throneId: "00000000-0000-0000-0000-000000000001", bytes: JPEG, contentType: "image/jpeg" }, Date.now(), okVision)
    ).rejects.toBeInstanceOf(PhotoError);
  });
});
```

- [ ] **Step 2 (Claude): verify fail.**

- [ ] **Step 3: Implement** — `src/lib/server/photos.ts`:

```ts
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { photos, reviewQueue, thrones, users } from "@/db/schema";
import { screenPhoto, type VisionClient } from "./photoScreen";

type UserRow = typeof users.$inferSelect;

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_PER_THRONE = 3;   // non-rejected photos per user per throne
const MAX_PENDING = 10;     // pending photos per user overall

export class PhotoError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface SubmitPhotoInput {
  throneId: string;
  bytes: Buffer;
  contentType: string;
}

export async function submitPhoto(
  user: UserRow,
  input: SubmitPhotoInput,
  now = Date.now(),
  vision?: VisionClient
) {
  const throne = await db.query.thrones.findFirst({ where: eq(thrones.id, input.throneId) });
  if (!throne || throne.hiddenAt) throw new PhotoError("no such throne", 404);
  if (!(ALLOWED_TYPES as readonly string[]).includes(input.contentType)) {
    throw new PhotoError("only jpeg, png, or webp portraits are accepted", 415);
  }
  if (input.bytes.length === 0) throw new PhotoError("empty file", 400);
  if (input.bytes.length > MAX_BYTES) throw new PhotoError("portraits may not exceed 5MB", 413);

  const count = sql<number>`count(*)::int`;
  const [[perThrone], [pending]] = await Promise.all([
    db.select({ n: count }).from(photos).where(and(
      eq(photos.uploadedBy, user.id), eq(photos.throneId, input.throneId), ne(photos.status, "rejected")
    )),
    db.select({ n: count }).from(photos).where(and(
      eq(photos.uploadedBy, user.id), eq(photos.status, "pending")
    )),
  ]);
  if (perThrone.n >= MAX_PER_THRONE) {
    throw new PhotoError("You have offered enough portraits of this throne.", 429);
  }
  if (pending.n >= MAX_PENDING) {
    throw new PhotoError("The Maesters are still reviewing your earlier portraits.", 429);
  }

  const [photo] = await db.insert(photos).values({
    throneId: input.throneId, uploadedBy: user.id,
    bytes: input.bytes, contentType: input.contentType, createdAt: new Date(now),
  }).returning({ id: photos.id });

  const verdict = await screenPhoto(input.bytes, input.contentType, vision);

  if (!verdict) {
    // Fail CLOSED: stays pending (invisible); human review is the backstop.
    await db.insert(reviewQueue).values({
      kind: "photo", subjectId: photo.id, userId: user.id,
      signals: [{ signal: "screen_unavailable" }], severity: "medium", createdAt: new Date(now),
    });
    return { photoId: photo.id, status: "pending" as const };
  }

  if (verdict.personDetected || verdict.nsfw) {
    const reason = verdict.nsfw ? "nsfw" : "person_detected";
    await db.update(photos).set({
      status: "rejected", rejectedReason: reason, aiVerdict: verdict,
      ...(verdict.nsfw ? { bytes: Buffer.alloc(0) } : {}), // nothing explicit is retained
    }).where(eq(photos.id, photo.id));
    await db.insert(reviewQueue).values({
      kind: "photo", subjectId: photo.id, userId: user.id,
      signals: [{ signal: "photo_rejected", reason }], severity: "high",
      aiAssessment: verdict.note, aiSeverity: "high", aiTriagedAt: new Date(now), createdAt: new Date(now),
    });
    return { photoId: photo.id, status: "rejected" as const };
  }

  await db.update(photos).set({ aiVerdict: verdict }).where(eq(photos.id, photo.id));
  await db.insert(reviewQueue).values({
    kind: "photo", subjectId: photo.id, userId: user.id,
    signals: [{ signal: "photo_pending", relevant: verdict.relevant }],
    severity: verdict.relevant ? "low" : "medium",
    aiAssessment: verdict.note, aiSeverity: verdict.relevant ? "low" : "medium",
    aiTriagedAt: new Date(now), createdAt: new Date(now),
  });
  return { photoId: photo.id, status: "pending" as const };
}
```

`src/app/api/photos/route.ts`:

```ts
import { NextResponse } from "next/server";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { PhotoError, submitPhoto } from "@/lib/server/photos";
import { sessionInfo } from "@/lib/server/session";
import { enforceHardCeiling, RateLimitError } from "@/lib/server/signals";
import { requireGoodStanding, StandingError } from "@/lib/server/standing";

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const throneId = form?.get("throneId");
  if (!form || !(file instanceof File) || typeof throneId !== "string") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    await requireAgeGate(info.user.googleSubject);
    requireGoodStanding(info.user);
    await enforceHardCeiling(info.user.id);
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await submitPhoto(info.user, { throneId, bytes, contentType: file.type });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof StandingError) return NextResponse.json({ error: e.code, until: e.until ?? null }, { status: e.status });
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof PhotoError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4 (Claude): verify + commit** — `git commit -m "feat: photo uploads — validation, vision gate, fail-closed pipeline"`

---

### Task 4: Serving + listings + realm photoCount

**Files:** create `src/app/api/photos/[id]/route.ts`, `src/app/api/thrones/[id]/photos/route.ts`; modify `src/lib/server/realm.ts`, `src/lib/api.ts` (ThroneDTO); test `src/test/photo-serving.test.ts`.

- [ ] **Step 1: Failing tests** — `src/test/photo-serving.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { photos } from "@/db/schema";
import { realmPayload } from "@/lib/server/realm";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { GET as photoGET } from "@/app/api/photos/[id]/route";
import { GET as throneListGET } from "@/app/api/thrones/[id]/photos/route";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

async function makePhoto(throneId: string, uploadedBy: string, status: "pending" | "approved" | "rejected") {
  const [p] = await db.insert(photos).values({
    throneId, uploadedBy, bytes: JPEG, contentType: "image/jpeg", status,
  }).returning();
  return p;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("photo serving authz", () => {
  beforeEach(resetDb);

  it("anonymous: approved streams, pending 404s", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const approved = await makePhoto(throne.id, owner.id, "approved");
    const pending = await makePhoto(throne.id, owner.id, "pending");

    const ok = await photoGET(new Request("http://t"), params(approved.id));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect((await photoGET(new Request("http://t"), params(pending.id))).status).toBe(404);
  });

  it("uploader sees own pending; strangers don't; moderator sees everything", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const pending = await makePhoto(throne.id, owner.id, "pending");

    vi.mocked(auth).mockResolvedValue({ googleSubject: owner.googleSubject } as never);
    expect((await photoGET(new Request("http://t"), params(pending.id))).status).toBe(200);

    const rando = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: rando.googleSubject } as never);
    expect((await photoGET(new Request("http://t"), params(pending.id))).status).toBe(404);

    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    expect((await photoGET(new Request("http://t"), params(pending.id))).status).toBe(200);
  });

  it("throne listing: approved for all, own photos included for the uploader", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    await makePhoto(throne.id, owner.id, "approved");
    await makePhoto(throne.id, owner.id, "pending");

    vi.mocked(auth).mockResolvedValue(null as never);
    const anon = await (await throneListGET(new Request("http://t"), params(throne.id))).json();
    expect(anon.photos).toHaveLength(1);

    vi.mocked(auth).mockResolvedValue({ googleSubject: owner.googleSubject } as never);
    const mine = await (await throneListGET(new Request("http://t"), params(throne.id))).json();
    expect(mine.photos).toHaveLength(2);
    expect(mine.photos.some((p: { mine: boolean; status: string }) => p.mine && p.status === "pending")).toBe(true);
  });

  it("realm throne DTO counts only approved photos", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    await makePhoto(throne.id, owner.id, "approved");
    await makePhoto(throne.id, owner.id, "pending");
    const realm = await realmPayload();
    expect(realm.thrones.find((t) => t.id === throne.id)!.photoCount).toBe(1);
  });
});
```

- [ ] **Step 2 (Claude): verify fail.**

- [ ] **Step 3: Implement.**

`src/app/api/photos/[id]/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { photos } from "@/db/schema";
import { sessionInfo } from "@/lib/server/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = await db.query.photos.findFirst({ where: eq(photos.id, id) });
  if (!photo || photo.bytes.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (photo.status !== "approved") {
    const info = await sessionInfo();
    const allowed = info.kind === "user" &&
      (info.user.role === "moderator" || info.user.id === photo.uploadedBy);
    if (!allowed) return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(photo.bytes), {
    status: 200,
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": photo.status === "approved" ? "public, max-age=3600" : "private, no-store",
    },
  });
}
```

`src/app/api/thrones/[id]/photos/route.ts`:

```ts
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { photos } from "@/db/schema";
import { sessionInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const info = await sessionInfo();
  const viewerId = info.kind === "user" ? info.user.id : null;

  const rows = await db.select({
    id: photos.id, status: photos.status, uploadedBy: photos.uploadedBy,
    rejectedReason: photos.rejectedReason, createdAt: photos.createdAt,
  }).from(photos).where(eq(photos.throneId, id)).orderBy(desc(photos.createdAt));

  const visible = rows.filter((p) => p.status === "approved" || (viewerId && p.uploadedBy === viewerId));
  return NextResponse.json({
    photos: visible.map((p) => ({
      id: p.id, status: p.status, mine: viewerId === p.uploadedBy,
      rejectedReason: viewerId === p.uploadedBy ? p.rejectedReason : null,
      createdAt: p.createdAt.getTime(),
    })),
  });
}
```

`src/lib/server/realm.ts` — add to the `Promise.all` (merge `sql`, `photos` into imports):

```ts
db.select({ throneId: photos.throneId, n: sql<number>`count(*)::int` })
  .from(photos).where(eq(photos.status, "approved")).groupBy(photos.throneId),
```

name the result `photoCounts`, then:

```ts
const photoCountByThrone = new Map(photoCounts.map((p) => [p.throneId, p.n]));
// in throneDtos:
photoCount: photoCountByThrone.get(t.id) ?? 0,
```

`src/lib/api.ts` — `ThroneDTO` gains `photoCount: number`.

- [ ] **Step 4 (Claude): verify + commit** — `git commit -m "feat: photo serving with status authz; realm photoCount"`

---

### Task 5: Moderate actions + reports-on-photos + review surfacing

**Files:** modify `src/lib/server/photos.ts` (approve/reject), `src/app/api/moderate/route.ts`, `src/lib/server/reports.ts`, `src/app/api/report/route.ts` (zod enum), `src/lib/server/review.ts`; test `src/test/photo-moderation.test.ts`.

- [ ] **Step 1: Failing tests** — `src/test/photo-moderation.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { photos, reviewQueue } from "@/db/schema";
import { submitReport } from "@/lib/server/reports";
import { listReview } from "@/lib/server/review";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as moderatePOST } from "@/app/api/moderate/route";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function post(body: unknown) {
  return new Request("http://test/api/moderate", { method: "POST", body: JSON.stringify(body) });
}

describe("photo moderation", () => {
  beforeEach(resetDb);

  it("approve_photo flips status, stamps reviewer, auto-resolves", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const [photo] = await db.insert(photos).values({
      throneId: throne.id, uploadedBy: owner.id, bytes: JPEG, contentType: "image/jpeg",
    }).returning();
    const [q] = await db.insert(reviewQueue).values({
      kind: "photo", subjectId: photo.id, userId: owner.id,
      signals: [{ signal: "photo_pending", relevant: true }], severity: "low",
    }).returning();

    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    const res = await moderatePOST(post({ action: "approve_photo", subjectId: photo.id, reviewId: q.id }));
    expect(res.status).toBe(200);

    const [p] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(p.status).toBe("approved");
    expect(p.reviewedBy).toBe(mod.id);
    const [resolved] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, q.id));
    expect(resolved.status).toBe("resolved");
  });

  it("reject_photo keeps bytes and records the reason", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const [photo] = await db.insert(photos).values({
      throneId: throne.id, uploadedBy: owner.id, bytes: JPEG, contentType: "image/jpeg",
    }).returning();
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    await moderatePOST(post({ action: "reject_photo", subjectId: photo.id, note: "not a restroom" }));
    const [p] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(p.status).toBe("rejected");
    expect(p.rejectedReason).toBe("not a restroom");
    expect(p.bytes.length).toBeGreaterThan(0);
  });

  it("approved photos are reportable (queue row → uploader); pending are not", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const [photo] = await db.insert(photos).values({
      throneId: throne.id, uploadedBy: owner.id, bytes: JPEG, contentType: "image/jpeg", status: "approved",
    }).returning();
    const reporter = await makeUser();
    await submitReport(reporter, { subjectKind: "photo", subjectId: photo.id, reason: "inappropriate" });
    const [q] = await db.select().from(reviewQueue);
    expect(q.kind).toBe("report");
    expect(q.userId).toBe(owner.id);

    const [pending] = await db.insert(photos).values({
      throneId: throne.id, uploadedBy: owner.id, bytes: JPEG, contentType: "image/jpeg",
    }).returning();
    await expect(
      submitReport(reporter, { subjectKind: "photo", subjectId: pending.id, reason: "spam" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("listReview surfaces photo rows with subjectKind photo", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const [photo] = await db.insert(photos).values({
      throneId: throne.id, uploadedBy: owner.id, bytes: JPEG, contentType: "image/jpeg",
    }).returning();
    await db.insert(reviewQueue).values({
      kind: "photo", subjectId: photo.id, userId: owner.id,
      signals: [{ signal: "photo_pending", relevant: true }], severity: "low",
    });
    const items = await listReview();
    expect(items[0].subjectKind).toBe("photo");
    expect(items[0].subject).toContain(throne.name);
  });
});
```

- [ ] **Step 2 (Claude): verify fail.**

- [ ] **Step 3: Implement.**

`src/lib/server/photos.ts` — append:

```ts
export async function approvePhoto(photoId: string, moderator: UserRow, now = Date.now()) {
  const photo = await db.query.photos.findFirst({ where: eq(photos.id, photoId) });
  if (!photo) throw new PhotoError("no such photo", 404);
  if (photo.status === "approved") throw new PhotoError("already approved", 409);
  const [updated] = await db.update(photos).set({
    status: "approved", rejectedReason: null, reviewedBy: moderator.id, reviewedAt: new Date(now),
  }).where(eq(photos.id, photoId)).returning({ id: photos.id, status: photos.status });
  return updated;
}

export async function rejectPhoto(photoId: string, moderator: UserRow, note?: string, now = Date.now()) {
  const photo = await db.query.photos.findFirst({ where: eq(photos.id, photoId) });
  if (!photo) throw new PhotoError("no such photo", 404);
  if (photo.status === "rejected") throw new PhotoError("already rejected", 409);
  const [updated] = await db.update(photos).set({
    status: "rejected", rejectedReason: note?.trim() || "rejected by moderator",
    reviewedBy: moderator.id, reviewedAt: new Date(now),
  }).where(eq(photos.id, photoId)).returning({ id: photos.id, status: photos.status });
  return updated;
}
```

`src/app/api/moderate/route.ts` — action enum += `"approve_photo", "reject_photo"`; switch cases:

```ts
case "approve_photo": await approvePhoto(subjectId, mod); break;
case "reject_photo": await rejectPhoto(subjectId, mod, note); break;
```

with `PhotoError` in the catch chain (same shape as `EnforcementError`).

`src/lib/server/reports.ts` — `SubmitReportInput.subjectKind` becomes `"throne" | "rating" | "photo"`; subject validation gains:

```ts
} else if (input.subjectKind === "photo") {
  const p = await db.query.photos.findFirst({ where: eq(photos.id, input.subjectId) });
  if (!p || p.status !== "approved") throw new ReportError("no such photo", 404);
  authorId = p.uploadedBy;
}
```

`src/app/api/report/route.ts` — zod `subjectKind: z.enum(["throne", "rating", "photo"])`.

`src/lib/server/review.ts` — `subjectSummary` gains a photo branch (FIRST, before the rating branch):

```ts
if (row.kind === "photo" || (row.kind === "report" && await db.query.photos.findFirst({ where: eq(photos.id, row.subjectId) }))) {
  const photo = await db.query.photos.findFirst({ where: eq(photos.id, row.subjectId) });
  if (photo) {
    const throne = await db.query.thrones.findFirst({ where: eq(thrones.id, photo.throneId) });
    const base = `Photo (${photo.status}) at "${throne?.name ?? "?"}"`;
    return row.kind === "report" ? `Reported: ${base}` : base;
  }
  return "Photo (missing)";
}
```

and `listReview`'s `subjectKind` mapping resolves `"photo"` for kind `photo`, and for `report` rows whose subject matches a photo (check photos before ratings).

- [ ] **Step 4 (Claude): verify + full suite + commit** — `git commit -m "feat: photo approve/reject moderation + photos reportable"`

---

### Task 6: Client — Offer a Portrait + moderation rendering

**Files:** modify `src/components/ThroneSheet.tsx`, `src/components/ReportModal.tsx` (prop union), `src/components/ModerationQueue.tsx`, `src/lib/api.ts`. **Codex: read the components before editing.**

- [ ] **Step 1: api helpers** — `src/lib/api.ts`:

```ts
listPhotos: (throneId: string) =>
  request<{ photos: { id: string; status: "pending" | "approved" | "rejected"; mine: boolean; rejectedReason: string | null; createdAt: number }[] }>(
    `/api/thrones/${throneId}/photos`
  ),
uploadPhoto: async (throneId: string, file: File) => {
  const form = new FormData();
  form.set("file", file);
  form.set("throneId", throneId);
  const res = await fetch("/api/photos", { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<{ photoId: string; status: "pending" | "rejected" }>;
},
```

- [ ] **Step 2: ThroneSheet "Offer a Portrait" section.** Below the recent-testimony block: load `api.listPhotos(throne.id)` in a `useEffect` keyed on `throne.id`. Approved photos render as a small gallery (`<img src={"/api/photos/" + p.id} alt="Throne portrait" className="pixel-panel-flat h-24 w-24 object-cover" />`); the uploader's own pending/rejected entries show a status chip ("awaits the Maesters' review" / "refused"). For ready users, a file input (accept="image/jpeg,image/png,image/webp") with the policy copy verbatim: *"Entrances, signage, and sinks only. No people — any face means rejection."* On upload → `api.uploadPhoto`; `status === "rejected"` → "The Maesters have refused this portrait."; else "This portrait awaits the Maesters' review."; then refresh the list. Approved photos get a small Report affordance reusing `ReportModal` — widen the modal's `subjectKind` prop and ThroneSheet's `reporting` state to include `"photo"`.

- [ ] **Step 3: ModerationQueue photo rows.** When `item.subjectKind === "photo"`: render the image inline above the actions — `<img src={"/api/photos/" + item.subjectId} alt="Portrait under review" className="pixel-panel-flat mt-2 max-h-64 w-auto" />` (the moderator path serves pending/rejected bytes; add an `onError` hide) — and the content-action buttons become **Approve photo** (`approve_photo`) / **Reject photo** (`reject_photo`) via the existing `moderate()` helper. Suspend/Ban/Resolve/Ask-again unchanged.

- [ ] **Step 4 (Codex): typecheck** — `npx.cmd tsc --noEmit`.
- [ ] **Step 5 (Claude): commit** — `git commit -m "feat: client — offer-a-portrait uploads, photo gallery, photo moderation"`

---

### Task 7: Docs + verify gate + deploy + wrap-up

- [ ] **Step 1: Docs.** ROADMAP: check the photo-pipeline and photo-policy-copy boxes (note EXIF stripping = pre-native TODO; the zero-tolerance ban lever exists via Cycle A). README: photo pipeline bullet (bytea + fail-closed + human-approval-before-public). Refresh `HANDOFF.md`: Phase 1 engineering complete; legal/trademark remains (external); next: Phase 2 UI gaps.
- [ ] **Step 2 (Claude): gates.** `npm test`, `npm run build`, browser pass: upload a compliant photo (pending, publicly invisible) → approve on `/moderation` → visible in the gallery; upload a photo with a person → auto-rejected. Commit, push (pre-authorized), verify prod.
- [ ] **Step 3 (Claude): memory.** Update project memory: Phase 1 engineering complete, bytea decision, fail-open (testimony) vs fail-closed (photos) asymmetry, remaining item = legal/trademark (external).

---

## Self-review notes

- **Spec coverage:** schema/bytea (T1), vision fail-closed (T2), upload+caps+dispatch (T3), status-gated serving + listings + photoCount (T4), approve/reject + reportable photos + queue surfacing (T5), client (T6), docs/verify/deploy/memory (T7).
- **Type consistency:** `VisionClient`/`VisionVerdict` defined T2, consumed T3; `PhotoError` statuses match route mappings (T3/T5); `photoCount` in both realm and `ThroneDTO` (T4); `subjectKind` union widened consistently (T1/T5/T6).
- **Deliberate asymmetry:** testimony fails OPEN, photos fail CLOSED — commented in code and spec.
