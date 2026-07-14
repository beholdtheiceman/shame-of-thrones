# Phase 4 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the repo into an npm-workspace monorepo, extract the pure-TS game logic into a shared `@sot/core` package, add a bearer-token native-auth path to the existing NextAuth backend, and scaffold an Expo app whose one screen authenticates and renders `/api/me`.

**Architecture:** `apps/web` (the existing Next.js app, moved wholesale) + `apps/mobile` (new Expo app) + `packages/core` (framework-agnostic logic consumed by both). Native auth adds a parallel `Authorization: Bearer` branch to `sessionInfo()` that verifies an app-issued JWT and converges on the same `googleSubject` identity as the web cookie flow — so no route and no web behavior changes.

**Tech Stack:** npm workspaces, TypeScript, Next.js 16, vitest, Expo (React Native, expo-router), `jose` (app JWT), `google-auth-library` (Google ID-token verification), `@react-native-google-signin/google-signin`, `expo-secure-store`.

**Spec:** `docs/superpowers/specs/2026-07-14-phase4-foundation-design.md`

---

## File Structure (created/moved/modified)

**Moved (git mv, no content change):**
- Everything currently at repo root → `apps/web/` (src, public, `*.config.*`, `package.json`, `.env*`, `drizzle.config.ts`, `vitest.config.ts`, `next.config.ts`, `eslint.config.mjs`, `tsconfig.json`, `postcss.config.*`, `next-env.d.ts`, `middleware.ts` if present).
- `apps/web/src/lib/{types,geo,data,selectors,standings,recognition,notifications,ratingQueue}.ts` + `game/rules.ts` + their `*.test.ts` → `packages/core/src/`.

**Created:**
- `package.json` (workspace root), `tsconfig.base.json`
- `packages/core/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/dto.ts}`
- `apps/web/src/app/api/auth/native/route.ts` + `.../route.test.ts`
- `apps/mobile/` (Expo app: `App.tsx`, `metro.config.js`, `app.json`, `package.json`, `lib/api.ts`, `lib/auth.ts`, `lib/config.ts`)

**Modified:**
- `apps/web/src/lib/server/session.ts` — bearer branch
- `apps/web/src/lib/api.ts` — import DTOs from `@sot/core`, re-export for existing web imports
- ~25 web files: `@/lib/{selectors,standings,…}` → `@sot/core`
- `apps/web/tsconfig.json`, `apps/web/vitest.config.ts` — add `@sot/core` alias
- `apps/web/.env.example`, `.env.test` — add `NATIVE_JWT_SECRET`, `GOOGLE_NATIVE_CLIENT_IDS`

**Naming note:** the shared package is `@sot/core`; the app JWT claim is `googleSubject`; the app JWT secret env is `NATIVE_JWT_SECRET`; the accepted Google audiences env is `GOOGLE_NATIVE_CLIENT_IDS` (comma-separated). These names are used identically in every task below.

---

## Task 1: Workspace root + move the web app into `apps/web`

Mechanical move. The regression gate is: the existing suite and build stay green from inside `apps/web`.

**Files:**
- Create: `package.json` (root), `tsconfig.base.json`
- Move: all root project files → `apps/web/`

- [ ] **Step 1: Create the workspace root `package.json`**

```json
{
  "name": "shame-of-thrones-monorepo",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build:web": "npm run build --workspace apps/web"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json` at the root**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "strict": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 3: Move every existing project file into `apps/web/`**

Use `git mv` so history is preserved. From the repo root (Git Bash):

```bash
mkdir -p apps/web
git mv src public package.json package-lock.json tsconfig.json next.config.ts \
  drizzle.config.ts vitest.config.ts eslint.config.mjs postcss.config.mjs \
  next-env.d.ts .env.example .env.test .env.local apps/web/ 2>/dev/null || true
# Move any remaining tracked root config not caught above (verify with: git status)
```

Do **not** move `docs/`, `.git/`, `.gitignore`, `HANDOFF.md`, `SHAME_OF_THRONES_PRD.md`, or the new root `package.json`/`tsconfig.base.json`. Confirm with `git status` that only intended files moved.

