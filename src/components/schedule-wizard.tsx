"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import {addDays, endOfMonth, format, getDay, startOfMonth} from "date-fns";
import {Check, ChevronLeft, ChevronRight, Download, FileImage, FileText, PawPrint, Plus, Sparkles, Trash2} from "lucide-react";
import {useLocale, useTranslations} from "next-intl";

type Role = "DOCTOR" | "NURSE";
type StaffRole = Role | "BACKUP_DOCTOR";
type ScheduleMode = "DOCTOR_ONLY" | "DOCTOR_NURSE";
type ConstraintStrength = "ABSOLUTE" | "PREFERRED";
type DaySwapScope = "WEEK" | "MONTH";
type PopularDayRule = {
  weekday: number;
  sessions: Session[];
  minDoctors: number;
  minNurses: number;
};
type Employee = {
  id: string;
  name: string;
  role: Role;
  backupOnly?: boolean;
  targetWeeklyHours: number;
  yearsExperience?: number;
  expertise?: string;
  hobbies?: string;
  daysOff: string[];
  unavailableWeekdays?: number[];
  preferredDaysPerWeek?: number;
  weekdayConstraintStrength?: ConstraintStrength;
  daysPerWeekConstraintStrength?: ConstraintStrength;
};
type Session = "morning" | "afternoon" | "evening";
type Assignment = {date: string; session: Session; employees: Employee[]};
type Preference = {fromId: string; toId: string; strength?: ConstraintStrength};
type Candidate = {
  id: string;
  rank: number;
  score: number;
  coverage: number;
  fairness: number;
  preference: number;
  assignments: Assignment[];
  warnings: string[];
};

const sessions: {id: Session; hours: number; time: string}[] = [
  {id: "morning", hours: 2.5, time: "10:00–12:30"},
  {id: "afternoon", hours: 4, time: "13:30–17:30"},
  {id: "evening", hours: 4, time: "18:00–22:00"},
];
const weekdays = [
  {value: 1, key: "monday"},
  {value: 2, key: "tuesday"},
  {value: 3, key: "wednesday"},
  {value: 4, key: "thursday"},
  {value: 5, key: "friday"},
  {value: 6, key: "saturday"},
  {value: 0, key: "sunday"},
] as const;

const starterStaff: Employee[] = [
  {id: "d1", name: "張嘉欣", role: "DOCTOR", targetWeeklyHours: 40, expertise: "內科", daysOff: []},
  {id: "d2", name: "蔡靜文", role: "DOCTOR", targetWeeklyHours: 32, expertise: "犬貓照護", daysOff: []},
  {id: "n1", name: "廖慧玲", role: "NURSE", targetWeeklyHours: 40, expertise: "住院照護", daysOff: []},
  {id: "n2", name: "陳怡安", role: "NURSE", targetWeeklyHours: 32, expertise: "門診照護", daysOff: []},
];

function monthDates(month: string) {
  const first = startOfMonth(new Date(`${month}-01T12:00:00`));
  const last = endOfMonth(first);
  const dates: Date[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) dates.push(day);
  return dates;
}

function targetHoursForMonth(
  preferredWeeklyHours: number,
  month: string,
  closedSundays: boolean,
) {
  const daysByWeek = new Map<string, number>();
  for (const date of monthDates(month)) {
    if (closedSundays && getDay(date) === 0) continue;
    const daysFromMonday = (getDay(date) + 6) % 7;
    const week = format(addDays(date, -daysFromMonday), "yyyy-MM-dd");
    daysByWeek.set(week, (daysByWeek.get(week) ?? 0) + 1);
  }
  return [...daysByWeek.values()].reduce(
    (total, days) => total + (preferredWeeklyHours / 5) * Math.min(days, 5),
    0,
  );
}

function targetDaysForMonth(
  preferredDaysPerWeek: number,
  month: string,
  closedSundays: boolean,
) {
  const daysByWeek = new Map<string, number>();
  for (const date of monthDates(month)) {
    if (closedSundays && getDay(date) === 0) continue;
    const daysFromMonday = (getDay(date) + 6) % 7;
    const week = format(addDays(date, -daysFromMonday), "yyyy-MM-dd");
    daysByWeek.set(week, (daysByWeek.get(week) ?? 0) + 1);
  }
  return [...daysByWeek.values()].reduce(
    (total, days) => total + Math.min(preferredDaysPerWeek, days),
    0,
  );
}

function makeCandidates(
  employees: Employee[],
  month: string,
  minDoctors: number,
  minNurses: number,
  closedSundays: boolean,
  singleDoctorWeekdays: number[],
  popularDayRules: PopularDayRule[],
  preferences: Preference[],
  avoidances: Preference[],
  candidateCount = 6,
  batch = 0,
): Candidate[] {
  const doctors = employees.filter((employee) => employee.role === "DOCTOR");
  const nurses = employees.filter((employee) => employee.role === "NURSE");
  const activeRules = popularDayRules.filter(
    (rule) => !(closedSundays && rule.weekday === 0),
  );
  const requiredDoctors = Math.max(
    minDoctors,
    ...activeRules.map((rule) => rule.minDoctors),
  );
  const requiredNurses = Math.max(
    minNurses,
    ...activeRules.map((rule) => rule.minNurses),
  );
  if (
    doctors.length < requiredDoctors ||
    nurses.length < requiredNurses ||
    activeRules.some(
      (rule) =>
        singleDoctorWeekdays.includes(rule.weekday) &&
        rule.minDoctors > 1,
    )
  ) return [];
  const targets = new Map(employees.map((employee) => [
    employee.id,
    targetHoursForMonth(employee.targetWeeklyHours, month, closedSundays),
  ]));
  const targetDays = new Map(employees.map((employee) => [
    employee.id,
    targetDaysForMonth(employee.preferredDaysPerWeek ?? 5, month, closedSundays),
  ]));

  return Array.from({length: candidateCount}, (_, index) => batch * candidateCount + index).map((offset) => {
    const assignments: Assignment[] = [];
    const hours = new Map<string, number>(employees.map((employee) => [employee.id, 0]));
    const workDates = new Map<string, Set<string>>(
      employees.map((employee) => [employee.id, new Set<string>()]),
    );
    const warnings: string[] = [];
    let uncovered = 0;

    monthDates(month).forEach((date, dayIndex) => {
      if (closedSundays && getDay(date) === 0) return;
      const dateKey = format(date, "yyyy-MM-dd");
      const popularRule = activeRules.find(
        (rule) => rule.weekday === getDay(date),
      );
      sessions.forEach((session, sessionIndex) => {
        const popularShiftRule = popularRule?.sessions.includes(session.id)
          ? popularRule
          : undefined;
        const assigned: Employee[] = [];
        const assignRole = (pool: Employee[], count: number) => {
          const available = pool
            .filter((employee) => {
              const employeeDates = workDates.get(employee.id) ?? new Set<string>();
              const daysFromMonday = (getDay(date) + 6) % 7;
              const currentWeek = format(addDays(date, -daysFromMonday), "yyyy-MM-dd");
              const workedThisWeek = [...employeeDates].filter((workedDate) => {
                const parsed = new Date(`${workedDate}T12:00:00`);
                return format(addDays(parsed, -((getDay(parsed) + 6) % 7)), "yyyy-MM-dd") === currentWeek;
              });
              return (
                !employee.daysOff.includes(dateKey) &&
                !(
                  employee.weekdayConstraintStrength !== "PREFERRED" &&
                  employee.unavailableWeekdays?.includes(getDay(date))
                ) &&
                !(
                  employee.daysPerWeekConstraintStrength === "ABSOLUTE" &&
                  !employeeDates.has(dateKey) &&
                  workedThisWeek.length >= (employee.preferredDaysPerWeek ?? 5)
                ) &&
                !assigned.some((coworker) => avoidances.some((pair) =>
                  pair.strength !== "PREFERRED" &&
                  (
                    (pair.fromId === employee.id && pair.toId === coworker.id) ||
                    (pair.toId === employee.id && pair.fromId === coworker.id)
                  ),
                ))
              );
            })
            .sort((a, b) => {
              if (a.backupOnly !== b.backupOnly) return a.backupOnly ? 1 : -1;
              const preferredPenalty = (employee: Employee) =>
                Number(
                  employee.weekdayConstraintStrength === "PREFERRED" &&
                  employee.unavailableWeekdays?.includes(getDay(date)),
                ) +
                assigned.filter((coworker) => avoidances.some((pair) =>
                  pair.strength === "PREFERRED" &&
                  (
                    (pair.fromId === employee.id && pair.toId === coworker.id) ||
                    (pair.toId === employee.id && pair.fromId === coworker.id)
                  ),
                )).length;
              const penaltyDifference = preferredPenalty(a) - preferredPenalty(b);
              if (penaltyDifference) return penaltyDifference;
              const targetA = targets.get(a.id) ?? 0;
              const targetB = targets.get(b.id) ?? 0;
              const datesA = workDates.get(a.id) ?? new Set<string>();
              const datesB = workDates.get(b.id) ?? new Set<string>();
              const dayDistanceA = Math.abs(
                datesA.size + Number(!datesA.has(dateKey)) - (targetDays.get(a.id) ?? 0),
              );
              const dayDistanceB = Math.abs(
                datesB.size + Number(!datesB.has(dateKey)) - (targetDays.get(b.id) ?? 0),
              );
              return ((hours.get(a.id) ?? 0) - targetA) - ((hours.get(b.id) ?? 0) - targetB)
                || dayDistanceA - dayDistanceB
                || a.name.localeCompare(b.name);
            });
          for (let i = 0; i < count; i += 1) {
            const employee = available[(dayIndex + sessionIndex + offset + i) % Math.max(available.length, 1)];
            if (employee && !assigned.some((item) => item.id === employee.id)) {
              assigned.push(employee);
              hours.set(employee.id, (hours.get(employee.id) ?? 0) + session.hours);
              workDates.get(employee.id)?.add(dateKey);
            } else {
              uncovered += 1;
            }
          }
        };
        assignRole(
          doctors,
          popularShiftRule?.minDoctors ??
            (singleDoctorWeekdays.includes(getDay(date)) ? 1 : minDoctors),
        );
        assignRole(nurses, popularShiftRule?.minNurses ?? minNurses);
        assignments.push({date: dateKey, session: session.id, employees: assigned});
      });
    });

    const deviations = employees.map((employee) => {
      const target = targets.get(employee.id) ?? 0;
      return Math.abs((hours.get(employee.id) ?? 0) - target) / Math.max(target, 1);
    });
    const fairness = Math.max(0, Math.round(100 - (deviations.reduce((a, b) => a + b, 0) / deviations.length) * 100));
    const coverage = Math.max(0, Math.round(100 - uncovered * 3));
    const matched = preferences.filter((preference) => assignments.some((assignment) =>
      assignment.employees.some((employee) => employee.id === preference.fromId)
      && assignment.employees.some((employee) => employee.id === preference.toId),
    )).length;
    const preference = preferences.length ? Math.round((matched / preferences.length) * 100) - offset * 2 : 100;
    if (uncovered) warnings.push(`${uncovered} session roles are not covered.`);

    return {
      id: `fallback-${batch}-${offset}`,
      rank: offset + 1,
      score: Math.round(coverage * .55 + fairness * .3 + preference * .15),
      coverage,
      fairness,
      preference,
      assignments,
      warnings,
    };
  }).sort((a, b) => b.score - a.score).map((candidate, index) => ({...candidate, rank: index + 1}));
}

