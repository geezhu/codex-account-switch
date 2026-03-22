import * as vscode from "vscode";
import * as fs from "fs";
import {
  addAccountFromAuth,
  removeAccount,
  useAccount,
  refreshAccount,
  exportAccounts,
  importAccounts,
  listAccounts,
  ExportData,
  getNamedAuthPath,
  readNamedAuth,
  formatTokenExpiry,
} from "@codex-account-switch/core";
import { AccountTreeProvider, AccountTreeItem, AccountTreeNode } from "./accountTree";
import { StatusBarManager } from "./statusBar";

function refreshAll(accountTree: AccountTreeProvider, statusBar: StatusBarManager) {
  accountTree.refresh();
  void accountTree.refreshQuota();
  void statusBar.refreshNow();
}

function getReloadBehavior(): "never" | "prompt" | "always" {
  return vscode.workspace
    .getConfiguration("codex-account-switch")
    .get<"never" | "prompt" | "always">("reloadWindowAfterSwitch", "prompt");
}

async function reloadWindow() {
  await vscode.commands.executeCommand("workbench.action.reloadWindow");
}

async function maybeReloadWindowAfterSwitch(accountName: string) {
  const behavior = getReloadBehavior();
  if (behavior === "never") {
    return;
  }

  if (behavior === "always") {
    void vscode.window.showInformationMessage(
      `Switched to "${accountName}". Reloading the window so the Codex extension can pick up the new auth.`
    );
    await reloadWindow();
    return;
  }

  const action = await vscode.window.showInformationMessage(
    `Switched to "${accountName}". Reload the window if the Codex extension is still using the previous account.`,
    "Reload",
    "Later"
  );
  if (action === "Reload") {
    await reloadWindow();
  }
}

