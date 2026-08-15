import {NextResponse} from "next/server";
import {createExpiredSessionCookie} from "@/lib/auth";

export async function POST() {
  const cookie = createExpiredSessionCookie();
  const response = NextResponse.json({ok: true});
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
