import {afterEach, describe, expect, it, vi} from "vitest";
import {isAdminRequestAuthorized, readAdminToken} from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("API authorization", () => {
  it("rejects a production request without an admin session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_EMAIL", "admin@example.com");
    vi.stubEnv("AUTH_SECRET", "a".repeat(32));

    await expect(
      isAdminRequestAuthorized(new Request("https://example.com/api/summary")),
    ).resolves.toBe(false);
  });

  it("reads the configured admin cookie from a request header", () => {
    vi.stubEnv("AUTH_COOKIE_NAME", "autovet_session");

    expect(
      readAdminToken("other=value; autovet_session=signed%20token"),
    ).toBe("signed token");
  });
});
