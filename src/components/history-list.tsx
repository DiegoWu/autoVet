"use client";

import {useEffect, useState} from "react";
import {CalendarDays, Search} from "lucide-react";
import {useLocale, useTranslations} from "next-intl";

type HistoryItem = {
  id: string;
  month: string;
  status: string;
  staff: string[];
  savedAt: string;
  selected: {score: number};
};

export function HistoryList() {
  const t = useTranslations("history");
  const locale = useLocale();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");

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
              <article className="staff-row" key={item.id}>
                <div className="avatar nurse"><CalendarDays size={19} /></div>
                <div>
                  <div className="staff-name">{new Intl.DateTimeFormat(locale, {year: "numeric", month: "long"}).format(new Date(`${item.month}-01T12:00:00`))}</div>
                  <div className="staff-meta">{item.staff.join("、")} · {new Date(item.savedAt).toLocaleDateString(locale)}</div>
                </div>
                <span className="role-tag">{item.status === "SELECTED" ? (locale === "zh-TW" ? "已確認" : "Selected") : item.status}</span>
                <span className="score" style={{fontSize: 18}}>{item.selected?.score ?? "—"}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