const CANDIDATE_BATCH_SIZE = 6;

export function ScheduleWizard() {
  const t = useTranslations();
  const locale = useLocale();
  const scheduleRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("DOCTOR_NURSE");
  const [staff, setStaff] = useState<Employee[]>(starterStaff);
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>("DOCTOR");
  const [hours, setHours] = useState("40");
  const [hourDrafts, setHourDrafts] = useState<Record<string, string>>({});
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const [minDoctors, setMinDoctors] = useState(1);
  const [maxDoctors, setMaxDoctors] = useState(2);
  const [minNurses, setMinNurses] = useState(1);
  const [closedSundays, setClosedSundays] = useState(true);
  const [singleDoctorWeekdays, setSingleDoctorWeekdays] = useState<number[]>([]);
  const [popularDayRules, setPopularDayRules] = useState<PopularDayRule[]>([]);
  const [flex, setFlex] = useState(false);
  const [attested, setAttested] = useState(false);
  const [dayOffEmployee, setDayOffEmployee] = useState("d1");
  const [dayOffDate, setDayOffDate] = useState("");
  const [preferenceFrom, setPreferenceFrom] = useState("d1");
  const [preferenceTo, setPreferenceTo] = useState("n1");
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [avoidFrom, setAvoidFrom] = useState("d1");
  const [avoidTo, setAvoidTo] = useState("d2");
  const [avoidStrength, setAvoidStrength] = useState<ConstraintStrength>("ABSOLUTE");
  const [avoidances, setAvoidances] = useState<Preference[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [candidateBatch, setCandidateBatch] = useState(0);
  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  const [highlightedEmployeeId, setHighlightedEmployeeId] = useState<string | null>(null);
  const [daySwapScope, setDaySwapScope] = useState<DaySwapScope>("WEEK");
  const [generating, setGenerating] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const selected = candidates.find((candidate) => candidate.rank === selectedRank);
  const previewed = candidates[previewIndex];
  const scheduleStaff = useMemo(
    () => scheduleMode === "DOCTOR_ONLY"
      ? staff.filter((employee) => employee.role === "DOCTOR")
      : staff,
    [scheduleMode, staff],
  );
  const scheduleStaffIds = useMemo(
    () => new Set(scheduleStaff.map((employee) => employee.id)),
    [scheduleStaff],
  );
  const schedulePreferences = useMemo(
    () => preferences.filter(
      (preference) =>
        scheduleStaffIds.has(preference.fromId) &&
        scheduleStaffIds.has(preference.toId),
    ),
    [preferences, scheduleStaffIds],
  );
  const doctorColors = useMemo(() => {
    const colors = new Map<string, {backgroundColor: string; borderColor: string; color: string}>();
    scheduleStaff
      .filter((employee) => employee.role === "DOCTOR")
      .sort((left, right) => left.id.localeCompare(right.id))
      .forEach((employee, index) => {
        const hue = Math.round((index * 137.508 + 18) % 360);
        colors.set(employee.id, {
          backgroundColor: `hsl(${hue} 70% 88%)`,
          borderColor: `hsl(${hue} 52% 64%)`,
          color: `hsl(${hue} 52% 25%)`,
        });
      });
    return colors;
  }, [scheduleStaff]);
  const effectiveMinNurses = scheduleMode === "DOCTOR_ONLY" ? 0 : minNurses;
  const activePopularDayRules = popularDayRules.filter(
    (rule) => !(closedSundays && rule.weekday === 0),
  );
  const popularDayConflict = activePopularDayRules.some(
    (rule) =>
      rule.minDoctors > maxDoctors ||
      (singleDoctorWeekdays.includes(rule.weekday) && rule.minDoctors > 1),
  );
  const singleDoctorCoverageConflict = singleDoctorWeekdays.some((weekday) => {
    if (closedSundays && weekday === 0) return false;
    const popularRule = popularDayRules.find((rule) => rule.weekday === weekday);
    return (popularRule?.minDoctors ?? minDoctors) > 1;
  });

  useEffect(() => {
    const stored = localStorage.getItem("autovet.staff");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Employee[];
        queueMicrotask(() => setStaff(parsed));
      } catch { /* Ignore corrupt local fallback. */ }
    }
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem("autovet.avoidances") ?? "[]",
      ) as Preference[];
      queueMicrotask(() => setAvoidances(stored));
    } catch {
      queueMicrotask(() => setAvoidances([]));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("autovet.staff", JSON.stringify(staff));
  }, [staff]);

  useEffect(() => {
    localStorage.setItem("autovet.avoidances", JSON.stringify(avoidances));
  }, [avoidances]);

  useEffect(() => {
    if (step !== 3 || !selected) return;
    const namedPreferences = schedulePreferences.map((preference) => ({
      employee: scheduleStaff.find((item) => item.id === preference.fromId)?.name,
      prefers: scheduleStaff.find((item) => item.id === preference.toId)?.name,
    }));
    fetch("/api/summary", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({locale, preferences: namedPreferences, assignments: selected.assignments}),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => result?.summary?.overview && setAiSummary(result.summary.overview))
      .catch(() => undefined);
  }, [step, selected, schedulePreferences, scheduleStaff, locale]);

  const canContinue = staff.some((employee) => employee.role === "DOCTOR")
    && (
      scheduleMode === "DOCTOR_ONLY" ||
      staff.some((employee) => employee.role === "NURSE")
    );

  function changeScheduleMode(nextMode: ScheduleMode) {
    setScheduleMode(nextMode);
    setCandidates([]);
    setPreviewIndex(0);
    setCandidateBatch(0);
    setSelectedRank(null);
    setHighlightedEmployeeId(null);
    setAiSummary("");
    if (nextMode === "DOCTOR_ONLY" && role === "NURSE") setRole("DOCTOR");
    const firstEligible = staff.find(
      (employee) => nextMode === "DOCTOR_NURSE" || employee.role === "DOCTOR",
    );
    setDayOffEmployee(firstEligible?.id ?? "");
    setPreferenceFrom(firstEligible?.id ?? "");
    setPreferenceTo("");
    const eligibleDoctors = staff.filter((employee) => employee.role === "DOCTOR");
    setAvoidFrom(eligibleDoctors[0]?.id ?? "");
    setAvoidTo(eligibleDoctors[1]?.id ?? "");
  }

  function addEmployee() {
    if (!name.trim()) return;
    setStaff((current) => [...current, {
      id: crypto.randomUUID(),
      name: name.trim(),
      role: role === "NURSE" ? "NURSE" : "DOCTOR",
      backupOnly: role === "BACKUP_DOCTOR",
      targetWeeklyHours: Number(hours) || 0,
      daysOff: [],
    }]);
    setName("");
  }

  function updateEmployee(
    employeeId: string,
    updates: Partial<Pick<Employee, "name" | "targetWeeklyHours" | "role" | "backupOnly" | "unavailableWeekdays" | "preferredDaysPerWeek" | "weekdayConstraintStrength" | "daysPerWeekConstraintStrength">>,
  ) {
    setStaff((current) => current.map((employee) =>
      employee.id === employeeId ? {...employee, ...updates} : employee,
    ));
  }

  function addDayOff() {
    if (!dayOffEmployee || !dayOffDate) return;
    setStaff((current) => current.map((employee) =>
      employee.id === dayOffEmployee && !employee.daysOff.includes(dayOffDate)
        ? {...employee, daysOff: [...employee.daysOff, dayOffDate]}
        : employee,
    ));
    setDayOffDate("");
  }

  function cycleAssignment(date: string, session: Session, employeeId: string) {
    setCandidates((current) => current.map((candidate) => {
      if (candidate.rank !== selectedRank) return candidate;
      let warning = "";
      const clickedDate = new Date(`${date}T12:00:00`);
      const weekStart = format(
        addDays(clickedDate, -((getDay(clickedDate) + 6) % 7)),
        "yyyy-MM-dd",
      );
      const isInClickedWeek = (candidateDate: string) => {
        const parsed = new Date(`${candidateDate}T12:00:00`);
        return format(
          addDays(parsed, -((getDay(parsed) + 6) % 7)),
          "yyyy-MM-dd",
        ) === weekStart;
      };
      const openDaysInWeek = monthDates(month).filter(
        (day) =>
          isInClickedWeek(format(day, "yyyy-MM-dd")) &&
          !(closedSundays && getDay(day) === 0),
      ).length;
      const workedDates = (id: string) => new Set(
        candidate.assignments
          .filter((item) => isInClickedWeek(item.date))
          .filter((item) => item.employees.some((employee) => employee.id === id))
          .map((item) => item.date),
      );
      const assignments = candidate.assignments.map((assignment) => {
        if (assignment.date !== date || assignment.session !== session) return assignment;
        const currentEmployee = assignment.employees.find((employee) => employee.id === employeeId);
        if (!currentEmployee) return assignment;
        const currentRequiredDays = Math.min(
          currentEmployee.preferredDaysPerWeek ?? 5,
          openDaysInWeek,
        );
        const currentHasAnotherShiftThatDay = candidate.assignments.some(
          (item) =>
            item !== assignment &&
            item.date === date &&
            item.employees.some((employee) => employee.id === currentEmployee.id),
        );
        if (
          currentEmployee.daysPerWeekConstraintStrength === "ABSOLUTE" &&
          !currentHasAnotherShiftThatDay &&
          workedDates(currentEmployee.id).size <= currentRequiredDays
        ) return assignment;
        const pool = scheduleStaff.filter((employee) => employee.role === currentEmployee.role);
        const index = pool.findIndex((employee) => employee.id === employeeId);
        const weekday = getDay(new Date(`${date}T12:00:00`));
        const replacement = [...pool.slice(index + 1), ...pool.slice(0, index)]
          .find((employee) =>
            employee.id !== employeeId &&
            !(
              employee.weekdayConstraintStrength !== "PREFERRED" &&
              employee.unavailableWeekdays?.includes(weekday)
            ) &&
            !(
              employee.daysPerWeekConstraintStrength === "ABSOLUTE" &&
              !workedDates(employee.id).has(date) &&
              workedDates(employee.id).size >= Math.min(
                employee.preferredDaysPerWeek ?? 5,
                openDaysInWeek,
              )
            ) &&
            !assignment.employees.some((assigned) =>
              assigned.id !== employeeId &&
              avoidances.some((pair) =>
                pair.strength !== "PREFERRED" &&
                (pair.fromId === employee.id && pair.toId === assigned.id) ||
                pair.strength !== "PREFERRED" &&
                (pair.toId === employee.id && pair.fromId === assigned.id),
              ),
            ) &&
            !assignment.employees.some((assigned) => assigned.id === employee.id),
          );
        if (!replacement || replacement.id === employeeId) return assignment;
        if (replacement.daysOff.includes(date)) warning = `${replacement.name}: requested day off ${date}`;
        return {...assignment, employees: assignment.employees.map((employee) => employee.id === employeeId ? replacement : employee)};
      });
      return {...candidate, assignments, warnings: warning ? [...candidate.warnings, warning] : candidate.warnings};
    }));
  }

  function removeAssignment(date: string, session: Session, employeeId: string) {
    setCandidates((current) => current.map((candidate) => {
      if (candidate.rank !== selectedRank) return candidate;
      let removed: Employee | undefined;
      const assignments = candidate.assignments.map((assignment) => {
        if (assignment.date !== date || assignment.session !== session) return assignment;
        removed = assignment.employees.find((employee) => employee.id === employeeId);
        return {
          ...assignment,
          employees: assignment.employees.filter((employee) => employee.id !== employeeId),
        };
      });
      if (!removed) return candidate;
      const editedShift = assignments.find(
        (assignment) => assignment.date === date && assignment.session === session,
      );
      const roleCount = editedShift?.employees.filter(
        (employee) => employee.role === removed?.role,
      ).length ?? 0;
      const popularRule = popularDayRules.find(
        (rule) =>
          rule.weekday === getDay(new Date(`${date}T12:00:00`)) &&
          rule.sessions.includes(session),
      );
      const minimum = removed.role === "DOCTOR"
        ? popularRule?.minDoctors ?? minDoctors
        : popularRule?.minNurses ?? effectiveMinNurses;
      const warning = roleCount < minimum
        ? (locale === "zh-TW"
          ? `${date} ${session} 低於最低${removed.role === "DOCTOR" ? "醫師" : "護理師"}人數。`
          : `${date} ${session} is below minimum ${removed.role === "DOCTOR" ? "doctor" : "nurse"} coverage.`)
        : "";
      return {
        ...candidate,
        assignments,
        warnings: warning ? [...candidate.warnings, warning] : candidate.warnings,
      };
    }));
  }

  function addAssignment(date: string, session: Session, employeeId: string) {
    const employee = scheduleStaff.find((item) => item.id === employeeId);
    if (!employee) return;
    setCandidates((current) => current.map((candidate) => {
      if (candidate.rank !== selectedRank) return candidate;
      let warning = "";
      const assignments = candidate.assignments.map((assignment) => {
        if (assignment.date !== date || assignment.session !== session) return assignment;
        if (assignment.employees.some((item) => item.id === employee.id)) return assignment;
        const weekday = getDay(new Date(`${date}T12:00:00`));
        if (
          employee.daysOff.includes(date) ||
          (
            employee.weekdayConstraintStrength !== "PREFERRED" &&
            employee.unavailableWeekdays?.includes(weekday)
          )
        ) {
          warning = locale === "zh-TW"
            ? `${employee.name} 在 ${date} 無法出勤。`
            : `${employee.name} is unavailable on ${date}.`;
          return assignment;
        }
        if (assignment.employees.some((coworker) => avoidances.some((pair) =>
          pair.strength !== "PREFERRED" &&
          (
            (pair.fromId === employee.id && pair.toId === coworker.id) ||
            (pair.toId === employee.id && pair.fromId === coworker.id)
          ),
        ))) {
          warning = locale === "zh-TW"
            ? `${employee.name} 與此診次中的醫師不可共同排班。`
            : `${employee.name} cannot work with a doctor in this shift.`;
          return assignment;
        }
        if (employee.role === "DOCTOR") {
          const maximum = singleDoctorWeekdays.includes(weekday) ? 1 : maxDoctors;
          const doctorCount = assignment.employees.filter(
            (item) => item.role === "DOCTOR",
          ).length;
          if (doctorCount >= maximum) {
            warning = locale === "zh-TW"
              ? `${date} ${session} 已達醫師人數上限。`
              : `${date} ${session} is already at its doctor limit.`;
            return assignment;
          }
        }
        return {...assignment, employees: [...assignment.employees, employee]};
      });
      return {
        ...candidate,
        assignments,
        warnings: warning ? [...candidate.warnings, warning] : candidate.warnings,
      };
    }));
  }

  function swapScheduleDays(
    sourceDate: string,
    targetDate: string,
    scope: DaySwapScope,
  ) {
    if (sourceDate === targetDate) return;
    const mapping = new Map<string, string>();
    if (scope === "WEEK") {
      const source = new Date(`${sourceDate}T12:00:00`);
      const target = new Date(`${targetDate}T12:00:00`);
      const sourceDay = (getDay(source) + 6) % 7;
      const targetDay = (getDay(target) + 6) % 7;
      const weekStart = addDays(source, -sourceDay);
      const targetInSourceWeek = format(
        addDays(weekStart, targetDay),
        "yyyy-MM-dd",
      );
      if (
        targetInSourceWeek === sourceDate ||
        !targetInSourceWeek.startsWith(month)
      ) return;
      mapping.set(sourceDate, targetInSourceWeek);
      mapping.set(targetInSourceWeek, sourceDate);
    } else {
      const source = new Date(`${sourceDate}T12:00:00`);
      const target = new Date(`${targetDate}T12:00:00`);
      const sourceDay = (getDay(source) + 6) % 7;
      const targetDay = (getDay(target) + 6) % 7;
      for (const date of monthDates(month)) {
        const day = (getDay(date) + 6) % 7;
        if (day !== sourceDay && day !== targetDay) continue;
        const weekStart = addDays(date, -day);
        const counterpart = addDays(
          weekStart,
          day === sourceDay ? targetDay : sourceDay,
        );
        if (format(counterpart, "yyyy-MM") === month) {
          mapping.set(
            format(date, "yyyy-MM-dd"),
            format(counterpart, "yyyy-MM-dd"),
          );
        }
      }
    }
    if (mapping.size === 0) return;
    const warning = locale === "zh-TW"
      ? "已交換班表日期。請再次確認休假、每週工時與勞動條件。"
      : "Schedule days were swapped. Review leave, weekly hours, and labor constraints.";
    setCandidates((current) => current.map((candidate) =>
      candidate.rank === selectedRank
        ? {
          ...candidate,
          assignments: candidate.assignments.map((assignment) => ({
            ...assignment,
            date: mapping.get(assignment.date) ?? assignment.date,
          })),
          warnings: [...candidate.warnings, warning],
        }
        : candidate,
    ));
    setAiSummary("");
  }

  async function generate({append = false, batch = 0}: {append?: boolean; batch?: number} = {}) {
    setGenerating(true);
    if (!append) {
      setSelectedRank(null);
      setPreviewIndex(0);
    }
    let generated: Candidate[] = [];
    try {
      const response = await fetch("/api/schedules/generate", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          mode: scheduleMode,
          candidateCount: CANDIDATE_BATCH_SIZE,
          batch,
          month,
          staff: scheduleStaff,
          preferences: schedulePreferences,
          avoidances,
          minDoctors,
          maxDoctors,
          minNurses: effectiveMinNurses,
          closedSundays,
          singleDoctorWeekdays,
          popularDayRules,
          flexible: flex,
          attested,
        }),
      });
      const result = await response.json();
      generated = response.ok ? result.candidates as Candidate[] : [];
    } catch {
      generated = makeCandidates(
        scheduleStaff,
        month,
        minDoctors,
        effectiveMinNurses,
        closedSundays,
        singleDoctorWeekdays,
        popularDayRules,
        schedulePreferences,
        avoidances,
        CANDIDATE_BATCH_SIZE,
        batch,
      );
    }
    if (append) {
      const seen = new Set(candidates.map((candidate) => candidate.id));
      const additions = generated.filter((candidate) => !seen.has(candidate.id));
      if (additions.length > 0) setPreviewIndex(candidates.length);
      setCandidates([...candidates, ...additions].map((candidate, index) => ({
        ...candidate,
        rank: index + 1,
      })));
    } else {
      setCandidates(generated.map((candidate, index) => ({...candidate, rank: index + 1})));
    }
    setCandidateBatch(batch);
    setGenerating(false);
  }

  async function exportImage(kind: "png" | "jpg" | "pdf") {
    if (!scheduleRef.current) return;
    const {toJpeg, toPng} = await import("html-to-image");
    const imageOptions = {
      pixelRatio: 2,
      backgroundColor: "#fffdf8",
      filter: (node: HTMLElement) => !node.classList?.contains("no-export"),
    };

    if (kind === "pdf") {
      const {jsPDF} = await import("jspdf");
      const pageImage = await toPng(scheduleRef.current, imageOptions);
      const pageWidth = 297;
      const margin = 8;
      const imageWidth = pageWidth - margin * 2;
      const imageHeight =
        imageWidth *
        (scheduleRef.current.scrollHeight / scheduleRef.current.scrollWidth);
      const pageHeight = imageHeight + margin * 2;
      const pdf = new jsPDF({
        orientation: pageHeight > pageWidth ? "portrait" : "landscape",
        unit: "mm",
        format: [pageWidth, pageHeight],
      });
      pdf.addImage(
        pageImage,
        "PNG",
        margin,
        margin,
        imageWidth,
        imageHeight,
        undefined,
        "FAST",
      );
      pdf.save(`autoVet-${month}.pdf`);
      return;
    }
    const dataUrl = kind === "jpg"
      ? await toJpeg(scheduleRef.current, {...imageOptions, quality: .95})
      : await toPng(scheduleRef.current, imageOptions);
    const link = document.createElement("a");
    link.download = `autoVet-${month}.${kind === "jpg" ? "jpg" : "png"}`;
    link.href = dataUrl;
    link.click();
  }

  async function saveSchedule() {
    if (!selected) return;
    const record = {id: crypto.randomUUID(), mode: scheduleMode, month, closedSundays, status: "SELECTED", staff: scheduleStaff.map((item) => item.name), selected, savedAt: new Date().toISOString()};
    const prior = JSON.parse(localStorage.getItem("autovet.history") ?? "[]") as unknown[];
    localStorage.setItem("autovet.history", JSON.stringify([record, ...prior]));
    try {
      await fetch("/api/schedules", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          mode: scheduleMode,
          month,
          locale,
          staff: scheduleStaff,
          preferences: schedulePreferences,
          avoidances,
          aiSummary: aiSummary || undefined,
          config: {minDoctors, maxDoctors, minNurses: effectiveMinNurses, closedSundays, singleDoctorWeekdays, popularDayRules, flex, attested},
          candidate: selected,
        }),
      });
    } catch { /* Local persistence remains available if the cloud database is not configured. */ }
  }

  function continueToNextStep() {
    if (step === 1) {
      setStep(2);
      void generate();
      return;
    }
    setStep((current) => Math.min(3, current + 1));
  }

  const stepKeys = ["staff", "rules", "generate", "confirm"] as const;

  return (
    <div className="wizard">
      <div className="stepper" role="tablist">
        {stepKeys.map((key, index) => (
          <button
            type="button"
            className={`step ${step === index ? "active" : ""} ${step > index ? "done" : ""}`}
            key={key}
            onClick={() => index <= step && setStep(index)}
          >
            <span className="step-number">{step > index ? <Check size={12} /> : index + 1}</span>
            <span className="step-label">{t(`steps.${key}`)}</span>
          </button>
        ))}
      </div>

      {step === 0 && (
        <section className="panel">
          <div className="panel-head">
            <div><h2>{t("staff.title")}</h2><p className="hint">{t(scheduleMode === "DOCTOR_ONLY" ? "staff.hintDoctorOnly" : "staff.hint")}</p></div>
            <span className="count-pill">{staff.length} {locale === "zh-TW" ? "位成員" : "people"}</span>
          </div>
          <fieldset style={{border: 0, padding: 0, margin: "0 0 20px"}}>
            <legend style={{fontWeight: 700, marginBottom: 10}}>{t("rules.scheduleMode")}</legend>
            <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12}}>
              {(["DOCTOR_ONLY", "DOCTOR_NURSE"] as const).map((mode) => (
                <label
                  className="rule-card"
                  key={mode}
                  style={{
                    cursor: "pointer",
                    borderColor: scheduleMode === mode ? "var(--primary)" : undefined,
                    boxShadow: scheduleMode === mode ? "0 0 0 2px color-mix(in srgb, var(--primary) 20%, transparent)" : undefined,
                  }}
                >
                  <span style={{display: "flex", alignItems: "flex-start", gap: 10}}>
                    <input
                      className="check"
                      type="radio"
                      name="schedule-mode"
                      value={mode}
                      checked={scheduleMode === mode}
                      onChange={() => changeScheduleMode(mode)}
                    />
                    <span>
                      <strong>{t(`rules.${mode === "DOCTOR_ONLY" ? "doctorOnly" : "doctorNurse"}`)}</strong>
                      <span className="hint" style={{display: "block", marginTop: 4}}>{t(`rules.${mode === "DOCTOR_ONLY" ? "doctorOnlyHelp" : "doctorNurseHelp"}`)}</span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="staff-form">
            <div className="field">
              <label htmlFor="staff-name">{t("staff.name")}</label>
              <input id="staff-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="staff-role">{t("staff.role")}</label>
              <select id="staff-role" value={role} onChange={(event) => {
                const nextRole = event.target.value as StaffRole;
                setRole(nextRole);
                if (nextRole === "BACKUP_DOCTOR") setHours("0");
                if (nextRole !== "BACKUP_DOCTOR" && Number(hours) === 0) setHours("40");
              }}>
                <option value="DOCTOR">{t("staff.doctor")}</option>
                {scheduleMode === "DOCTOR_NURSE" && <option value="NURSE">{t("staff.nurse")}</option>}
                <option value="BACKUP_DOCTOR">{t("staff.backupDoctor")}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="staff-hours">{t("staff.hours")}</label>
              <input id="staff-hours" type="number" min={0} max={60} value={hours} onChange={(event) => setHours(event.target.value)} />
            </div>
            <button className="button secondary" type="button" onClick={addEmployee}><Plus size={16} />{t("staff.add")}</button>
          </div>
          {staff.length === 0 ? <div className="empty">{t("staff.empty")}</div> : (
            <div className="staff-list">
              {staff.map((employee) => (
                <div className="staff-row" key={employee.id}>
                  <div className={`avatar ${employee.role === "NURSE" ? "nurse" : ""}`}>{employee.name.slice(0, 1)}</div>
                  <div className="staff-edit-fields">
                    <input
                      className="staff-name-input"
                      aria-label={`${employee.name} ${t("staff.name")}`}
                      value={employee.name}
                      onChange={(event) => updateEmployee(employee.id, {name: event.target.value})}
                    />
                    <label className="staff-hours-input">
                      <span>{t("staff.hours")}</span>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        value={hourDrafts[employee.id] ?? String(employee.targetWeeklyHours)}
                        onChange={(event) => setHourDrafts((current) => ({
                          ...current,
                          [employee.id]: event.target.value,
                        }))}
                        onBlur={() => {
                          const draft = hourDrafts[employee.id];
                          if (draft === undefined) return;
                          updateEmployee(employee.id, {targetWeeklyHours: Number(draft) || 0});
                          setHourDrafts((current) => {
                            const next = {...current};
                            delete next[employee.id];
                            return next;
                          });
                        }}
                      />
                      <span>{t("common.hours")} / {locale === "zh-TW" ? "週" : "week"}</span>
                    </label>
                  </div>
                  <select
                    className="role-tag staff-role-select"
                    aria-label={`${employee.name} ${t("staff.role")}`}
                    value={employee.backupOnly ? "BACKUP_DOCTOR" : employee.role}
                    onChange={(event) => {
                      const nextRole = event.target.value as StaffRole;
                      updateEmployee(employee.id, {
                        role: nextRole === "NURSE" ? "NURSE" : "DOCTOR",
                        backupOnly: nextRole === "BACKUP_DOCTOR",
                        targetWeeklyHours:
                          nextRole === "BACKUP_DOCTOR"
                            ? 0
                            : employee.targetWeeklyHours || 40,
                      });
                      setHourDrafts((current) => ({
                        ...current,
                        [employee.id]:
                          nextRole === "BACKUP_DOCTOR"
                            ? "0"
                            : String(employee.targetWeeklyHours || 40),
                      }));
                    }}
                  >
                    <option value="DOCTOR">{t("staff.doctor")}</option>
                    <option value="NURSE">{t("staff.nurse")}</option>
                    <option value="BACKUP_DOCTOR">{t("staff.backupDoctor")}</option>
                  </select>
                  <button className="button danger" aria-label={t("common.remove")} onClick={() => setStaff((current) => current.filter((item) => item.id !== employee.id))}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {step === 1 && (
        <section className="panel">
          <div className="panel-head"><div><h2>{t("rules.title")}</h2><p className="hint">{locale === "zh-TW" ? "固定早、午、晚三診；週日可設為休診。" : "Three fixed sessions each day, with optional Sunday closure."}</p></div></div>
          <div className="rules-grid">
            <details className="rule-card wide">
              <summary className="accordion-summary">
                <span><strong>{t("rules.coverageGroup")}</strong><span className="hint">{t("rules.coverageGroupHelp")}</span></span>
              </summary>
              <div className="rules-grid" style={{marginTop: 16}}>
            <div className="rule-card field">
              <label htmlFor="month">{t("rules.month")}</label>
              <input id="month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </div>
            <div className="rule-card field">
              <label htmlFor="doctors">{t("rules.minDoctors")}</label>
              <input id="doctors" type="number" min={1} max={10} value={minDoctors} onChange={(event) => {
                const nextMinimum = Number(event.target.value);
                setMinDoctors(nextMinimum);
                setMaxDoctors((current) => Math.max(current, nextMinimum));
              }} />
            </div>
            <div className="rule-card field">
              <label htmlFor="max-doctors">{t("rules.maxDoctors")}</label>
              <input id="max-doctors" type="number" min={minDoctors} max={10} value={maxDoctors} onChange={(event) => setMaxDoctors(Math.max(minDoctors, Number(event.target.value)))} />
            </div>
            <div className="rule-card wide">
              <strong>{t("rules.singleDoctorWeekdays")}</strong>
              <p className="hint" style={{marginTop: 5}}>{t("rules.singleDoctorWeekdaysHelp")}</p>
              <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12}}>
                {weekdays.map((weekday) => {
                  const checked = singleDoctorWeekdays.includes(weekday.value);
                  return (
                    <label className="role-tag" key={weekday.value} style={{display: "flex", alignItems: "center", gap: 6, cursor: "pointer"}}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSingleDoctorWeekdays((current) =>
                          checked
                            ? current.filter((day) => day !== weekday.value)
                            : [...current, weekday.value],
                        )}
                      />
                      {t(`weekdays.${weekday.key}`)}
                    </label>
                  );
                })}
              </div>
              {singleDoctorCoverageConflict && (
                <div className="notice" style={{marginTop: 12}}>{t("rules.singleDoctorConflict")}</div>
              )}
            </div>
            {scheduleMode === "DOCTOR_NURSE" && (
              <div className="rule-card field">
                <label htmlFor="nurses">{t("rules.minNurses")}</label>
                <input id="nurses" type="number" min={1} max={10} value={minNurses} onChange={(event) => setMinNurses(Number(event.target.value))} />
              </div>
            )}
            <div className="rule-card switch-row">
              <div><strong>{t("rules.closedSundays")}</strong><p className="hint">Sunday / 週日</p></div>
              <input className="check" type="checkbox" checked={closedSundays} onChange={(event) => setClosedSundays(event.target.checked)} />
            </div>
              </div>
            </details>
            <details className="rule-card wide">
              <summary className="accordion-summary">
                <span><strong>{t("rules.laborGroup")}</strong><span className="hint">{t("rules.laborGroupHelp")}</span></span>
              </summary>
              <div style={{marginTop: 16}}>
            <div className="rule-card wide">
              <div className="switch-row">
                <div><strong>{t("rules.flex")}</strong><p className="hint">{t("rules.flexHelp")}</p></div>
                <input className="check" type="checkbox" checked={flex} onChange={(event) => { setFlex(event.target.checked); if (!event.target.checked) setAttested(false); }} />
              </div>
              {flex && (
                <label className="notice" style={{display: "flex", alignItems: "center", gap: 9}}>
                  <input className="check" type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} />
                  {t("rules.attest")}
                </label>
              )}
            </div>
              </div>
            </details>
            <details className="rule-card wide">
              <summary className="accordion-summary">
                <span><strong>{t("rules.popularDays")}</strong><span className="hint">{t("rules.popularDaysHelp")}</span></span>
              </summary>
              <div style={{display: "grid", gap: 9, marginTop: 16}}>
                {weekdays.map((weekday) => {
                  const rule = popularDayRules.find(
                    (item) => item.weekday === weekday.value,
                  );
                  const closed = closedSundays && weekday.value === 0;
                  return (
                    <div className="popular-day-row" key={weekday.value}>
                      <label className="role-tag" style={{display: "flex", alignItems: "center", gap: 7, cursor: "pointer"}}>
                        <input
                          type="checkbox"
                          checked={Boolean(rule)}
                          onChange={() => setPopularDayRules((current) =>
                            rule
                              ? current.filter((item) => item.weekday !== weekday.value)
                              : [...current, {
                                weekday: weekday.value,
                                sessions: ["morning"],
                                minDoctors,
                                minNurses: effectiveMinNurses,
                              }],
                          )}
                        />
                        {t(`weekdays.${weekday.key}`)}
                        {closed ? ` · ${t("schedule.closed")}` : ""}
                      </label>
                      <label className="field">
                        <span>{t("rules.popularShift")}</span>
                        <span className="popular-shift-options">
                          {sessions.map((session) => (
                            <label className="role-tag" key={session.id}>
                              <input
                                type="checkbox"
                                disabled={!rule || closed}
                                checked={rule?.sessions.includes(session.id) ?? session.id === "morning"}
                                onChange={() => setPopularDayRules((current) =>
                                  current.map((item) => {
                                    if (item.weekday !== weekday.value) return item;
                                    const selected = item.sessions.includes(session.id);
                                    if (selected && item.sessions.length === 1) return item;
                                    return {
                                      ...item,
                                      sessions: selected
                                        ? item.sessions.filter((itemSession) => itemSession !== session.id)
                                        : [...item.sessions, session.id],
                                    };
                                  }),
                                )}
                              />
                              {t(`schedule.${session.id}`)}
                            </label>
                          ))}
                        </span>
                      </label>
                      <label className="field">
                        <span>{t("rules.popularMinDoctors")}</span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          disabled={!rule || closed}
                          value={rule?.minDoctors ?? minDoctors}
                          onChange={(event) => setPopularDayRules((current) =>
                            current.map((item) => item.weekday === weekday.value
                              ? {...item, minDoctors: Math.max(1, Number(event.target.value) || 1)}
                              : item),
                          )}
                        />
                      </label>
                      {scheduleMode === "DOCTOR_NURSE" ? (
                        <label className="field">
                          <span>{t("rules.popularMinNurses")}</span>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            disabled={!rule || closed}
                            value={rule?.minNurses ?? minNurses}
                            onChange={(event) => setPopularDayRules((current) =>
                              current.map((item) => item.weekday === weekday.value
                                ? {...item, minNurses: Math.max(1, Number(event.target.value) || 1)}
                                : item),
                            )}
                          />
                        </label>
                      ) : <span />}
                    </div>
                  );
                })}
              </div>
              {popularDayConflict && (
                <div className="notice" style={{marginTop: 12}}>{t("rules.popularDayConflict")}</div>
              )}
            </details>
            <details className="rule-card wide">
              <summary className="accordion-summary">
                <span><strong>{t("rules.availabilityGroup")}</strong><span className="hint">{t("rules.availabilityGroupHelp")}</span></span>
              </summary>
              <div style={{marginTop: 16}}>
            <div>
              <strong>{t("rules.doctorWeeklyPreferences")}</strong>
              <p className="hint" style={{marginTop: 5}}>{t("rules.doctorWeeklyPreferencesHelp")}</p>
              <div style={{display: "grid", gap: 12, marginTop: 14}}>
                {scheduleStaff.filter((employee) => employee.role === "DOCTOR").map((doctor) => (
                  <div key={doctor.id} style={{borderTop: "1px solid var(--line)", paddingTop: 12}}>
                    <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap"}}>
                      <strong>{doctor.name}</strong>
                      <label className="field" style={{display: "flex", alignItems: "center", gap: 8}}>
                        <span>{t("rules.preferredDaysPerWeek")}</span>
                        <input
                          type="number"
                          min={1}
                          max={7}
                          value={doctor.preferredDaysPerWeek ?? 5}
                          onChange={(event) => updateEmployee(doctor.id, {
                            preferredDaysPerWeek: Math.min(7, Math.max(1, Number(event.target.value) || 1)),
                          })}
                          style={{width: 70}}
                        />
                        <select
                          aria-label={t("rules.constraintStrength")}
                          value={doctor.daysPerWeekConstraintStrength ?? "PREFERRED"}
                          onChange={(event) => updateEmployee(doctor.id, {
                            daysPerWeekConstraintStrength: event.target.value as ConstraintStrength,
                          })}
                          style={{width: "auto"}}
                        >
                          <option value="ABSOLUTE">{t("rules.absolute")}</option>
                          <option value="PREFERRED">{t("rules.preferred")}</option>
                        </select>
                      </label>
                    </div>
                    <label className="field" style={{display: "flex", alignItems: "center", gap: 8, marginTop: 10}}>
                      <span>{t("rules.unavailableWeekdayStrength")}</span>
                      <select
                        aria-label={t("rules.unavailableWeekdayStrength")}
                        value={doctor.weekdayConstraintStrength ?? "ABSOLUTE"}
                        onChange={(event) => updateEmployee(doctor.id, {
                          weekdayConstraintStrength: event.target.value as ConstraintStrength,
                        })}
                        style={{width: "auto"}}
                      >
                        <option value="ABSOLUTE">{t("rules.absolute")}</option>
                        <option value="PREFERRED">{t("rules.preferred")}</option>
                      </select>
                    </label>
                    <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10}}>
                      {weekdays.map((weekday) => {
                        const checked = doctor.unavailableWeekdays?.includes(weekday.value) ?? false;
                        return (
                          <label className="role-tag" key={weekday.value} style={{display: "flex", alignItems: "center", gap: 6, cursor: "pointer"}}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => updateEmployee(doctor.id, {
                                unavailableWeekdays: checked
                                  ? doctor.unavailableWeekdays?.filter((day) => day !== weekday.value)
                                  : [...(doctor.unavailableWeekdays ?? []), weekday.value],
                              })}
                            />
                            {t(`weekdays.${weekday.key}`)}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
              </div>
            </details>
            <details className="rule-card wide">
              <summary className="accordion-summary">
                <span><strong>{t("rules.compatibilityGroup")}</strong><span className="hint">{t("rules.compatibilityGroupHelp")}</span></span>
              </summary>
              <div style={{marginTop: 16}}>
            <div className="rule-card wide">
              <strong>{t("rules.incompatibleDoctors")}</strong>
              <p className="hint" style={{marginTop: 5}}>{t("rules.incompatibleDoctorsHelp")}</p>
              <div className="staff-form" style={{margin: "14px 0 10px", gridTemplateColumns: "1fr 1fr auto auto"}}>
                <div className="field">
                  <label htmlFor="avoid-from">{t("staff.doctor")}</label>
                  <select id="avoid-from" value={avoidFrom} onChange={(event) => setAvoidFrom(event.target.value)}>
                    <option value="" disabled>{t("common.select")}</option>
                    {scheduleStaff.filter((employee) => employee.role === "DOCTOR").map((doctor) => <option value={doctor.id} key={doctor.id}>{doctor.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="avoid-to">{t("rules.willNotWorkWith")}</label>
                  <select id="avoid-to" value={avoidTo} onChange={(event) => setAvoidTo(event.target.value)}>
                    <option value="" disabled>{t("common.select")}</option>
                    {scheduleStaff.filter((employee) => employee.role === "DOCTOR" && employee.id !== avoidFrom).map((doctor) => <option value={doctor.id} key={doctor.id}>{doctor.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="avoid-strength">{t("rules.constraintStrength")}</label>
                  <select id="avoid-strength" value={avoidStrength} onChange={(event) => setAvoidStrength(event.target.value as ConstraintStrength)}>
                    <option value="ABSOLUTE">{t("rules.absolute")}</option>
                    <option value="PREFERRED">{t("rules.preferred")}</option>
                  </select>
                </div>
                <button className="button secondary" type="button" onClick={() => {
                  if (!avoidFrom || !avoidTo || avoidFrom === avoidTo) return;
                  setAvoidances((current) => current.some((pair) =>
                    (pair.fromId === avoidFrom && pair.toId === avoidTo) ||
                    (pair.fromId === avoidTo && pair.toId === avoidFrom)
                  ) ? current : [...current, {fromId: avoidFrom, toId: avoidTo, strength: avoidStrength}]);
                }}><Plus size={15} />{locale === "zh-TW" ? "加入" : "Add"}</button>
              </div>
              <div style={{display: "flex", gap: 7, flexWrap: "wrap"}}>
                {avoidances.map((pair) => (
                  <button className="role-tag" style={{border: 0}} key={`${pair.fromId}-${pair.toId}`} onClick={() => setAvoidances((current) => current.filter((item) => item !== pair))}>
                    {staff.find((item) => item.id === pair.fromId)?.name} × {staff.find((item) => item.id === pair.toId)?.name} · {t(`rules.${pair.strength === "PREFERRED" ? "preferred" : "absolute"}`)}
                  </button>
                ))}
              </div>
            </div>
              </div>
            </details>
            <details className="rule-card wide">
              <summary className="accordion-summary">
                <span><strong>{t("rules.leaveGroup")}</strong><span className="hint">{t("rules.leaveGroupHelp")}</span></span>
              </summary>
              <div style={{marginTop: 16}}>
            <div className="rule-card wide">
              <strong>{t("rules.daysOff")}</strong>
              <div className="staff-form" style={{margin: "14px 0 10px", gridTemplateColumns: "1fr 1fr auto"}}>
                <div className="field">
                  <label htmlFor="day-off-employee">{t("staff.name")}</label>
                  <select id="day-off-employee" value={dayOffEmployee} onChange={(event) => setDayOffEmployee(event.target.value)}>
                    <option value="" disabled>{t("common.select")}</option>
                    {scheduleStaff.map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="day-off-date">{t("rules.daysOff")}</label>
                  <input id="day-off-date" type="date" min={`${month}-01`} max={format(endOfMonth(new Date(`${month}-01T12:00:00`)), "yyyy-MM-dd")} value={dayOffDate} onChange={(event) => setDayOffDate(event.target.value)} />
                </div>
                <button className="button secondary" type="button" onClick={addDayOff}><Plus size={15} />{locale === "zh-TW" ? "加入" : "Add"}</button>
              </div>
              <div style={{display: "flex", gap: 7, flexWrap: "wrap"}}>
                {scheduleStaff.flatMap((employee) => employee.daysOff.map((date) => (
                  <button className="role-tag" style={{border: 0}} key={`${employee.id}-${date}`} onClick={() => setStaff((current) => current.map((item) => item.id === employee.id ? {...item, daysOff: item.daysOff.filter((itemDate) => itemDate !== date)} : item))}>
                    {employee.name} · {date} ×
                  </button>
                )))}
              </div>
            </div>
              </div>
            </details>
            <details className="rule-card wide">
              <summary className="accordion-summary">
                <span><strong>{t("rules.coworkerGroup")}</strong><span className="hint">{t("rules.coworkerGroupHelp")}</span></span>
              </summary>
              <div style={{marginTop: 16}}>
            <div className="rule-card wide">
              <strong>{t("rules.preferences")}</strong>
              <div className="staff-form" style={{margin: "14px 0 10px", gridTemplateColumns: "1fr 1fr auto"}}>
                <div className="field">
                  <label htmlFor="preference-from">{locale === "zh-TW" ? "員工" : "Employee"}</label>
                  <select id="preference-from" value={preferenceFrom} onChange={(event) => setPreferenceFrom(event.target.value)}>
                    <option value="" disabled>{t("common.select")}</option>
                    {scheduleStaff.map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="preference-to">{locale === "zh-TW" ? "希望合作對象" : "Prefers working with"}</label>
                  <select id="preference-to" value={preferenceTo} onChange={(event) => setPreferenceTo(event.target.value)}>
                    <option value="" disabled>{t("common.select")}</option>
                    {scheduleStaff.filter((employee) => employee.id !== preferenceFrom).map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}
                  </select>
                </div>
                <button className="button secondary" type="button" onClick={() => {
                  if (preferenceFrom && preferenceTo && preferenceFrom !== preferenceTo) {
                    setPreferences((current) => current.some((item) => item.fromId === preferenceFrom && item.toId === preferenceTo) ? current : [...current, {fromId: preferenceFrom, toId: preferenceTo}]);
                  }
                }}><Plus size={15} />{locale === "zh-TW" ? "加入" : "Add"}</button>
              </div>
              <div style={{display: "flex", gap: 7, flexWrap: "wrap"}}>
                {schedulePreferences.map((preference) => (
                  <button className="role-tag" style={{border: 0}} key={`${preference.fromId}-${preference.toId}`} onClick={() => setPreferences((current) => current.filter((item) => item !== preference))}>
                    {staff.find((item) => item.id === preference.fromId)?.name} → {staff.find((item) => item.id === preference.toId)?.name} ×
                  </button>
                ))}
              </div>
            </div>
              </div>
            </details>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="panel">
          <div className="panel-head">
            <div><h2>{t("generate.title")}</h2><p className="hint">{locale === "zh-TW" ? "硬性條件先滿足，再依公平性與合作偏好排序。" : "Hard constraints first, then ranked by fairness and coworker fit."}</p></div>
            <button className="button primary" disabled={generating} onClick={() => void generate()}><Sparkles size={16} />{generating ? t("generate.working") : t("generate.action")}</button>
          </div>
          {!generating && candidates.length === 0 ? (
            <div className="empty"><PawPrint size={28} style={{margin: "0 auto 10px"}} />{t("generate.noResult")}</div>
          ) : previewed ? (
            <div style={{display: "grid", gap: 16}}>
              <div style={{display: "flex", alignItems: "center", justifyContent: "center", gap: 12}}>
                <button className="button ghost" type="button" disabled={previewIndex === 0} onClick={() => setPreviewIndex((current) => Math.max(0, current - 1))}>
                  <ChevronLeft size={16} />{t("generate.previous")}
                </button>
                <span className="count-pill">{t("generate.planPosition", {current: previewIndex + 1, total: candidates.length})}</span>
                <button className="button ghost" type="button" disabled={previewIndex >= candidates.length - 1} onClick={() => setPreviewIndex((current) => Math.min(candidates.length - 1, current + 1))}>
                  {t("generate.next")}<ChevronRight size={16} />
                </button>
              </div>
              <article className={`candidate ${selectedRank === previewed.rank ? "selected" : ""}`}>
                <div className="candidate-head"><strong>{t("generate.candidate", {rank: previewed.rank})}</strong><span className="score">{previewed.score}</span></div>
                <div className="candidate-grid" style={{margin: "14px 0"}}>
                  {(["coverage", "fairness", "preference"] as const).map((metric) => (
                    <div className="metric" key={metric}>
                      <div className="metric-label"><span>{t(`generate.${metric}`)}</span><b>{previewed[metric]}%</b></div>
                      <div className="bar"><span style={{width: `${previewed[metric]}%`}} /></div>
                    </div>
                  ))}
                </div>
                <ScheduleGrid
                  candidate={previewed}
                  month={month}
                  closedSundays={closedSundays}
                  doctorColors={doctorColors}
                  highlightedEmployeeId={highlightedEmployeeId}
                  onHighlight={setHighlightedEmployeeId}
                />
                <button className={`button ${selectedRank === previewed.rank ? "secondary" : "primary"}`} style={{width: "100%", marginTop: 18}} onClick={() => setSelectedRank(previewed.rank)}>
                  {selectedRank === previewed.rank ? <><Check size={15} />{t("generate.selected")}</> : t("generate.select")}
                </button>
              </article>
              <button className="button secondary" type="button" disabled={generating} onClick={() => void generate({append: true, batch: candidateBatch + 1})}>
                <Plus size={16} />{generating ? t("generate.working") : t("generate.loadMore")}
              </button>
            </div>
          ) : null}
        </section>
      )}

      {step === 3 && selected && (
        <section className="panel">
          <div className="panel-head"><div><h2>{t("export.title")}</h2><p className="hint">{month} · {t("generate.candidate", {rank: selected.rank})}</p></div><span className="count-pill">{t("generate.score")} {selected.score}</span></div>
          <div className="notice no-print" style={{marginBottom: 14}}>{t("export.editHint")}</div>
          <div className="rule-card no-print" style={{marginBottom: 14}}>
            <strong>{t("schedule.daySwap")}</strong>
            <p className="hint" style={{marginTop: 4}}>{t("schedule.daySwapHint")}</p>
            <div style={{display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10}}>
              {(["WEEK", "MONTH"] as const).map((scope) => (
                <label key={scope} style={{display: "flex", alignItems: "center", gap: 7, cursor: "pointer"}}>
                  <input
                    type="radio"
                    name="day-swap-scope"
                    checked={daySwapScope === scope}
                    onChange={() => setDaySwapScope(scope)}
                  />
                  {t(`schedule.${scope === "WEEK" ? "swapWeek" : "swapMonth"}`)}
                </label>
              ))}
            </div>
          </div>
          <div ref={scheduleRef}>
            <ScheduleGrid
              candidate={selected}
              month={month}
              closedSundays={closedSundays}
              doctorColors={doctorColors}
              highlightedEmployeeId={highlightedEmployeeId}
              onHighlight={setHighlightedEmployeeId}
              onCycle={cycleAssignment}
              editableStaff={scheduleStaff}
              onRemove={removeAssignment}
              onAdd={addAssignment}
              daySwapScope={daySwapScope}
              onSwapDays={swapScheduleDays}
            />
          </div>
          {selected.warnings.length > 0 && <div className="notice no-print">{t("generate.warning")}: {selected.warnings.at(-1)}</div>}
          <div className="export-grid" style={{marginTop: 18}}>
            <div className="summary-card">
              <h3><Sparkles size={16} style={{display: "inline", marginRight: 7}} />{t("export.summary")}</h3>
              <p>{aiSummary || (locale === "zh-TW"
                ? t("export.summaryDoctorOnly", {count: scheduleStaff.length, doctors: minDoctors})
                : t("export.summaryCombined", {count: scheduleStaff.length, doctors: minDoctors, nurses: minNurses}))}</p>
              <small>{t("export.summaryHint")}</small>
            </div>
            <div className="export-buttons no-print">
              <button className="button primary" onClick={() => { void saveSchedule(); void exportImage("pdf"); }}><FileText size={16} />{t("export.pdf")}</button>
              <button className="button secondary" onClick={() => void exportImage("png")}><FileImage size={16} />{t("export.png")}</button>
              <button className="button ghost" onClick={() => void exportImage("jpg")}><Download size={16} />{t("export.jpg")}</button>
            </div>
          </div>
        </section>
      )}

      <footer className="actions">
        <p className="legal">{t("hero.legal")}</p>
        <div className="action-right">
          <button className="button ghost" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ChevronLeft size={16} />{t("common.back")}</button>
          <button className="button primary" disabled={(step === 0 && !canContinue) || (step === 1 && ((flex && !attested) || singleDoctorCoverageConflict || popularDayConflict)) || (step === 2 && !selectedRank) || step === 3} onClick={continueToNextStep}>{t("common.next")}<ChevronRight size={16} /></button>
        </div>
      </footer>
    </div>
  );
}

function ScheduleGrid({
  candidate,
  month,
  closedSundays,
  doctorColors,
  highlightedEmployeeId,
  onHighlight,
  onCycle,
  editableStaff,
  onRemove,
  onAdd,
  daySwapScope,
  onSwapDays,
}: {
  candidate: Candidate;
  month: string;
  closedSundays: boolean;
  doctorColors: Map<string, {backgroundColor: string; borderColor: string; color: string}>;
  highlightedEmployeeId: string | null;
  onHighlight: (employeeId: string) => void;
  onCycle?: (date: string, session: Session, employeeId: string) => void;
  editableStaff?: Employee[];
  onRemove?: (date: string, session: Session, employeeId: string) => void;
  onAdd?: (date: string, session: Session, employeeId: string) => void;
  daySwapScope?: DaySwapScope;
  onSwapDays?: (sourceDate: string, targetDate: string, scope: DaySwapScope) => void;
}) {
  const t = useTranslations("schedule");
  const locale = useLocale();
  const weeks = useMemo(() => {
    const first = startOfMonth(new Date(`${month}-01T12:00:00`));
    const last = endOfMonth(first);
    const gridStart = addDays(first, -((getDay(first) + 6) % 7));
    const gridEnd = addDays(last, (7 - getDay(last)) % 7);
    const dates: Date[] = [];
    for (let day = gridStart; day <= gridEnd; day = addDays(day, 1)) {
      dates.push(day);
    }
    const chunks: Date[][] = [];
    for (let index = 0; index < dates.length; index += 7) chunks.push(dates.slice(index, index + 7));
    return chunks;
  }, [month]);
  const scheduledDoctors = useMemo(() => {
    const doctors = new Map<string, Employee>();
    for (const assignment of candidate.assignments) {
      for (const employee of assignment.employees) {
        if (employee.role === "DOCTOR") doctors.set(employee.id, employee);
      }
    }
    return [...doctors.values()].sort((left, right) => left.name.localeCompare(right.name, locale));
  }, [candidate.assignments, locale]);
  const highlightedDoctor = scheduledDoctors.find(
    (doctor) => doctor.id === highlightedEmployeeId,
  );

  return (
    <div className="schedule-wrap">
      <div aria-label={t("doctorColors")} style={{display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 12}}>
        <strong style={{fontSize: 12, color: "var(--muted)", marginRight: 2}}>{t("doctorColors")}</strong>
        {scheduledDoctors.map((doctor) => (
          <button
            type="button"
            className="assignment"
            aria-pressed={highlightedEmployeeId === doctor.id}
            title={t("highlightHint")}
            onClick={() => onHighlight(doctor.id)}
            key={doctor.id}
            style={{
              ...doctorColors.get(doctor.id),
              borderStyle: "solid",
              borderWidth: 1,
              paddingInline: 8,
              boxShadow: highlightedEmployeeId === doctor.id ? "0 0 0 3px var(--sage-deep)" : undefined,
            }}
          >
            {doctor.name}
          </button>
        ))}
      </div>
      {weeks.map((week, weekIndex) => {
        const weekDates = new Set(week.map((date) => format(date, "yyyy-MM-dd")));
        const weeklyHours = highlightedDoctor
          ? candidate.assignments.reduce((total, assignment) => {
            if (
              !weekDates.has(assignment.date) ||
              !assignment.employees.some(
                (employee) => employee.id === highlightedDoctor.id,
              )
            ) return total;
            return total + (sessions.find((session) => session.id === assignment.session)?.hours ?? 0);
          }, 0)
          : 0;
        return (
        <div key={weekIndex}>
          {highlightedDoctor && (
            <div className="count-pill" style={{display: "inline-flex", marginBottom: 8}}>
              {t("weeklyHours", {name: highlightedDoctor.name, hours: weeklyHours})}
            </div>
          )}
          <table className="schedule" style={{marginBottom: 13}}>
          <thead><tr><th>autoVet</th>{week.map((date) => {
            const outsideMonth = format(date, "yyyy-MM") !== month;
            const closed = closedSundays && getDay(date) === 0;
            const draggable = Boolean(onSwapDays && !outsideMonth && !closed);
            const dateKey = format(date, "yyyy-MM-dd");
            return (
              <th
                key={date.toISOString()}
                draggable={draggable}
                title={draggable ? t("dragDayHint") : undefined}
                onDragStart={(event) => {
                  if (!draggable) return;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", dateKey);
                }}
                onDragOver={(event) => {
                  if (draggable) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (!draggable || !onSwapDays) return;
                  event.preventDefault();
                  const sourceDate = event.dataTransfer.getData("text/plain");
                  if (sourceDate) onSwapDays(sourceDate, dateKey, daySwapScope ?? "WEEK");
                }}
                style={{opacity: outsideMonth ? .45 : 1, cursor: draggable ? "grab" : undefined}}
              >
                {format(date, "M/d")}<br />{new Intl.DateTimeFormat(locale, {weekday: "short"}).format(date)}
              </th>
            );
          })}</tr></thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td className="session">{t(session.id)}<br /><small>{session.time}</small></td>
                {week.map((date) => {
                  const dateKey = format(date, "yyyy-MM-dd");
                  const outsideMonth = format(date, "yyyy-MM") !== month;
                  const closed = closedSundays && getDay(date) === 0;
                  const assignment = candidate.assignments.find((item) => item.date === dateKey && item.session === session.id);
                  return outsideMonth ? <td className="closed" key={dateKey}>—</td> : closed ? <td className="closed" key={dateKey}>{t("closed")}</td> : (
                    <td key={dateKey}>{assignment?.employees.map((employee) => {
                      const doctorColor = employee.role === "DOCTOR" ? doctorColors.get(employee.id) : undefined;
                      const highlighted = highlightedEmployeeId === employee.id;
                      return (
                        <div key={employee.id} style={{display: "flex", alignItems: "stretch", gap: 3}}>
                          <button
                            type="button"
                            aria-pressed={highlighted}
                            onClick={() => onHighlight(employee.id)}
                            onDoubleClick={() => onCycle?.(dateKey, session.id, employee.id)}
                            title={onCycle ? `${t("highlightHint")} ${t("replaceHint")}` : t("highlightHint")}
                            className={`assignment ${employee.role === "NURSE" ? "nurse" : ""}`}
                            style={{
                              flex: 1,
                              borderStyle: "solid",
                              borderWidth: highlighted ? 2 : doctorColor ? 1 : 0,
                              boxShadow: highlighted ? "0 0 0 3px var(--sage-deep)" : undefined,
                              position: highlighted ? "relative" : undefined,
                              zIndex: highlighted ? 1 : undefined,
                              ...doctorColor,
                            }}
                          >
                            {employee.name}
                          </button>
                          {onRemove && (
                            <button
                              type="button"
                              className="no-export"
                              aria-label={t("removeStaff", {name: employee.name})}
                              title={t("removeStaff", {name: employee.name})}
                              onClick={() => onRemove(dateKey, session.id, employee.id)}
                              style={{border: 0, borderRadius: 6, background: "#faebe7", color: "#a94c3d", cursor: "pointer"}}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {editableStaff && onAdd && (
                      <select
                        className="no-export"
                        aria-label={t("addStaff")}
                        defaultValue=""
                        onChange={(event) => {
                          if (event.target.value) onAdd(dateKey, session.id, event.target.value);
                          event.currentTarget.value = "";
                        }}
                        style={{width: "100%", marginTop: 4, border: "1px dashed var(--line)", borderRadius: 6, padding: 3, color: "var(--muted)", background: "white"}}
                      >
                        <option value="">{t("addStaff")}</option>
                        {editableStaff
                          .filter((employee) => !assignment?.employees.some((assigned) => assigned.id === employee.id))
                          .map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}
                      </select>
                    )}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          </table>
        </div>
        );
      })}
    </div>
  );
}
