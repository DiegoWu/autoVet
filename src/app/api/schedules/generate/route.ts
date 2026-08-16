import {NextResponse} from "next/server";
import {isAuthConfigured, requireSession} from "@/lib/auth";
import {buildGeneratedSchedule, generateScheduleInputSchema} from "@/lib/scheduler/from-input";

export async function POST(request: Request) {
  if (isAuthConfigured() && !await requireSession(request)) {
    return NextResponse.json({error: "Unauthorized"}, {status: 401});
  }
  const parsed = generateScheduleInputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({error: "Invalid scheduling input", issues: parsed.error.issues}, {status: 400});
  const input = parsed.data;
  if (input.flexible && !input.attested) return NextResponse.json({error: "Flexible-hours approval must be attested"}, {status: 400});
  const result = buildGeneratedSchedule(input);
  return NextResponse.json(result);
}
