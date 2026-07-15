# Phase 5 — Owner Runbook (ship mobile to production)

Status legend: ✅ done · 🔶 needs you (login/secret/CLI) · ⏳ gated cutover.
Last updated 2026-07-15 after Claude set up everything automatable.

## What Claude already did
- ✅ Reused the existing **web** OAuth client as the native audience.
- ✅ Created the **iOS** OAuth client (`shame-of-thrones-ios`, GCP project `personal-os`).
- ✅ Wired `app.json` `iosUrlScheme`, and `eas.json` + local `.env` with the client IDs + prod API URL.
- ✅ Set Vercel envs `GOOGLE_NATIVE_CLIENT_IDS` (web+ios) and confirmed `NATIVE_JWT_SECRET` present (both Production + Preview).
- ✅ Verified prod DB is in the clean pre-`0006` state (push_tokens absent, journal at 0005).
- ✅ Proved the monorepo builds green on Vercel and `/api/health` responds correctly.

Reference values (client IDs are public, safe to keep here):
- Web client ID: `112554886763-p6nipif6hp7gr56foio0erhre8ck8ab7.apps.googleusercontent.com`
- iOS client ID: `112554886763-sos23msr1bbntpou7ojhrrva2gn5rqg8.apps.googleusercontent.com`

## 1. 🔶 Prod Neon migration `0006` (one command)
PowerShell (your `&&` isn't supported — two lines):
```powershell
cd apps/web
npm run db:migrate
```
Applies only `0006_push-tokens` (creates the `push_tokens` table). Claude verified prod
is in the exact clean state for this; the auto-mode safety guard blocked Claude from
running it, so it's yours.

## 2. 🔶 Mapbox tokens (needs your Mapbox account)
- **Public token** (`pk.*`) → set as Vercel/EAS build env `EXPO_PUBLIC_MAPBOX_TOKEN`
  and in `apps/mobile/eas.json` (currently `REPLACE_WITH_MAPBOX_PUBLIC_TOKEN`) + local `.env`.
- **Secret download token** (`sk.*`, scope `DOWNLOADS:READ`) → `app.json`
  `RNMapboxMapsDownloadToken` (currently `REPLACE_WITH_MAPBOX_SECRET_DOWNLOAD_TOKEN`).
  ⚠️ Do NOT commit the real `sk.*` token. Set it locally / in EAS secrets, or export
  `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` and reference it — keep it out of git.

## 3. 🔶 Expo / EAS (needs `eas login` — you weren't logged in)
```
cd apps/mobile
eas login
eas init            # writes your real projectId into app.json extra.eas.projectId
eas credentials     # APNs key (iOS) + FCM key (Android) for push
eas build --profile development --platform ios   # (and/or android)
```
`eas.json` build profiles already carry the Google client IDs + API base URL, so builds
are configured apart from the Mapbox token above.

## 4. 🔶 Android OAuth client (after your first EAS build)
Needs the app-signing **SHA-1**, which only exists once EAS generates a keystore:
`eas credentials` → Android → copy the SHA-1 → GCP Console → create an **Android** OAuth
client (package `com.beholdtheiceman.shameofthrones` + that SHA-1). Then append its client
ID to `GOOGLE_NATIVE_CLIENT_IDS` on Vercel. (iOS sign-in works without this.)

## 5. ⏳ Production cutover (do WITH Claude, each step gated)
1. Confirm `/api/health` on the phase5 preview shows `NATIVE_JWT_SECRET` + `GOOGLE_NATIVE_CLIENT_IDS` = `true` (redeploy the preview after the env-var add).
2. Merge `feat/phase4-foundation` (incl. `feat/phase5-ship-mobile`) → `main` — verified a clean fast-forward (no conflicts).
3. Vercel → Settings → Git → Production Branch = `main`.
4. Deploy; confirm prod `/api/health` `ok: true` and the site is Ready.

## 6. 🔶 Device QA (needs your hardware; see spec WS4)
On a dev build: Google sign-in → `/api/auth/native` → `/api/me`; Mapbox render;
fief-tap-vs-background guard; rating flow + offline queue; push delivery.
