"use client";

import {Bone, CalendarDays, History, Languages, Users} from "lucide-react";
import {useLocale, useTranslations} from "next-intl";
import {Link, usePathname, useRouter} from "@/i18n/navigation";

export function AppHeader() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function toggleLocale() {
    router.replace(pathname, {locale: locale === "zh-TW" ? "en" : "zh-TW"});
    document.cookie = `NEXT_LOCALE=${locale === "zh-TW" ? "en" : "zh-TW"};path=/;max-age=31536000;samesite=lax`;
  }

  return (
    <header className="topbar">
      <div className="container" style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
        <Link href="/" className="brand">
          <span className="brand-mark"><Bone size={21} /></span>
          <span>autoVet</span>
        </Link>
        <nav className="nav" aria-label="Primary navigation">
          <Link href="/"><CalendarDays size={15} style={{display: "inline", marginRight: 5}} />{t("workspace")}</Link>
          <Link href="/staff"><Users size={15} style={{display: "inline", marginRight: 5}} />{t("staff")}</Link>
          <Link href="/history"><History size={15} style={{display: "inline", marginRight: 5}} />{t("history")}</Link>
          <button className="language" onClick={toggleLocale} aria-label={t("language")}>
            <Languages size={15} style={{display: "inline", marginRight: 5}} />{t("language")}
          </button>
        </nav>
      </div>
    </header>
  );
}
