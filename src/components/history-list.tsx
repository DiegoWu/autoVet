"use client";

import {useEffect, useState} from "react";
import {addDays, endOfMonth, format, getDay, startOfMonth} from "date-fns";
import {CalendarDays, ChevronDown, Search} from "lucide-react";
import {useLocale, useTranslations} from "next-intl";

type Session = "morning" | "afternoon" | "evening";
type ArchivedEmployee = {
  id: string;
  name: string;
  role: "DOCTOR" | "NURSE";
};
type ArchivedAssignment = {
  date: string;
  session: Session;
  employees: ArchivedEmployee[];
};
type HistoryItem = {
  id: string;
  month: string;
  status: string;
  staff: string[];
  savedAt: string;
  closedSundays?: boolean;
  selected: {score: number; assignments?: ArchivedAssignment[]};
};

export function HistoryList() {
  const t = useTranslations("history");
  const locale = useLocale();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [openedId, setOpenedId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const localItems = JSON.parse(localStorage.getItem("autovet.history") ?? "[]") as HistoryItem[];
      queueMicrotask(() => setItems(localItems));
    } catch {
      queueMicrotask(() => setItems([]));
    }
    fetch("/api/schedules")
      .then((response) => response.ok ? response.json() : [])
      .then((data: HistoryItem[]) => data.length && setItems(data))
      .catch(() => undefined);
  }, []);

  const filtered = items.filter((item) =>
    item.month.includes(query) || item.staff.some((name) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
  );

  return (
    <div className="wizard">
      <section className="panel">
        <div className="panel-head">
          <div><h2>{t("title")}</h2><p className="hint">{t("subtitle")}</p></div>
          <div className="field" style={{minWidth: 250, position: "relative"}}>
            <Search size={15} style={{position: "absolute", left: 12, top: 14, color: "var(--muted)"}} />
            <input aria-label={t("search")} placeholder={t("search")} value={query} onChange={(event) => setQuery(event.target.value)} style={{paddingLeft: 36}} />
          </div>
        </div>
        {filtered.length === 0 ? <div className="empty">{t("empty")}</div> : (
          <div className="staff-list">
            {filtered.map((item) => (
              <div key={item.id}>
                <article
                  className="staff-row"
                  role="button"
                  tabIndex={0}
                  aria-expanded={openedId === item.id}
                  onClick={() => setOpenedId((current) => current === item.id ? null : item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setOpenedId((current) => current === item.id ? null : item.id);
                    }
                  }}
                  style={{cursor: "pointer"}}
                >
                  <div className="avatar nurse"><CalendarDays size={19} /></div>
                  <div>
                    <div className="staff-name">{new Intl.DateTimeFormat(locale, {year: "numeric", month: "long"}).format(new Date(`${item.month}-01T12:00:00`))}</div>
                    <div className="staff-meta">{item.staff.join("、")} · {new Date(item.savedAt).toLocaleDateString(locale)}</div>
                  </div>
                  <span className="role-tag">{item.status === "SELECTED" ? (locale === "zh-TW" ? "已確認" : "Selected") : item.status}</span>
                  <span style={{display: "flex", alignItems: "center", gap: 8}}>
                    <span className="score" style={{fontSize: 18}}>{item.selected?.score ?? "—"}</span>
                    <ChevronDown size={17} style={{transform: openedId === item.id ? "rotate(180deg)" : undefined, transition: "transform .2s"}} />
                  </span>
                </article>
                {openedId === item.id && (
                  item.selected?.assignments?.length
                    ? <ArchivedSchedule item={item} />
                    : <div className="empty" style={{marginTop: 8}}>{t("detailsUnavailable")}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const archivedSessions: Array<{id: Session; time: string}> = [
  {id: "morning", time: "10:00–12:30"},
  {id: "afternoon", time: "13:30–17:30"},
  {id: "evening", time: "18:00–22:00"},
];

function ArchivedSchedule({item}: {item: HistoryItem}) {
  const t = useTranslations("schedule");
  const locale = useLocale();
  const assignments = item.selected.assignments ?? [];
  const first = startOfMonth(new Date(`${item.month}-01T12:00:00`));
  const last = endOfMonth(first);
  const gridStart = addDays(first, -((getDay(first) + 6) % 7));
  const gridEnd = addDays(last, (7 - getDay(last)) % 7);
  const dates: Date[] = [];
  for (let day = gridStart; day <= gridEnd; day = addDays(day, 1)) dates.push(day);
  const weeks: Date[][] = [];
  for (let index = 0; index < dates.length; index += 7) {
    weeks.push(dates.slice(index, index + 7));
  }
  const doctors = new Map<string, ArchivedEmployee>();
  for (const assignment of assignments) {
    for (const employee of assignment.employees) {
      if (employee.role === "DOCTOR") doctors.set(employee.id, employee);
    }
  }
  const doctorColors = new Map(
    [...doctors.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((doctor, index) => {
        const hue = Math.round((index * 137.508 + 18) % 360);
        return [doctor.id, {
          backgroundColor: `hsl(${hue} 70% 88%)`,
          borderColor: `hsl(${hue} 52% 64%)`,
          color: `hsl(${hue} 52% 25%)`,
        }] as const;
      }),
  );

  return (
    <div className="schedule-wrap" style={{margin: "10px 0 20px", padding: 14, border: "1px solid var(--line)", borderRadius: 16}}>
      {weeks.map((week, weekIndex) => (
        <table className="schedule" key={weekIndex} style={{marginBottom: 13}}>
          <thead>
            <tr>
              <th>autoVet</th>
              {week.map((date) => (
                <th key={date.toISOString()} style={{opacity: format(date, "yyyy-MM") === item.month ? 1 : .45}}>
                  {format(date, "M/d")}<br />
                  {new Intl.DateTimeFormat(locale, {weekday: "short"}).format(date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {archivedSessions.map((session) => (
              <tr key={session.id}>
                <td className="session">{t(session.id)}<br /><small>{session.time}</small></td>
                {week.map((date) => {
                  const dateKey = format(date, "yyyy-MM-dd");
                  const outsideMonth = format(date, "yyyy-MM") !== item.month;
                  const closed = item.closedSundays && getDay(date) === 0;
                  const assignment = assignments.find(
                    (candidate) =>
                      candidate.date === dateKey &&
                      candidate.session === session.id,
                  );
                  if (outsideMonth) return <td className="closed" key={dateKey}>—</td>;
                  if (closed) return <td className="closed" key={dateKey}>{t("closed")}</td>;
                  return (
                    <td key={dateKey}>
                      {assignment?.employees.map((employee) => (
                        <span
                          className={`assignment ${employee.role === "NURSE" ? "nurse" : ""}`}
                          key={employee.id}
                          style={employee.role === "DOCTOR"
                            ? {...doctorColors.get(employee.id), borderStyle: "solid", borderWidth: 1}
                            : undefined}
                        >
                          {employee.name}
                        </span>
                      ))}
                    </td>
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
