/**
 * Persistent app settings.
 *
 * Source-of-truth for runtime knobs the user can toggle from the
 * Settings popover. Reads:
 *   1. Saved JSON at <DATA_DIR>/settings.json (if it exists — i.e. the
 *      user has touched the controls at some point).
 *   2. Otherwise, the build-time defaults from `.env` (NEXT_PUBLIC_*).
 *   3. Otherwise, hardcoded fallbacks.
 *
 * Saved settings survive app restarts, OS reboots, and (in the packaged
 * Electron app) the dynamic localhost port that changes between launches
 * — that's why we don't lean on localStorage here.
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths";
import { AUTO_GENERATE_VIZ, MAX_VIZ_GEN_RETRIES } from "./config";

export type AppSettings = {
  autoGenerate: boolean;
  maxRetries: number;
  provider: "codex" | "pi";
  piUrl?: string;
  piApiKey?: string;
  piModelFast?: string;
  piModelSmart?: string;
};

const VERSION = 2 as const; // Bumped to 2 for new settings structure
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

function defaultsFromEnv(): AppSettings {
  return {
    autoGenerate: AUTO_GENERATE_VIZ,
    maxRetries: MAX_VIZ_GEN_RETRIES,
    provider: "codex",
    piUrl: process.env.PI_URL || "http://localhost:11434/v1",
    piApiKey: process.env.PI_API_KEY || "",
    piModelFast: process.env.PI_MODEL_FAST || "llama3.2",
    piModelSmart: process.env.PI_MODEL_SMART || "llama3.2",
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { v: number } & Partial<AppSettings>;
    // Accept version 1 or 2
    if (parsed && (parsed.v === 1 || parsed.v === VERSION)) {
      const env = defaultsFromEnv();
      return {
        autoGenerate:
          typeof parsed.autoGenerate === "boolean"
            ? parsed.autoGenerate
            : env.autoGenerate,
        maxRetries:
          typeof parsed.maxRetries === "number" && parsed.maxRetries >= 0
            ? Math.min(10, Math.floor(parsed.maxRetries))
            : env.maxRetries,
        provider:
          parsed.provider === "codex" || parsed.provider === "pi"
            ? parsed.provider
            : env.provider,
        piUrl: typeof parsed.piUrl === "string" ? parsed.piUrl : env.piUrl,
        piApiKey:
          typeof parsed.piApiKey === "string" ? parsed.piApiKey : env.piApiKey,
        piModelFast:
          typeof parsed.piModelFast === "string"
            ? parsed.piModelFast
            : env.piModelFast,
        piModelSmart:
          typeof parsed.piModelSmart === "string"
            ? parsed.piModelSmart
            : env.piModelSmart,
      };
    }
  } catch {
    /* file missing or malformed — fall through to env defaults */
  }
  return defaultsFromEnv();
}

export function saveSettings(s: AppSettings): void {
  const file = {
    v: VERSION,
    savedAt: Date.now(),
    autoGenerate: !!s.autoGenerate,
    maxRetries: Math.min(10, Math.max(0, Math.floor(s.maxRetries))),
    provider: s.provider,
    piUrl: s.piUrl,
    piApiKey: s.piApiKey,
    piModelFast: s.piModelFast,
    piModelSmart: s.piModelSmart,
  };
  const tmp = `${SETTINGS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
  fs.renameSync(tmp, SETTINGS_PATH);
}
