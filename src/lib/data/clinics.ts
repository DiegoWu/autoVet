import { getPrisma } from "@/lib/db";
import {
  clinicSetupSchema,
  type ClinicSetupInput,
} from "@/lib/validation";

export async function setupClinic(payload: ClinicSetupInput) {
  const input = clinicSetupSchema.parse(payload);
  const prisma = await getPrisma();
  const { id, ...data } = input;

  if (id) {
    return prisma.clinic.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  }

  return prisma.clinic.create({ data });
}

export async function getClinic(clinicId: string) {
  const prisma = await getPrisma();
  return prisma.clinic.findUnique({
    where: { id: clinicId },
    include: {
      employees: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          availability: { orderBy: { date: "asc" } },
          preferencesFrom: true,
        },
      },
    },
  });
}

