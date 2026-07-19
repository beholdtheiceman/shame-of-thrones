import { afterEach, describe, expect, it } from "vitest";
import {
  skuForProductId,
  platformForStore,
  verifyWebhookAuth,
  GRANT_EVENTS,
  REVOKE_EVENTS,
} from "@/lib/server/revenuecat";

describe("revenuecat mapping", () => {
  it("maps known product ids to skus and ignores unknown ones", () => {
    expect(skuForProductId("sot_banner_dragonscale")).toBe("banner.dragonscale");
    expect(skuForProductId("sot_unknown")).toBeUndefined();
  });

  it("maps store to platform", () => {
    expect(platformForStore("APP_STORE")).toBe("ios");
    expect(platformForStore("PLAY_STORE")).toBe("android");
    expect(platformForStore(undefined)).toBeNull();
  });

  it("classifies grant vs revoke event types", () => {
    expect(GRANT_EVENTS.has("INITIAL_PURCHASE")).toBe(true);
    expect(GRANT_EVENTS.has("NON_RENEWING_PURCHASE")).toBe(true);
    expect(REVOKE_EVENTS.has("REFUND")).toBe(true);
    expect(REVOKE_EVENTS.has("CANCELLATION")).toBe(true);
  });
});

describe("verifyWebhookAuth", () => {
  const prev = process.env.REVENUECAT_WEBHOOK_AUTH;
  afterEach(() => { process.env.REVENUECAT_WEBHOOK_AUTH = prev; });

  it("accepts the matching bearer token and rejects everything else", () => {
    process.env.REVENUECAT_WEBHOOK_AUTH = "s3cret";
    expect(verifyWebhookAuth("Bearer s3cret")).toBe(true);
    expect(verifyWebhookAuth("Bearer nope")).toBe(false);
    expect(verifyWebhookAuth(null)).toBe(false);
  });

  it("fails closed when the secret is unset", () => {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    expect(verifyWebhookAuth("Bearer anything")).toBe(false);
  });
});
