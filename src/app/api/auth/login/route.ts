import {NextResponse} from "next/server";
import {authenticateAdmin, createAdminSessionCookie} from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!await authenticateAdmin(body)) {
      return NextResponse.json({error: "Invalid email or password"}, {status: 401});
    }
    const cookie = await createAdminSessionCookie();
    const response = NextResponse.json({ok: true});
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch {
    return NextResponse.json({error: "Authentication is not configured"}, {status: 503});
  }
}
