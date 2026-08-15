import createMiddleware from "next-intl/middleware";
import {NextRequest, NextResponse} from "next/server";
import {routing} from "./i18n/routing";
import {getSessionCookieName, verifyUserSession} from "./lib/auth";

const intlMiddleware = createMiddleware(routing);

function isPublicAuthPath(pathname: string): boolean {
  return routing.locales.some((locale) =>
    pathname === `/${locale}/login` || pathname === `/${locale}/signup`,
  );
}

function localeFromPath(pathname: string): string {
  return routing.locales.find((locale) =>
    pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  ) ?? routing.defaultLocale;
}

export default async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublicAuthPath(pathname)) {
    return intlMiddleware(request);
  }

  if (process.env.AUTH_SECRET) {
    const session = await verifyUserSession(request.cookies.get(getSessionCookieName())?.value);
    if (!session) {
      return NextResponse.redirect(new URL(`/${localeFromPath(pathname)}/login`, request.url));
    }
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
