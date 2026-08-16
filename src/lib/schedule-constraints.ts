import {z} from "zod";
import type {SessionId} from "@/lib/scheduler";

export const SESSION_IDS = ["morning", "afternoon", "evening"] as const satisfies readonly SessionId[];
export type SundayMode = "closed" | "nurses_only" | "open";

export const sundayModeSchema = z.enum(["closed", "nurses_only", "open"]);
export const sessionIdSchema = z.enum(SESSION_IDS);

export const dayOffEntrySchema = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sessions: z.array(sessionIdSchema).optional(),
  }),
]);

export const unavailableShiftSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  sessions: z.array(sessionIdSchema).min(1),
});

export type DayOffEntry = {
  date: string;
  sessions: SessionId[];
};

export type UnavailableShift = {
  weekday: number;
  sessions: SessionId[];
};

export function isWholeDay(sessions: SessionId[] | undefined): boolean {
  if (!sessions || sessions.length === 0) return true;
  return SESSION_IDS.every((session) => sessions.includes(session));
}

export function normalizeDaysOff(value: unknown): DayOffEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") {
      return [{date: item, sessions: [...SESSION_IDS]}];
    }
    if (item && typeof item === "object" && "date" in item && typeof item.date === "string") {
      const sessions = Array.isArray(item.sessions) && item.sessions.length > 0
        ? item.sessions.filter((session: unknown): session is SessionId =>
          SESSION_IDS.includes(session as SessionId),
        )
        : [...SESSION_IDS];
      return [{date: item.date, sessions: sessions.length ? sessions : [...SESSION_IDS]}];
    }
    return [];
  });
}

export function normalizeUnavailableShifts(input: {
  unavailableShifts?: UnavailableShift[];
  unavailableWeekdays?: number[];
}): UnavailableShift[] {
  if (input.unavailableShifts?.length) return input.unavailableShifts;
  return (input.unavailableWeekdays ?? []).map((weekday) => ({
    weekday,
    sessions: [...SESSION_IDS],
  }));
}

export function resolveSundayMode(input: {
  sundayMode?: SundayMode;
  closedSundays?: boolean;
}): SundayMode {
  if (input.sundayMode) return input.sundayMode;
  if (input.closedSundays === false) return "open";
  return "closed";
}

export function dayOffBlocks(entry: DayOffEntry, date: string, session: SessionId): boolean {
  return entry.date === date && (isWholeDay(entry.sessions) || entry.sessions.includes(session));
}

export function shiftBlocks(
  item: UnavailableShift,
  weekday: number,
  session: SessionId,
): boolean {
  return item.weekday === weekday && (isWholeDay(item.sessions) || item.sessions.includes(session));
}

export const staffConstraintFields = {
  daysOff: z.array(dayOffEntrySchema).default([]),
  unavailableWeekdays: z.array(z.number().int().min(0).max(6)).default([]),
  unavailableShifts: z.array(unavailableShiftSchema).default([]),
  preferredDaysPerWeek: z.number().int().min(1).max(7).default(5),
  weekdayConstraintStrength: z.enum(["ABSOLUTE", "PREFERRED"]).default("ABSOLUTE"),
  daysPerWeekConstraintStrength: z.enum(["ABSOLUTE", "PREFERRED"]).default("PREFERRED"),
};

export const sundayConfigFields = {
  sundayMode: sundayModeSchema.optional(),
  closedSundays: z.boolean().optional(),
};
