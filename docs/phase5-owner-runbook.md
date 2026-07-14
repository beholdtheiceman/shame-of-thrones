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
