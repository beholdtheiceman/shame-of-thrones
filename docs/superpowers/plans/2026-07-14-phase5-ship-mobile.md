# Phase 5 — Ship Mobile: Guardrails + Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the code/config guardrails and the owner runbook that make the Phase 4 mobile app safe to ship to production.

**Architecture:** Add a loud-failure env preflight (a `/api/health` route + a fail-fast in the native-auth sign path), make the mobile app EAS-build-ready with placeholder config, remove a lockfile that confuses Vercel's monorepo install, and write the exact owner runbook. All changes land on `feat/phase5-ship-mobile` (off `feat/phase4-foundation`). Production cutover (WS3) and device QA (WS4) are owner-gated and handled interactively, not in this plan.

**Tech Stack:** Next.js (App Router) under `apps/web`, Vitest, `jose` (HS256 JWT), `google-auth-library`, Expo/EAS, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-14-phase5-ship-mobile-design.md`

---

## File Structure

- `apps/web/src/app/api/health/route.ts` — **new** GET route reporting presence (boolean only) of required env vars.
- `apps/web/src/app/api/health/route.test.ts` — **new** test for the health route.
- `apps/web/src/app/api/auth/native/route.ts` — **modify** to fail-fast (500) when `NATIVE_JWT_SECRET` or `GOOGLE_NATIVE_CLIENT_IDS` are absent, instead of signing with the literal string `"undefined"`.
- `apps/web/src/app/api/auth/native/route.test.ts` — **modify** to cover the two new 500 cases.
- `apps/web/package-lock.json` — **delete** (stale duplicate of the root lockfile).
- `apps/mobile/eas.json` — **new** EAS build profiles.
- `apps/mobile/app.json` — **modify** to add bundle identifiers, `scheme`, `extra.eas.projectId` placeholder, google-signin plugin.
- `docs/phase5-owner-runbook.md` — **new** owner runbook.

---

## Task 1: Remove the stale web lockfile and re-prove the build

**Files:**
- Delete: `apps/web/package-lock.json`

- [ ] **Step 1: Confirm the duplicate exists and root lockfile is authoritative**

Run: `ls apps/web/package-lock.json package-lock.json`
Expected: both exist. The root `package-lock.json` is the workspace lockfile; the `apps/web` one is a stale leftover that makes Vercel warn about multiple lockfiles.

- [ ] **Step 2: Delete the stale lockfile**

```bash
git rm apps/web/package-lock.json
```

- [ ] **Step 3: Re-resolve from the root lockfile and prove the workspace still installs**

Run: `npm install`
Expected: completes with no error; `apps/web` workspace resolves `@sot/core`. `git status` should show no unexpected changes to the root `package-lock.json` beyond normal (ideally none).

- [ ] **Step 4: Prove the web app still builds**

Run: `npm run build:web`
Expected: `next build` completes successfully (exit 0). If it requires a DB URL for build-time evaluation, set a throwaway one: `DATABASE_URL=postgres://x:x@localhost:5432/x npm run build:web` — the build must not error on missing config.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(phase5): drop stale apps/web lockfile; build proven from root workspace"
```

---

## Task 2: Fail-fast in the native-auth sign path

The route currently signs with `process.env.NATIVE_JWT_SECRET` unguarded; when unset, `TextEncoder().encode(undefined)` signs with the literal key `"undefined"` (a known weak key), and an empty `GOOGLE_NATIVE_CLIENT_IDS` makes every token verification fail with a misleading 401. Both should return a clear 500 so a misconfigured deploy is obvious.

**Files:**
- Modify: `apps/web/src/app/api/auth/native/route.ts`
- Test: `apps/web/src/app/api/auth/native/route.test.ts`

- [ ] **Step 1: Write the failing tests**

First guard the existing happy path against the new precondition: the mocked-`verifyIdToken` tests never needed `GOOGLE_NATIVE_CLIENT_IDS`, but the new guard checks `audiences().length`. Add a `beforeEach` (or extend the existing one) so the happy path stays green:

```typescript
  beforeEach(() => {
    verifyIdToken.mockReset();
    process.env.NATIVE_JWT_SECRET ??= "test-native-secret";
    process.env.GOOGLE_NATIVE_CLIENT_IDS ??= "test-web-client-id";
  });
