import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./_core/cookies";

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    protocol: "http",
    headers: {},
    ...overrides,
  } as Request;
}

describe("getSessionCookieOptions", () => {
  it("uses SameSite=None for secure requests", () => {
    const req = createReq({ protocol: "https" });

    const options = getSessionCookieOptions(req);

    expect(options).toMatchObject({
      secure: true,
      sameSite: "none",
      httpOnly: true,
      path: "/",
    });
  });

  it("falls back to SameSite=Lax when request is not secure", () => {
    const req = createReq({ protocol: "http" });

    const options = getSessionCookieOptions(req);

    expect(options).toMatchObject({
      secure: false,
      sameSite: "lax",
      httpOnly: true,
      path: "/",
    });
  });
});
