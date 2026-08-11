import createMiddleware from "next-intl/middleware";
import {NextRequest, NextResponse} from "next/server";
import {routing} from "./i18n/routing";
import {getAdminCookieName, verifyAdminSession} from "./lib/auth";

const intlMiddleware = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/login" || routing.locales.some((locale) => pathname === `/${locale}/login`)) {
    return intlMiddleware(request);
  }

  const authConfigured = Boolean(process.env.ADMIN_EMAIL && process.env.AUTH_SECRET);
  if (authConfigured) {
    const session = await verifyAdminSession(request.cookies.get(getAdminCookieName())?.value);
    if (!session) {
      const localePrefix = pathname.startsWith("/en") ? "/en" : "";
      return NextResponse.redirect(new URL(`${localePrefix}/login`, request.url));
    }
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
