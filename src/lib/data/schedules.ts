import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import {
  candidateInputSchema,
  manualAssignmentUpdateSchema,
  saveCandidatesSchema,
  scheduleHistoryQuerySchema,
  scheduleRunCreateSchema,
  selectCandidateSchema,
  type CandidateInput,
  type ManualAssignmentUpdateInput,
  type ScheduleHistoryQuery,
  type ScheduleRunCreateInput,
} from "@/lib/validation";
import {
  DataConflictError,
  DataNotFoundError,
  immutableJson,
  monthBounds,
  toUtcDate,
} from "./shared";

export async function createScheduleRun(payload: ScheduleRunCreateInput) {
  const input = scheduleRunCreateSchema.parse(payload);
  const prisma = await getPrisma();

  return prisma.scheduleRun.create({
    data: {
      clinicId: input.clinicId,
      month: monthBounds(input.month).gte,
      seed: input.seed,
      inputSnapshot: immutableJson(input.inputSnapshot),
    },
  });
}

export async function saveScheduleCandidates(
  scheduleRunId: string,
  candidates: CandidateInput[],
) {
  const input = saveCandidatesSchema.parse({ scheduleRunId, candidates });
  const prisma = await getPrisma();

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const run = await tx.scheduleRun.findUnique({
      where: { id: input.scheduleRunId },
      select: {
        clinicId: true,
        month: true,
        selectedId: true,
      },
    });
    if (!run) throw new DataNotFoundError("Schedule run not found.");
    if (run.selectedId) {
      throw new DataConflictError(
        "Candidates cannot be replaced after a candidate is selected.",
      );
    }

    const ranks = input.candidates.map(({ rank }) => rank);
    if (new Set(ranks).size !== ranks.length) {
      throw new DataConflictError("Candidate ranks must be unique.");
    }

    const employeeIds = [
      ...new Set(
        input.candidates.flatMap(({ assignments }) =>
          assignments.map(({ employeeId }) => employeeId),
        ),
      ),
    ];
    const employeeCount = await tx.employee.count({
      where: { id: { in: employeeIds }, clinicId: run.clinicId, active: true },
    });
    if (employeeCount !== employeeIds.length) {
      throw new DataConflictError(
        "Assignments require active employees from the schedule's clinic.",
      );
    }

    const { gte, lt } = monthBounds(
      `${run.month.getUTCFullYear()}-${String(
        run.month.getUTCMonth() + 1,
      ).padStart(2, "0")}`,
    );
    for (const candidate of input.candidates) {
      const assignmentKeys = candidate.assignments.map(
        ({ employeeId, date, session }) => `${employeeId}\0${date}\0${session}`,
      );
      if (new Set(assignmentKeys).size !== assignmentKeys.length) {
        throw new DataConflictError(
          `Candidate rank ${candidate.rank} has duplicate assignments.`,
        );
      }
      if (
        candidate.assignments.some(({ date }) => {
          const parsed = toUtcDate(date);
          return parsed < gte || parsed >= lt;
        })
      ) {
        throw new DataConflictError(
          "Every assignment must fall within the schedule month.",
        );
      }
    }

    await tx.candidate.deleteMany({
      where: { scheduleRunId: input.scheduleRunId },
    });

    for (const candidate of input.candidates) {
      await tx.candidate.create({
        data: {
          scheduleRunId: input.scheduleRunId,
          rank: candidate.rank,
          score: candidate.score,
          scoreDetails: immutableJson(candidate.scoreDetails),
          warnings: immutableJson(candidate.warnings),
          assignments: {
            create: candidate.assignments.map((assignment) => ({
              ...assignment,
              date: toUtcDate(assignment.date),
            })),
          },
        },
      });
    }

    return tx.candidate.findMany({
      where: { scheduleRunId: input.scheduleRunId },
      orderBy: { rank: "asc" },
      include: { assignments: { orderBy: [{ date: "asc" }, { session: "asc" }] } },
    });
  });
}

