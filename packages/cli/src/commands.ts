import * as fs from "fs";
import { execSync } from "child_process";
import chalk from "chalk";
import {
  listAccounts,
  addAccountFromAuth,
  removeAccount,
  useAccount,
  getCurrentAccount,
  queryQuota,
  refreshAccount,
  exportAccounts,
  importAccounts,
  getTokenExpiry,
  formatTokenExpiry,
  ExportData,
  WindowInfo,
  getNamedAuthPath,
  readNamedAuth,
} from "@codex-account-switch/core";

export function cmdList(): void {
  const accounts = listAccounts();

  if (accounts.length === 0) {
    console.log(chalk.yellow("No saved accounts. Use the add command to create one."));
    return;
  }

  console.log(chalk.bold("\nSaved accounts:\n"));

  const maxNameLen = Math.max(...accounts.map((a) => a.name.length), 4);

  for (const account of accounts) {
    const marker = account.isCurrent ? chalk.green("● ") : "  ";
    const tag = account.isCurrent ? chalk.green(" [current]") : "";
    const paddedName = account.name.padEnd(maxNameLen);
    const email = account.meta?.email ?? "unknown";
    const plan = account.meta?.plan ?? "unknown";

    let tokenStatus = "";
    if (account.auth) {
      const expiry = getTokenExpiry(account.auth);
      if (expiry) {
        const expired = expiry.getTime() < Date.now();
        tokenStatus = expired
          ? chalk.red(` [${formatTokenExpiry(account.auth)}]`)
          : chalk.dim(` [${formatTokenExpiry(account.auth)}]`);
      }
    }

    console.log(
      `${marker}${chalk.bold(paddedName)}  ${chalk.dim(email)}  ${chalk.cyan(plan)}${tokenStatus}${tag}`
    );
  }
  console.log();
}

export async function cmdAdd(name: string): Promise<void> {
  const dest = getNamedAuthPath(name);
  if (fs.existsSync(dest)) {
    console.log(chalk.yellow(`Account "${name}" already exists. Trying to refresh its token first.`));

    const refreshResult = await refreshAccount(name);
    if (refreshResult.success) {
      const refreshedAuth = readNamedAuth(name);
      const tokenStatus = refreshedAuth ? formatTokenExpiry(refreshedAuth) : null;

      console.log(chalk.green(`✓ Account "${name}" already existed and its token was refreshed.`));
      if (tokenStatus) {
        console.log(chalk.dim(`  Remaining validity: ${tokenStatus}`));
      }
      return;
    }

    console.log(chalk.yellow(`  Token refresh failed: ${refreshResult.message}`));
    console.log(chalk.cyan("  Starting a new login flow to re-authorize and overwrite the saved account.\n"));
  }

  console.log(chalk.cyan("Starting the Codex login flow...\n"));

  try {
    execSync("codex login", { stdio: "inherit" });
  } catch {
    console.log(chalk.red("\nLogin failed or was cancelled."));
    return;
  }

  const result = addAccountFromAuth(name);
  if (!result.success) {
    console.log(chalk.red(result.message));
    return;
  }

  console.log(chalk.green(`\n✓ ${result.message}`));
  if (result.meta) {
    console.log(chalk.dim(`  Email: ${result.meta.email}`));
    console.log(chalk.dim(`  Plan: ${result.meta.plan}`));
  }
  console.log(chalk.dim(`  File: ${dest}`));
}

export function cmdRemove(name: string): void {
  const result = removeAccount(name);
  console.log(result.success ? chalk.green(`✓ ${result.message}`) : chalk.red(result.message));
}

export function cmdUse(name: string): void {
  const result = useAccount(name);
  if (!result.success) {
    console.log(chalk.red(result.message));
    const accounts = listAccounts();
    if (accounts.length === 0) {
      console.log(chalk.yellow("  (none)"));
    } else {
      accounts.forEach((a) => console.log(`  - ${a.name}`));
    }
    return;
  }

  console.log(chalk.green(`✓ ${result.message}`));
  if (result.meta) {
    console.log(chalk.dim(`  Email: ${result.meta.email}`));
    console.log(chalk.dim(`  Plan: ${result.meta.plan}`));
  }
}

function formatResetTime(resetsAt: Date | null): string {
  if (!resetsAt) return "";
  const secs = Math.floor((resetsAt.getTime() - Date.now()) / 1000);
  if (secs <= 0) return "";
  const minutes = Math.floor(secs / 60);
  if (minutes >= 60) return `resets in ${Math.floor(minutes / 60)}h${minutes % 60}m`;
  return `resets in ${minutes}m`;
}

function colorPercent(pct: number): string {
  const rounded = Math.round(pct);
  if (rounded >= 70) return chalk.red(`${rounded}%`);
  if (rounded >= 50) return chalk.yellow(`${rounded}%`);
  return chalk.green(`${rounded}%`);
}

function formatBar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  if (pct >= 70) return chalk.red(bar);
  if (pct >= 50) return chalk.yellow(bar);
  return chalk.green(bar);
}

function windowLabel(w: WindowInfo): string {
  if (w.windowSeconds == null) return "quota";
  const hours = w.windowSeconds / 3600;
  if (hours <= 5) return "5h quota";
  if (hours <= 24) return `${Math.round(hours)}h quota`;
  const days = Math.round(hours / 24);
  return `${days}d quota`;
}