- [ ] **Step 4: Point `apps/web/tsconfig.json` at the base config**

Edit `apps/web/tsconfig.json` — add `"extends": "../../tsconfig.base.json"` as the first key. Leave its `paths` (`@/*` → `./src/*`), `plugins`, `include`, `exclude` as-is.

- [ ] **Step 5: Install from the root and verify the web suite + build**

```bash
npm install
npm run test --workspace apps/web
npm run build --workspace apps/web
```

Expected: install succeeds (hoisted `node_modules` at root); all existing tests PASS against the `.env.test` Neon branch; `next build` clean. If Neon env is missing locally, the DB tests are the same ones that already run today — no new failures should appear from the move alone.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(phase4): move web app into apps/web, add npm workspace root"
```

---

## Task 2: Extract `packages/core` and rewire web imports

Move the pure modules + tests, add a core vitest config, extract the DTOs, then repoint web imports. Regression gate: core tests green in their new home, web tests + build still green.

**Files:**
- Create: `packages/core/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/dto.ts}`
- Move: pure modules + tests from `apps/web/src/lib` → `packages/core/src`
- Modify: `apps/web/src/lib/api.ts`, `apps/web/tsconfig.json`, `apps/web/vitest.config.ts`, ~25 importing files

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@sot/core",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": { "h3-js": "^4.5.0" },
  "devDependencies": { "vitest": "^4.1.10", "typescript": "^5" }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "jsx": "react-jsx" },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/core/vitest.config.ts` (pure, no DB, no `.env`)**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 4: Move the pure modules and their tests into `packages/core/src`**

```bash
mkdir -p packages/core/src/game
cd apps/web/src/lib
git mv types.ts geo.ts data.ts selectors.ts standings.ts recognition.ts \
  notifications.ts ratingQueue.ts \
  selectors.test.ts standings.test.ts recognition.test.ts \
  notifications.test.ts ratingQueue.test.ts \
  ../../../../packages/core/src/
git mv game/rules.ts ../../../../packages/core/src/game/rules.ts
cd ../../../../
```

The modules' **internal** relative imports (`./data`, `./selectors`, `./standings`, `./game/rules`, `./types`, `./geo`) are unchanged — they still resolve inside `packages/core/src`. `copy.test.ts` stays in web (it tests `copy.tsx`, which stays in web).

- [ ] **Step 5: Extract the DTO interfaces into `packages/core/src/dto.ts`**

Cut the interface declarations from `apps/web/src/lib/api.ts` (`NotifyPrefsDTO`, `NotificationDTO`, `NotificationsDTO`, `ThroneDTO`, `RealmDTO`, `MeDTO`, `StandingsDTO`) into a new `packages/core/src/dto.ts`. Change their type imports to be relative-within-core:

```ts
// packages/core/src/dto.ts
import type { FiefControl, RankInfo } from "./selectors";
import type { CouncilRow, HouseStandingRow, WindowKey } from "./standings";
import type { Amenities, HouseId, LedgerEntry, Rating, ThroneCategory } from "./types";

export interface NotifyPrefsDTO { contested: boolean; banner_fallen: boolean; season_start: boolean; }
// ... (paste the remaining interfaces verbatim from api.ts, unchanged) ...
```

- [ ] **Step 6: Create the core barrel `packages/core/src/index.ts`**

```ts
export * from "./types";
export * from "./geo";
export * from "./data";
export * from "./selectors";
export * from "./game/rules";
export * from "./standings";
export * from "./recognition";
export * from "./notifications";
export * from "./ratingQueue";
export * from "./dto";
```

If two modules export a colliding name, prefer explicit re-exports over `*` for the colliding module (resolve per the tsc error; do not rename source symbols).

- [ ] **Step 7: Add the `@sot/core` alias to web's tsconfig and vitest**

In `apps/web/tsconfig.json`, extend `paths`:

