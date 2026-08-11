import {NextResponse} from "next/server";
import {z} from "zod";
import {summarizeSelectedSchedule} from "@/lib/ai/preference-summary";

const RequestSchema = z.object({
  locale: z.enum(["zh-TW", "en"]).default("zh-TW"),
  preferences: z.array(z.unknown()).default([]),
  assignments: z.array(z.unknown()).max(5000),
});

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid summary request", issues: parsed.error.issues}, {status: 400});
  }

  try {
    const summary = await summarizeSelectedSchedule(parsed.data);
    return NextResponse.json({summary, configured: summary !== null});
  } catch {
    return NextResponse.json({error: "Summary generation is temporarily unavailable"}, {status: 503});
  }
}
