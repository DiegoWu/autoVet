import {HeartPulse} from "lucide-react";
import {getTranslations, setRequestLocale} from "next-intl/server";
import {AppHeader} from "@/components/app-header";
import {ScheduleWizard} from "@/components/schedule-wizard";

export default async function HomePage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  setRequestLocale(locale);
  const t = await getTranslations("hero");

  return (
    <main className="shell">
      <AppHeader />
      <div className="container">
        <section className="hero">
          <div>
            <div className="eyebrow">{t("eyebrow")}</div>
            <h1>{t("title")}</h1>
            <p>{t("subtitle")}</p>
          </div>
          <div className="hero-art" aria-hidden="true"><HeartPulse size={62} strokeWidth={1.5} /></div>
        </section>
        <ScheduleWizard />
      </div>
    </main>
  );
}
