import { describe, expect, it } from "vitest";

import {
  SESSIONS,
  generateScheduleCandidates,
  scoreSchedule,
  validateLaborRules,
  validateSchedule,
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
      expect(assignedHours).toBeGreaterThanOrEqual(doctor.targetHoursPerWeek);
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
