# Runbook: Enable RevenueCat In-App Purchases

The purchase entitlement path is **server-authoritative**: RevenueCat webhook
→ entitlements store → `mePayload`. The app never grants a cosmetic just
because a client-side purchase call returned success. Everything below is
also **fail-safe when keys/secrets are unset** — purchases are simply
unavailable, nothing crashes.

The three purchasable products are banner cosmetics. Their IDs are already
wired into the code and must match exactly across all three places:

| Store product ID          | Internal sku          |
|----------------------------|------------------------|
| `sot_banner_dragonscale`   | `banner.dragonscale`  |
| `sot_banner_gilded`        | `banner.gilded`       |
| `sot_banner_obsidian`      | `banner.obsidian`     |

Source of truth for the mapping: `apps/web/src/lib/server/revenuecat.ts`
(`PRODUCT_ID_TO_SKU`), mirrored in `apps/mobile/lib/purchases.ts`. If you ever
add/rename a product, update both files together.

## Owner steps

1. **Create a RevenueCat project** (app.revenuecat.com) for Shame of Thrones.

2. **Create the store products**, using the exact IDs above:
   - App Store Connect: three in-app purchase products with product IDs
     `sot_banner_dragonscale`, `sot_banner_gilded`, `sot_banner_obsidian`.
   - Google Play Console: three in-app products with the same IDs.
   - Attach each to the corresponding RevenueCat product/entitlement.

3. **Add the RevenueCat public SDK keys** (safe to expose client-side):
   - `EXPO_PUBLIC_REVENUECAT_IOS_KEY`
   - `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`

   Set both in:
   - `apps/mobile/.env` (local dev)
   - `apps/mobile/eas.json` — the `EXPO_PUBLIC_REVENUECAT_IOS_KEY` /
     `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` entries are already present per
     build profile but blank; fill them in.
   - Vercel env vars, only if/when the web app ever needs to trigger
     purchases directly (not currently required).

4. **Set the webhook secret in Vercel prod env**: `REVENUECAT_WEBHOOK_AUTH`
   — a random secret string you generate yourself (e.g. `openssl rand -hex 32`).
   This is checked (constant-time compare) by the webhook route in
   `apps/web/src/lib/server/revenuecat.ts`.

5. **Point the RevenueCat dashboard webhook** at:
   ```
   https://shame-of-thrones.vercel.app/api/revenuecat/webhook
   ```
   with header:
   ```
   Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH value>
   ```

6. **Test with an EAS dev build**: build a development client
   (`eas build --profile development`) so you can complete a real sandbox
   purchase on-device and confirm:
   - The webhook fires and grants the entitlement server-side.
   - The cosmetic shows up as owned/equippable via `mePayload` and in the
     Treasury screen.

## Notes

- Nothing on the client decides entitlement — it only *displays* what the
  server says is owned/equipped, sourced from `mePayload`.
- If `EXPO_PUBLIC_REVENUECAT_*` keys are unset, the mobile purchase UI simply
  has nothing to sell (fails safe, no crash).
- If `REVENUECAT_WEBHOOK_AUTH` is unset, the webhook route fails closed
  (rejects) rather than accepting unauthenticated grants.
