export interface AuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
  account_id: string;
}

export interface AuthFile {
  auth_mode: string;
  OPENAI_API_KEY: string | null;
  tokens: AuthTokens;
  last_refresh: string;
}

export interface IdTokenPayload {
  email?: string;
  name?: string;
  sub?: string;
  exp?: number;
  "https://api.openai.com/auth"?: {
    chatgpt_plan_type?: string;
    chatgpt_user_id?: string;
    chatgpt_account_id?: string;
    chatgpt_subscription_active_start?: string;
    chatgpt_subscription_active_until?: string;
    organizations?: Array<{ id: string; title: string; role: string }>;
  };
}

export interface AccountMeta {
  name: string;
  email: string;
  plan: string;
}

export interface WindowInfo {
  usedPercent: number;
  resetsAt: Date | null;
  windowSeconds: number | null;
}

export interface QuotaInfo {
  plan: string;
  primaryWindow: WindowInfo | null;
  secondaryWindow: WindowInfo | null;
  additional: Array<{
    name: string;
    primary: WindowInfo | null;
    secondary: WindowInfo | null;
  }>;
  codeReview: WindowInfo | null;
  credits: { hasCredits: boolean } | null;
  email: string;
  tokenExpired: boolean;
}

export interface ExportData {
  version: 1;
  exportedAt: string;
  accounts: Array<{
    name: string;
    auth: AuthFile;
  }>;
}