```json
"paths": {
  "@/*": ["./src/*"],
  "@sot/core": ["../../packages/core/src/index.ts"]
}
```

In `apps/web/vitest.config.ts`, add the alias next to `@`:

```ts
resolve: {
  alias: {
    "@": path.resolve(__dirname, "src"),
    "@sot/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
  },
},
```

- [ ] **Step 8: Rewire web imports of the moved modules to `@sot/core`**

Repoint every `from "@/lib/selectors" | "@/lib/standings" | "@/lib/recognition" | "@/lib/notifications" | "@/lib/ratingQueue" | "@/lib/geo" | "@/lib/types" | "@/lib/data" | "@/lib/game/rules"` to `from "@sot/core"` across `apps/web/src` (~25 files; the DTO consumers of `@/lib/api` are unaffected — keep importing `@/lib/api`). Rewrite `apps/web/src/lib/api.ts` to import DTOs from `@sot/core` and re-export them so existing `@/lib/api` DTO imports keep working:

```ts
// top of apps/web/src/lib/api.ts
import type {
  MeDTO, RealmDTO, StandingsDTO, NotificationsDTO, NotifyPrefsDTO, ThroneDTO,
  HouseId, Amenities, ThroneCategory, WindowKey,
} from "@sot/core";
export type { MeDTO, RealmDTO, StandingsDTO, NotificationsDTO, NotifyPrefsDTO, ThroneDTO } from "@sot/core";
// ...rest of the file (ApiError, request(), api object) unchanged...
```

Merge duplicate type-imports as tsc directs.

- [ ] **Step 9: Run core tests, then web tests, then web build**

```bash
npm run test --workspace @sot/core
npm run test --workspace apps/web
npm run build --workspace apps/web
```

Expected: core suite PASS (fast, DB-free) — proves the extraction changed no behavior; web suite PASS against `.env.test`; `next build` clean.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(phase4): extract @sot/core (pure logic + DTOs), rewire web imports"
```

---

## Task 3: Native-auth backend — `sessionInfo` bearer branch (TDD)

**Files:**
- Modify: `apps/web/src/lib/server/session.ts`
- Test: `apps/web/src/test/session-bearer.test.ts`
- Modify: `apps/web/package.json` (+`jose`, +`google-auth-library`), `apps/web/.env.test`, `apps/web/.env.example`

- [ ] **Step 1: Add deps and the test secret**

```bash
npm install --workspace apps/web jose google-auth-library
```

Append to `apps/web/.env.test`: `NATIVE_JWT_SECRET=test-native-secret-do-not-use-in-prod`
Append to `apps/web/.env.example`: `NATIVE_JWT_SECRET=` and `GOOGLE_NATIVE_CLIENT_IDS=`

- [ ] **Step 2: Write the failing test**

`apps/web/src/test/session-bearer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

const secret = () => new TextEncoder().encode(process.env.NATIVE_JWT_SECRET);
async function bearer(googleSubject: string, opts?: { expInPast?: boolean }) {
  const t = new SignJWT({ googleSubject })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt();
  t.setExpirationTime(opts?.expInPast ? Math.floor(Date.now() / 1000) - 60 : "30d");
  return t.sign(secret());
}

async function loadSessionInfoWith(authHeader: string | null) {
  vi.resetModules();
  vi.doMock("next/headers", () => ({
    headers: async () => new Headers(authHeader ? { authorization: authHeader } : {}),
  }));
  vi.doMock("@/auth", () => ({ auth: async () => null }));
  return (await import("@/lib/server/session")).sessionInfo;
}

