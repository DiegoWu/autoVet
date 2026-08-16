import {NextResponse} from "next/server";
import {z} from "zod";
import {getPrisma} from "@/lib/db";
import {requireSession} from "@/lib/auth";
import type {Prisma} from "@/generated/prisma/client";
import {
  resolveSundayMode,
  staffConstraintFields,
  sundayConfigFields,
} from "@/lib/schedule-constraints";

const SaveSchema = z.object({
  mode: z.enum(["DOCTOR_ONLY", "DOCTOR_NURSE"]).default("DOCTOR_NURSE"),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  locale: z.enum(["zh-TW", "en"]).default("zh-TW"),
  aiSummary: z.string().max(10_000).optional(),
  staff: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(200),
    role: z.enum(["DOCTOR", "NURSE"]),
    backupOnly: z.boolean().default(false),
    targetWeeklyHours: z.number().min(0).max(168),
    yearsExperience: z.number().int().min(0).optional(),
    expertise: z.string().optional(),
    hobbies: z.string().optional(),
    ...staffConstraintFields,
  })),
  preferences: z.array(z.object({
    fromId: z.string().min(1),
    toId: z.string().min(1),
  })).default([]),
  avoidances: z.array(z.object({
    fromId: z.string().min(1),
    toId: z.string().min(1),
    strength: z.enum(["ABSOLUTE", "PREFERRED"]).default("ABSOLUTE"),
  })).default([]),
  config: z.object({
    minDoctors: z.number().int().min(1),
    maxDoctors: z.number().int().min(1),
    minNurses: z.number().int().min(0),
    ...sundayConfigFields,
    singleDoctorWeekdays: z.array(z.number().int().min(0).max(6)).default([]),
    popularDayRules: z.array(z.object({
      weekday: z.number().int().min(0).max(6),
      sessions: z.array(
        z.enum(["morning", "afternoon", "evening"]),
      ).min(1).default(["morning"]),
      minDoctors: z.number().int().min(1).max(10),
      minNurses: z.number().int().min(0).max(10),
    })).default([]),
    flex: z.boolean(),
    attested: z.boolean(),
  }),
  candidate: z.object({
    rank: z.number().int(),
    score: z.number(),
    coverage: z.number(),
    fairness: z.number(),
    preference: z.number(),
    warnings: z.array(z.string()),
    assignments: z.array(z.object({
      date: z.string(),
      session: z.enum(["morning", "afternoon", "evening"]),
      employees: z.array(z.object({id: z.string()})),
    })),
  }),
}).superRefine((input, context) => {
  if (input.config.maxDoctors < input.config.minDoctors) {
    context.addIssue({
      code: "custom",
      message: "Maximum doctors must be greater than or equal to minimum doctors",
      path: ["config", "maxDoctors"],
    });
  }
  if (input.mode === "DOCTOR_ONLY" && input.config.minNurses !== 0) {
    context.addIssue({
      code: "custom",
      message: "Doctor-only schedules must use zero nurse coverage",
      path: ["config", "minNurses"],
    });
  }
  if (input.mode === "DOCTOR_NURSE" && input.config.minNurses < 1) {
    context.addIssue({
      code: "custom",
      message: "Combined schedules require at least one nurse per shift",
      path: ["config", "minNurses"],
    });
  }
  const seenPopularWeekdays = new Set<number>();
  for (const [index, rule] of input.config.popularDayRules.entries()) {
    if (seenPopularWeekdays.has(rule.weekday)) {
      context.addIssue({
        code: "custom",
        message: "Each popular weekday may only be configured once",
        path: ["config", "popularDayRules", index, "weekday"],
      });
    }
    seenPopularWeekdays.add(rule.weekday);
    if (resolveSundayMode(input.config) !== "open" && rule.weekday === 0) continue;
    if (
      rule.minDoctors > input.config.maxDoctors ||
      (
        input.config.singleDoctorWeekdays.includes(rule.weekday) &&
        rule.minDoctors > 1
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Popular-day doctor minimum exceeds the weekday maximum",
        path: ["config", "popularDayRules", index, "minDoctors"],
      });
    }
    if (input.mode === "DOCTOR_NURSE" && rule.minNurses < 1) {
      context.addIssue({
        code: "custom",
        message: "Combined popular-day rules require at least one nurse",
        path: ["config", "popularDayRules", index, "minNurses"],
      });
    }
  }
  for (const weekday of input.config.singleDoctorWeekdays) {
    if (resolveSundayMode(input.config) !== "open" && weekday === 0) continue;
    const doctorMinimum = input.config.popularDayRules.find(
      (rule) => rule.weekday === weekday,
    )?.minDoctors ?? input.config.minDoctors;
    if (doctorMinimum > 1) {
      context.addIssue({
        code: "custom",
        message: "One-doctor weekdays require doctor coverage of one",
        path: ["config", "singleDoctorWeekdays"],
      });
    }
  }
});

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  try {
    const prisma = await getPrisma();
    const runs = await prisma.scheduleRun.findMany({
      where: {clinicId: session.clinicId, status: "SELECTED"},
      orderBy: {createdAt: "desc"},
      include: {selected: {include: {assignments: {include: {employee: true}}}}},
      take: 60,
    });
    return NextResponse.json(runs.map((run) => {
      const grouped = new Map<string, {
        date: string;
        session: string;
        employees: Array<{id: string; name: string; role: string}>;
      }>();
      for (const assignment of run.selected?.assignments ?? []) {
        const date = assignment.date.toISOString().slice(0, 10);
        const key = `${date}:${assignment.session}`;
        const item = grouped.get(key) ?? {
          date,
          session: assignment.session,
          employees: [],
        };
        if (!item.employees.some((employee) => employee.id === assignment.employee.id)) {
          item.employees.push({
            id: assignment.employee.id,
            name: assignment.employee.name,
            role: assignment.employee.role,
          });
        }
        grouped.set(key, item);
      }
      const snapshot = run.inputSnapshot as {
        config?: {closedSundays?: boolean; sundayMode?: "closed" | "nurses_only" | "open"};
      } | null;
      return {
        id: run.id,
        month: run.month.toISOString().slice(0, 7),
        status: run.status,
        staff: [...new Set(run.selected?.assignments.map((assignment) => assignment.employee.name) ?? [])],
        savedAt: run.createdAt,
        closedSundays: resolveSundayMode(snapshot?.config ?? {}) === "closed",
        selected: {
          score: run.selected?.score ?? 0,
          assignments: [...grouped.values()],
        },
      };
    }));
  } catch {
    return NextResponse.json([], {status: 200});
  }
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  const parsed = SaveSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({error: "Invalid schedule", issues: parsed.error.issues}, {status: 400});

  try {
    const input = parsed.data;
    const clinicId = session.clinicId;
    const prisma = await getPrisma();
    const run = await prisma.$transaction(async (tx) => {
      await tx.clinic.update({
        where: {id: clinicId},
        data: {
          minDoctors: input.config.minDoctors,
          maxDoctors: input.config.maxDoctors,
          minNurses: input.config.minNurses,
          flexibleHoursMode: input.config.flex,
          approvalAttested: input.config.attested,
        },
      });
      const existingEmployees = await tx.employee.findMany({
        where: {id: {in: input.staff.map((employee) => employee.id)}},
        select: {clinicId: true},
      });
      if (existingEmployees.some((employee) => employee.clinicId !== clinicId)) {
        throw new Error("EMPLOYEE_CLINIC_MISMATCH");
      }
      for (const [sortOrder, employee] of input.staff.entries()) {
        await tx.employee.upsert({
          where: {id: employee.id},
          update: {
            name: employee.name,
            role: employee.role,
            backupOnly: employee.backupOnly,
            targetWeeklyHours: employee.targetWeeklyHours,
            yearsExperience: employee.yearsExperience,
            expertise: employee.expertise,
            hobbies: employee.hobbies,
            sortOrder,
          },
          create: {
            id: employee.id,
            clinicId,
            name: employee.name,
            role: employee.role,
            backupOnly: employee.backupOnly,
            targetWeeklyHours: employee.targetWeeklyHours,
            yearsExperience: employee.yearsExperience,
            expertise: employee.expertise,
            hobbies: employee.hobbies,
            sortOrder,
          },
        });
      }
      const created = await tx.scheduleRun.create({
        data: {
          clinicId,
          month: new Date(`${input.month}-01T00:00:00.000Z`),
          seed: 1,
          inputSnapshot: input as unknown as Prisma.InputJsonValue,
          candidates: {
            create: {
              rank: input.candidate.rank,
              score: input.candidate.score,
              scoreDetails: {
                coverage: input.candidate.coverage,
                fairness: input.candidate.fairness,
                preference: input.candidate.preference,
              },
              warnings: input.candidate.warnings,
              assignments: {
                create: input.candidate.assignments.flatMap((assignment) =>
                  assignment.employees.map((employee) => ({
                    employeeId: employee.id,
                    date: new Date(`${assignment.date}T00:00:00.000Z`),
                    session: assignment.session,
                    hours: assignment.session === "morning" ? 2.5 : 4,
                  })),
                ),
              },
            },
          },
          summaries: input.aiSummary ? {
            create: {
              locale: input.locale,
              content: input.aiSummary,
              model: "gpt-5-mini",
            },
          } : undefined,
        },
        include: {candidates: true},
      });
      return tx.scheduleRun.update({
        where: {id: created.id},
        data: {status: "SELECTED", selectedId: created.candidates[0].id},
      });
    });
    return NextResponse.json({id: run.id}, {status: 201});
  } catch (error) {
    if (error instanceof Error && error.message === "EMPLOYEE_CLINIC_MISMATCH") {
      return NextResponse.json({error: "Staff records must belong to the signed-in clinic"}, {status: 400});
    }
    return NextResponse.json({error: "Database persistence is unavailable"}, {status: 503});
  }
}
