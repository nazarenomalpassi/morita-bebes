import { describe, expect, it } from "vitest";

import { authHashError, authHashOtp, authHashSession } from "./invite-session";

describe("authHashOtp", () => {
  it("recovers a recovery token hash without changing it", () => {
    expect(authHashOtp("#token_hash=hashed-token.123&type=recovery")).toEqual({
      tokenHash: "hashed-token.123",
      type: "recovery",
    });
  });

  it("accepts invite tokens and rejects unsupported or incomplete fragments", () => {
    expect(authHashOtp("#token_hash=invite-token&type=invite")).toEqual({
      tokenHash: "invite-token",
      type: "invite",
    });
    expect(authHashOtp("#token_hash=token&type=magiclink")).toBeNull();
    expect(authHashOtp("#type=recovery")).toBeNull();
  });
});

describe("authHashSession", () => {
  it("recovers an implicit invite session without changing the tokens", () => {
    expect(authHashSession("#access_token=access.123&refresh_token=refresh.456&type=invite")).toEqual({
      accessToken: "access.123",
      refreshToken: "refresh.456",
    });
  });

  it("rejects incomplete or empty fragments", () => {
    expect(authHashSession("#access_token=only-access")).toBeNull();
    expect(authHashSession("")).toBeNull();
  });

  it("extracts the provider error description", () => {
    expect(authHashError("#error=access_denied&error_description=Link+expired")).toBe("Link expired");
  });
});