describe("sessionInfo bearer branch", () => {
  it("resolves a valid bearer to the matching user", async () => {
    const { seedUser } = await import("./fixtures");
    const sub = "google-sub-bearer-1";
    await seedUser({ googleSubject: sub });
    const sessionInfo = await loadSessionInfoWith(`Bearer ${await bearer(sub)}`);
    expect((await sessionInfo()).kind).toBe("user");
  });

  it("falls through to anonymous on an expired bearer", async () => {
    const sessionInfo = await loadSessionInfoWith(`Bearer ${await bearer("x", { expInPast: true })}`);
    expect((await sessionInfo()).kind).toBe("anonymous");
  });

  it("falls through to anonymous on a tampered bearer", async () => {
    const sessionInfo = await loadSessionInfoWith(`Bearer ${(await bearer("x")).slice(0, -3)}aaa`);
    expect((await sessionInfo()).kind).toBe("anonymous");
  });
});
```

Adjust the `seedUser` import/signature to match `apps/web/src/test/fixtures.ts`. If no `seedUser` helper exists, insert a user via `db` + `users` directly with a `googleSubject`, mirroring the existing fixtures pattern.

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd apps/web && npx vitest run src/test/session-bearer.test.ts
```

Expected: FAIL — the bearer is ignored, valid-bearer case returns `anonymous`.

- [ ] **Step 4: Implement the bearer branch in `session.ts`**

Rewrite `apps/web/src/lib/server/session.ts`:

```ts
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { jwtVerify } from "jose";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { users } from "@/db/schema";

export type SessionInfo =
  | { kind: "anonymous" }
  | { kind: "no_profile"; googleSubject: string }
  | { kind: "user"; user: typeof users.$inferSelect };

async function googleSubjectFromBearer(): Promise<string | null> {
  const authz = (await headers()).get("authorization");
  if (!authz?.startsWith("Bearer ")) return null;
  const secret = process.env.NATIVE_JWT_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(authz.slice(7), new TextEncoder().encode(secret));
    return typeof payload.googleSubject === "string" ? payload.googleSubject : null;
  } catch {
    return null;
  }
}

export async function sessionInfo(): Promise<SessionInfo> {
  const sub = (await googleSubjectFromBearer()) ?? (await auth())?.googleSubject;
  if (!sub) return { kind: "anonymous" };
  const user = await db.query.users.findFirst({ where: eq(users.googleSubject, sub) });
  return user ? { kind: "user", user } : { kind: "no_profile", googleSubject: sub };
}
```

- [ ] **Step 5: Run the new test + the full web suite**

```bash
cd apps/web && npx vitest run src/test/session-bearer.test.ts
cd ../.. && npm run test --workspace apps/web
```

Expected: new test PASS; the full suite PASS (the cookie path is unchanged — every existing route still authenticates via `auth()`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(phase4): sessionInfo accepts a native bearer token (falls back to cookie)"
```

---

## Task 4: `POST /api/auth/native` endpoint (TDD)

**Files:**
- Create: `apps/web/src/app/api/auth/native/route.ts`
- Test: `apps/web/src/app/api/auth/native/route.test.ts`

- [ ] **Step 1: Write the failing test (Google verifier mocked)**

`apps/web/src/app/api/auth/native/route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { jwtVerify } from "jose";

const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class { verifyIdToken = verifyIdToken; },
}));

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/auth/native", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/auth/native", () => {
  beforeEach(() => verifyIdToken.mockReset());

  it("issues a bearer JWT carrying the Google sub on a valid idToken", async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "google-sub-99" }) });
    const res = await post({ idToken: "good" });
    expect(res.status).toBe(200);
    const { token } = await res.json();
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.NATIVE_JWT_SECRET));
    expect(payload.googleSubject).toBe("google-sub-99");
  });

  it("returns 401 when verification throws", async () => {
    verifyIdToken.mockRejectedValue(new Error("bad token"));
    expect((await post({ idToken: "bad" })).status).toBe(401);
  });

  it("returns 400 when idToken is missing", async () => {
    expect((await post({})).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && npx vitest run src/app/api/auth/native/route.test.ts
```

Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement the route**

`apps/web/src/app/api/auth/native/route.ts`:

```ts
import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { SignJWT } from "jose";

const client = new OAuth2Client();

function audiences(): string[] {
  return (process.env.GOOGLE_NATIVE_CLIENT_IDS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const idToken = body?.idToken;
  if (typeof idToken !== "string") {
    return NextResponse.json({ error: "idToken required" }, { status: 400 });
  }

  let sub: string | undefined;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: audiences() });
    sub = ticket.getPayload()?.sub;
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }
  if (!sub) return NextResponse.json({ error: "invalid token" }, { status: 401 });

  const token = await new SignJWT({ googleSubject: sub })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(process.env.NATIVE_JWT_SECRET));

  return NextResponse.json({ token });
}
```

- [ ] **Step 4: Run the test + full suite + build**

```bash
cd apps/web && npx vitest run src/app/api/auth/native/route.test.ts
cd ../.. && npm run test --workspace apps/web && npm run build --workspace apps/web
```

Expected: route test PASS; full suite PASS; `next build` clean (the new route appears in the build output).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(phase4): POST /api/auth/native verifies Google idToken, issues app bearer"
```

