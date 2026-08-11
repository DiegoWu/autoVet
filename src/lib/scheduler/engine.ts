import {
  SESSIONS,
  type Assignment,
  type Coverage,
  type CoverageRequirement,
  type Employee,
  type EmployeeRole,
  type ImpossibleInputReport,
  type LocalDate,
  type ScheduleCandidate,
  type SchedulerConfig,
  type ScheduleResult,
  type ScoreBreakdown,
  type ScoreWeights,
  type SessionId,
  type TimeOff,
  type ValidationIssue,
} from "./types";
import {
  enumerateDates,
  parseLocalDate,
  validateLaborRules,
  weekKey,
} from "./labor";

const SESSION_IDS = Object.keys(SESSIONS) as SessionId[];
const ROLES: EmployeeRole[] = ["doctor", "nurse"];
const DEFAULT_WEIGHTS: ScoreWeights = {
  coworkerPreference: 5,
  targetHourCloseness: 10,
  weekendFairness: 1,
  eveningFairness: 1,
  continuity: 0.75,
  weeklyConsistency: 6,
  overtimeAvoidance: 3,
  sessionPreference: 1,
};

interface Slot {
  date: LocalDate;
  session: SessionId;
  role: EmployeeRole;
  required: number;
}

interface Attempt {
  assignments: Assignment[];
  issues: ValidationIssue[];
  uncovered: ImpossibleInputReport["uncovered"];
}

function seedHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFactory(seed: string): () => number {
  let state = seedHash(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function offsetLocalDate(date: LocalDate, days: number): LocalDate {
  const parsed = parseLocalDate(date);
  if (!parsed) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function coverageFor(
  coverage: Coverage | CoverageRequirement[],
  date: LocalDate,
  session: SessionId,
): Coverage {
  if (!Array.isArray(coverage)) return coverage;
  let result: Coverage = { doctors: 0, nurses: 0 };
  let specificity = -1;
  for (const requirement of coverage) {
    if (requirement.date && requirement.date !== date) continue;
    if (requirement.session && requirement.session !== session) continue;
    const currentSpecificity = Number(Boolean(requirement.date)) + Number(Boolean(requirement.session));
    if (currentSpecificity >= specificity) {
      result = { doctors: requirement.doctors, nurses: requirement.nurses };
      specificity = currentSpecificity;
    }
  }
  return result;
}

export function validateSchedulerInput(
  employees: Employee[],
  timeOff: TimeOff[],
  config: SchedulerConfig,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dates = enumerateDates(config.startDate, config.endDate);
  if (!parseLocalDate(config.startDate) || !parseLocalDate(config.endDate)) {
    issues.push({
      severity: "error",
      code: "INVALID_DATE",
      message: "Schedule dates must use valid YYYY-MM-DD values.",
    });
  } else if (dates.length === 0) {
    issues.push({
      severity: "error",
      code: "INVALID_DATE_RANGE",
      message: "startDate must be on or before endDate.",
    });
  }

  const seenIds = new Set<string>();
  for (const employee of employees) {
    if (!employee.id.trim() || seenIds.has(employee.id)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_EMPLOYEE_ID",
        message: `Employee id "${employee.id}" is empty or duplicated.`,
        employeeId: employee.id,
      });
    }
    seenIds.add(employee.id);
    if (
      employee.targetHoursPerWeek < 0 ||
      (employee.maxHoursPerWeek !== undefined && employee.maxHoursPerWeek <= 0)
    ) {
      issues.push({
        severity: "error",
        code: "INVALID_EMPLOYEE_HOURS",
        message: `${employee.name} has invalid target or maximum hours.`,
        employeeId: employee.id,
      });
    }
    if (
      employee.maxHoursPerWeek !== undefined &&
      employee.targetHoursPerWeek > employee.maxHoursPerWeek
    ) {
      issues.push({
        severity: "warning",
        code: "TARGET_ABOVE_MAXIMUM",
        message: `${employee.name}'s target exceeds their weekly maximum.`,
        employeeId: employee.id,
      });
    }
  }

  for (const item of timeOff) {
    if (!seenIds.has(item.employeeId)) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_TIME_OFF_EMPLOYEE",
        message: `Time off references unknown employee ${item.employeeId}.`,
        employeeId: item.employeeId,
        date: item.date,
      });
    }
    if (!parseLocalDate(item.date)) {
      issues.push({
        severity: "error",
        code: "INVALID_TIME_OFF_DATE",
        message: `Invalid time-off date ${item.date}.`,
        employeeId: item.employeeId,
        date: item.date,
      });
    }
  }

  const requirements = Array.isArray(config.coverage) ? config.coverage : [config.coverage];
  for (const requirement of requirements) {
    if (
      !Number.isInteger(requirement.doctors) ||
      !Number.isInteger(requirement.nurses) ||
      requirement.doctors < 0 ||
      requirement.nurses < 0
    ) {
      issues.push({
        severity: "error",
        code: "INVALID_COVERAGE",
        message: "Coverage counts must be non-negative integers.",
      });
    }
    if (
      config.maxDoctorsPerShift !== undefined &&
      requirement.doctors > config.maxDoctorsPerShift
    ) {
      issues.push({
        severity: "error",
        code: "DOCTOR_MINIMUM_EXCEEDS_MAXIMUM",
        message: "Minimum doctor coverage cannot exceed the maximum doctors per shift.",
      });
    }
  }
  if (
    config.maxDoctorsPerShift !== undefined &&
    (!Number.isInteger(config.maxDoctorsPerShift) || config.maxDoctorsPerShift < 1)
  ) {
    issues.push({
      severity: "error",
      code: "INVALID_MAX_DOCTORS",
      message: "Maximum doctors per shift must be a positive integer.",
    });
  }
  if (config.candidateCount !== undefined && (!Number.isInteger(config.candidateCount) || config.candidateCount < 1)) {
    issues.push({
      severity: "error",
      code: "INVALID_CANDIDATE_COUNT",
      message: "candidateCount must be a positive integer.",
    });
  }
  return issues;
}

