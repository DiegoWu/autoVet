import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { DataConflictError, DataNotFoundError, toUtcDate } from "./shared";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
} from "@/lib/validation";

const employeeDetails = {
  availability: { orderBy: { date: "asc" as const } },
  preferencesFrom: {
    include: { to: true },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.EmployeeInclude;

async function assertValidPreferences(
  tx: Prisma.TransactionClient,
  clinicId: string,
  employeeId: string | undefined,
  preferences: CreateEmployeeInput["preferences"],
): Promise<void> {
  const targetIds = preferences.map(({ employeeId: targetId }) => targetId);
  if (new Set(targetIds).size !== targetIds.length) {
    throw new DataConflictError("Coworker preferences must be unique.");
  }
  if (employeeId && targetIds.includes(employeeId)) {
    throw new DataConflictError("An employee cannot prefer themselves.");
  }
  if (!targetIds.length) return;

  const count = await tx.employee.count({
    where: { id: { in: targetIds }, clinicId },
  });
  if (count !== targetIds.length) {
    throw new DataConflictError(
      "Every preferred coworker must belong to the same clinic.",
    );
  }
}

function employeeScalarData(
  input: Omit<CreateEmployeeInput, "clinicId" | "availability" | "preferences">,
) {
  return {
    name: input.name,
    role: input.role,
    targetWeeklyHours: input.targetWeeklyHours,
    minMonthlyHours: input.minMonthlyHours,
    maxMonthlyHours: input.maxMonthlyHours,
    yearsExperience: input.yearsExperience,
    expertise: input.expertise,
    hobbies: input.hobbies,
    abilityScores:
      input.abilityScores === null ? Prisma.JsonNull : input.abilityScores,
    active: input.active,
    sortOrder: input.sortOrder,
  };
}

export async function listEmployees(
  clinicId: string,
  options: { includeInactive?: boolean } = {},
) {
  const prisma = await getPrisma();
  return prisma.employee.findMany({
    where: {
      clinicId,
      ...(options.includeInactive ? {} : { active: true }),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: employeeDetails,
  });
}

export async function getEmployee(employeeId: string) {
  const prisma = await getPrisma();
  return prisma.employee.findUnique({
    where: { id: employeeId },
    include: employeeDetails,
  });
}

export async function createEmployee(payload: CreateEmployeeInput) {
  const input = createEmployeeSchema.parse(payload);
  const prisma = await getPrisma();

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await assertValidPreferences(
      tx,
      input.clinicId,
      undefined,
      input.preferences,
    );

    return tx.employee.create({
      data: {
        clinicId: input.clinicId,
        ...employeeScalarData(input),
        availability: {
          create: input.availability.map((item) => ({
            ...item,
            date: toUtcDate(item.date),
          })),
        },
        preferencesFrom: {
          create: input.preferences.map(({ employeeId, ...preference }) => ({
            ...preference,
            toId: employeeId,
          })),
        },
      },
      include: employeeDetails,
    });
  });
}

export async function updateEmployee(
  employeeId: string,
  payload: UpdateEmployeeInput,
) {
  const input = updateEmployeeSchema.parse(payload);
  const prisma = await getPrisma();

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        clinicId: true,
        minMonthlyHours: true,
        maxMonthlyHours: true,
      },
    });
    if (!existing) throw new DataNotFoundError("Employee not found.");

    const min =
      input.minMonthlyHours !== undefined
        ? input.minMonthlyHours
        : existing.minMonthlyHours;
    const max =
      input.maxMonthlyHours !== undefined
        ? input.maxMonthlyHours
        : existing.maxMonthlyHours;
    if (min != null && max != null && min > max) {
      throw new DataConflictError(
        "minMonthlyHours cannot exceed maxMonthlyHours.",
      );
    }

    if (input.preferences) {
      await assertValidPreferences(
        tx,
        existing.clinicId,
        employeeId,
        input.preferences,
      );
      await tx.coworkerPreference.deleteMany({ where: { fromId: employeeId } });
    }
    if (input.availability) {
      await tx.availability.deleteMany({ where: { employeeId } });
    }

    const {
      availability,
      preferences,
      abilityScores,
      ...scalarUpdates
    } = input;

    return tx.employee.update({
      where: { id: employeeId },
      data: {
        ...scalarUpdates,
        ...(abilityScores !== undefined
          ? {
              abilityScores:
                abilityScores === null ? Prisma.JsonNull : abilityScores,
            }
          : {}),
        ...(availability
          ? {
              availability: {
                create: availability.map((item) => ({
                  ...item,
                  date: toUtcDate(item.date),
                })),
              },
            }
          : {}),
        ...(preferences
          ? {
              preferencesFrom: {
                create: preferences.map(
                  ({ employeeId: targetId, ...preference }) => ({
                    ...preference,
                    toId: targetId,
                  }),
                ),
              },
            }
          : {}),
      },
      include: employeeDetails,
    });
  });
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  const prisma = await getPrisma();
  await prisma.employee.delete({ where: { id: employeeId } });
}