---

## Task 5: Expo app scaffold + monorepo Metro config

No automated tests here (RN testing deferred). Verification is: the app type-checks and Metro resolves `@sot/core`.

**Files:**
- Create: `apps/mobile/` (via Expo), `apps/mobile/metro.config.js`, `apps/mobile/tsconfig.json`

- [ ] **Step 1: Scaffold the Expo app into `apps/mobile`**

```bash
npx create-expo-app@latest apps/mobile --template blank-typescript
```

If the template creates a nested git repo or its own lockfile, remove `apps/mobile/.git` and `apps/mobile/package-lock.json` so it joins the workspace.

- [ ] **Step 2: Add the monorepo Metro config**

`apps/mobile/metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
```

- [ ] **Step 3: Add `@sot/core` as a workspace dependency of mobile**

In `apps/mobile/package.json` add `"@sot/core": "*"` to `dependencies`. Point `apps/mobile/tsconfig.json` at the base + alias:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": { "@sot/core": ["../../packages/core/src/index.ts"] }
  }
}
```

- [ ] **Step 4: Install and verify the workspace resolves core**

```bash
npm install
```

Add a temporary line `import { HOUSES } from "@sot/core";` to `apps/mobile/App.tsx`, run `cd apps/mobile && npx tsc --noEmit`, confirm it type-resolves (no "cannot find module @sot/core"), then remove the temp import.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(phase4): scaffold apps/mobile Expo app with monorepo Metro + @sot/core"
```

---

## Task 6: Mobile auth client + first authenticated screen

Wires Google sign-in → `/api/auth/native` → SecureStore bearer → `/api/me`. Verified by manual simulator smoke (documented; not automated).

**Files:**
- Create: `apps/mobile/lib/config.ts`, `apps/mobile/lib/auth.ts`, `apps/mobile/lib/api.ts`, `apps/mobile/App.tsx` (replace default)

- [ ] **Step 1: Add mobile auth deps**

```bash
npm install --workspace apps/mobile @react-native-google-signin/google-signin expo-secure-store
```

- [ ] **Step 2: Config module**

`apps/mobile/lib/config.ts`:

```ts
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://<prod-or-preview-host>";
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
```

`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` go in `apps/mobile/.env` (owner fills real values once Google Cloud client IDs exist — see spec risks 2). The `<prod-or-preview-host>` literal is the only intentional owner-provided placeholder in this plan.

- [ ] **Step 3: Auth module (Google sign-in → app bearer → SecureStore)**

`apps/mobile/lib/auth.ts`:

```ts
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
```

- [ ] **Step 4: API client (absolute base URL + bearer + shared DTOs)**

`apps/mobile/lib/api.ts`:

```ts
import type { MeDTO } from "@sot/core";
import { API_BASE_URL } from "./config";
import { getToken, signOut } from "./auth";

export async function fetchMe(): Promise<MeDTO> {
  const token = await getToken();
  const res = await fetch(`${API_BASE_URL}/api/me`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) { await signOut(); throw new Error("unauthorized"); }
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return res.json();
}
```

- [ ] **Step 5: First screen**

Replace `apps/mobile/App.tsx`:

