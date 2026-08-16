export const SESSIONS = {
  morning: { start: "10:00", end: "12:30", hours: 2.5 },
  afternoon: { start: "13:30", end: "17:30", hours: 4 },
  evening: { start: "18:00", end: "22:00", hours: 4 },
} as const;

export type SessionId = keyof typeof SESSIONS;
export type EmployeeRole = "doctor" | "nurse";
export type LocalDate = string;

export interface EmployeePreferences {
  preferredCoworkerIds?: string[];
  avoidedCoworkerIds?: string[];
  discouragedCoworkerIds?: string[];
  preferredSessions?: SessionId[];
  avoidedSessions?: SessionId[];
  preferredDates?: LocalDate[];
  avoidedDates?: LocalDate[];
}

export interface Employee {
  id: string;
  name: string;
  role: EmployeeRole;
  targetHoursPerWeek: number;
  /** Target for distinct workdays in a scheduling week. */
  preferredDaysPerWeek?: number;
  preferredDaysConstraint?: "absolute" | "preferred";
  maxHoursPerWeek?: number;
  active?: boolean;
  /** Backup doctors cover otherwise-unfillable required slots only. */
  backupOnly?: boolean;
  /** Required before this employee may be evaluated under four-week rules. */
  flexibleFourWeekOptIn?: boolean;
  preferences?: EmployeePreferences;
}

export interface TimeOff {
  employeeId: string;
  date: LocalDate;
  kind: "unavailable" | "day-off";
  reason?: string;
  /** When omitted, empty, or all three sessions, the whole day is blocked. */
  sessions?: SessionId[];
}

export interface Coverage {
  doctors: number;
  nurses: number;
}

export interface CoverageRequirement extends Coverage {
  date?: LocalDate;
  session?: SessionId;
}

export type LaborRuleMode = "standard" | "flexible-four-week";

export interface LaborRuleConfig {
  mode?: LaborRuleMode;
  standard?: {
    maxDailyHours?: number;
    maxWeeklyHours?: number;
    maxMonthlyOvertimeHours?: number;
    maxConsecutiveWorkDays?: number;
  };
  flexibleFourWeek?: {
    maxDailyHours?: number;
    maxFourWeekHours?: number;
    maxMonthlyOvertimeHours?: number;
    maxThreeMonthOvertimeHours?: number;
    maxConsecutiveWorkDays?: number;
  };
}

export interface ScoreWeights {
  coworkerPreference: number;
  targetHourCloseness: number;
  weekendFairness: number;
  eveningFairness: number;
  continuity: number;
  weeklyConsistency: number;
  overtimeAvoidance: number;
  sessionPreference: number;
}

export interface SchedulerConfig {
  startDate: LocalDate;
  endDate: LocalDate;
  seed: string | number;
  candidateCount?: number;
  coverage: Coverage | CoverageRequirement[];
  maxDoctorsPerShift?: number;
  maxDoctorsPerShiftByDate?: Partial<Record<LocalDate, number>>;
  laborRules?: LaborRuleConfig;
  scoreWeights?: Partial<ScoreWeights>;
}

export interface Assignment {
  employeeId: string;
  date: LocalDate;
  session: SessionId;
  role: EmployeeRole;
  hours: number;
}

export type ValidationSeverity = "warning" | "error";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  employeeId?: string;
  date?: LocalDate;
  session?: SessionId;
}

export interface ScoreBreakdown {
  coworkerPreference: number;
  targetHourCloseness: number;
  weekendFairness: number;
  eveningFairness: number;
  continuity: number;
  weeklyConsistency: number;
  overtimeAvoidance: number;
  sessionPreference: number;
  total: number;
}

export interface ScheduleCandidate {
  rank: number;
  id: string;
  assignments: Assignment[];
  score: ScoreBreakdown;
  warnings: ValidationIssue[];
}

export interface ImpossibleInputReport {
  summary: string;
  issues: ValidationIssue[];
  uncovered: Array<{
    date: LocalDate;
    session: SessionId;
    role: EmployeeRole;
    required: number;
    assigned: number;
  }>;
}

export interface ScheduleResult {
  candidates: ScheduleCandidate[];
  issues: ValidationIssue[];
  impossible?: ImpossibleInputReport;
}
