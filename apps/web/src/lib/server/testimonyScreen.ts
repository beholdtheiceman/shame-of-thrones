import Anthropic from "@anthropic-ai/sdk";

export type ScreenVerdict = "allow" | "flag" | "block";
export interface ScreenResult {
  verdict: ScreenVerdict;
  category?: string;
  note: string;
}
export interface ScreenClient {
  screen(text: string): Promise<ScreenResult>;
}

const SYSTEM = `You review 280-character free-text restroom reviews ("testimony") for
"Shame of Thrones", a playful fantasy-themed restroom-rating game. Crude bathroom
humor, profanity, and colorful complaints are ALLOWED and expected — this is a game
about toilets. Your job is narrow:
- verdict "block" ONLY for: slurs/hate speech targeting protected groups; doxxing or
  personal information (a person's name paired with an address/phone/workplace shift);
  explicit threats of violence.
- verdict "flag" for borderline content a human moderator should glance at: targeted
  harassment of a specific individual, sexual content beyond bathroom humor, spam/ads.
- verdict "allow" for everything else, however vulgar.
Give category (slur, doxxing, threat, harassment, sexual, spam) when not "allow", and
a one-sentence note for the moderator (never shown to users).`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["allow", "flag", "block"] },
    category: { type: "string" },
    note: { type: "string" },
  },
  required: ["verdict", "note"],
  additionalProperties: false,
} as const;

export function anthropicScreenClient(): ScreenClient {
  const model = process.env.TRIAGE_MODEL ?? "claude-haiku-4-5";
  return {
    async screen(text) {
      // Lazy construction: a missing ANTHROPIC_API_KEY becomes a caught
      // screen failure (fail-open) instead of an unhandled throw.
      const client = new Anthropic();
      const response = await client.messages.create({
        model,
        max_tokens: 512,
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        messages: [{ role: "user", content: `Testimony to review:\n"""\n${text}\n"""` }],
      });
      const raw = response.content.find((b) => b.type === "text")?.text ?? "";
      const parsed = JSON.parse(raw) as ScreenResult;
      const verdict: ScreenVerdict = ["allow", "flag", "block"].includes(parsed.verdict)
        ? parsed.verdict
        : "flag";
      return { verdict, category: parsed.category, note: parsed.note };
    },
  };
}

/** Fail-open wrapper (Larry's rule: the action goes through; a human reviews). */
export async function screenTestimony(
  text: string,
  client: ScreenClient = anthropicScreenClient()
): Promise<ScreenResult> {
  try {
    return await client.screen(text);
  } catch (e) {
    return {
      verdict: "flag",
      category: "screen_unavailable",
      note: `Screen unavailable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
