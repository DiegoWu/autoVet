import OpenAI from "openai";
import {z} from "zod";

const SummarySchema = z.object({
  overview: z.string().min(1),
  satisfiedPreferences: z.array(z.string()),
  tradeoffs: z.array(z.string()),
});

export type PreferenceSummary = z.infer<typeof SummarySchema>;

export async function summarizeSelectedSchedule(input: {
  locale: "zh-TW" | "en";
  preferences: unknown[];
  assignments: unknown[];
}): Promise<PreferenceSummary | null> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env["GPT-API-KEY"];
  if (!apiKey) return null;

  const client = new OpenAI({apiKey});
  const response = await client.responses.create({
    model: "gpt-5-mini",
    text: {
      format: {
        type: "json_schema",
        name: "preference_summary",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            overview: {type: "string"},
            satisfiedPreferences: {type: "array", items: {type: "string"}},
            tradeoffs: {type: "array", items: {type: "string"}},
          },
          required: ["overview", "satisfiedPreferences", "tradeoffs"],
        },
      },
    },
    input: [
      {
        role: "system",
        content: `Summarize coworker preferences against a selected veterinary clinic schedule. Write in ${input.locale}. Do not infer personality, health, protected traits, or ability. Only discuss supplied preferences and assignments.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          preferences: input.preferences,
          assignments: input.assignments,
          requiredShape: {
            overview: "string",
            satisfiedPreferences: ["string"],
            tradeoffs: ["string"],
          },
        }),
      },
    ],
  });

  const raw = response.output_text.replace(/^```json\s*|\s*```$/g, "");
  try {
    return SummarySchema.parse(JSON.parse(raw));
  } catch {
    return {
      overview: response.output_text,
      satisfiedPreferences: [],
      tradeoffs: [],
    };
  }
}
