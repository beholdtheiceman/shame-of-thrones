/** Unambiguous alphabet — omits 0/O and 1/I to avoid transcription errors. */
export const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const GROUP = 4;

function group(rand: () => number): string {
  let out = "";
  for (let i = 0; i < GROUP; i++) {
    out += INVITE_ALPHABET[Math.floor(rand() * INVITE_ALPHABET.length)];
  }
  return out;
}

/**
 * A readable single-use invite code, e.g. `SOT-7K2M-QW9P`. Pure and seedable
 * via `rand` so tests can assert determinism; production passes Math.random.
 */
export function generateInviteCode(rand: () => number = Math.random): string {
  return `SOT-${group(rand)}-${group(rand)}`;
}
