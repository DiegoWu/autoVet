import { describe, expect, it } from "vitest";

import {
  SESSIONS,
  generateScheduleCandidates,
  prorateWeeklyTargetHours,
  scoreSchedule,
  validateLaborRules,
  validateSchedule,
  validateSchedulerInput,
  type Assignment,
  type Employee,
  type SchedulerConfig,
} from "./index";

const employees: Employee[] = [
  { id: "d1", name: "Dr A", role: "doctor", targetHoursPerWeek: 24 },
  { id: "d2", name: "Dr B", role: "doctor", targetHoursPerWeek: 24 },
  { id: "d3", name: "Dr C", role: "doctor", targetHoursPerWeek: 24 },
  { id: "n1", name: "Nurse A", role: "nurse", targetHoursPerWeek: 24 },
  { id: "n2", name: "Nurse B", role: "nurse", targetHoursPerWeek: 24 },
  { id: "n3", name: "Nurse C", role: "nurse", targetHoursPerWeek: 24 },
];

const config: SchedulerConfig = {
  startDate: "2026-08-10",
  endDate: "2026-08-12",
  seed: "clinic-seed",
  candidateCount: 4,
  coverage: { doctors: 1, nurses: 1 },
};

describe("deterministic candidate generation", () => {
  it("reproduces ranked candidates exactly for the same seed", () => {
    const first = generateScheduleCandidates(employees, [], config);
    const second = generateScheduleCandidates(employees, [], config);

    expect(first.impossible).toBeUndefined();
    expect(second.candidates).toEqual(first.candidates);
    expect(first.candidates).toHaveLength(4);
    expect(new Set(first.candidates.map((candidate) => candidate.id)).size).toBe(4);
    expect(first.candidates.map((candidate) => candidate.rank)).toEqual([1, 2, 3, 4]);
    expect(first.candidates[0]!.score.total).toBeGreaterThanOrEqual(
      first.candidates[1]!.score.total,
    );
  });

  it("changes its candidate set when the seed changes", () => {
    const first = generateScheduleCandidates(employees, [], config);
    const second = generateScheduleCandidates(employees, [], {
      ...config,
      seed: "another-seed",
    });

    expect(second.candidates.map((candidate) => candidate.id)).not.toEqual(
      first.candidates.map((candidate) => candidate.id),
    );
  });

  it("honors fixed session boundaries, coverage, and time off", () => {
    expect(SESSIONS).toEqual({
      morning: { start: "10:00", end: "12:30", hours: 2.5 },
      afternoon: { start: "13:30", end: "17:30", hours: 4 },
      evening: { start: "18:00", end: "22:00", hours: 4 },
    });
    const result = generateScheduleCandidates(
      employees,
      [{ employeeId: "d1", date: "2026-08-10", kind: "day-off" }],
      config,
    );
    const candidate = result.candidates[0]!;

    expect(candidate.assignments.some(
      (assignment) => assignment.employeeId === "d1" && assignment.date === "2026-08-10",
    )).toBe(false);
    expect(
      validateSchedule(
        candidate.assignments,
        employees,
        [{ employeeId: "d1", date: "2026-08-10", kind: "day-off" }],
        config,
      ).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
    expect(candidate.assignments.some((assignment) => assignment.role === "doctor")).toBe(true);
    expect(candidate.assignments.some((assignment) => assignment.role === "nurse")).toBe(true);
  });

  it("generates a doctor-only schedule when nurse coverage is zero", () => {
    const doctorOnlyConfig: SchedulerConfig = {
      ...config,
      coverage: { doctors: 1, nurses: 0 },
    };
    const result = generateScheduleCandidates(employees, [], doctorOnlyConfig);

    expect(result.impossible).toBeUndefined();
    expect(result.candidates[0]!.assignments.length).toBeGreaterThan(0);
    expect(
      result.candidates[0]!.assignments.every(
        (assignment) => assignment.role === "doctor",
      ),
    ).toBe(true);
    expect(
      validateSchedule(
        result.candidates[0]!.assignments,
        employees,
        [],
        doctorOnlyConfig,
      ).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  it("uses every employee toward their weekly target after minimum coverage", () => {
    const doctors: Employee[] = [
      { id: "d1", name: "Dr A", role: "doctor", targetHoursPerWeek: 4 },
      { id: "d2", name: "Dr B", role: "doctor", targetHoursPerWeek: 4 },
      { id: "d3", name: "Dr C", role: "doctor", targetHoursPerWeek: 16 },
    ];
    const targetConfig: SchedulerConfig = {
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      seed: "target-priority",
      candidateCount: 3,
      coverage: { doctors: 1, nurses: 0 },
    };
    const result = generateScheduleCandidates(doctors, [], targetConfig);
    const candidate = result.candidates[0]!;

    expect(candidate).toBeDefined();
    for (const doctor of doctors) {
      const assignedHours = candidate.assignments
        .filter((assignment) => assignment.employeeId === doctor.id)
        .reduce((total, assignment) => total + assignment.hours, 0);
      expect(assignedHours).toBeGreaterThanOrEqual(
        prorateWeeklyTargetHours(doctor.targetHoursPerWeek, 2),
      );
    }
    expect(
      validateSchedule(candidate.assignments, doctors, [], targetConfig).filter(
        (issue) => issue.severity === "error",
      ),
    ).toEqual([]);
    expect(
      candidate.warnings.some((issue) => issue.code === "TARGET_HOURS_UNMET"),
    ).toBe(false);
  });

  it("prorates a partial week's target using a five-day workweek", () => {
    expect(prorateWeeklyTargetHours(32, 2)).toBeCloseTo(12.8);
    expect(prorateWeeklyTargetHours(32, 5)).toBe(32);
    expect(prorateWeeklyTargetHours(32, 7)).toBe(32);
  });

  it("uses backup doctors only when regular doctors cannot cover a required shift", () => {
    const regular: Employee = {
      id: "regular",
      name: "Regular doctor",
      role: "doctor",
      targetHoursPerWeek: 16,
    };
    const backup: Employee = {
      id: "backup",
      name: "Backup doctor",
      role: "doctor",
      targetHoursPerWeek: 0,
      backupOnly: true,
    };
    const backupConfig: SchedulerConfig = {
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      seed: "backup-priority",
      coverage: { doctors: 1, nurses: 0 },
      maxDoctorsPerShift: 1,
    };

    const covered = generateScheduleCandidates([regular, backup], [], backupConfig);
    expect(
      covered.candidates[0]!.assignments.some(
        (assignment) => assignment.employeeId === backup.id,
      ),
    ).toBe(false);

    const needsBackup = generateScheduleCandidates(
      [regular, backup],
      [{ employeeId: regular.id, date: "2026-08-10", kind: "unavailable" }],
      backupConfig,
    );
    expect(
      needsBackup.candidates[0]!.assignments.every(
        (assignment) => assignment.employeeId === backup.id,
      ),
    ).toBe(true);
  });

  it("never exceeds the configured maximum doctors per shift", () => {
    const doctors: Employee[] = ["d1", "d2", "d3"].map((id) => ({
      id,
      name: id,
      role: "doctor",
      targetHoursPerWeek: 16,
    }));
    const cappedConfig: SchedulerConfig = {
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      seed: "doctor-cap",
      coverage: { doctors: 1, nurses: 0 },
      maxDoctorsPerShift: 2,
    };
    const candidate = generateScheduleCandidates(doctors, [], cappedConfig).candidates[0]!;

    for (const date of ["2026-08-10", "2026-08-11"]) {
      for (const session of ["morning", "afternoon", "evening"] as const) {
        expect(
          candidate.assignments.filter(
            (assignment) =>
              assignment.role === "doctor" &&
              assignment.date === date &&
              assignment.session === session,
          ).length,
        ).toBeLessThanOrEqual(2);
      }
    }
  });

  it("uses a one-doctor cap only on configured dates", () => {
    const doctors: Employee[] = ["d1", "d2", "d3"].map((id) => ({
      id,
      name: id,
      role: "doctor",
      targetHoursPerWeek: 16,
    }));
    const dateCapConfig: SchedulerConfig = {
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      seed: "date-doctor-cap",
      coverage: {doctors: 1, nurses: 0},
      maxDoctorsPerShift: 2,
      maxDoctorsPerShiftByDate: {"2026-08-10": 1},
    };
    const candidate = generateScheduleCandidates(doctors, [], dateCapConfig).candidates[0]!;

    for (const session of ["morning", "afternoon", "evening"] as const) {
      expect(
        candidate.assignments.filter(
          (assignment) =>
            assignment.role === "doctor" &&
            assignment.date === "2026-08-10" &&
            assignment.session === session,
        ).length,
      ).toBeLessThanOrEqual(1);
      expect(
        candidate.assignments.filter(
          (assignment) =>
            assignment.role === "doctor" &&
            assignment.date === "2026-08-11" &&
            assignment.session === session,
        ).length,
      ).toBeLessThanOrEqual(2);
    }
  });

  it("rejects minimum coverage above a date-specific doctor cap", () => {
    const issues = validateSchedulerInput(employees, [], {
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      seed: "date-cap-conflict",
      coverage: {doctors: 2, nurses: 1},
      maxDoctorsPerShift: 2,
      maxDoctorsPerShiftByDate: {"2026-08-10": 1},
    });

    expect(
      issues.some(
        (issue) => issue.code === "DOCTOR_MINIMUM_EXCEEDS_DATE_MAXIMUM",
      ),
    ).toBe(true);
  });

  it("applies higher minimum coverage to multiple configured popular shifts", () => {
    const popularConfig: SchedulerConfig = {
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      seed: "popular-date",
      coverage: [
        {doctors: 1, nurses: 1},
        {date: "2026-08-10", session: "afternoon", doctors: 2, nurses: 2},
        {date: "2026-08-10", session: "evening", doctors: 2, nurses: 2},
      ],
      maxDoctorsPerShift: 2,
    };
    const candidate = generateScheduleCandidates(employees, [], popularConfig).candidates[0]!;

    for (const session of ["afternoon", "evening"] as const) {
      expect(
        candidate.assignments.filter(
          (assignment) =>
            assignment.date === "2026-08-10" &&
            assignment.session === session &&
            assignment.role === "doctor",
        ).length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        candidate.assignments.filter(
          (assignment) =>
            assignment.date === "2026-08-10" &&
            assignment.session === session &&
            assignment.role === "nurse",
        ).length,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("rejects a popular-date minimum above its one-doctor cap", () => {
    const issues = validateSchedulerInput(employees, [], {
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      seed: "popular-date-conflict",
      coverage: [
        {doctors: 1, nurses: 1},
        {date: "2026-08-10", doctors: 2, nurses: 1},
      ],
      maxDoctorsPerShift: 2,
      maxDoctorsPerShiftByDate: {"2026-08-10": 1},
    });

    expect(
      issues.some((issue) =>
        issue.code === "DOCTOR_MINIMUM_EXCEEDS_MAXIMUM" ||
        issue.code === "DOCTOR_MINIMUM_EXCEEDS_DATE_MAXIMUM"
      ),
    ).toBe(true);
  });
});

describe("weekly pattern scoring", () => {
  it("rewards the same weekday and session across weeks", () => {
    const employee = employees[0]!;
    const repeated: Assignment[] = [
      { employeeId: employee.id, date: "2026-08-10", session: "morning", role: "doctor", hours: 2.5 },
      { employeeId: employee.id, date: "2026-08-17", session: "morning", role: "doctor", hours: 2.5 },
    ];
    const changed: Assignment[] = [
      repeated[0]!,
      { employeeId: employee.id, date: "2026-08-17", session: "afternoon", role: "doctor", hours: 4 },
    ];

    expect(scoreSchedule(repeated, [employee]).weeklyConsistency).toBeGreaterThan(
      scoreSchedule(changed, [employee]).weeklyConsistency,
    );
  });

  it("rewards schedules closer to preferred workdays per week", () => {
    const employee: Employee = {
      id: "d1",
      name: "Dr A",
      role: "doctor",
      targetHoursPerWeek: 6.5,
      preferredDaysPerWeek: 2,
    };
    const compact: Assignment[] = [
      {employeeId: "d1", date: "2026-08-10", session: "morning", role: "doctor", hours: 2.5},
      {employeeId: "d1", date: "2026-08-10", session: "afternoon", role: "doctor", hours: 4},
    ];
    const spread: Assignment[] = [
      compact[0]!,
      {employeeId: "d1", date: "2026-08-11", session: "afternoon", role: "doctor", hours: 4},
    ];

    expect(scoreSchedule(spread, [employee]).targetHourCloseness).toBeGreaterThan(
      scoreSchedule(compact, [employee]).targetHourCloseness,
    );
  });
});

describe("hard constraints and labor boundaries", () => {
  it("rejects assigning the same employee twice in one shift", () => {
    const employee = employees[0]!;
    const duplicate: Assignment = {
      employeeId: employee.id,
      date: "2026-08-10",
      session: "morning",
      role: "doctor",
      hours: 2.5,
    };
    expect(
      validateSchedule(
        [duplicate, {...duplicate}],
        [employee],
        [],
        {
          startDate: "2026-08-10",
          endDate: "2026-08-10",
          seed: "duplicate",
          coverage: {doctors: 1, nurses: 0},
        },
      ).some((issue) => issue.code === "DUPLICATE_SHIFT_ASSIGNMENT"),
    ).toBe(true);
  });

  it("rejects doctors who refuse to share a shift", () => {
    const doctorA: Employee = {
      id: "d1",
      name: "Dr A",
      role: "doctor",
      targetHoursPerWeek: 8,
      preferences: {avoidedCoworkerIds: ["d2"]},
    };
    const doctorB: Employee = {
      id: "d2",
      name: "Dr B",
      role: "doctor",
      targetHoursPerWeek: 8,
    };
    const sharedShift: Assignment[] = [doctorA, doctorB].map((doctor) => ({
      employeeId: doctor.id,
      date: "2026-08-10",
      session: "morning",
      role: "doctor",
      hours: 2.5,
    }));

    expect(
      validateSchedule(sharedShift, [doctorA, doctorB], [], {
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        seed: "avoided-pair",
        coverage: {doctors: 2, nurses: 0},
      }).some((issue) => issue.code === "AVOIDED_COWORKER_PAIR"),
    ).toBe(true);
  });

  it("treats discouraged coworker pairs as soft preferences", () => {
    const doctorA: Employee = {
      id: "d1",
      name: "Dr A",
      role: "doctor",
      targetHoursPerWeek: 2.5,
      preferences: {discouragedCoworkerIds: ["d2"]},
    };
    const doctorB: Employee = {
      id: "d2",
      name: "Dr B",
      role: "doctor",
      targetHoursPerWeek: 2.5,
    };
    const sharedShift: Assignment[] = [doctorA, doctorB].map((doctor) => ({
      employeeId: doctor.id,
      date: "2026-08-10",
      session: "morning",
      role: "doctor",
      hours: 2.5,
    }));
    const validation = validateSchedule(sharedShift, [doctorA, doctorB], [], {
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      seed: "discouraged-pair",
      coverage: {doctors: 2, nurses: 0},
    });

    expect(validation.some((issue) => issue.code === "AVOIDED_COWORKER_PAIR")).toBe(false);
    expect(scoreSchedule(sharedShift, [doctorA, doctorB]).coworkerPreference).toBeLessThan(0);
  });

  it("enforces exact workdays only when configured as absolute", () => {
    const absolute: Employee = {
      id: "d1",
      name: "Dr A",
      role: "doctor",
      targetHoursPerWeek: 8,
      preferredDaysPerWeek: 2,
      preferredDaysConstraint: "absolute",
    };
    const preferred: Employee = {
      ...absolute,
      preferredDaysConstraint: "preferred",
    };
    const oneDay: Assignment[] = [{
      employeeId: "d1",
      date: "2026-08-10",
      session: "morning",
      role: "doctor",
      hours: 2.5,
    }];
    const twoDayConfig: SchedulerConfig = {
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      seed: "workday-strength",
      coverage: {doctors: 1, nurses: 0},
    };

    expect(
      validateSchedule(oneDay, [absolute], [], twoDayConfig).some(
        (issue) => issue.code === "ABSOLUTE_WORKDAYS_MISMATCH",
      ),
    ).toBe(true);
    expect(
      validateSchedule(oneDay, [preferred], [], twoDayConfig).some(
        (issue) => issue.code === "ABSOLUTE_WORKDAYS_MISMATCH",
      ),
    ).toBe(false);
  });

  it("rejects segmented same-day shifts and allows consecutive shifts", () => {
    const employee = employees[0]!;
    const morningAndEvening: Assignment[] = [
      { employeeId: employee.id, date: "2026-08-10", session: "morning", role: "doctor", hours: 2.5 },
      { employeeId: employee.id, date: "2026-08-10", session: "evening", role: "doctor", hours: 4 },
    ];
    const morningAndAfternoon: Assignment[] = [
      morningAndEvening[0]!,
      { employeeId: employee.id, date: "2026-08-10", session: "afternoon", role: "doctor", hours: 4 },
    ];

    expect(
      validateLaborRules(morningAndEvening, [employee]).some(
        (issue) => issue.code === "NON_CONSECUTIVE_SAME_DAY_SHIFTS",
      ),
    ).toBe(true);
    expect(
      validateLaborRules(morningAndAfternoon, [employee]).some(
        (issue) => issue.code === "NON_CONSECUTIVE_SAME_DAY_SHIFTS",
      ),
    ).toBe(false);
  });

  it("accepts an exact employee weekly maximum and rejects an excess", () => {
    const employee: Employee = {
      id: "d1",
      name: "Dr A",
      role: "doctor",
      targetHoursPerWeek: 42,
      maxHoursPerWeek: 42,
    };
    const exact: Assignment[] = [
      ...(["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"] as const).flatMap(
        (date) => [
          { employeeId: "d1", date, session: "morning", role: "doctor", hours: 2.5 } as const,
          { employeeId: "d1", date, session: "afternoon", role: "doctor", hours: 4 } as const,
          { employeeId: "d1", date, session: "evening", role: "doctor", hours: 4 } as const,
        ],
      ),
    ];

    expect(
      validateLaborRules(exact, [employee]).some(
        (issue) => issue.code === "MAX_WEEKLY_HOURS",
      ),
    ).toBe(false);
    expect(
      validateLaborRules(
        [
          ...exact,
          {
            employeeId: "d1",
            date: "2026-08-14",
            session: "morning",
            role: "doctor",
            hours: 2.5,
          },
        ],
        [employee],
      ).some((issue) => issue.code === "MAX_WEEKLY_HOURS"),
    ).toBe(true);
  });

  it("requires explicit opt-in for flexible four-week rules and enforces 160 hours", () => {
    const flexibleEmployee: Employee = {
      id: "n1",
      name: "Nurse A",
      role: "nurse",
      targetHoursPerWeek: 40,
      flexibleFourWeekOptIn: true,
    };
    const assignments: Assignment[] = Array.from({ length: 16 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10);
      return [
        { employeeId: "n1", date, session: "morning", role: "nurse", hours: 2.5 },
        { employeeId: "n1", date, session: "afternoon", role: "nurse", hours: 4 },
        { employeeId: "n1", date, session: "evening", role: "nurse", hours: 4 },
      ] satisfies Assignment[];
    }).flat();

    const optedIn = validateLaborRules(assignments, [flexibleEmployee], {
      mode: "flexible-four-week",
      flexibleFourWeek: { maxConsecutiveWorkDays: 28 },
    });
    expect(optedIn.some((issue) => issue.code === "MAX_FOUR_WEEK_HOURS")).toBe(true);
    expect(optedIn.some((issue) => issue.code === "FLEXIBLE_RULES_NOT_OPTED_IN")).toBe(false);

    const notOptedIn = validateLaborRules(
      assignments.slice(0, 3),
      [{ ...flexibleEmployee, flexibleFourWeekOptIn: false }],
      { mode: "flexible-four-week" },
    );
    expect(notOptedIn.some((issue) => issue.code === "FLEXIBLE_RULES_NOT_OPTED_IN")).toBe(true);
  });

  it("reports seven consecutive work days as a hard rest-day violation", () => {
    const assignments: Assignment[] = Array.from({ length: 7 }, (_, index) => ({
      employeeId: "d1",
      date: new Date(Date.UTC(2026, 7, 10 + index)).toISOString().slice(0, 10),
      session: "morning",
      role: "doctor",
      hours: 2.5,
    }));
    expect(
      validateLaborRules(assignments, [employees[0]!]).some(
        (issue) => issue.code === "REST_DAY_REQUIRED" && issue.severity === "error",
      ),
    ).toBe(true);
  });
});

describe("infeasibility reporting", () => {
  it("returns uncovered slots when availability makes coverage impossible", () => {
    const result = generateScheduleCandidates(
      [{ id: "d1", name: "Only doctor", role: "doctor", targetHoursPerWeek: 8 }],
      [{ employeeId: "d1", date: "2026-08-10", kind: "unavailable" }],
      {
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        seed: 1,
        coverage: { doctors: 1, nurses: 0 },
      },
    );

    expect(result.candidates).toEqual([]);
    expect(result.impossible?.summary).toContain("No schedule satisfies");
    expect(result.impossible?.uncovered).toHaveLength(3);
    expect(result.issues.some((issue) => issue.code === "IMPOSSIBLE_COVERAGE")).toBe(true);
  });

  it("blocks only the listed sessions for partial-day leave", () => {
    const result = generateScheduleCandidates(
      employees,
      [{ employeeId: "d1", date: "2026-08-10", kind: "day-off", sessions: ["evening"] }],
      config,
    );
    const candidate = result.candidates[0]!;
    expect(candidate.assignments.some(
      (assignment) =>
        assignment.employeeId === "d1" &&
        assignment.date === "2026-08-10" &&
        assignment.session === "evening",
    )).toBe(false);
    expect(candidate.assignments.some(
      (assignment) =>
        assignment.employeeId === "d1" &&
        assignment.date === "2026-08-10" &&
        assignment.session !== "evening",
    )).toBe(true);
  });

  it("keeps whole-day leave blocking every session", () => {
    const result = generateScheduleCandidates(
      employees,
      [{ employeeId: "d1", date: "2026-08-10", kind: "day-off" }],
      config,
    );
    expect(result.candidates[0]!.assignments.some(
      (assignment) => assignment.employeeId === "d1" && assignment.date === "2026-08-10",
    )).toBe(false);
  });

  it("assigns only nurses when Sunday doctor coverage is zero", () => {
    const result = generateScheduleCandidates(employees, [], {
      startDate: "2026-08-16",
      endDate: "2026-08-16",
      seed: "sunday-nurses",
      coverage: [
        { date: "2026-08-16", session: "morning", doctors: 0, nurses: 1 },
        { date: "2026-08-16", session: "afternoon", doctors: 0, nurses: 1 },
        { date: "2026-08-16", session: "evening", doctors: 0, nurses: 1 },
      ],
    });
    const assignments = result.candidates[0]!.assignments;
    expect(assignments.length).toBeGreaterThan(0);
    expect(assignments.every((assignment) => assignment.role === "nurse")).toBe(true);
    expect(assignments.some((assignment) => assignment.role === "doctor")).toBe(false);
  });

  it("reports invalid ranges without attempting generation", () => {
    const result = generateScheduleCandidates(employees, [], {
      ...config,
      startDate: "2026-08-12",
      endDate: "2026-08-10",
    });
    expect(result.impossible?.issues.some(
      (issue) => issue.code === "INVALID_DATE_RANGE",
    )).toBe(true);
  });
});
