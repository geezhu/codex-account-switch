import * as fs from "fs";
import { jwtDecode } from "jwt-decode";
import { getCodexAuthPath } from "./paths";
import { AuthFile, IdTokenPayload, AccountMeta } from "./types";

export function readCurrentAuth(): AuthFile | null {
  const p = getCodexAuthPath();
  if (!fs.existsSync(p)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as AuthFile;
  } catch {
    return null;
  }
}

export function readAuthFile(filePath: string): AuthFile | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as AuthFile;
  } catch {
    return null;
  }
}

export function extractMeta(auth: AuthFile): AccountMeta {
  let email = "unknown";
  let name = "unknown";
  let plan = "unknown";

  if (auth.tokens?.id_token) {
    try {
      const decoded = jwtDecode<IdTokenPayload>(auth.tokens.id_token);
      email = decoded.email ?? email;
      name = decoded.name ?? decoded.sub ?? name;
      const authInfo = decoded["https://api.openai.com/auth"];
      if (authInfo?.chatgpt_plan_type) {
        plan = authInfo.chatgpt_plan_type;
      }
    } catch {
      // JWT decode failed
    }
  }

  return { name, email, plan };
}

export function getTokenExpiry(auth: AuthFile): Date | null {
  if (!auth.tokens?.access_token) return null;
  try {
    const decoded = jwtDecode<{ exp?: number }>(auth.tokens.access_token);
    if (decoded.exp) {
      return new Date(decoded.exp * 1000);
    }
  } catch {
    // ignore
  }
  return null;
}

export function isTokenExpired(auth: AuthFile): boolean {
  const expiry = getTokenExpiry(auth);
  if (!expiry) return true;
  return expiry.getTime() < Date.now();
}

export function formatTokenExpiry(auth: AuthFile): string {
  const expiry = getTokenExpiry(auth);
  if (!expiry) return "unknown";
  const now = Date.now();
  const diff = expiry.getTime() - now;
  if (diff <= 0) {
    const ago = Math.abs(diff);
    const m = Math.floor(ago / 60000);
    if (m < 60) return `expired ${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `expired ${h}h${m % 60}m ago`;
    return `expired ${Math.floor(h / 24)}d${h % 24}h ago`;
  }
  const m = Math.floor(diff / 60000);
  if (m < 60) return `expires in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `expires in ${h}h${m % 60}m`;
  return `expires in ${Math.floor(h / 24)}d${h % 24}h`;
}