function printWindowLine(label: string, w: WindowInfo): void {
  const used = w.usedPercent;
  const remaining = Math.max(0, 100 - used);
  const reset = formatResetTime(w.resetsAt);
  const padded = label.padEnd(10);
  console.log(
    `  ${padded}${formatBar(used)} ${colorPercent(used)} used / ${chalk.bold(`${Math.round(remaining)}%`)} remaining`
  );
  if (reset) {
    console.log(`  ${" ".repeat(10)}${chalk.dim(reset)}`);
  }
}

export async function cmdQuota(name?: string): Promise<void> {
  const result = await queryQuota(name);

  if (!result) {
    console.log(chalk.red(name ? `Account "${name}" does not exist.` : "No auth information found."));
    return;
  }

  const { displayName, info } = result;

  console.log(chalk.bold(`\nAccount quota - ${displayName}\n`));
  console.log(`  Email: ${info.email}`);
  console.log(`  Plan:  ${chalk.cyan(info.plan)}`);

  if (info.tokenExpired) {
    console.log(`  Token: ${chalk.red("expired")}`);
  } else {
    console.log(`  Token: ${chalk.green("valid")}`);
  }

  if (info.primaryWindow || info.secondaryWindow) console.log();

  if (info.primaryWindow) printWindowLine(windowLabel(info.primaryWindow), info.primaryWindow);
  if (info.secondaryWindow) printWindowLine(windowLabel(info.secondaryWindow), info.secondaryWindow);

  if (info.additional.length > 0) {
    console.log();
    for (const item of info.additional) {
      if (item.primary && item.primary.usedPercent > 0) {
        printWindowLine(`${item.name} (${windowLabel(item.primary)})`, item.primary);
      }
      if (item.secondary && item.secondary.usedPercent > 0) {
        printWindowLine(`${item.name} (${windowLabel(item.secondary)})`, item.secondary);
      }
    }
  }

  if (info.codeReview && info.codeReview.usedPercent > 0) {
    printWindowLine("code review", info.codeReview);
  }

  if (info.credits) {
    console.log(`\n  ${chalk.green("✓")} Extra purchased credits available`);
  }

  if (!info.primaryWindow && !info.secondaryWindow) {
    console.log(chalk.yellow("\n  Unable to load quota information (API request failed or token expired)"));
  }

  console.log();
}

export function cmdCurrent(): void {
  const { name, meta } = getCurrentAccount();

  if (!name) {
    console.log(chalk.yellow("No saved account matches the current auth. You may be using an unsaved login."));
    if (meta) {
      console.log(chalk.dim(`  Current auth.json email: ${meta.email}`));
    }
    return;
  }

  console.log(chalk.green(`Current account: ${name}`));
  if (meta) {
    console.log(chalk.dim(`  Email: ${meta.email}`));
    console.log(chalk.dim(`  Plan: ${meta.plan}`));
  }
}

export async function cmdRefresh(name?: string): Promise<void> {
  console.log(chalk.cyan("Refreshing token..."));
  const result = await refreshAccount(name);

  if (!result.success) {
    console.log(chalk.red(result.message));
    console.log(chalk.yellow("Try logging in again: codex-account-switch add <name>"));
    return;
  }

  console.log(chalk.green(`✓ ${result.message}`));
  if (result.meta) {
    console.log(chalk.dim(`  Email: ${result.meta.email}`));
  }
  if (result.lastRefresh) {
    console.log(chalk.dim(`  Time: ${result.lastRefresh}`));
  }
}

export function cmdExport(file?: string, names?: string[]): void {
  const outputPath = file ?? "codex-accounts.json";
  const data = exportAccounts(names);

  if (data.accounts.length === 0) {
    console.log(chalk.yellow("No accounts available to export."));
    return;
  }

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(chalk.green(`✓ Exported ${data.accounts.length} account(s) to ${outputPath}`));
  data.accounts.forEach((a) => console.log(chalk.dim(`  - ${a.name}`)));
}

export function cmdImport(file: string, overwrite?: boolean): void {
  if (!fs.existsSync(file)) {
    console.log(chalk.red(`File does not exist: ${file}`));
    return;
  }

  let data: ExportData;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf-8")) as ExportData;
  } catch {
    console.log(chalk.red("Invalid file format: unable to parse JSON."));
    return;
  }

  if (data.version !== 1 || !Array.isArray(data.accounts)) {
    console.log(chalk.red("Unsupported export file format."));
    return;
  }

  const result = importAccounts(data, overwrite);

  if (result.imported.length > 0) {
    console.log(chalk.green(`✓ Imported ${result.imported.length} account(s):`));
    result.imported.forEach((n) => console.log(chalk.dim(`  - ${n}`)));
  }
  if (result.skipped.length > 0) {
    console.log(chalk.yellow(`Skipped ${result.skipped.length} existing account(s) (use --overwrite to replace them):`));
    result.skipped.forEach((n) => console.log(chalk.dim(`  - ${n}`)));
  }
  if (result.errors.length > 0) {
    console.log(chalk.red("Import failed:"));
    result.errors.forEach((e) => console.log(chalk.dim(`  - ${e}`)));
  }
}
