import {NextResponse} from "next/server";
import {createExpiredAdminCookie} from "@/lib/auth";

export async function POST() {
  const cookie = createExpiredAdminCookie();
  const response = NextResponse.json({ok: true});
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
