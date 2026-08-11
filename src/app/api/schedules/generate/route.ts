import {NextResponse} from "next/server";
import {z} from "zod";
import {addDays, endOfMonth, format, getDay, startOfMonth} from "date-fns";
import {generateScheduleCandidates, type CoverageRequirement, type SessionId} from "@/lib/scheduler";

const InputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  staff: z.array(z.object({
    id: z.string(),
    name: z.string(),
    role: z.enum(["DOCTOR", "NURSE"]),
    backupOnly: z.boolean().default(false),
    targetWeeklyHours: z.number(),
    daysOff: z.array(z.string()).default([]),
  })),
  preferences: z.array(z.object({fromId: z.string(), toId: z.string()})).default([]),
  minDoctors: z.number().int().min(1),
  maxDoctors: z.number().int().min(1),
  minNurses: z.number().int().min(1),
  closedSundays: z.boolean(),
  flexible: z.boolean(),
  attested: z.boolean(),
}).refine((input) => input.maxDoctors >= input.minDoctors, {
  message: "Maximum doctors must be greater than or equal to minimum doctors",
  path: ["maxDoctors"],
});

const sessionIds: SessionId[] = ["morning", "afternoon", "evening"];

export async function POST(request: Request) {
  const parsed = InputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({error: "Invalid scheduling input", issues: parsed.error.issues}, {status: 400});
  const input = parsed.data;
  if (input.flexible && !input.attested) return NextResponse.json({error: "Flexible-hours approval must be attested"}, {status: 400});

  const first = startOfMonth(new Date(`${input.month}-01T12:00:00`));
  const last = endOfMonth(first);
  const coverage: CoverageRequirement[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    if (input.closedSundays && getDay(date) === 0) continue;
    for (const session of sessionIds) {
      coverage.push({date: format(date, "yyyy-MM-dd"), session, doctors: input.minDoctors, nurses: input.minNurses});
    }
  }

  const result = generateScheduleCandidates(
    input.staff.map((employee) => ({
      id: employee.id,
      name: employee.name,
      role: employee.role === "DOCTOR" ? "doctor" as const : "nurse" as const,
      backupOnly: employee.backupOnly,
      targetHoursPerWeek: employee.targetWeeklyHours,
      maxHoursPerWeek: 48,
      flexibleFourWeekOptIn: input.flexible && input.attested,
      preferences: {
        preferredCoworkerIds: input.preferences.filter((item) => item.fromId === employee.id).map((item) => item.toId),
      },
    })),
    input.staff.flatMap((employee) => employee.daysOff.map((date) => ({employeeId: employee.id, date, kind: "day-off" as const}))),
    {
      startDate: format(first, "yyyy-MM-dd"),
      endDate: format(last, "yyyy-MM-dd"),
      seed: `${input.month}:${input.staff.map((employee) => employee.id).join(",")}`,
      candidateCount: 3,
      coverage,
      maxDoctorsPerShift: input.maxDoctors,
      laborRules: {mode: input.flexible ? "flexible-four-week" : "standard"},
    },
  );

  if (result.impossible || result.candidates.length === 0) {
    return NextResponse.json({candidates: [], impossible: result.impossible, issues: result.issues});
  }

  const staffById = new Map(input.staff.map((employee) => [employee.id, employee]));
  const candidates = result.candidates.map((candidate) => {
    const grouped = new Map<string, {date: string; session: SessionId; employees: typeof input.staff}>();
    for (const assignment of candidate.assignments) {
      const key = `${assignment.date}:${assignment.session}`;
      const item = grouped.get(key) ?? {date: assignment.date, session: assignment.session, employees: []};
      const employee = staffById.get(assignment.employeeId);
      if (employee && !item.employees.some((assigned) => assigned.id === employee.id)) {
        item.employees.push(employee);
      }
      grouped.set(key, item);
    }
    const warningCount = candidate.warnings.length;
    return {
      rank: candidate.rank,
      score: Math.max(0, Math.min(100, Math.round(96 - warningCount * 2 + candidate.score.total / 100))),
      coverage: candidate.warnings.some((issue) => issue.code.includes("COVERAGE")) ? 80 : 100,
      fairness: Math.max(0, Math.min(100, Math.round(90 + candidate.score.targetHourCloseness / 100))),
      preference: Math.max(0, Math.min(100, Math.round(90 + candidate.score.coworkerPreference / 50))),
      assignments: [...grouped.values()],
      warnings: candidate.warnings.map((issue) => issue.message),
      scoreDetails: candidate.score,
    };
  });
  return NextResponse.json({candidates, issues: result.issues});
}