export async function selectScheduleCandidate(
  scheduleRunId: string,
  candidateId: string,
) {
  const input = selectCandidateSchema.parse({ scheduleRunId, candidateId });
  const prisma = await getPrisma();

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const candidate = await tx.candidate.findFirst({
      where: {
        id: input.candidateId,
        scheduleRunId: input.scheduleRunId,
      },
      select: { id: true },
    });
    if (!candidate) {
      throw new DataNotFoundError(
        "Candidate does not belong to this schedule run.",
      );
    }

    return tx.scheduleRun.update({
      where: { id: input.scheduleRunId },
      data: { selectedId: candidate.id, status: "SELECTED" },
      include: {
        selected: {
          include: {
            assignments: {
              include: { employee: true },
              orderBy: [{ date: "asc" }, { session: "asc" }],
            },
          },
        },
      },
    });
  });
}

export async function queryScheduleHistory(query: ScheduleHistoryQuery) {
  const input = scheduleHistoryQuerySchema.parse(query);
  const prisma = await getPrisma();

  return prisma.scheduleRun.findMany({
    where: {
      clinicId: input.clinicId,
      ...(input.month ? { month: monthBounds(input.month) } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.employeeId
        ? {
            candidates: {
              some: {
                assignments: { some: { employeeId: input.employeeId } },
              },
            },
          }
        : {}),
    },
    orderBy: [{ month: "desc" }, { createdAt: "desc" }],
    include: {
      candidates: {
        orderBy: { rank: "asc" },
        include: {
          assignments: {
            ...(input.employeeId
              ? { where: { employeeId: input.employeeId } }
              : {}),
            orderBy: [{ date: "asc" }, { session: "asc" }],
            include: { employee: true },
          },
        },
      },
    },
  });
}

type AssignmentWithContext = Prisma.AssignmentGetPayload<{
  include: {
    employee: true;
    candidate: { include: { scheduleRun: true } };
  };
}>;

export interface ManualAssignmentChange {
  previous: AssignmentWithContext;
  next: AssignmentWithContext;
}

export interface ManualAssignmentHooks {
  beforeUpdate?: (
    previous: AssignmentWithContext,
    requested: Readonly<ManualAssignmentUpdateInput>,
  ) => void | Promise<void>;
  afterUpdate?: (change: ManualAssignmentChange) => void | Promise<void>;
}

export async function updateManualAssignment(
  payload: ManualAssignmentUpdateInput,
  hooks: ManualAssignmentHooks = {},
) {
  const input = manualAssignmentUpdateSchema.parse(payload);
  const prisma = await getPrisma();

  const change = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const previous = await tx.assignment.findUnique({
        where: { id: input.assignmentId },
        include: {
          employee: true,
          candidate: { include: { scheduleRun: true } },
        },
      });
      if (!previous) throw new DataNotFoundError("Assignment not found.");

      await hooks.beforeUpdate?.(previous, Object.freeze({ ...input }));

      if (input.employeeId) {
        const employee = await tx.employee.findFirst({
          where: {
            id: input.employeeId,
            clinicId: previous.candidate.scheduleRun.clinicId,
            active: true,
          },
          select: { id: true },
        });
        if (!employee) {
          throw new DataConflictError(
            "The replacement employee must be active in the same clinic.",
          );
        }
      }

      const nextDate = input.date ? toUtcDate(input.date) : previous.date;
      const runMonth = previous.candidate.scheduleRun.month;
      if (
        nextDate.getUTCFullYear() !== runMonth.getUTCFullYear() ||
        nextDate.getUTCMonth() !== runMonth.getUTCMonth()
      ) {
        throw new DataConflictError(
          "A manual assignment must remain in its schedule month.",
        );
      }

      const next = await tx.assignment.update({
        where: { id: input.assignmentId },
        data: {
          ...(input.employeeId ? { employeeId: input.employeeId } : {}),
          ...(input.date ? { date: nextDate } : {}),
          ...(input.session ? { session: input.session } : {}),
          ...(input.hours !== undefined ? { hours: input.hours } : {}),
          manual: true,
        },
        include: {
          employee: true,
          candidate: { include: { scheduleRun: true } },
        },
      });

      return { previous, next };
    },
  );

  await hooks.afterUpdate?.(change);
  return change.next;
}

export { candidateInputSchema };