export function registerCommands(
  context: vscode.ExtensionContext,
  accountTree: AccountTreeProvider,
  statusBar: StatusBarManager,
  accountTreeView: vscode.TreeView<AccountTreeNode>
) {
  context.subscriptions.push(
    vscode.commands.registerCommand("codex-account-switch.addAccount", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Enter an account name",
        placeHolder: "For example: work, personal",
        validateInput: (v) => (v.trim() ? null : "Name is required"),
      });
      if (!name) return;

      const dest = getNamedAuthPath(name.trim());
      if (fs.existsSync(dest)) {
        const existingName = name.trim();
        const refreshResult = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Refreshing token for "${existingName}"...` },
          async () => refreshAccount(existingName)
        );

        if (refreshResult.success) {
          const refreshedAuth = readNamedAuth(existingName);
          const tokenStatus = refreshedAuth ? formatTokenExpiry(refreshedAuth) : undefined;
          vscode.window.showInformationMessage(
            tokenStatus
              ? `Account "${existingName}" already exists. Token refreshed. Remaining validity: ${tokenStatus}.`
              : `Account "${existingName}" already exists. Token refreshed.`
          );
          refreshAll(accountTree, statusBar);
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Account "${existingName}" already exists and token refresh failed. Start login and overwrite it?`,
          "Login and overwrite",
          "Cancel"
        );
        if (confirm !== "Login and overwrite") return;
      }

      const terminal = vscode.window.createTerminal("Codex Login");
      terminal.show();
      terminal.sendText("codex login");

      const action = await vscode.window.showInformationMessage(
        "Complete `codex login` in the terminal, then click Done.",
        "Done",
        "Cancel"
      );

      if (action !== "Done") return;

      const result = addAccountFromAuth(name.trim());
      if (result.success) {
        vscode.window.showInformationMessage(`✓ ${result.message} (${result.meta?.email})`);
        refreshAll(accountTree, statusBar);
      } else {
        vscode.window.showErrorMessage(result.message);
      }
    }),

    vscode.commands.registerCommand(
      "codex-account-switch.removeAccount",
      async (item?: AccountTreeItem) => {
        let name: string | undefined;

        if (item) {
          name = item.account.name;
        } else {
          const accounts = listAccounts();
          if (accounts.length === 0) {
            vscode.window.showWarningMessage("No saved accounts");
            return;
          }
          name = await vscode.window.showQuickPick(
            accounts.map((a) => a.name),
            { placeHolder: "Select an account to remove" }
          );
        }

        if (!name) return;

        const confirm = await vscode.window.showWarningMessage(
          `Remove account "${name}"?`,
          "Remove",
          "Cancel"
        );
        if (confirm !== "Remove") return;

        const result = removeAccount(name);
        if (result.success) {
          vscode.window.showInformationMessage(`✓ ${result.message}`);
          refreshAll(accountTree, statusBar);
        } else {
          vscode.window.showErrorMessage(result.message);
        }
      }
    ),

    vscode.commands.registerCommand(
      "codex-account-switch.useAccount",
      async (item?: AccountTreeItem) => {
        let name: string | undefined;

        if (item) {
          name = item.account.name;
        } else {
          const accounts = listAccounts();
          if (accounts.length === 0) {
            vscode.window.showWarningMessage("No saved accounts");
            return;
          }
          const items = accounts.map((a) => ({
            label: a.isCurrent ? `$(pass-filled) ${a.name}` : a.name,
            description: `${a.meta?.email ?? ""} (${a.meta?.plan ?? ""})`,
            name: a.name,
          }));
          const picked = await vscode.window.showQuickPick(items, {
            placeHolder: "Select an account to switch to",
          });
          name = picked?.name;
        }

        if (!name) return;

        const result = useAccount(name);
        if (result.success) {
          vscode.window.showInformationMessage(
            `✓ ${result.message} (${result.meta?.email})`
          );
          refreshAll(accountTree, statusBar);
          await maybeReloadWindowAfterSwitch(name);
        } else {
          vscode.window.showErrorMessage(result.message);
        }
      }
    ),

    vscode.commands.registerCommand(
      "codex-account-switch.refreshToken",
      async (item?: AccountTreeItem) => {
        const name = item?.account.name;

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Refreshing token..." },
          async () => {
            const result = await refreshAccount(name);
            if (result.success) {
              vscode.window.showInformationMessage(`✓ ${result.message}`);
              refreshAll(accountTree, statusBar);
            } else {
              vscode.window.showErrorMessage(result.message);
            }
          }
        );
      }
    ),

    vscode.commands.registerCommand("codex-account-switch.refreshQuota", () => {
      void accountTree.refreshQuota();
      void statusBar.refreshNow();
    }),

    vscode.commands.registerCommand("codex-account-switch.exportAccounts", async () => {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file("codex-accounts.json"),
        filters: { JSON: ["json"] },
      });
      if (!uri) return;

      const data = exportAccounts();
      if (data.accounts.length === 0) {
        vscode.window.showWarningMessage("No accounts to export");
        return;
      }

      fs.writeFileSync(uri.fsPath, JSON.stringify(data, null, 2), "utf-8");
      vscode.window.showInformationMessage(
        `✓ Exported ${data.accounts.length} account(s) to ${uri.fsPath}`
      );
    }),

    vscode.commands.registerCommand("codex-account-switch.importAccounts", async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { JSON: ["json"] },
        openLabel: "Import",
      });
      if (!uris || uris.length === 0) return;

      let data: ExportData;
      try {
        data = JSON.parse(
          fs.readFileSync(uris[0].fsPath, "utf-8")
        ) as ExportData;
      } catch {
        vscode.window.showErrorMessage("Invalid file format: unable to parse JSON");
        return;
      }

      if (data.version !== 1 || !Array.isArray(data.accounts)) {
        vscode.window.showErrorMessage("Unsupported export file format");
        return;
      }

      const overwrite = await vscode.window.showQuickPick(
        [
          { label: "Skip existing accounts", value: false },
          { label: "Overwrite existing accounts", value: true },
        ],
        { placeHolder: "How should duplicate account names be handled?" }
      );
      if (!overwrite) return;

      const result = importAccounts(data, overwrite.value);

      const msgs: string[] = [];
      if (result.imported.length > 0) {
        msgs.push(`imported ${result.imported.length}`);
      }
      if (result.skipped.length > 0) {
        msgs.push(`skipped ${result.skipped.length}`);
      }
      if (result.errors.length > 0) {
        msgs.push(`failed ${result.errors.length}`);
      }

      vscode.window.showInformationMessage(`Import finished: ${msgs.join(", ")}`);
      refreshAll(accountTree, statusBar);
    }),

    vscode.commands.registerCommand("codex-account-switch.refreshList", () => {
      refreshAll(accountTree, statusBar);
    }),

    vscode.commands.registerCommand("codex-account-switch.expandAllAccounts", async () => {
      for (const item of accountTree.getRootItems()) {
        await accountTreeView.reveal(item, { expand: true, focus: false, select: false });
      }
    }),

    vscode.commands.registerCommand("codex-account-switch.reloadWindow", async () => {
      await reloadWindow();
    })
  );
}