```

Then add these cases inside the existing `describe("POST /api/auth/native", …)` block in `apps/web/src/app/api/auth/native/route.test.ts`:

```typescript
  it("returns 500 when NATIVE_JWT_SECRET is unset", async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "s" }) });
    const prev = process.env.NATIVE_JWT_SECRET;
    delete process.env.NATIVE_JWT_SECRET;
    try {
      expect((await post({ idToken: "good" })).status).toBe(500);
    } finally {
      process.env.NATIVE_JWT_SECRET = prev;
    }
  });

  it("returns 500 when GOOGLE_NATIVE_CLIENT_IDS is unset", async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "s" }) });
    const prev = process.env.GOOGLE_NATIVE_CLIENT_IDS;
    delete process.env.GOOGLE_NATIVE_CLIENT_IDS;
    try {
      expect((await post({ idToken: "good" })).status).toBe(500);
    } finally {
      process.env.GOOGLE_NATIVE_CLIENT_IDS = prev;
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace apps/web -- route.test --run`
Expected: the two new cases FAIL (route currently returns 200 / 401, not 500).

- [ ] **Step 3: Add the guard at the top of `POST`**

In `apps/web/src/app/api/auth/native/route.ts`, immediately inside `export async function POST(req: Request) {`, before reading the body, add:

```typescript
  if (!process.env.NATIVE_JWT_SECRET || audiences().length === 0) {
    return NextResponse.json(
      { error: "native auth not configured" },
      { status: 500 },
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace apps/web -- route.test --run`
Expected: all cases in the file PASS (the existing 200/401/400 cases still pass because the test env sets `NATIVE_JWT_SECRET` and the new cases delete/restore the vars).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/auth/native/route.ts apps/web/src/app/api/auth/native/route.test.ts
git commit -m "fix(phase5): native-auth returns 500 (not weak-key 200/misleading 401) when unconfigured"
```

---

## Task 3: `/api/health` env-preflight route

**Files:**
- Create: `apps/web/src/app/api/health/route.ts`
- Test: `apps/web/src/app/api/health/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/api/health/route.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

async function get() {
  const { GET } = await import("./route");
  return GET();
}

describe("GET /api/health", () => {
  it("reports env presence as booleans and never leaks values", async () => {
    process.env.NATIVE_JWT_SECRET = "super-secret-value";
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.env.NATIVE_JWT_SECRET).toBe(true);
    // must not echo the actual secret anywhere in the payload
    expect(JSON.stringify(body)).not.toContain("super-secret-value");
  });

  it("marks a missing var as false", async () => {
    delete process.env.GOOGLE_NATIVE_CLIENT_IDS;
    const body = await (await get()).json();
    expect(body.env.GOOGLE_NATIVE_CLIENT_IDS).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace apps/web -- health --run`
Expected: FAIL with a module-not-found / no export `GET` error.

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/health/route.ts`:

```typescript
import { NextResponse } from "next/server";

// Reports only the PRESENCE of each required server env var (boolean), never the
// value. Lets a deploy be verified at a glance without leaking secrets.
const REQUIRED = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "NATIVE_JWT_SECRET",
  "GOOGLE_NATIVE_CLIENT_IDS",
] as const;

export function GET() {
  const env = Object.fromEntries(
    REQUIRED.map((k) => [k, Boolean(process.env[k])]),
  );
  const ok = Object.values(env).every(Boolean);
  return NextResponse.json({ ok, env }, { status: 200 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace apps/web -- health --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/health/route.ts apps/web/src/app/api/health/route.test.ts
git commit -m "feat(phase5): /api/health reports required-env presence (booleans, no values)"
```

---

## Task 4: Mobile EAS build-readiness config

Values the owner supplies later are left as clearly-marked placeholders. This task only makes the app *structurally* build-ready.

**Files:**
- Create: `apps/mobile/eas.json`
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Create `apps/mobile/eas.json`**

```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {}
  },
  "submit": {
    "production": {}
  }
}
```

- [ ] **Step 2: Update `apps/mobile/app.json`**

Replace the file with this (adds `scheme`, `ios.bundleIdentifier`, `android.package`, `extra.eas.projectId` placeholder, and the google-signin plugin; keeps the existing Mapbox + notifications plugins and icon config):

```json
{
  "expo": {
    "name": "mobile",
    "slug": "mobile",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "scheme": "shameofthrones",
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.beholdtheiceman.shameofthrones"
    },
    "android": {
      "package": "com.beholdtheiceman.shameofthrones",
      "adaptiveIcon": {
        "backgroundColor": "#E6F4FE",
        "foregroundImage": "./assets/android-icon-foreground.png",
        "backgroundImage": "./assets/android-icon-background.png",
        "monochromeImage": "./assets/android-icon-monochrome.png"
      },
      "predictiveBackGestureEnabled": false
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "plugins": [
      [
        "@rnmapbox/maps",
        {
          "RNMapboxMapsDownloadToken": "REPLACE_WITH_MAPBOX_SECRET_DOWNLOAD_TOKEN"
        }
      ],
      [
        "@react-native-google-signin/google-signin",
        {
          "iosUrlScheme": "REPLACE_WITH_IOS_GOOGLE_REVERSED_CLIENT_ID"
        }
      ],
      "expo-notifications"
    ],
    "extra": {
      "eas": {
        "projectId": "REPLACE_WITH_EAS_PROJECT_ID"
      }
    }
  }
}
```

- [ ] **Step 3: Verify both files are valid JSON and app.json config resolves**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/mobile/eas.json','utf8')); JSON.parse(require('fs').readFileSync('apps/mobile/app.json','utf8')); console.log('json ok')"`
Expected: prints `json ok`.

Then confirm the app config still resolves (the google-signin plugin must be an installed dependency; if `npx expo config` reports the plugin package is missing, add `@react-native-google-signin/google-signin` to `apps/mobile/package.json` dependencies and re-run `npm install`):

Run: `cd apps/mobile && npx expo config --type public >/dev/null && echo "expo config ok"; cd -`
Expected: prints `expo config ok` (network may be required; if the CLI cannot run offline, skip this sub-step and rely on the JSON validity check — note it in the commit).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/eas.json apps/mobile/app.json apps/mobile/package.json
git commit -m "feat(phase5): mobile EAS build-readiness (eas.json, bundle ids, scheme, google-signin, projectId placeholder)"
```

---

## Task 5: Owner runbook

**Files:**
- Create: `docs/phase5-owner-runbook.md`

- [ ] **Step 1: Write the runbook**

Create `docs/phase5-owner-runbook.md` with the exact, ordered steps below. Fill every `REPLACE_WITH_…` placeholder in the mobile config with the real value as you go.

````markdown
# Phase 5 — Owner Runbook (ship mobile to production)

Do these in order. Each maps to a placeholder in code or a Vercel/Neon setting.
Nothing here is reversible-blind; the prod cutover (last section) is gated on your OK.

## 1. Google Cloud OAuth clients
In Google Cloud Console → APIs & Services → Credentials, create THREE OAuth client IDs
for the same project:
- **Web application** — this client's ID is the *audience* the backend validates.
- **iOS** — bundle id `com.beholdtheiceman.shameofthrones`.
- **Android** — package `com.beholdtheiceman.shameofthrones` + your signing SHA-1.

Then:
- Vercel env `GOOGLE_NATIVE_CLIENT_IDS` = the **Web** client ID (add the iOS/Android
  client IDs too, comma-separated, if the mobile lib sends them as audience).
- Mobile: set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
  in the mobile build env (EAS secrets or `.env`).
- From the **iOS** client, copy the *reversed client ID* into `app.json` →
  google-signin `iosUrlScheme` (replaces `REPLACE_WITH_IOS_GOOGLE_REVERSED_CLIENT_ID`).

## 2. NATIVE_JWT_SECRET
Generate a strong secret: `openssl rand -base64 48`.
Add it as Vercel env `NATIVE_JWT_SECRET` for **Production** and any **Preview** the app
targets. (Without it, `/api/auth/native` now returns 500 by design.)

## 3. Mapbox tokens
- **Secret (downloads) token** with the `DOWNLOADS:READ` scope → `app.json`
  `RNMapboxMapsDownloadToken` (replaces `REPLACE_WITH_MAPBOX_SECRET_DOWNLOAD_TOKEN`).
- **Public token** → mobile build env `EXPO_PUBLIC_MAPBOX_TOKEN`.

## 4. Expo / EAS
- `cd apps/mobile && eas init` → copies the project id into `app.json`
  `extra.eas.projectId` (replaces `REPLACE_WITH_EAS_PROJECT_ID`).
- Configure push credentials: `eas credentials` → APNs key (iOS) + FCM key (Android).
- Build the dev client: `eas build --profile development --platform ios` (and/or android).

## 5. Prod Neon migration
Confirm `push_tokens` is absent in prod, then apply `0006_push-tokens`:
- Compare against the migrations in `apps/web/drizzle/` (0006 is the newest).
- Apply via the prod `DATABASE_URL` (Drizzle migrate or the SQL editor).

## 6. Production cutover (do WITH Claude, each step gated)
1. Verify `/api/health` on a `feat/phase4-foundation` preview reports every env `true`.
2. Merge `feat/phase4-foundation` (incl. `feat/phase5-ship-mobile`) → `main`.
3. Vercel → Settings → Git → Production Branch = `main`.
4. Deploy; confirm prod `/api/health` `ok: true` and the site is Ready.

## 7. Device QA (see spec WS4)
Sign-in → `/api/auth/native` → `/api/me`; map render; fief-tap guard; rating + offline
queue; push delivery.
````

- [ ] **Step 2: Commit**

```bash
git add docs/phase5-owner-runbook.md
git commit -m "docs(phase5): owner runbook for the 5 remaining ship deps + gated cutover"
```

---

## Final verification

- [ ] **Full web test suite still green**

Run: `npm run test --workspace apps/web -- --run`
Expected: all tests pass (previously 133 + the ~4 new health/native cases).

- [ ] **Typecheck clean**

Run: `npm run -s typecheck --workspace apps/web` (or `npx tsc --noEmit -p apps/web`)
Expected: no errors.

- [ ] **Core package unaffected**

Run: `npm run test --workspace packages/core -- --run`
Expected: still green (61).