function buildSlots(dates: LocalDate[], config: SchedulerConfig): Slot[] {
  const slots: Slot[] = [];
  for (const date of dates) {
    for (const session of SESSION_IDS) {
      const coverage = coverageFor(config.coverage, date, session);
      for (const role of ROLES) {
        slots.push({
          date,
          session,
          role,
          required: role === "doctor" ? coverage.doctors : coverage.nurses,
        });
      }
    }
  }
  return slots.filter((slot) => slot.required > 0);
}

function scheduleSignature(assignments: Assignment[]): string {
  return [...assignments]
    .sort((left, right) =>
      `${left.date}|${left.session}|${left.employeeId}`.localeCompare(
        `${right.date}|${right.session}|${right.employeeId}`,
      ),
    )
    .map((assignment) => `${assignment.date}:${assignment.session}:${assignment.employeeId}`)
    .join("|");
}

function isHardValid(
  proposed: Assignment[],
  employees: Employee[],
  config: SchedulerConfig,
): boolean {
  return !validateLaborRules(proposed, employees, config.laborRules).some(
    (issue) => issue.severity === "error",
  );
}

function runAttempt(
  employees: Employee[],
  timeOff: TimeOff[],
  slots: Slot[],
  config: SchedulerConfig,
  attemptNumber: number,
): Attempt {
  const random = randomFactory(`${String(config.seed)}:${attemptNumber}`);
  const assignments: Assignment[] = [];
  const unavailable = new Set(timeOff.map((item) => `${item.employeeId}|${item.date}`));
  const activeEmployees = employees.filter((employee) => employee.active !== false);
  const uncovered: Attempt["uncovered"] = [];

  const orderedSlots = [...slots].sort((left, right) => {
    const leftPool = activeEmployees.filter(
      (employee) =>
        employee.role === left.role && !unavailable.has(`${employee.id}|${left.date}`),
    ).length;
    const rightPool = activeEmployees.filter(
      (employee) =>
        employee.role === right.role && !unavailable.has(`${employee.id}|${right.date}`),
    ).length;
    return (
      leftPool - left.required - (rightPool - right.required) ||
      `${left.date}|${left.session}|${left.role}`.localeCompare(
        `${right.date}|${right.session}|${right.role}`,
      )
    );
  });

  for (const slot of orderedSlots) {
    let assigned = 0;
    while (assigned < slot.required) {
      const weeklyHours = new Map<string, number>();
      for (const assignment of assignments) {
        const key = `${assignment.employeeId}|${weekKey(assignment.date)}`;
        weeklyHours.set(key, (weeklyHours.get(key) ?? 0) + assignment.hours);
      }
      const candidates = activeEmployees
        .filter(
          (employee) =>
            employee.role === slot.role &&
            !unavailable.has(`${employee.id}|${slot.date}`) &&
            !assignments.some(
              (assignment) =>
                assignment.employeeId === employee.id &&
                assignment.date === slot.date &&
                assignment.session === slot.session,
            ),
        )
        .map((employee) => {
          const assignment: Assignment = {
            employeeId: employee.id,
            date: slot.date,
            session: slot.session,
            role: employee.role,
            hours: SESSIONS[slot.session].hours,
          };
          const valid = isHardValid([...assignments, assignment], employees, config);
          const hours = weeklyHours.get(`${employee.id}|${weekKey(slot.date)}`) ?? 0;
          const targetCompletion =
            employee.targetHoursPerWeek > 0
              ? (hours + assignment.hours) / employee.targetHoursPerWeek
              : 10_000;
          const preference =
            employee.preferences?.preferredSessions?.includes(slot.session) ? -2 : 0;
          const avoidance =
            employee.preferences?.avoidedSessions?.includes(slot.session) ? 3 : 0;
          const weeklyPatternMatch = assignments.some(
            (existing) =>
              existing.employeeId === employee.id &&
              existing.session === slot.session &&
              (
                existing.date === offsetLocalDate(slot.date, -7) ||
                existing.date === offsetLocalDate(slot.date, 7)
              ),
          );
          return {
            employee,
            assignment,
            valid,
            backupPriority: employee.backupOnly ? 1 : 0,
            priority:
              targetCompletion +
              (weeklyPatternMatch ? -0.2 : 0) +
              preference * 0.03 +
              avoidance * 0.03 +
              random() * 0.05,
          };
        })
        .filter((candidate) => candidate.valid)
        .sort(
          (left, right) =>
            left.backupPriority - right.backupPriority ||
            left.priority - right.priority ||
            left.employee.id.localeCompare(right.employee.id),
        );
      const selected = candidates[0];
      if (!selected) break;
      assignments.push(selected.assignment);
      assigned += 1;
    }
    if (assigned < slot.required) {
      uncovered.push({ ...slot, assigned });
    }
  }

  // Coverage is the hard floor. Once every required role is present, use open
  // sessions to move each employee toward their individual weekly target.
  // This permits intentional overstaffing because coverage values are minima.
  if (uncovered.length === 0) {
    const weeks = [...new Set(orderedSlots.map((slot) => weekKey(slot.date)))].sort();
    for (const week of weeks) {
      let added = true;
      while (added) {
        added = false;
        const hoursByEmployee = new Map<string, number>();
        for (const assignment of assignments) {
          if (weekKey(assignment.date) !== week) continue;
          hoursByEmployee.set(
            assignment.employeeId,
            (hoursByEmployee.get(assignment.employeeId) ?? 0) + assignment.hours,
          );
        }

        const underTarget = activeEmployees
          .filter((employee) => !employee.backupOnly)
          .filter((employee) => {
            const current = hoursByEmployee.get(employee.id) ?? 0;
            return employee.targetHoursPerWeek > current;
          })
          .sort((left, right) => {
            const leftRatio =
              (hoursByEmployee.get(left.id) ?? 0) / left.targetHoursPerWeek;
            const rightRatio =
              (hoursByEmployee.get(right.id) ?? 0) / right.targetHoursPerWeek;
            return leftRatio - rightRatio || left.id.localeCompare(right.id);
          });

        for (const employee of underTarget) {
          const current = hoursByEmployee.get(employee.id) ?? 0;
          const remaining = employee.targetHoursPerWeek - current;
          const options = orderedSlots
            .filter(
              (slot) =>
                slot.role === employee.role &&
                weekKey(slot.date) === week &&
                !unavailable.has(`${employee.id}|${slot.date}`) &&
                !(
                  employee.role === "doctor" &&
                  config.maxDoctorsPerShift !== undefined &&
                  assignments.filter(
                    (assignment) =>
                      assignment.role === "doctor" &&
                      assignment.date === slot.date &&
                      assignment.session === slot.session,
                  ).length >= config.maxDoctorsPerShift
                ) &&
                !assignments.some(
                  (assignment) =>
                    assignment.employeeId === employee.id &&
                    assignment.date === slot.date &&
                    assignment.session === slot.session,
                ),
            )
            .map((slot) => {
              const assignment: Assignment = {
                employeeId: employee.id,
                date: slot.date,
                session: slot.session,
                role: employee.role,
                hours: SESSIONS[slot.session].hours,
              };
              return {
                assignment,
                remainingAfter: remaining - assignment.hours,
                weeklyPatternMatch: assignments.some(
                  (existing) =>
                    existing.employeeId === employee.id &&
                    existing.session === slot.session &&
                    (
                      existing.date === offsetLocalDate(slot.date, -7) ||
                      existing.date === offsetLocalDate(slot.date, 7)
                    ),
                ),
                tieBreaker: random(),
                valid: isHardValid([...assignments, assignment], employees, config),
              };
            })
            .filter((option) => option.valid)
            .sort(
              (left, right) =>
                Math.abs(left.remainingAfter) - Math.abs(right.remainingAfter) ||
                Number(right.weeklyPatternMatch) - Number(left.weeklyPatternMatch) ||
                left.tieBreaker - right.tieBreaker,
            );

          const selected = options[0];
          if (!selected) continue;
          assignments.push(selected.assignment);
          added = true;
          break;
        }
      }
    }
  }

  const issues = validateLaborRules(assignments, employees, config.laborRules);
  const scheduledWeeks = [...new Set(slots.map((slot) => weekKey(slot.date)))];
  for (const employee of activeEmployees.filter((item) => !item.backupOnly)) {
    for (const week of scheduledWeeks) {
      const assignedHours = assignments
        .filter(
          (assignment) =>
            assignment.employeeId === employee.id &&
            weekKey(assignment.date) === week,
        )
        .reduce((total, assignment) => total + assignment.hours, 0);
      if (assignedHours + 0.01 < employee.targetHoursPerWeek) {
        issues.push({
          severity: "warning",
          code: "TARGET_HOURS_UNMET",
          message: `${employee.name} has ${assignedHours}h in week ${week}, below the ${employee.targetHoursPerWeek}h target.`,
          employeeId: employee.id,
          date: week,
        });
      }
    }
  }
  return { assignments, issues, uncovered };
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
}

