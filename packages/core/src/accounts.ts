import * as fs from "fs";
import {
  getCodexAuthPath,
  getNamedAuthPath,
  listNamedAuthFiles,
  getNamedAuthDir,
} from "./paths";
import { readCurrentAuth, readAuthFile, extractMeta } from "./auth";
import { refreshAndSave } from "./refresh";
import { getQuotaInfo } from "./quota";
import { AuthFile, AccountMeta, QuotaInfo, ExportData } from "./types";

export interface AccountInfo {
  name: string;
  meta: AccountMeta | null;
  auth: AuthFile | null;
  isCurrent: boolean;
}

function normalizeIdentityValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function getAccountIdentity(meta: AccountMeta | null | undefined): string | null {
  if (!meta) return null;
  const email = normalizeIdentityValue(meta.email);
  const plan = normalizeIdentityValue(meta.plan);
  if (!email || !plan) return null;
  return `${email}::${plan}`;
}

function getSavedAccountsSnapshot(): Array<{ name: string; meta: AccountMeta | null; auth: AuthFile | null }> {
  return listNamedAuthFiles().map((name) => {
    const auth = readNamedAuth(name);
    const meta = auth ? extractMeta(auth) : null;
    return { name, meta, auth };
  });
}

function findAccountByIdentity(identity: string, excludeName?: string): AccountInfo | null {
  for (const account of getSavedAccountsSnapshot()) {
    if (excludeName && account.name === excludeName) {
      continue;
    }
    if (getAccountIdentity(account.meta) === identity) {
      return { ...account, isCurrent: false };
    }
  }
  return null;
}

export function readNamedAuth(name: string): AuthFile | null {
  return readAuthFile(getNamedAuthPath(name));
}

export function detectCurrentName(): string | null {
  const current = readCurrentAuth();
  if (!current) return null;

  if (current.tokens?.account_id) {
    for (const name of listNamedAuthFiles()) {
      const named = readNamedAuth(name);
      if (named?.tokens?.account_id === current.tokens.account_id) {
        return name;
      }
    }
  }

  const currentIdentity = getAccountIdentity(extractMeta(current));
  if (!currentIdentity) {
    return null;
  }

  for (const account of getSavedAccountsSnapshot()) {
    if (getAccountIdentity(account.meta) === currentIdentity) {
      return account.name;
    }
  }
  return null;
}

export function listAccounts(): AccountInfo[] {
  const currentName = detectCurrentName();
  return getSavedAccountsSnapshot().map(({ name, meta, auth }) => {
    return { name, meta, auth, isCurrent: name === currentName };
  });
}

export function addAccountFromAuth(name: string): { success: boolean; message: string; meta?: AccountMeta } {
  const auth = readCurrentAuth();
  if (!auth) {
    return { success: false, message: "auth.json was not found after login. Failed to add account." };
  }

  const meta = extractMeta(auth);
  const identity = getAccountIdentity(meta);
  if (identity) {
    const existing = findAccountByIdentity(identity, name);
    if (existing) {
      return {
        success: false,
        message: `An account with email ${meta.email} and plan ${meta.plan} is already saved as "${existing.name}". Duplicate add was rejected.`,
        meta,
      };
    }
  }

  const dest = getNamedAuthPath(name);
  fs.mkdirSync(getNamedAuthDir(), { recursive: true });
  fs.copyFileSync(getCodexAuthPath(), dest);

  return { success: true, message: `Account "${name}" was saved`, meta };
}

export function removeAccount(name: string): { success: boolean; message: string } {
  const p = getNamedAuthPath(name);
  if (!fs.existsSync(p)) {
    return { success: false, message: `Account "${name}" does not exist.` };
  }

  fs.unlinkSync(p);
  return { success: true, message: `Account "${name}" was removed` };
}

export function useAccount(name: string): { success: boolean; message: string; meta?: AccountMeta } {
  const src = getNamedAuthPath(name);
  if (!fs.existsSync(src)) {
    return { success: false, message: `Account "${name}" does not exist.` };
  }

  fs.copyFileSync(src, getCodexAuthPath());

  const auth = readNamedAuth(name);
  const meta = auth ? extractMeta(auth) : undefined;

  return { success: true, message: `Switched to account "${name}"`, meta };
}

export function getCurrentAccount(): { name: string | null; meta: AccountMeta | null } {
  const currentName = detectCurrentName();
  if (!currentName) {
    const auth = readCurrentAuth();
    const meta = auth ? extractMeta(auth) : null;
    return { name: null, meta };
  }

  const auth = readNamedAuth(currentName);
  const meta = auth ? extractMeta(auth) : null;
  return { name: currentName, meta };
}

export async function queryQuota(name?: string): Promise<{
  displayName: string;
  info: QuotaInfo;
} | null> {
  let auth: AuthFile | null;
  let displayName: string;

  if (name) {
    auth = readNamedAuth(name);
    if (!auth) return null;
    displayName = name;
  } else {
    const currentName = detectCurrentName();
    if (currentName) {
      auth = readNamedAuth(currentName);
      displayName = currentName;
    } else {
      auth = readCurrentAuth();
      displayName = "Current auth";
    }
  }

  if (!auth) return null;

  const info = await getQuotaInfo(auth);
  return { displayName, info };
}

export async function refreshAccount(name?: string): Promise<{
  success: boolean;
  message: string;
  meta?: AccountMeta;
  lastRefresh?: string;
}> {
  let authPath: string;
  let displayName: string;

  if (name) {
    authPath = getNamedAuthPath(name);
    if (!fs.existsSync(authPath)) {
      return { success: false, message: `Account "${name}" does not exist.` };
    }
    displayName = name;
  } else {
    const currentName = detectCurrentName();
    if (currentName) {
      authPath = getNamedAuthPath(currentName);
      displayName = currentName;
    } else {
      authPath = getCodexAuthPath();
      displayName = "Current auth";
    }
  }

  if (!fs.existsSync(authPath)) {
    return { success: false, message: "Auth file was not found." };
  }

  try {
    const updated = await refreshAndSave(authPath);

    if (name) {
      const currentName = detectCurrentName();
      if (currentName === name) {
        fs.copyFileSync(authPath, getCodexAuthPath());
      }
    }

    const meta = extractMeta(updated);
    return {
      success: true,
      message: `Token for "${displayName}" was refreshed`,
      meta,
      lastRefresh: updated.last_refresh,
    };
  } catch (err) {
    return {
      success: false,
      message: `Token refresh failed: ${err instanceof Error ? err.message : err}`,
    };
  }
}

export function exportAccounts(names?: string[]): ExportData {
  const allNames = names ?? listNamedAuthFiles();
  const accounts = allNames
    .map((name) => {
      const auth = readNamedAuth(name);
      if (!auth) return null;
      return { name, auth };
    })
    .filter((a): a is { name: string; auth: AuthFile } => a !== null);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts,
  };
}

export function importAccounts(
  data: ExportData,
  overwrite = false
): { imported: string[]; skipped: string[]; errors: string[] } {
  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const dir = getNamedAuthDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const account of data.accounts) {
    try {
      const dest = getNamedAuthPath(account.name);
      if (fs.existsSync(dest) && !overwrite) {
        skipped.push(account.name);
        continue;
      }
      fs.writeFileSync(dest, JSON.stringify(account.auth, null, 2), "utf-8");
      imported.push(account.name);
    } catch (err) {
      errors.push(`${account.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { imported, skipped, errors };
}
