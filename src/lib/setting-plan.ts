import {z} from "zod";
import {
  sessionIdSchema,
  staffConstraintFields,
  sundayModeSchema,
  unavailableShiftSchema,
} from "@/lib/schedule-constraints";

export const settingPlanPayloadSchema = z.object({
  sundayMode: sundayModeSchema,
  minDoctors: z.number().int().min(1),
  maxDoctors: z.number().int().min(1),
  minNurses: z.number().int().min(0),
  singleDoctorWeekdays: z.array(z.number().int().min(0).max(6)).default([]),
  popularDayRules: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    sessions: z.array(sessionIdSchema).min(1),
    minDoctors: z.number().int().min(1).max(10),
    minNurses: z.number().int().min(0).max(10),
  })).default([]),
  flex: z.boolean(),
  attested: z.boolean(),
  preferences: z.array(z.object({
    fromId: z.string().min(1),
    toId: z.string().min(1),
  })).default([]),
  avoidances: z.array(z.object({
    fromId: z.string().min(1),
    toId: z.string().min(1),
    strength: z.enum(["ABSOLUTE", "PREFERRED"]).default("ABSOLUTE"),
  })).default([]),
  employees: z.array(z.object({
    id: z.string().min(1),
    daysOff: staffConstraintFields.daysOff,
    unavailableShifts: z.array(unavailableShiftSchema).default([]),
    preferredDaysPerWeek: z.number().int().min(1).max(7).default(5),
    weekdayConstraintStrength: z.enum(["ABSOLUTE", "PREFERRED"]).default("ABSOLUTE"),
    daysPerWeekConstraintStrength: z.enum(["ABSOLUTE", "PREFERRED"]).default("PREFERRED"),
  })).default([]),
}).strict();

export type SettingPlanPayload = z.infer<typeof settingPlanPayloadSchema>;
