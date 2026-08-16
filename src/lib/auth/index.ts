import {compare, hash} from "bcryptjs";
import {jwtVerify, SignJWT, type JWTPayload} from "jose";
import {Prisma} from "@/generated/prisma/client";
import {getPrisma} from "@/lib/db";
import {userLoginSchema, userSignupSchema} from "@/lib/validation";

const ISSUER = "autovet";
const AUDIENCE = "autovet-user";
const DEFAULT_TTL_SECONDS = 60 * 60 * 12;

export interface UserSession extends JWTPayload {
  sub: string;
  email: string;
  clinicId: string;
  role: "OWNER" | "MEMBER";
}

export interface SessionCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "strict";
    path: "/";
    maxAge: number;
  };
}

function getSessionTtl(): number {
  const configured = Number(process.env.AUTH_SESSION_TTL_SECONDS);
  if (!Number.isSafeInteger(configured) || configured < 300) {
    return DEFAULT_TTL_SECONDS;
  }
  return Math.min(configured, 60 * 60 * 24 * 7);
}

function isSecureCookie(): boolean {
  return process.env.NODE_ENV !== "development";
}

export function getSessionCookieName(): string {
  if (process.env.AUTH_COOKIE_NAME) return process.env.AUTH_COOKIE_NAME;
  return isSecureCookie() ? "__Host-autovet" : "autovet_session";
}

export function isAuthConfigured(): boolean {
  const secret = process.env.AUTH_SECRET;
  return Boolean(secret && new TextEncoder().encode(secret).byteLength >= 32);
}

function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 bytes.");
  }
  return new TextEncoder().encode(secret);
}

export async function signUp(payload: {
  clinicName: string;
  name: string;
  email: string;
  password: string;
}): Promise<UserSession> {
  const input = userSignupSchema.parse(payload);
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hash(input.password, 12);
  const prisma = await getPrisma();

  try {
    const user = await prisma.$transaction(async (tx) => {
      const clinic = await tx.clinic.create({
        data: {name: input.clinicName},
      });
      return tx.user.create({
        data: {
          email,
          passwordHash,
          name: input.name,
          role: "OWNER",
          clinicId: clinic.id,
        },
      });
    });

    return {
      sub: user.id,
      email: user.email,
      clinicId: user.clinicId,
      role: user.role,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("EMAIL_TAKEN");
    }
    throw error;
  }
}

export async function signIn(payload: {
  email: string;
  password: string;
}): Promise<UserSession | null> {
  const input = userLoginSchema.parse(payload);
  const email = input.email.trim().toLowerCase();
  const prisma = await getPrisma();
  const user = await prisma.user.findUnique({where: {email}});
  if (!user) return null;
  if (!await compare(input.password, user.passwordHash)) return null;
  return {
    sub: user.id,
    email: user.email,
    clinicId: user.clinicId,
    role: user.role,
  };
}

export async function signUserSession(session: UserSession): Promise<string> {
  const ttl = getSessionTtl();

  return new SignJWT({
    email: session.email,
    clinicId: session.clinicId,
    role: session.role,
  })
    .setProtectedHeader({alg: "HS256", typ: "JWT"})
    .setSubject(session.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(getAuthSecret());
}

export async function verifyUserSession(
  token: string | null | undefined,
): Promise<UserSession | null> {
  if (!token) return null;

  try {
    const {payload} = await jwtVerify(token, getAuthSecret(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.clinicId !== "string" ||
      (payload.role !== "OWNER" && payload.role !== "MEMBER")
    ) {
      return null;
    }
    return payload as UserSession;
  } catch {
    return null;
  }
}

export async function createSessionCookie(session: UserSession): Promise<SessionCookie> {
  return {
    name: getSessionCookieName(),
    value: await signUserSession(session),
    options: {
      httpOnly: true,
      secure: isSecureCookie(),
      sameSite: "strict",
      path: "/",
      maxAge: getSessionTtl(),
    },
  };
}

export function createExpiredSessionCookie(): SessionCookie {
  return {
    name: getSessionCookieName(),
    value: "",
    options: {
      httpOnly: true,
      secure: isSecureCookie(),
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    },
  };
}

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const target = getSessionCookieName();

  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    if (name === target) {
      try {
        return decodeURIComponent(pair.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function requireSession(request: Request): Promise<UserSession | null> {
  const headerToken = readSessionToken(request.headers.get("cookie"));
  if (headerToken) return verifyUserSession(headerToken);
  const cookieGetter = (request as Request & {
    cookies?: {get: (name: string) => {value: string} | undefined};
  }).cookies;
  return verifyUserSession(cookieGetter?.get(getSessionCookieName())?.value);
}

export function serializeSessionCookie(cookie: SessionCookie): string {
  const parts = [
    `${cookie.name}=${encodeURIComponent(cookie.value)}`,
    `Path=${cookie.options.path}`,
    `Max-Age=${cookie.options.maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (cookie.options.secure) parts.push("Secure");
  return parts.join("; ");
}
