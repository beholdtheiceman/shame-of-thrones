import type { Cosmetic } from "@sot/core";

const CHEVRON = "polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)";

/** The heraldic banner chevron. `colorVar` is the House colour; `style`, when
 * present, is the user's equipped premium Banner cosmetic overlaid on top. */
export function BannerCrest({
  colorVar,
  style,
  className = "h-4 w-7",
}: {
  colorVar: string;
  style?: Cosmetic;
  className?: string;
}) {
  return (
    <span className={`relative inline-block shrink-0 ${className}`}>
      <span
        className="absolute inset-0"
        style={{ background: colorVar, clipPath: CHEVRON }}
      />
      {style && (
        <span
          className={`absolute inset-0 banner-art-${style.art}`}
          style={{ clipPath: CHEVRON }}
          aria-hidden
        />
      )}
    </span>
  );
}