export function scoreSchedule(
  assignments: Assignment[],
  employees: Employee[],
  weights: Partial<ScoreWeights> = {},
): ScoreBreakdown {
  const applied = { ...DEFAULT_WEIGHTS, ...weights };
  const byEmployee = new Map(employees.map((employee) => [employee.id, employee]));
  const weeklyHours = new Map<string, number>();
  const weekend = new Map<string, number>();
  const evenings = new Map<string, number>();
  let coworker = 0;
  let continuity = 0;
  let weeklyConsistency = 0;
  let sessionPreference = 0;

  for (const assignment of assignments) {
    const employee = byEmployee.get(assignment.employeeId);
    if (!employee) continue;
    const weeklyKey = `${employee.id}|${weekKey(assignment.date)}`;
    weeklyHours.set(weeklyKey, (weeklyHours.get(weeklyKey) ?? 0) + assignment.hours);
    const day = parseLocalDate(assignment.date)?.getUTCDay();
    if (day === 0 || day === 6) {
      weekend.set(employee.id, (weekend.get(employee.id) ?? 0) + assignment.hours);
    }
    if (assignment.session === "evening") {
      evenings.set(employee.id, (evenings.get(employee.id) ?? 0) + assignment.hours);
    }
    if (employee.preferences?.preferredSessions?.includes(assignment.session)) sessionPreference += 1;
    if (employee.preferences?.avoidedSessions?.includes(assignment.session)) sessionPreference -= 1;

    const peers = assignments.filter(
      (other) =>
        other.date === assignment.date &&
        other.session === assignment.session &&
        other.employeeId !== employee.id,
    );
    coworker += peers.filter((peer) =>
      employee.preferences?.preferredCoworkerIds?.includes(peer.employeeId),
    ).length;
    coworker -= peers.filter((peer) =>
      employee.preferences?.avoidedCoworkerIds?.includes(peer.employeeId),
    ).length;
  }

  for (const employee of employees) {
    const own = assignments
      .filter((assignment) => assignment.employeeId === employee.id)
      .sort((left, right) => left.date.localeCompare(right.date));
    const ownPatterns = new Set(
      own.map((assignment) => `${assignment.date}|${assignment.session}`),
    );
    for (const assignment of own) {
      if (
        ownPatterns.has(
          `${offsetLocalDate(assignment.date, 7)}|${assignment.session}`,
        )
      ) {
        weeklyConsistency += 1;
      }
    }
    for (let index = 1; index < own.length; index += 1) {
      const previous = parseLocalDate(own[index - 1]!.date)!;
      const current = parseLocalDate(own[index]!.date)!;
      if (
        current.getTime() - previous.getTime() === 86_400_000 &&
        own[index - 1]!.session === own[index]!.session
      ) {
        continuity += 1;
      }
    }
  }

  let targetDistance = 0;
  let overtime = 0;
  const weeks = new Set(assignments.map((assignment) => weekKey(assignment.date)));
  for (const employee of employees.filter(
    (item) => item.active !== false && !item.backupOnly,
  )) {
    for (const week of weeks) {
      const hours = weeklyHours.get(`${employee.id}|${week}`) ?? 0;
      targetDistance += Math.abs(hours - employee.targetHoursPerWeek);
      overtime += Math.max(0, hours - 40);
    }
  }

  const activeIds = employees
    .filter((employee) => employee.active !== false && !employee.backupOnly)
    .map((employee) => employee.id);
  const breakdown = {
    coworkerPreference: coworker * applied.coworkerPreference,
    targetHourCloseness: -targetDistance * applied.targetHourCloseness,
    weekendFairness:
      -variance(activeIds.map((id) => weekend.get(id) ?? 0)) * applied.weekendFairness,
    eveningFairness:
      -variance(activeIds.map((id) => evenings.get(id) ?? 0)) * applied.eveningFairness,
    continuity: continuity * applied.continuity,
    weeklyConsistency: weeklyConsistency * applied.weeklyConsistency,
    overtimeAvoidance: -overtime * applied.overtimeAvoidance,
    sessionPreference: sessionPreference * applied.sessionPreference,
    total: 0,
  };
  breakdown.total =
    breakdown.coworkerPreference +
    breakdown.targetHourCloseness +
    breakdown.weekendFairness +
    breakdown.eveningFairness +
    breakdown.continuity +
    breakdown.weeklyConsistency +
    breakdown.overtimeAvoidance +
    breakdown.sessionPreference;
  return breakdown;
}

