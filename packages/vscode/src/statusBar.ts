import * as vscode from "vscode";
import { queryQuota, getCurrentAccount } from "@codex-account-switch/core";

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private timer: ReturnType<typeof setInterval> | undefined;
  private configListener: vscode.Disposable | undefined;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "codex-account-switch.refreshQuota";
    this.statusBarItem.name = "Codex Account Switch Quota";
    this.updateVisibility();
  }

  private updateVisibility() {
    const config = vscode.workspace.getConfiguration("codex-account-switch");
    if (config.get<boolean>("showStatusBar", true)) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  startAutoRefresh(context: vscode.ExtensionContext) {
    this.refreshNow();
    this.restartTimer();

    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("codex-account-switch.quotaRefreshInterval")) {
        this.restartTimer();
      }
      if (e.affectsConfiguration("codex-account-switch.showStatusBar")) {
        this.updateVisibility();
      }
    });
    context.subscriptions.push(this.configListener);
  }

  private restartTimer() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    const config = vscode.workspace.getConfiguration("codex-account-switch");
    const intervalSec = config.get<number>("quotaRefreshInterval", 300);
    this.timer = setInterval(() => this.refreshNow(), intervalSec * 1000);
  }

  async refreshNow() {
    const { name } = getCurrentAccount();

    if (!name) {
      this.statusBarItem.text = "$(account) Codex: No account";
      this.statusBarItem.tooltip = "No active Codex account detected";
      return;
    }

    this.statusBarItem.text = `$(loading~spin) ${name}`;

    try {
      const result = await queryQuota();
      if (!result) {
        this.statusBarItem.text = `$(account) ${name}`;
        this.statusBarItem.tooltip = "Unable to load quota information";
        return;
      }

      const { info } = result;
      const primary = info.primaryWindow;

      if (primary) {
        const used = Math.round(primary.usedPercent);
        const icon = used >= 70 ? "$(warning)" : used >= 50 ? "$(info)" : "$(check)";
        this.statusBarItem.text = `${icon} ${name}: ${used}%`;

        let tip = `Account: ${name}\nEmail: ${info.email}\nPlan: ${info.plan}\n`;
        tip += `\n5h quota: ${used}% used`;
        if (info.secondaryWindow) {
          tip += `\n7d quota: ${Math.round(info.secondaryWindow.usedPercent)}% used`;
        }
        this.statusBarItem.tooltip = tip;
      } else {
        this.statusBarItem.text = `$(account) ${name}`;
        this.statusBarItem.tooltip = `Account: ${name}\nEmail: ${info.email}\nPlan: ${info.plan}`;
      }
    } catch {
      this.statusBarItem.text = `$(account) ${name}`;
      this.statusBarItem.tooltip = "Quota lookup failed";
    }
  }

  dispose() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.configListener?.dispose();
    this.statusBarItem.dispose();
  }
}
