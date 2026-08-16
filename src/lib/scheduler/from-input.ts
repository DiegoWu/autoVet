import {addDays, endOfMonth, format, getDay, startOfMonth} from "date-fns";
import {z} from "zod";
import {
  normalizeDaysOff,
  normalizeUnavailableShifts,
  resolveSundayMode,
  SESSION_IDS,
  staffConstraintFields,
  sundayConfigFields,
} from "@/lib/schedule-constraints";
import {generateScheduleCandidates} from "./engine";
import type {CoverageRequirement, SessionId} from "./types";

export const generateScheduleInputSchema = z.object({
  mode: z.enum(["DOCTOR_ONLY", "DOCTOR_NURSE"]).default("DOCTOR_NURSE"),
  candidateCount: z.number().int().min(1).max(20).default(6),
  batch: z.number().int().min(0).default(0),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  staff: z.array(z.object({
    id: z.string(),
    name: z.string(),
    role: z.enum(["DOCTOR", "NURSE"]),
    backupOnly: z.boolean().default(false),
    targetWeeklyHours: z.number(),
    ...staffConstraintFields,
  })),
  preferences: z.array(z.object({fromId: z.string(), toId: z.string()})).default([]),
  avoidances: z.array(z.object({
    fromId: z.string(),
    toId: z.string(),
    strength: z.enum(["ABSOLUTE", "PREFERRED"]).default("ABSOLUTE"),
  })).default([]),
  minDoctors: z.number().int().min(1),
  maxDoctors: z.number().int().min(1),
  minNurses: z.number().int().min(0),
  maxNurses: z.number().int().min(0).default(4),
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
  flexible: z.boolean(),
  attested: z.boolean(),
}).superRefine((input, context) => {
  if (input.maxDoctors < input.minDoctors) {
    context.addIssue({
      code: "custom",
      message: "Maximum doctors must be greater than or equal to minimum doctors",
      path: ["maxDoctors"],
    });
  }
  if (input.maxNurses < input.minNurses) {
    context.addIssue({
      code: "custom",
      message: "Maximum nurses must be greater than or equal to minimum nurses",
      path: ["maxNurses"],
    });
  }
  if (input.mode === "DOCTOR_ONLY" && input.minNurses !== 0) {
    context.addIssue({
      code: "custom",
      message: "Doctor-only schedules must use zero nurse coverage",
      path: ["minNurses"],
    });
  }
  if (input.mode === "DOCTOR_NURSE" && input.minNurses < 1) {
    context.addIssue({
      code: "custom",
      message: "Combined schedules require at least one nurse per shift",
      path: ["minNurses"],
    });
  }
  const seenPopularWeekdays = new Set<number>();
  for (const [index, rule] of input.popularDayRules.entries()) {
    if (seenPopularWeekdays.has(rule.weekday)) {
      context.addIssue({
        code: "custom",
        message: "Each popular weekday may only be configured once",
        path: ["popularDayRules", index, "weekday"],
      });
    }
    seenPopularWeekdays.add(rule.weekday);
    if (resolveSundayMode(input) !== "open" && rule.weekday === 0) continue;
    if (rule.minDoctors > input.maxDoctors) {
      context.addIssue({
        code: "custom",
        message: "Popular-day doctor minimum exceeds the maximum",
        path: ["popularDayRules", index, "minDoctors"],
      });
    }
    if (
      input.singleDoctorWeekdays.includes(rule.weekday) &&
      rule.minDoctors > 1
    ) {
      context.addIssue({
        code: "custom",
        message: "One-doctor weekdays cannot require multiple doctors",
        path: ["popularDayRules", index, "minDoctors"],
      });
    }
    if (input.mode === "DOCTOR_NURSE" && rule.minNurses < 1) {
      context.addIssue({
        code: "custom",
        message: "Combined popular-day rules require at least one nurse",
        path: ["popularDayRules", index, "minNurses"],
      });
    }
    if (rule.minNurses > input.maxNurses) {
      context.addIssue({
        code: "custom",
        message: "Popular-day nurse minimum exceeds the maximum",
        path: ["popularDayRules", index, "minNurses"],
      });
    }
  }
  for (const weekday of input.singleDoctorWeekdays) {
    if (resolveSundayMode(input) !== "open" && weekday === 0) continue;
    const doctorMinimum = input.popularDayRules.find(
      (rule) => rule.weekday === weekday,
    )?.minDoctors ?? input.minDoctors;
    if (doctorMinimum > 1) {
      context.addIssue({
        code: "custom",
        message: "One-doctor weekdays require doctor coverage of one",
        path: ["singleDoctorWeekdays"],
      });
    }
  }
});

export type GenerateScheduleInput = z.infer<typeof generateScheduleInputSchema>;

