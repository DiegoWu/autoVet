import { z } from "zod";

const idSchema = z.string().trim().min(1).max(191);
const dateSchema = z.iso.date();
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");

export const clinicSetupSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(200),
    defaultLocale: z.string().trim().min(2).max(35).default("zh-TW"),
    minDoctors: z.int().min(0).max(100).default(1),
    maxDoctors: z.int().min(1).max(100).default(2),
    minNurses: z.int().min(0).max(100).default(1),
    maxNurses: z.int().min(0).max(100).default(4),
    flexibleHoursMode: z.boolean().default(false),
    approvalAttested: z.boolean().default(false),
  })
  .strict()
  .refine((clinic) => clinic.maxDoctors >= clinic.minDoctors, {
    message: "maxDoctors cannot be less than minDoctors",
    path: ["maxDoctors"],
  })
  .refine((clinic) => clinic.maxNurses >= clinic.minNurses, {
    message: "maxNurses cannot be less than minNurses",
    path: ["maxNurses"],
  });

export const availabilitySchema = z
  .object({
    date: dateSchema,
    kind: z.enum(["DAY_OFF", "UNAVAILABLE"]),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const coworkerPreferenceSchema = z
  .object({
    employeeId: idSchema,
    weight: z.int().min(-10).max(10).default(1),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const employeeFields = {
  name: z.string().trim().min(1).max(200),
  role: z.enum(["DOCTOR", "NURSE"]),
  backupOnly: z.boolean().default(false),
  targetWeeklyHours: z.number().finite().min(0).max(168).default(40),
  minMonthlyHours: z.number().finite().min(0).nullable().optional(),
  maxMonthlyHours: z.number().finite().min(0).nullable().optional(),
  yearsExperience: z.int().min(0).max(100).nullable().optional(),
  expertise: z.string().trim().max(2_000).nullable().optional(),
  hobbies: z.string().trim().max(2_000).nullable().optional(),
  abilityScores: z.json().nullable().optional(),
  active: z.boolean().default(true),
  sortOrder: z.int().min(0).default(0),
  availability: z.array(availabilitySchema).max(1_000).default([]),
  preferences: z.array(coworkerPreferenceSchema).max(500).default([]),
};

function validHours(value: {
  minMonthlyHours?: number | null;
  maxMonthlyHours?: number | null;
}): boolean {
  return (
    value.minMonthlyHours == null ||
    value.maxMonthlyHours == null ||
    value.minMonthlyHours <= value.maxMonthlyHours
  );
}

export const createEmployeeSchema = z
  .object({
    clinicId: idSchema,
    ...employeeFields,
  })
  .strict()
  .refine(validHours, {
    message: "minMonthlyHours cannot exceed maxMonthlyHours",
    path: ["maxMonthlyHours"],
  });

export const updateEmployeeSchema = z
  .object(employeeFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "No updates supplied")
  .refine(validHours, {
    message: "minMonthlyHours cannot exceed maxMonthlyHours",
    path: ["maxMonthlyHours"],
  });

export const scheduleRunCreateSchema = z
  .object({
    clinicId: idSchema,
    month: monthSchema,
    seed: z.int(),
    inputSnapshot: z.json(),
  })
  .strict();

export const assignmentInputSchema = z
  .object({
    employeeId: idSchema,
    date: dateSchema,
    session: z.string().trim().min(1).max(100),
    hours: z.number().finite().positive().max(24),
    manual: z.boolean().default(false),
  })
  .strict();

export const candidateInputSchema = z
  .object({
    rank: z.int().positive(),
    score: z.number().finite(),
    scoreDetails: z.json(),
    warnings: z.json(),
    assignments: z.array(assignmentInputSchema).max(10_000),
  })
  .strict();

export const saveCandidatesSchema = z
  .object({
    scheduleRunId: idSchema,
    candidates: z.array(candidateInputSchema).min(1).max(100),
  })
  .strict();

export const selectCandidateSchema = z
  .object({
    scheduleRunId: idSchema,
    candidateId: idSchema,
  })
  .strict();

export const scheduleHistoryQuerySchema = z
  .object({
    clinicId: idSchema,
    month: monthSchema.optional(),
    employeeId: idSchema.optional(),
    status: z.enum(["DRAFT", "SELECTED", "ARCHIVED"]).optional(),
  })
  .strict();

export const manualAssignmentUpdateSchema = z
  .object({
    assignmentId: idSchema,
    employeeId: idSchema.optional(),
    date: dateSchema.optional(),
    session: z.string().trim().min(1).max(100).optional(),
    hours: z.number().finite().positive().max(24).optional(),
  })
  .strict()
  .refine(
    (payload) =>
      Object.entries(payload).some(
        ([key, value]) => key !== "assignmentId" && value !== undefined,
      ),
    "No updates supplied",
  );

export const userLoginSchema = z
  .object({
    email: z.email().max(320),
    password: z.string().min(1).max(1_024),
  })
  .strict();

export const userSignupSchema = z
  .object({
    clinicName: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    email: z.email().max(320),
    password: z.string().min(8).max(1_024),
  })
  .strict();

export type UserLoginInput = z.infer<typeof userLoginSchema>;
export type UserSignupInput = z.infer<typeof userSignupSchema>;
export type ClinicSetupInput = z.infer<typeof clinicSetupSchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type ScheduleRunCreateInput = z.infer<typeof scheduleRunCreateSchema>;
export type CandidateInput = z.infer<typeof candidateInputSchema>;
export type ScheduleHistoryQuery = z.infer<
  typeof scheduleHistoryQuerySchema
>;
export type ManualAssignmentUpdateInput = z.infer<
  typeof manualAssignmentUpdateSchema
>;

