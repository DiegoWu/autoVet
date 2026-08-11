import {
  type Assignment,
  type Employee,
  type LaborRuleConfig,
  type LocalDate,
  type ValidationIssue,
} from "./types";

const DAY_MS = 86_400_000;

export const TAIWAN_LABOR_DEFAULTS = {
  standard: {
    regularDailyHours: 8,
    regularWeeklyHours: 40,
    maxDailyHours: 12,
    maxWeeklyHours: 48,
    maxMonthlyOvertimeHours: 46,
    maxConsecutiveWorkDays: 6,
  },
  flexibleFourWeek: {
    regularDailyHours: 10,
    maxDailyHours: 12,
    maxFourWeekHours: 160,
    maxMonthlyOvertimeHours: 54,
    maxThreeMonthOvertimeHours: 138,
    maxConsecutiveWorkDays: 6,
  },
} as const;

export function parseLocalDate(value: LocalDate): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : date;
}

export function enumerateDates(start: LocalDate, end: LocalDate): LocalDate[] {
  const first = parseLocalDate(start);
  const last = parseLocalDate(end);
  if (!first || !last || first > last) return [];
  const dates: LocalDate[] = [];
  for (let time = first.getTime(); time <= last.getTime(); time += DAY_MS) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

export function weekKey(date: LocalDate): string {
  const parsed = parseLocalDate(date);
  if (!parsed) return `invalid:${date}`;
  const day = parsed.getUTCDay() || 7;
  return new Date(parsed.getTime() - (day - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function sumBy(
  assignments: Assignment[],
  key: (assignment: Assignment) => string,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const assignment of assignments) {
    const group = key(assignment);
    totals.set(group, (totals.get(group) ?? 0) + assignment.hours);
  }
  return totals;
}

function rollingMaximum(
  dailyHours: Map<string, number>,
  windowDays: number,
): Array<{ start: string; hours: number }> {
  const days = [...dailyHours.keys()].sort();
  return days.map((start) => {
    const startDate = parseLocalDate(start)!;
    const end = startDate.getTime() + (windowDays - 1) * DAY_MS;
    let hours = 0;
    for (const [date, value] of dailyHours) {
      const time = parseLocalDate(date)?.getTime() ?? Number.POSITIVE_INFINITY;
      if (time >= startDate.getTime() && time <= end) hours += value;
    }
    return { start, hours };
  });
}

/**
 * Central labor validator. Hours above regular-hour thresholds are reported as
 * overtime; absolute daily, configured employee, overtime and rest limits are
 * hard errors.
 */
export function validateLaborRules(
  assignments: Assignment[],
  employees: Employee[],
  config: LaborRuleConfig = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

  for (const employee of employees) {
    const own = assignments.filter((assignment) => assignment.employeeId === employee.id);
    if (own.length === 0) continue;
    const requestedFlexible = config.mode === "flexible-four-week";
    const flexible = requestedFlexible && employee.flexibleFourWeekOptIn === true;
    if (requestedFlexible && !flexible) {
      issues.push({
        severity: "warning",
        code: "FLEXIBLE_RULES_NOT_OPTED_IN",
        message: `${employee.name} has not opted in; standard labor rules were applied.`,
        employeeId: employee.id,
      });
    }

    const daily = sumBy(own, (assignment) => assignment.date);
    const weekly = sumBy(own, (assignment) => weekKey(assignment.date));
    const sessionsByDate = new Map<LocalDate, Set<Assignment["session"]>>();
    for (const assignment of own) {
      const sessions = sessionsByDate.get(assignment.date) ?? new Set();
      sessions.add(assignment.session);
      sessionsByDate.set(assignment.date, sessions);
    }
    const maxDaily = flexible
      ? (config.flexibleFourWeek?.maxDailyHours ??
        TAIWAN_LABOR_DEFAULTS.flexibleFourWeek.maxDailyHours)
      : (config.standard?.maxDailyHours ?? TAIWAN_LABOR_DEFAULTS.standard.maxDailyHours);

    for (const [date, sessions] of sessionsByDate) {
      if (
        sessions.has("morning") &&
        sessions.has("evening") &&
        !sessions.has("afternoon")
      ) {
        issues.push({
          severity: "error",
          code: "NON_CONSECUTIVE_SAME_DAY_SHIFTS",
          message: `${employee.name} has segmented morning and evening shifts on ${date}.`,
          employeeId: employee.id,
          date,
        });
      }
    }

    for (const [date, hours] of daily) {
      if (hours > maxDaily) {
        issues.push({
          severity: "error",
          code: "MAX_DAILY_HOURS",
          message: `${employee.name} has ${hours}h on ${date}, above the ${maxDaily}h daily limit.`,
          employeeId: employee.id,
          date,
        });
      }
      const regularBoundary = flexible
        ? TAIWAN_LABOR_DEFAULTS.flexibleFourWeek.regularDailyHours
        : TAIWAN_LABOR_DEFAULTS.standard.regularDailyHours;
      if (hours > regularBoundary && hours <= maxDaily) {
        issues.push({
          severity: "warning",
          code: "DAILY_OVERTIME",
          message: `${employee.name} requires ${hours - regularBoundary}h daily overtime on ${date}.`,
          employeeId: employee.id,
          date,
        });
      }
    }

    for (const [week, hours] of weekly) {
      const employeeLimit =
        employee.maxHoursPerWeek ??
        (flexible
          ? Number.POSITIVE_INFINITY
          : (config.standard?.maxWeeklyHours ??
            TAIWAN_LABOR_DEFAULTS.standard.maxWeeklyHours));
      if (hours > employeeLimit) {
        issues.push({
          severity: "error",
          code: "MAX_WEEKLY_HOURS",
          message: `${employee.name} has ${hours}h in week ${week}, above the ${employeeLimit}h limit.`,
          employeeId: employee.id,
          date: week,
        });
      } else if (!flexible && hours > TAIWAN_LABOR_DEFAULTS.standard.regularWeeklyHours) {
        issues.push({
          severity: "warning",
          code: "WEEKLY_OVERTIME",
          message: `${employee.name} requires ${hours - 40}h weekly overtime in week ${week}.`,
          employeeId: employee.id,
          date: week,
        });
      }
    }

    if (flexible) {
      const limit =
        config.flexibleFourWeek?.maxFourWeekHours ??
        TAIWAN_LABOR_DEFAULTS.flexibleFourWeek.maxFourWeekHours;
      for (const window of rollingMaximum(daily, 28)) {
        if (window.hours > limit) {
          issues.push({
            severity: "error",
            code: "MAX_FOUR_WEEK_HOURS",
            message: `${employee.name} has ${window.hours}h in the 28-day window starting ${window.start}, above ${limit}h.`,
            employeeId: employee.id,
            date: window.start,
          });
        }
      }
    }

    const monthTotals = sumBy(own, (assignment) => assignment.date.slice(0, 7));
    const regularMonthlyAllowance = flexible ? 160 : 40 * (52 / 12);
    const monthlyOvertimeLimit = flexible
      ? (config.flexibleFourWeek?.maxMonthlyOvertimeHours ??
        TAIWAN_LABOR_DEFAULTS.flexibleFourWeek.maxMonthlyOvertimeHours)
      : (config.standard?.maxMonthlyOvertimeHours ??
        TAIWAN_LABOR_DEFAULTS.standard.maxMonthlyOvertimeHours);
    const overtimeByMonth = new Map<string, number>();
    for (const [month, hours] of monthTotals) {
      const overtime = Math.max(0, hours - regularMonthlyAllowance);
      overtimeByMonth.set(month, overtime);
      if (overtime > monthlyOvertimeLimit) {
        issues.push({
          severity: "error",
          code: "MAX_MONTHLY_OVERTIME",
          message: `${employee.name} exceeds the ${monthlyOvertimeLimit}h monthly overtime limit in ${month}.`,
          employeeId: employee.id,
        });
      }
    }
    if (flexible) {
      const threeMonthLimit =
        config.flexibleFourWeek?.maxThreeMonthOvertimeHours ??
        TAIWAN_LABOR_DEFAULTS.flexibleFourWeek.maxThreeMonthOvertimeHours;
      for (const month of [...overtimeByMonth.keys()].sort()) {
        const [year, monthNumber] = month.split("-").map(Number) as [number, number];
        let overtime = 0;
        for (let offset = 0; offset < 3; offset += 1) {
          const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
          overtime +=
            overtimeByMonth.get(
              `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
            ) ?? 0;
        }
        if (overtime > threeMonthLimit) {
          issues.push({
            severity: "error",
            code: "MAX_THREE_MONTH_OVERTIME",
            message: `${employee.name} has ${overtime}h overtime in the three-month period starting ${month}, above ${threeMonthLimit}h.`,
            employeeId: employee.id,
          });
        }
      }
    }

    const workedDates = new Set(own.map((assignment) => assignment.date));
    const sorted = [...workedDates].sort();
    const maxConsecutive = flexible
      ? (config.flexibleFourWeek?.maxConsecutiveWorkDays ??
        TAIWAN_LABOR_DEFAULTS.flexibleFourWeek.maxConsecutiveWorkDays)
      : (config.standard?.maxConsecutiveWorkDays ??
        TAIWAN_LABOR_DEFAULTS.standard.maxConsecutiveWorkDays);
    let run = 0;
    let previous: Date | undefined;
    for (const value of sorted) {
      const current = parseLocalDate(value)!;
      run = previous && current.getTime() - previous.getTime() === DAY_MS ? run + 1 : 1;
      if (run > maxConsecutive) {
        issues.push({
          severity: "error",
          code: "REST_DAY_REQUIRED",
          message: `${employee.name} works more than ${maxConsecutive} consecutive days ending ${value}.`,
          employeeId: employee.id,
          date: value,
        });
      }
      previous = current;
    }
  }

  for (const assignment of assignments) {
    if (!employeeById.has(assignment.employeeId)) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_EMPLOYEE",
        message: `Assignment references unknown employee ${assignment.employeeId}.`,
        employeeId: assignment.employeeId,
        date: assignment.date,
        session: assignment.session,
      });
    }
  }
  return issues;
}
