import {getTranslations, setRequestLocale} from "next-intl/server";
import {AppHeader} from "@/components/app-header";
import {HistoryList} from "@/components/history-list";

export default async function HistoryPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  setRequestLocale(locale);
  const t = await getTranslations("history");
  return (
    <main className="shell">
      <AppHeader />
      <div className="container">
        <section className="hero"><div><div className="eyebrow">Archive</div><h1>{t("title")}</h1><p>{t("subtitle")}</p></div></section>
        <HistoryList />
      </div>
    </main>
  );
}