```tsx
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
          <Text>Rank: {me.rank?.title ?? "—"}</Text>
          <Text>Streak: {me.streak ? `${me.streak.weeks}w` : "—"}</Text>
        </View>
      )}
      {signedIn && <Button title="Sign out" onPress={async () => { await signOut(); setSignedIn(false); setMe(null); }} />}
      {error && <Text style={{ color: "crimson" }}>{error}</Text>}
    </SafeAreaView>
  );
}
```

Confirm `MeDTO.rank`/`MeDTO.streak` field names against `packages/core/src/dto.ts` (rank is `RankInfo`; streak is `{ weeks; thisWeekActive }`) and adjust the display lines if the property names differ (e.g. if `RankInfo` has no `title`, show the correct field).

- [ ] **Step 6: Type-check the mobile app**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: PASS (imports of `@sot/core` and local modules resolve; DTO field access type-checks).

- [ ] **Step 7: Manual smoke (documented; run when Google client IDs + `EXPO_PUBLIC_*` env exist)**

Start the app: `cd apps/mobile && npx expo start`. On a simulator/device:
1. "Continue as Wandering Peasant" → "Load my profile" → expect a `MeDTO` with `profile: null` (anonymous) and no crash.
2. "Sign in with Google" → complete the Google flow → profile fields populate from `/api/me`. This exercises Google sign-in → `/api/auth/native` → bearer → authenticated `/api/me` end-to-end.

Record the outcome in the PR/handoff. This step is blocked on spec risks 2–3 (owner-provided Google client IDs + envs) but nothing above it is.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(phase4): mobile Google sign-in -> app bearer -> authenticated /api/me screen"
```

---

## Post-implementation (owner actions before deploy — from spec risks)

These are **not** code tasks; surface them in the PR/handoff:

1. **Vercel Root Directory → `apps/web`** — set before the next prod deploy or the deploy breaks.
2. **Google Cloud OAuth client IDs** (iOS/Android + web audience) → fill `GOOGLE_NATIVE_CLIENT_IDS` (web env) and the `EXPO_PUBLIC_GOOGLE_*` (mobile env).
3. **`NATIVE_JWT_SECRET`** — set on Vercel (prod) and any preview env the mobile app points at.

---

## Self-Review

**Spec coverage:**
- Monorepo restructure (`apps/*` + `packages/core`, npm workspaces) → Tasks 1–2. ✅
- Extract pure logic + tests + DTOs into `@sot/core` → Task 2. ✅
- Test split (core DB-free, web DB-backed) → Task 2 Step 9. ✅
- Native auth: Google ID-token → `/api/auth/native` → app bearer → `sessionInfo` bearer branch, fail-closed, converge on `googleSubject`, web unchanged → Tasks 3–4. ✅
- Expo scaffold + Metro monorepo config → Task 5. ✅
- First authenticated `/api/me` screen + SecureStore + `EXPO_PUBLIC_API_BASE_URL` → Task 6. ✅
- Added tests: sessionInfo bearer (valid/expired/tampered), `/api/auth/native` (mocked verifier: 200/401/400) → Tasks 3–4. ✅
- Owner-only deps (Vercel root dir, Google client IDs, `NATIVE_JWT_SECRET`, Metro fiddliness) → surfaced in Task 6 Step 2 / Post-implementation. ✅
- Non-goals (no product UI, no push, no Mapbox/hex, no native moderation, no staging env) → respected; no task strays into them. ✅

**Placeholder scan:** the sole intentional placeholder is `<prod-or-preview-host>` in `apps/mobile/lib/config.ts` (an owner-provided value, flagged as such). No "TBD/handle edge cases/write tests for the above" — every code step shows code.

**Type/name consistency:** `@sot/core`, `googleSubject`, `NATIVE_JWT_SECRET`, `GOOGLE_NATIVE_CLIENT_IDS`, `sessionInfo`, the `SessionInfo` union, and `MeDTO` are used identically across Tasks 2–6. The JWT is signed and verified with the same secret + `HS256` in Tasks 3 and 4.
