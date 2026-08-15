import {NextResponse} from "next/server";
import {ZodError} from "zod";
import {createSessionCookie, signUp} from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const session = await signUp(body);
    const cookie = await createSessionCookie(session);
    const response = NextResponse.json({ok: true});
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_TAKEN") {
      return NextResponse.json({error: "An account with this email already exists"}, {status: 409});
    }
    if (error instanceof ZodError) {
      return NextResponse.json({error: "Invalid sign-up input"}, {status: 400});
    }
    return NextResponse.json({error: "Sign-up is unavailable"}, {status: 503});
  }
}
