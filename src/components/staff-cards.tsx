"use client";

import {useEffect, useState} from "react";
import {Brain, BriefcaseMedical, Heart, PawPrint, Pencil, Save, Trash2, X} from "lucide-react";
import {useLocale, useTranslations} from "next-intl";

type Employee = {
  id: string;
  name: string;
  role: "DOCTOR" | "NURSE";
  backupOnly?: boolean;
  targetWeeklyHours: number;
  yearsExperience?: number;
  expertise?: string;
  hobbies?: string;
};

export function StaffCards() {
  const t = useTranslations("staff");
  const common = useTranslations("common");
  const locale = useLocale();
  const [staff, setStaff] = useState<Employee[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Employee | null>(null);
  const [draftHours, setDraftHours] = useState("");

  useEffect(() => {
    try {
      const localStaff = JSON.parse(localStorage.getItem("autovet.staff") ?? "[]") as Employee[];
      queueMicrotask(() => setStaff(localStaff));
    } catch {
      queueMicrotask(() => setStaff([]));
    }
  }, []);

  function persist(nextStaff: Employee[]) {
    setStaff(nextStaff);
    localStorage.setItem("autovet.staff", JSON.stringify(nextStaff));
  }

  function beginEditing(employee: Employee) {
    setEditingId(employee.id);
    setDraft({...employee});
    setDraftHours(String(employee.targetWeeklyHours));
  }

  function saveEditing() {
    if (!draft?.name.trim()) return;
    persist(staff.map((employee) =>
      employee.id === draft.id
        ? {...draft, name: draft.name.trim(), targetWeeklyHours: Number(draftHours) || 0}
        : employee,
    ));
    setEditingId(null);
    setDraft(null);
    setDraftHours("");
  }

  if (!staff.length) return <div className="empty">{t("empty")}</div>;

  return (
    <div className="candidate-grid">
      {staff.map((employee, index) => (
        <article className="candidate" key={employee.id} style={{overflow: "hidden", position: "relative"}}>
          <PawPrint size={90} aria-hidden="true" style={{position: "absolute", right: -18, top: -20, opacity: .05, transform: "rotate(20deg)"}} />
          {editingId === employee.id && draft ? (
            <div style={{position: "relative"}}>
              <div className="field" style={{marginBottom: 10}}>
                <label htmlFor={`team-name-${employee.id}`}>{t("name")}</label>
                <input id={`team-name-${employee.id}`} value={draft.name} onChange={(event) => setDraft({...draft, name: event.target.value})} />
              </div>
              <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10}}>
                <div className="field">
                  <label htmlFor={`team-role-${employee.id}`}>{t("role")}</label>
                  <select
                    id={`team-role-${employee.id}`}
                    value={draft.backupOnly ? "BACKUP_DOCTOR" : draft.role}
                    onChange={(event) => {
                      const role = event.target.value;
                      setDraft({
                        ...draft,
                        role: role === "NURSE" ? "NURSE" : "DOCTOR",
                        backupOnly: role === "BACKUP_DOCTOR",
                      });
                    }}
                  >
                    <option value="DOCTOR">{t("doctor")}</option>
                    <option value="NURSE">{t("nurse")}</option>
                    <option value="BACKUP_DOCTOR">{t("backupDoctor")}</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`team-hours-${employee.id}`}>{t("hours")}</label>
                  <input id={`team-hours-${employee.id}`} type="number" min={0} max={60} value={draftHours} onChange={(event) => setDraftHours(event.target.value)} />
                </div>
              </div>
              <div className="field" style={{marginTop: 10}}>
                <label htmlFor={`team-experience-${employee.id}`}>{t("experience")}</label>
                <input id={`team-experience-${employee.id}`} type="number" min={0} max={100} value={draft.yearsExperience ?? ""} onChange={(event) => setDraft({...draft, yearsExperience: event.target.value ? Number(event.target.value) : undefined})} />
              </div>
              <div className="field" style={{marginTop: 10}}>
                <label htmlFor={`team-expertise-${employee.id}`}>{t("expertise")}</label>
                <input id={`team-expertise-${employee.id}`} value={draft.expertise ?? ""} onChange={(event) => setDraft({...draft, expertise: event.target.value})} />
              </div>
              <div className="field" style={{marginTop: 10}}>
                <label htmlFor={`team-hobbies-${employee.id}`}>{t("hobbies")}</label>
                <input id={`team-hobbies-${employee.id}`} value={draft.hobbies ?? ""} onChange={(event) => setDraft({...draft, hobbies: event.target.value})} />
              </div>
              <div style={{display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16}}>
                <button className="button danger" type="button" onClick={() => persist(staff.filter((item) => item.id !== employee.id))}><Trash2 size={15} />{common("remove")}</button>
                <div style={{display: "flex", gap: 8}}>
                  <button className="button ghost" type="button" onClick={() => { setEditingId(null); setDraft(null); setDraftHours(""); }}><X size={15} />{common("cancel")}</button>
                  <button className="button primary" type="button" onClick={saveEditing}><Save size={15} />{common("save")}</button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div style={{display: "flex", alignItems: "center", gap: 12, position: "relative"}}>
                <div className={`avatar ${employee.role === "NURSE" ? "nurse" : ""}`} style={{width: 52, height: 52, fontSize: 18}}>{employee.name.slice(0, 1)}</div>
                <div style={{flex: 1}}><h3 style={{margin: 0}}>{employee.name}</h3><span className="role-tag">{t(employee.backupOnly ? "backupDoctor" : employee.role === "DOCTOR" ? "doctor" : "nurse")}</span></div>
                <button className="button ghost" type="button" aria-label={`${common("edit")} ${employee.name}`} onClick={() => beginEditing(employee)}><Pencil size={15} />{common("edit")}</button>
              </div>
              <div style={{display: "grid", gap: 10, marginTop: 20, fontSize: 13}}>
                <div><BriefcaseMedical size={15} style={{display: "inline", marginRight: 8}} />{employee.yearsExperience ?? index + 2} {locale === "zh-TW" ? "年資歷" : "years experience"} · {employee.targetWeeklyHours}h/{locale === "zh-TW" ? "週" : "week"}</div>
                <div><Heart size={15} style={{display: "inline", marginRight: 8}} />{employee.expertise ?? (locale === "zh-TW" ? "一般診療與照護" : "General care")}</div>
                <div><Brain size={15} style={{display: "inline", marginRight: 8}} />{locale === "zh-TW" ? "團隊協作" : "Teamwork"} {84 + index * 3}/100 <small style={{color: "var(--muted)"}}>AI</small></div>
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  );
}