export function buildGeneratedSchedule(input: GenerateScheduleInput) {
  const sessionIds: SessionId[] = [...SESSION_IDS];
  const activeStaff = input.mode === "DOCTOR_ONLY"
    ? input.staff.filter((employee) => employee.role === "DOCTOR")
    : input.staff;
  const activeIds = new Set(activeStaff.map((employee) => employee.id));
  const activePreferences = input.preferences.filter(
    (preference) =>
      activeIds.has(preference.fromId) &&
      activeIds.has(preference.toId),
  );
  const activeAvoidances = input.avoidances.filter(
    (pair) =>
      activeIds.has(pair.fromId) &&
      activeIds.has(pair.toId) &&
      pair.fromId !== pair.toId,
  );

  const sundayMode = resolveSundayMode(input);
  const first = startOfMonth(new Date(`${input.month}-01T12:00:00`));
  const last = endOfMonth(first);
  const coverage: CoverageRequirement[] = [];
  const maxDoctorsPerShiftByDate: Record<string, number> = {};
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const weekday = getDay(date);
    if (sundayMode === "closed" && weekday === 0) continue;
    const dateKey = format(date, "yyyy-MM-dd");
    const nursesOnlySunday = sundayMode === "nurses_only" && weekday === 0;
    const popularRule = nursesOnlySunday
      ? undefined
      : input.popularDayRules.find((rule) => rule.weekday === weekday);
    if (!nursesOnlySunday && input.singleDoctorWeekdays.includes(weekday)) {
      maxDoctorsPerShiftByDate[dateKey] = 1;
    }
    for (const session of sessionIds) {
      const popularShiftRule = popularRule?.sessions.includes(session)
        ? popularRule
        : undefined;
      coverage.push({
        date: dateKey,
        session,
        doctors: nursesOnlySunday ? 0 : (popularShiftRule?.minDoctors ?? input.minDoctors),
        nurses: input.mode === "DOCTOR_ONLY"
          ? 0
          : (popularShiftRule?.minNurses ?? input.minNurses),
      });
    }
  }

  const result = generateScheduleCandidates(
    activeStaff.map((employee) => ({
      id: employee.id,
      name: employee.name,
      role: employee.role === "DOCTOR" ? "doctor" as const : "nurse" as const,
      backupOnly: employee.backupOnly,
      targetHoursPerWeek: employee.targetWeeklyHours,
      preferredDaysPerWeek: employee.preferredDaysPerWeek,
      preferredDaysConstraint: employee.daysPerWeekConstraintStrength === "ABSOLUTE"
        ? "absolute" as const
        : "preferred" as const,
      maxHoursPerWeek: 48,
      flexibleFourWeekOptIn: input.flexible && input.attested,
      preferences: {
        preferredCoworkerIds: activePreferences.filter((item) => item.fromId === employee.id).map((item) => item.toId),
        avoidedCoworkerIds: activeAvoidances.flatMap((pair) =>
          pair.strength === "ABSOLUTE"
            ? pair.fromId === employee.id
              ? [pair.toId]
              : pair.toId === employee.id
                ? [pair.fromId]
                : []
            : [],
        ),
        discouragedCoworkerIds: activeAvoidances.flatMap((pair) =>
          pair.strength === "PREFERRED"
            ? pair.fromId === employee.id
              ? [pair.toId]
              : pair.toId === employee.id
                ? [pair.fromId]
                : []
            : [],
        ),
        avoidedDates: employee.weekdayConstraintStrength === "PREFERRED"
          ? [...new Set(coverage
            .filter((requirement) => {
              if (!requirement.date) return false;
              const weekday = getDay(new Date(`${requirement.date}T12:00:00`));
              const shifts = normalizeUnavailableShifts(employee);
              const dayShifts = shifts.find((item) => item.weekday === weekday);
              return Boolean(dayShifts && dayShifts.sessions.length === SESSION_IDS.length);
            })
            .map((requirement) => requirement.date!)
          )]
          : [],
      },
    })),
    activeStaff.flatMap((employee) => {
      const daysOff = normalizeDaysOff(employee.daysOff);
      const shifts = normalizeUnavailableShifts(employee);
      const recurringDaysOff: Array<{
        employeeId: string;
        date: string;
        kind: "unavailable";
        sessions: SessionId[];
      }> = [];
      for (let date = first; date <= last; date = addDays(date, 1)) {
        const dayShifts = shifts.find((item) => item.weekday === getDay(date));
        if (employee.weekdayConstraintStrength === "ABSOLUTE" && dayShifts) {
          recurringDaysOff.push({
            employeeId: employee.id,
            date: format(date, "yyyy-MM-dd"),
            kind: "unavailable",
            sessions: dayShifts.sessions,
          });
        }
      }
      return [
        ...daysOff.map((entry) => ({
          employeeId: employee.id,
          date: entry.date,
          kind: "day-off" as const,
          sessions: entry.sessions,
        })),
        ...recurringDaysOff,
      ];
    }),
    {
      startDate: format(first, "yyyy-MM-dd"),
      endDate: format(last, "yyyy-MM-dd"),
      seed: `${input.mode}:${input.month}:${input.batch}:${activeStaff.map((employee) => employee.id).join(",")}`,
      candidateCount: input.candidateCount,
      coverage,
      maxDoctorsPerShift: input.maxDoctors,
      maxDoctorsPerShiftByDate,
      maxNursesPerShift: input.maxNurses,
      laborRules: {mode: input.flexible ? "flexible-four-week" : "standard"},
    },
  );

  if (result.impossible || result.candidates.length === 0) {
    return {candidates: [], impossible: result.impossible, issues: result.issues};
  }

  const staffById = new Map(activeStaff.map((employee) => [employee.id, employee]));
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
      id: candidate.id,
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
  return {candidates, issues: result.issues};
}
