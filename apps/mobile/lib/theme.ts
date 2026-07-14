/**
 * Native color palette mirroring the web app's CSS custom properties
 * (apps/web/src/app/globals.css `:root` block — the default/light-key
 * variant, which is itself a dark-navy parchment theme). RN has no CSS
 * vars, so these are the resolved hex values. Keep in sync manually if
 * the web palette changes; there is no shared token source yet.
 */
export const COLORS = {
  ink: "#f6e9c8",
  inkSoft: "#d8c493",
  inkFaint: "#a8966d",
  vellum: "#171b30",
  vellumRaised: "#262c4a",
  vellumLine: "#0a0c18",
  brass: "#e8c14c",
  brassStrong: "#ffdd75",
  onBrass: "#241804",
  crimson: "#f07267",
  crimsonStrong: "#f8887e",
  emerald: "#63d483",
  houseFlush: "#3f6fd1",
  houseBidet: "#2bb5a6",
  housePlunger: "#9b6fd1",
  housePorcelain: "#c9c48a",
} as const;

export const HOUSE_COLOR: Record<string, string> = {
  flush: COLORS.houseFlush,
  bidet: COLORS.houseBidet,
  plunger: COLORS.housePlunger,
  porcelain: COLORS.housePorcelain,
};

export const SCORE_BAND_COLOR: Record<string, string> = {
  high: COLORS.emerald,
  mid: COLORS.brass,
  low: COLORS.crimson,
  unrated: COLORS.inkFaint,
};