export function validateSchedule(
  assignments: Assignment[],
  employees: Employee[],
  timeOff: TimeOff[],
  config: SchedulerConfig,
): ValidationIssue[] {
  const issues = validateLaborRules(assignments, employees, config.laborRules);
  const dates = enumerateDates(config.startDate, config.endDate);
  const unavailable = new Set(timeOff.map((item) => `${item.employeeId}|${item.date}`));
  const assignmentKeys = new Set<string>();
  for (const assignment of assignments) {
    const assignmentKey = `${assignment.employeeId}|${assignment.date}|${assignment.session}`;
    if (assignmentKeys.has(assignmentKey)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_SHIFT_ASSIGNMENT",
        message: `${assignment.employeeId} is assigned more than once to ${assignment.date} ${assignment.session}.`,
        employeeId: assignment.employeeId,
        date: assignment.date,
        session: assignment.session,
      });
    }
    assignmentKeys.add(assignmentKey);
    if (unavailable.has(`${assignment.employeeId}|${assignment.date}`)) {
      issues.push({
        severity: "error",
        code: "ASSIGNED_DURING_TIME_OFF",
        message: `${assignment.employeeId} is assigned during time off.`,
        employeeId: assignment.employeeId,
        date: assignment.date,
        session: assignment.session,
      });
    }
  }
  for (const slot of buildSlots(dates, config)) {
    const count = assignments.filter(
      (assignment) =>
        assignment.date === slot.date &&
        assignment.session === slot.session &&
        assignment.role === slot.role,
    ).length;
    if (count < slot.required) {
      issues.push({
        severity: "error",
        code: "INSUFFICIENT_COVERAGE",
        message: `${slot.date} ${slot.session} needs ${slot.required} ${slot.role}(s), but has ${count}.`,
        date: slot.date,
        session: slot.session,
      });
    }
    if (
      slot.role === "doctor" &&
      config.maxDoctorsPerShift !== undefined &&
      count > config.maxDoctorsPerShift
    ) {
      issues.push({
        severity: "error",
        code: "MAX_DOCTORS_EXCEEDED",
        message: `${slot.date} ${slot.session} has ${count} doctors, above the maximum of ${config.maxDoctorsPerShift}.`,
        date: slot.date,
        session: slot.session,
      });
    }
  }
  return issues;
}

