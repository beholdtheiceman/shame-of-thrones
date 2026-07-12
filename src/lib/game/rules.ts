/** Server-enforced game rules. The client imports these for display only —
 * the server never trusts client-computed values. */

export const INFLUENCE = {
  verifiedRating: 10,
  hearsayRating: 2,
  firstOfNameBonus: 15,
  throneConfirmedAdderAward: 25, // to the adder, once a second user confirms (PRD §5.5)
  confirmAction: 3,              // to the confirming user (PRD §5.5 freshness check)
} as const;

export const RATING_TAGS = [
  "Clean",
  "Stocked",
  "Hot water",
  "Smells like victory",
  "Smells like defeat",
  "No soap (a war crime)",
  "Door lock broken",
  "Line too long",
  "Hidden gem",
] as const;

export type RatingTag = (typeof RATING_TAGS)[number];

export const RATING_UPDATE_WINDOW_MS = 24 * 60 * 60 * 1000; // repeat within 24h updates, not stacks
export const HOUSE_SWITCH_WINDOW_MS = 56 * 24 * 60 * 60 * 1000; // stands in for the 8-week season

/** Phase-1 anti-gaming thresholds. Heuristics are NON-PUNITIVE: when one
 * trips, the action still succeeds and a review_queue row records it.
 * Only the hard ceiling rejects. */
export const SAFETY = {
  newAccountWindowMs: 7 * 24 * 60 * 60 * 1000, // accounts younger than this earn 50% and flag
  newAccountInfluenceFactor: 0.5,
  softRateLimitPerHour: 12, // writes/hour that flag to the review queue
  hardRateLimitPerHour: 30, // writes/hour that 429 — bot scale, humans never see it
  impossibleTravelKmh: 150, // implied speed between verified ratings that flags
} as const;

/** New-account Influence ramp (PRD §5.8): <7-day accounts earn 50%, rounded
 * up so an award is never zero. The ledger stores the ramped value. */
export function rampedPoints(base: number, accountAgeMs: number): number {
  if (accountAgeMs >= SAFETY.newAccountWindowMs) return base;
  return Math.ceil(base * SAFETY.newAccountInfluenceFactor);
}
