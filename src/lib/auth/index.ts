import { compare } from "bcryptjs";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { adminLoginSchema } from "@/lib/validation";

const ISSUER = "autovet";
const AUDIENCE = "autovet-admin";
const DEFAULT_TTL_SECONDS = 60 * 60 * 12;

export interface AdminSession extends JWTPayload {
  sub: "admin";
  role: "admin";
  email: string;
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

export function getAdminCookieName(): string {
  if (process.env.AUTH_COOKIE_NAME) return process.env.AUTH_COOKIE_NAME;
  return isSecureCookie() ? "__Host-autovet_admin" : "autovet_admin";
}

function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 bytes.");
  }
  return new TextEncoder().encode(secret);
}

function getAdminCredentials(): { email: string; passwordHash: string } {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!email || !passwordHash) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD_HASH are required for admin login.",
    );
  }
  return { email, passwordHash };
}

export async function authenticateAdmin(payload: {
  email: string;
  password: string;
}): Promise<boolean> {
  const input = adminLoginSchema.parse(payload);
  const credentials = getAdminCredentials();
  const passwordMatches = await compare(
    input.password,
    credentials.passwordHash,
  );

  return (
    passwordMatches &&
    input.email.trim().toLowerCase() === credentials.email
  );
}

export async function signAdminSession(): Promise<string> {
  const { email } = getAdminCredentials();
  const ttl = getSessionTtl();

  return new SignJWT({ role: "admin", email })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("admin")
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(getAuthSecret());
}

export async function verifyAdminSession(
  token: string | null | undefined,
): Promise<AdminSession | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getAuthSecret(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: "admin",
    });
    const credentials = getAdminCredentials();
    if (
      payload.role !== "admin" ||
      typeof payload.email !== "string" ||
      payload.email.toLowerCase() !== credentials.email
    ) {
      return null;
    }
    return payload as AdminSession;
  } catch {
    return null;
  }
}

export async function createAdminSessionCookie(): Promise<SessionCookie> {
  return {
    name: getAdminCookieName(),
    value: await signAdminSession(),
    options: {
      httpOnly: true,
      secure: isSecureCookie(),
      sameSite: "strict",
      path: "/",
      maxAge: getSessionTtl(),
    },
  };
}

export function createExpiredAdminCookie(): SessionCookie {
  return {
    name: getAdminCookieName(),
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

export function readAdminToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const target = getAdminCookieName();

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

