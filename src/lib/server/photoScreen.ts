import Anthropic from "@anthropic-ai/sdk";

export interface VisionVerdict {
  personDetected: boolean;
  nsfw: boolean;
  relevant: boolean;
  note: string;
}
export interface VisionClient {
  classify(imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<VisionVerdict>;
}

const SYSTEM = `You classify photos uploaded to "Shame of Thrones", a public-restroom-rating
game. Policy (hard rules): photos may show restroom ENTRANCES, SIGNAGE, and SINK AREAS only.
- personDetected: true if ANY person, face, or identifiable body part is visible, even
  partially, even in a mirror. Zero tolerance — when unsure, say true.
- nsfw: true for any sexual/explicit content whatsoever.
- relevant: true if the photo plausibly shows a restroom entrance, signage, sink area, or
  the venue exterior; false for unrelated subjects (memes, screenshots, food, etc.).
- note: one sentence for the human moderator describing what the photo shows.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    personDetected: { type: "boolean" },
    nsfw: { type: "boolean" },
    relevant: { type: "boolean" },
    note: { type: "string" },
  },
  required: ["personDetected", "nsfw", "relevant", "note"],
  additionalProperties: false,
} as const;

export function anthropicVisionClient(): VisionClient {
  const model = process.env.TRIAGE_MODEL ?? "claude-haiku-4-5";
  return {
    async classify(imageBase64, mediaType) {
      const client = new Anthropic(); // lazy — a missing key becomes a caught failure
      const response = await client.messages.create({
        model,
        max_tokens: 512,
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: "Classify this photo per the policy." },
          ],
        }],
      });
      const raw = response.content.find((b) => b.type === "text")?.text ?? "";
      return JSON.parse(raw) as VisionVerdict;
    },
  };
}

/** Fail-CLOSED wrapper: null means "could not classify" — the caller must leave
 * the photo pending (invisible) for human review. Opposite of the testimony
 * screen's fail-open, because the PRD forbids unmoderated public photos. */
export async function screenPhoto(
  bytes: Buffer,
  contentType: string,
  client: VisionClient = anthropicVisionClient()
): Promise<VisionVerdict | null> {
  try {
    return await client.classify(
      bytes.toString("base64"),
      contentType as "image/jpeg" | "image/png" | "image/webp"
    );
  } catch {
    return null;
  }
}
