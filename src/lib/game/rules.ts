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