export function generateScheduleCandidates(
  employees: Employee[],
  timeOff: TimeOff[],
  config: SchedulerConfig,
): ScheduleResult {
  const inputIssues = validateSchedulerInput(employees, timeOff, config);
  if (inputIssues.some((issue) => issue.severity === "error")) {
    return {
      candidates: [],
      issues: inputIssues,
      impossible: {
        summary: "The scheduler input is invalid.",
        issues: inputIssues,
        uncovered: [],
      },
    };
  }

  const dates = enumerateDates(config.startDate, config.endDate);
  const slots = buildSlots(dates, config);
  const requested = config.candidateCount ?? 3;
  const attempts = Math.max(20, requested * 12);
  const distinct = new Map<string, ScheduleCandidate>();
  let bestFailed: Attempt | undefined;

  for (let attemptNumber = 0; attemptNumber < attempts; attemptNumber += 1) {
    const attempt = runAttempt(employees, timeOff, slots, config, attemptNumber);
    if (
      !bestFailed ||
      attempt.uncovered.reduce((sum, item) => sum + item.required - item.assigned, 0) <
        bestFailed.uncovered.reduce((sum, item) => sum + item.required - item.assigned, 0)
    ) {
      bestFailed = attempt;
    }
    if (attempt.uncovered.length > 0 || attempt.issues.some((issue) => issue.severity === "error")) {
      continue;
    }
    const signature = scheduleSignature(attempt.assignments);
    if (!distinct.has(signature)) {
      distinct.set(signature, {
        rank: 0,
        id: `candidate-${seedHash(signature).toString(16).padStart(8, "0")}`,
        assignments: [...attempt.assignments].sort((left, right) =>
          `${left.date}|${left.session}|${left.role}|${left.employeeId}`.localeCompare(
            `${right.date}|${right.session}|${right.role}|${right.employeeId}`,
          ),
        ),
        score: scoreSchedule(attempt.assignments, employees, config.scoreWeights),
        warnings: attempt.issues.filter((issue) => issue.severity === "warning"),
      });
    }
  }

  const candidates = [...distinct.values()]
    .sort(
      (left, right) =>
        right.score.total - left.score.total || left.id.localeCompare(right.id),
    )
    .slice(0, requested)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  if (candidates.length === 0) {
    const failed = bestFailed ?? { assignments: [], issues: [], uncovered: [] };
    const failureIssues: ValidationIssue[] = [
      ...inputIssues,
      ...failed.issues,
      ...failed.uncovered.map(
        (slot): ValidationIssue => ({
          severity: "error",
          code: "IMPOSSIBLE_COVERAGE",
          message: `Could not cover ${slot.date} ${slot.session}: ${slot.assigned}/${slot.required} ${slot.role}s.`,
          date: slot.date,
          session: slot.session,
        }),
      ),
    ];
    return {
      candidates: [],
      issues: failureIssues,
      impossible: {
        summary: "No schedule satisfies all coverage, availability, hour, and labor constraints.",
        issues: failureIssues,
        uncovered: failed.uncovered,
      },
    };
  }

  return { candidates, issues: inputIssues };
}
