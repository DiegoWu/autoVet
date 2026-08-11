import {NextResponse} from "next/server";
import {z} from "zod";
import {getPrisma} from "@/lib/db";
import {getAdminCookieName, verifyAdminSession} from "@/lib/auth";
import type {Prisma} from "@/generated/prisma/client";

const SaveSchema = z.object({
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
    daysOff: z.array(z.string()).default([]),
  })),
  preferences: z.array(z.object({
    fromId: z.string().min(1),
    toId: z.string().min(1),
  })).default([]),
  config: z.object({
    minDoctors: z.number().int().min(1),
    maxDoctors: z.number().int().min(1),
    minNurses: z.number().int().min(1),
    closedSundays: z.boolean(),
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
}).refine((input) => input.config.maxDoctors >= input.config.minDoctors, {
  message: "Maximum doctors must be greater than or equal to minimum doctors",
  path: ["config", "maxDoctors"],
});

async function isAuthorized(request: Request) {
  if (process.env.NODE_ENV === "development" && !process.env.ADMIN_EMAIL) return true;
  const cookie = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${getAdminCookieName()}=([^;]+)`))?.[1];
  return Boolean(await verifyAdminSession(cookie ? decodeURIComponent(cookie) : null));
}

export async function GET(request: Request) {
  if (!await isAuthorized(request)) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  try {
    const prisma = await getPrisma();
    const runs = await prisma.scheduleRun.findMany({
      where: {clinicId: "default-clinic", status: "SELECTED"},
      orderBy: {createdAt: "desc"},
      include: {selected: {include: {assignments: {include: {employee: true}}}}},
      take: 60,
    });
    return NextResponse.json(runs.map((run) => ({
      id: run.id,
      month: run.month.toISOString().slice(0, 7),
      status: run.status,
      staff: [...new Set(run.selected?.assignments.map((assignment) => assignment.employee.name) ?? [])],
      savedAt: run.createdAt,
      selected: {score: run.selected?.score ?? 0},
    })));
  } catch {
    return NextResponse.json([], {status: 200});
  }
}

export async function POST(request: Request) {
  if (!await isAuthorized(request)) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  const parsed = SaveSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({error: "Invalid schedule", issues: parsed.error.issues}, {status: 400});

  try {
    const input = parsed.data;
    const prisma = await getPrisma();
    const run = await prisma.$transaction(async (tx) => {
      await tx.clinic.upsert({
        where: {id: "default-clinic"},
        update: {
          minDoctors: input.config.minDoctors,
          maxDoctors: input.config.maxDoctors,
          minNurses: input.config.minNurses,
          flexibleHoursMode: input.config.flex,
          approvalAttested: input.config.attested,
        },
        create: {
          id: "default-clinic",
          name: "autoVet Clinic",
          minDoctors: input.config.minDoctors,
          maxDoctors: input.config.maxDoctors,
          minNurses: input.config.minNurses,
          flexibleHoursMode: input.config.flex,
          approvalAttested: input.config.attested,
        },
      });
      for (const [sortOrder, employee] of input.staff.entries()) {
        await tx.employee.upsert({
          where: {id: employee.id},
          update: {...employee, daysOff: undefined, sortOrder},
          create: {
            id: employee.id,
            clinicId: "default-clinic",
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
          clinicId: "default-clinic",
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
  } catch {
    return NextResponse.json({error: "Database persistence is unavailable"}, {status: 503});
  }
}
