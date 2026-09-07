export type AuthHashSession = {
  accessToken: string;
  refreshToken: string;
};

export type AuthHashOtp = {
  tokenHash: string;
  type: "invite" | "recovery";
};

export function authHashOtp(hash: string): AuthHashOtp | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const tokenHash = params.get("token_hash")?.trim();
  const type = params.get("type")?.trim();

  if (!tokenHash || (type !== "invite" && type !== "recovery")) return null;
  return { tokenHash, type };
}

export function authHashSession(hash: string): AuthHashSession | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = params.get("access_token")?.trim();
  const refreshToken = params.get("refresh_token")?.trim();

  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export function authHashError(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.get("error_description")?.trim() || null;
}
