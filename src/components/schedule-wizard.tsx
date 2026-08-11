"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import {addDays, endOfMonth, format, getDay, startOfMonth} from "date-fns";
import {Check, ChevronLeft, ChevronRight, Download, FileImage, FileText, PawPrint, Plus, Sparkles, Trash2} from "lucide-react";
import {useLocale, useTranslations} from "next-intl";

type Role = "DOCTOR" | "NURSE";
type StaffRole = Role | "BACKUP_DOCTOR";
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
};
type Session = "morning" | "afternoon" | "evening";
type Assignment = {date: string; session: Session; employees: Employee[]};
type Preference = {fromId: string; toId: string};
type Candidate = {
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

function makeCandidates(
  employees: Employee[],
  month: string,
  minDoctors: number,
  minNurses: number,
  closedSundays: boolean,
  preferences: Preference[],
): Candidate[] {
  const doctors = employees.filter((employee) => employee.role === "DOCTOR");
  const nurses = employees.filter((employee) => employee.role === "NURSE");
  if (doctors.length < minDoctors || nurses.length < minNurses) return [];

  return [0, 1, 2].map((offset) => {
    const assignments: Assignment[] = [];
    const hours = new Map<string, number>(employees.map((employee) => [employee.id, 0]));
    const warnings: string[] = [];
    let uncovered = 0;

    monthDates(month).forEach((date, dayIndex) => {
      if (closedSundays && getDay(date) === 0) return;
      const dateKey = format(date, "yyyy-MM-dd");
      sessions.forEach((session, sessionIndex) => {
        const assigned: Employee[] = [];
        const assignRole = (pool: Employee[], count: number) => {
          const available = pool
            .filter((employee) => !employee.daysOff.includes(dateKey))
            .sort((a, b) => {
              if (a.backupOnly !== b.backupOnly) return a.backupOnly ? 1 : -1;
              const targetA = a.targetWeeklyHours * 4.33;
              const targetB = b.targetWeeklyHours * 4.33;
              return ((hours.get(a.id) ?? 0) - targetA) - ((hours.get(b.id) ?? 0) - targetB)
                || a.name.localeCompare(b.name);
            });
          for (let i = 0; i < count; i += 1) {
            const employee = available[(dayIndex + sessionIndex + offset + i) % Math.max(available.length, 1)];
            if (employee && !assigned.some((item) => item.id === employee.id)) {
              assigned.push(employee);
              hours.set(employee.id, (hours.get(employee.id) ?? 0) + session.hours);
            } else {
              uncovered += 1;
            }
          }
        };
        assignRole(doctors, minDoctors);
        assignRole(nurses, minNurses);
        assignments.push({date: dateKey, session: session.id, employees: assigned});
      });
    });

    const deviations = employees.map((employee) => {
      const target = employee.targetWeeklyHours * 4.33;
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

export function ScheduleWizard() {
  const t = useTranslations();
  const locale = useLocale();
  const scheduleRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
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
  const [flex, setFlex] = useState(false);
  const [attested, setAttested] = useState(false);
  const [dayOffEmployee, setDayOffEmployee] = useState("d1");
  const [dayOffDate, setDayOffDate] = useState("");
  const [preferenceFrom, setPreferenceFrom] = useState("d1");
  const [preferenceTo, setPreferenceTo] = useState("n1");
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const selected = candidates.find((candidate) => candidate.rank === selectedRank);

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
    localStorage.setItem("autovet.staff", JSON.stringify(staff));
  }, [staff]);

  useEffect(() => {
    if (step !== 3 || !selected) return;
    const namedPreferences = preferences.map((preference) => ({
      employee: staff.find((item) => item.id === preference.fromId)?.name,
      prefers: staff.find((item) => item.id === preference.toId)?.name,
    }));
    fetch("/api/summary", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({locale, preferences: namedPreferences, assignments: selected.assignments}),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => result?.summary?.overview && setAiSummary(result.summary.overview))
      .catch(() => undefined);
  }, [step, selected, preferences, staff, locale]);

  const canContinue = staff.some((employee) => employee.role === "DOCTOR")
    && staff.some((employee) => employee.role === "NURSE");

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
    updates: Partial<Pick<Employee, "name" | "targetWeeklyHours" | "role" | "backupOnly">>,
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
      const assignments = candidate.assignments.map((assignment) => {
        if (assignment.date !== date || assignment.session !== session) return assignment;
        const currentEmployee = assignment.employees.find((employee) => employee.id === employeeId);
        if (!currentEmployee) return assignment;
        const pool = staff.filter((employee) => employee.role === currentEmployee.role);
        const index = pool.findIndex((employee) => employee.id === employeeId);
        const replacement = [...pool.slice(index + 1), ...pool.slice(0, index)]
          .find((employee) =>
            employee.id !== employeeId &&
            !assignment.employees.some((assigned) => assigned.id === employee.id),
          );
        if (!replacement || replacement.id === employeeId) return assignment;
        if (replacement.daysOff.includes(date)) warning = `${replacement.name}: requested day off ${date}`;
        return {...assignment, employees: assignment.employees.map((employee) => employee.id === employeeId ? replacement : employee)};
      });
      return {...candidate, assignments, warnings: warning ? [...candidate.warnings, warning] : candidate.warnings};
    }));
  }

  async function generate() {
    setGenerating(true);
    setSelectedRank(null);
    try {
      const response = await fetch("/api/schedules/generate", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({month, staff, preferences, minDoctors, maxDoctors, minNurses, closedSundays, flexible: flex, attested}),
      });
      const result = await response.json();
      setCandidates(response.ok ? result.candidates as Candidate[] : []);
    } catch {
      setCandidates(makeCandidates(staff, month, minDoctors, minNurses, closedSundays, preferences));
    }
    setGenerating(false);
  }

  async function exportImage(kind: "png" | "jpg" | "pdf") {
    if (!scheduleRef.current) return;
    const {toJpeg, toPng} = await import("html-to-image");
    const dataUrl = kind === "jpg"
      ? await toJpeg(scheduleRef.current, {quality: .95, pixelRatio: 2, backgroundColor: "#fffdf8"})
      : await toPng(scheduleRef.current, {pixelRatio: 2, backgroundColor: "#fffdf8"});

    if (kind === "pdf") {
      const {jsPDF} = await import("jspdf");
      const pdf = new jsPDF({orientation: "landscape", unit: "mm", format: "a4"});
      pdf.addImage(dataUrl, "PNG", 8, 8, 281, 194, undefined, "FAST");
      pdf.save(`autoVet-${month}.pdf`);
      return;
    }
    const link = document.createElement("a");
    link.download = `autoVet-${month}.${kind === "jpg" ? "jpg" : "png"}`;
    link.href = dataUrl;
    link.click();
  }

  async function saveSchedule() {
    if (!selected) return;
    const record = {id: crypto.randomUUID(), month, status: "SELECTED", staff: staff.map((item) => item.name), selected, savedAt: new Date().toISOString()};
    const prior = JSON.parse(localStorage.getItem("autovet.history") ?? "[]") as unknown[];
    localStorage.setItem("autovet.history", JSON.stringify([record, ...prior]));
    try {
      await fetch("/api/schedules", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({month, locale, staff, preferences, aiSummary: aiSummary || undefined, config: {minDoctors, maxDoctors, minNurses, closedSundays, flex, attested}, candidate: selected}),
      });
    } catch { /* Local persistence remains available if the cloud database is not configured. */ }
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
            <div><h2>{t("staff.title")}</h2><p className="hint">{t("staff.hint")}</p></div>
            <span className="count-pill">{staff.length} {locale === "zh-TW" ? "位成員" : "people"}</span>
          </div>
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
                <option value="NURSE">{t("staff.nurse")}</option>
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
            <div className="rule-card field">
              <label htmlFor="nurses">{t("rules.minNurses")}</label>
              <input id="nurses" type="number" min={1} max={10} value={minNurses} onChange={(event) => setMinNurses(Number(event.target.value))} />
            </div>
            <div className="rule-card switch-row">
              <div><strong>{t("rules.closedSundays")}</strong><p className="hint">Sunday / 週日</p></div>
              <input className="check" type="checkbox" checked={closedSundays} onChange={(event) => setClosedSundays(event.target.checked)} />
            </div>
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
            <div className="rule-card wide">
              <strong>{t("rules.daysOff")}</strong>
              <div className="staff-form" style={{margin: "14px 0 10px", gridTemplateColumns: "1fr 1fr auto"}}>
                <div className="field">
                  <label htmlFor="day-off-employee">{t("staff.name")}</label>
                  <select id="day-off-employee" value={dayOffEmployee} onChange={(event) => setDayOffEmployee(event.target.value)}>
                    {staff.map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="day-off-date">{t("rules.daysOff")}</label>
                  <input id="day-off-date" type="date" min={`${month}-01`} max={format(endOfMonth(new Date(`${month}-01T12:00:00`)), "yyyy-MM-dd")} value={dayOffDate} onChange={(event) => setDayOffDate(event.target.value)} />
                </div>
                <button className="button secondary" type="button" onClick={addDayOff}><Plus size={15} />{locale === "zh-TW" ? "加入" : "Add"}</button>
              </div>
              <div style={{display: "flex", gap: 7, flexWrap: "wrap"}}>
                {staff.flatMap((employee) => employee.daysOff.map((date) => (
                  <button className="role-tag" style={{border: 0}} key={`${employee.id}-${date}`} onClick={() => setStaff((current) => current.map((item) => item.id === employee.id ? {...item, daysOff: item.daysOff.filter((itemDate) => itemDate !== date)} : item))}>
                    {employee.name} · {date} ×
                  </button>
                )))}
              </div>
            </div>
            <div className="rule-card wide">
              <strong>{t("rules.preferences")}</strong>
              <div className="staff-form" style={{margin: "14px 0 10px", gridTemplateColumns: "1fr 1fr auto"}}>
                <div className="field">
                  <label htmlFor="preference-from">{locale === "zh-TW" ? "員工" : "Employee"}</label>
                  <select id="preference-from" value={preferenceFrom} onChange={(event) => setPreferenceFrom(event.target.value)}>
                    {staff.map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="preference-to">{locale === "zh-TW" ? "希望合作對象" : "Prefers working with"}</label>
                  <select id="preference-to" value={preferenceTo} onChange={(event) => setPreferenceTo(event.target.value)}>
                    {staff.filter((employee) => employee.id !== preferenceFrom).map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}
                  </select>
                </div>
                <button className="button secondary" type="button" onClick={() => {
                  if (preferenceFrom && preferenceTo && preferenceFrom !== preferenceTo) {
                    setPreferences((current) => current.some((item) => item.fromId === preferenceFrom && item.toId === preferenceTo) ? current : [...current, {fromId: preferenceFrom, toId: preferenceTo}]);
                  }
                }}><Plus size={15} />{locale === "zh-TW" ? "加入" : "Add"}</button>
              </div>
              <div style={{display: "flex", gap: 7, flexWrap: "wrap"}}>
                {preferences.map((preference) => (
                  <button className="role-tag" style={{border: 0}} key={`${preference.fromId}-${preference.toId}`} onClick={() => setPreferences((current) => current.filter((item) => item !== preference))}>
                    {staff.find((item) => item.id === preference.fromId)?.name} → {staff.find((item) => item.id === preference.toId)?.name} ×
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="panel">
          <div className="panel-head">
            <div><h2>{t("generate.title")}</h2><p className="hint">{locale === "zh-TW" ? "硬性條件先滿足，再依公平性與合作偏好排序。" : "Hard constraints first, then ranked by fairness and coworker fit."}</p></div>
            <button className="button primary" disabled={generating} onClick={generate}><Sparkles size={16} />{generating ? t("generate.working") : t("generate.action")}</button>
          </div>
          {!generating && candidates.length === 0 ? (
            <div className="empty"><PawPrint size={28} style={{margin: "0 auto 10px"}} />{t("generate.noResult")}</div>
          ) : (
            <div className="candidate-grid">
              {candidates.map((candidate) => (
                <article className={`candidate ${selectedRank === candidate.rank ? "selected" : ""}`} key={candidate.rank}>
                  <div className="candidate-head"><strong>{t("generate.candidate", {rank: candidate.rank})}</strong><span className="score">{candidate.score}</span></div>
                  {(["coverage", "fairness", "preference"] as const).map((metric) => (
                    <div className="metric" key={metric}>
                      <div className="metric-label"><span>{t(`generate.${metric}`)}</span><b>{candidate[metric]}%</b></div>
                      <div className="bar"><span style={{width: `${candidate[metric]}%`}} /></div>
                    </div>
                  ))}
                  <button className={`button ${selectedRank === candidate.rank ? "secondary" : "ghost"}`} style={{width: "100%", marginTop: 18}} onClick={() => setSelectedRank(candidate.rank)}>
                    {selectedRank === candidate.rank ? <><Check size={15} />{t("generate.selected")}</> : t("generate.select")}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {step === 3 && selected && (
        <section className="panel">
          <div className="panel-head"><div><h2>{t("export.title")}</h2><p className="hint">{month} · {t("generate.candidate", {rank: selected.rank})}</p></div><span className="count-pill">{t("generate.score")} {selected.score}</span></div>
          <div ref={scheduleRef}>
            <ScheduleGrid candidate={selected} month={month} closedSundays={closedSundays} onCycle={cycleAssignment} />
          </div>
          {selected.warnings.length > 0 && <div className="notice no-print">{t("generate.warning")}: {selected.warnings.at(-1)}</div>}
          <div className="export-grid" style={{marginTop: 18}}>
            <div className="summary-card">
              <h3><Sparkles size={16} style={{display: "inline", marginRight: 7}} />{t("export.summary")}</h3>
              <p>{aiSummary || (locale === "zh-TW"
                ? `本方案已優先平衡 ${staff.length} 位成員的目標工時，並維持每診至少 ${minDoctors} 位醫師與 ${minNurses} 位護理師。選定後可由 AI 根據合作偏好產生更完整摘要。`
                : `This option balances target hours for ${staff.length} team members while maintaining at least ${minDoctors} doctor(s) and ${minNurses} nurse(s) per session. AI can summarize coworker preferences after selection.`)}</p>
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
          <button className="button primary" disabled={(step === 0 && !canContinue) || (step === 1 && flex && !attested) || (step === 2 && !selectedRank) || step === 3} onClick={() => setStep((current) => Math.min(3, current + 1))}>{t("common.next")}<ChevronRight size={16} /></button>
        </div>
      </footer>
    </div>
  );
}

function ScheduleGrid({candidate, month, closedSundays, onCycle}: {candidate: Candidate; month: string; closedSundays: boolean; onCycle: (date: string, session: Session, employeeId: string) => void}) {
  const t = useTranslations("schedule");
  const locale = useLocale();
  const weeks = useMemo(() => {
    const dates = monthDates(month);
    const chunks: Date[][] = [];
    for (let index = 0; index < dates.length; index += 7) chunks.push(dates.slice(index, index + 7));
    return chunks;
  }, [month]);

  return (
    <div className="schedule-wrap">
      {weeks.map((week, weekIndex) => (
        <table className="schedule" key={weekIndex} style={{marginBottom: 13}}>
          <thead><tr><th>autoVet</th>{week.map((date) => <th key={date.toISOString()}>{format(date, "M/d")}<br />{new Intl.DateTimeFormat(locale, {weekday: "short"}).format(date)}</th>)}</tr></thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td className="session">{t(session.id)}<br /><small>{session.time}</small></td>
                {week.map((date) => {
                  const dateKey = format(date, "yyyy-MM-dd");
                  const closed = closedSundays && getDay(date) === 0;
                  const assignment = candidate.assignments.find((item) => item.date === dateKey && item.session === session.id);
                  return closed ? <td className="closed" key={dateKey}>{t("closed")}</td> : (
                    <td key={dateKey}>{assignment?.employees.map((employee) => <button type="button" onClick={() => onCycle(dateKey, session.id, employee.id)} title={locale === "zh-TW" ? "點擊更換同職務員工" : "Click to cycle staff in the same role"} className={`assignment ${employee.role === "NURSE" ? "nurse" : ""}`} style={{width: "100%", border: 0}} key={employee.id}>{employee.name}</button>)}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
