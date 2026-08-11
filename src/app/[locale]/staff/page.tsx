import {getTranslations, setRequestLocale} from "next-intl/server";
import {AppHeader} from "@/components/app-header";
import {StaffCards} from "@/components/staff-cards";

export default async function StaffPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  setRequestLocale(locale);
  const t = await getTranslations("staff");
  return (
    <main className="shell">
      <AppHeader />
      <div className="container">
        <section className="hero"><div><div className="eyebrow">Team</div><h1>{t("title")}</h1><p>{t("hint")}</p></div></section>
        <div className="wizard"><section className="panel"><StaffCards /></section></div>
      </div>
    </main>
  );
}
