import * as fs from "fs";
import type { ProviderProfile } from "@codex-account-switch/core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ProviderProfileDraft {
  auth: Record<string, unknown>;
  config: Record<string, unknown>;
  exists: boolean;
  invalid: boolean;
}

export function readProviderProfileDraft(filePath: string, name: string): ProviderProfileDraft {
  if (!fs.existsSync(filePath)) {
    return { auth: {}, config: {}, exists: false, invalid: false };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!isRecord(parsed)) {
      return { auth: {}, config: {}, exists: true, invalid: true };
    }

    const auth = isRecord(parsed.auth) ? parsed.auth : {};
    const config = isRecord(parsed.config) ? parsed.config : {};

    return {
      auth,
      config,
      exists: true,
      invalid:
        parsed.kind !== "provider" ||
        parsed.name !== name ||
        !isRecord(parsed.auth) ||
        !isRecord(parsed.config) ||
        typeof auth.OPENAI_API_KEY !== "string" ||
        auth.OPENAI_API_KEY.trim() === "" ||
        typeof config.base_url !== "string" ||
        config.base_url.trim() === "" ||
        typeof config.wire_api !== "string" ||
        config.wire_api.trim() === "",
    };
  } catch {
    return { auth: {}, config: {}, exists: true, invalid: true };
  }
}

export function buildCompletedProviderProfile(
  name: string,
  defaults: ProviderProfile,
  draft: ProviderProfileDraft,
  values: { apiKey: string; baseUrl: string; wireApi: string }
): ProviderProfile {
  return {
    kind: "provider",
    name,
    auth: {
      ...defaults.auth,
      ...draft.auth,
      OPENAI_API_KEY: values.apiKey.trim(),
    },
    config: {
      ...defaults.config,
      ...draft.config,
      name,
      base_url: values.baseUrl.trim(),
      wire_api: values.wireApi.trim(),
    },
  };
}
