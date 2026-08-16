import {afterEach, describe, expect, it, vi} from "vitest";
import {
  isAuthConfigured,
  readSessionToken,
  requireSession,
  signUserSession,
  verifyUserSession,
} from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
});

const session = {
  sub: "user_1",
  email: "owner@clinic.example",
  clinicId: "clinic_1",
  role: "OWNER" as const,
};

describe("user sessions", () => {
  it("treats a missing or short AUTH_SECRET as unconfigured", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(isAuthConfigured()).toBe(false);
    vi.stubEnv("AUTH_SECRET", "a".repeat(32));
    expect(isAuthConfigured()).toBe(true);
  });

  it("rejects a request without a session cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a".repeat(32));

    await expect(
      requireSession(new Request("https://example.com/api/summary")),
    ).resolves.toBeNull();
  });

  it("reads the configured session cookie from a request header", () => {
    vi.stubEnv("AUTH_COOKIE_NAME", "autovet_session");

    expect(
      readSessionToken("other=value; autovet_session=signed%20token"),
    ).toBe("signed token");
  });

  it("round-trips a clinic-scoped user session", async () => {
    vi.stubEnv("AUTH_SECRET", "a".repeat(32));

    const token = await signUserSession(session);
    await expect(verifyUserSession(token)).resolves.toMatchObject(session);
  });
});
