import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { loadSettings } from "./settings-store";
import { CodexError } from "./codex-errors";

const execFileAsync = promisify(execFile);

export type RunOptions = {
  signal?: AbortSignal;
};

function getPiBinaryPath(): string {
  // Try to use a bundled binary path if provided, else fallback to npx/node_modules
  return process.env.PI_BINARY_PATH || path.resolve(process.cwd(), "node_modules", ".bin", "pi");
}

function buildEnv(settings: ReturnType<typeof loadSettings>) {
  const env = { ...process.env };
  
  // Configure Pi to use the provided BYOK settings
  if (settings.piUrl) {
    // Pi AI uses standard OpenAI environment variables if not overridden
    env.OPENAI_BASE_URL = settings.piUrl;
    env.OPENAI_API_BASE = settings.piUrl;
  }
  
  if (settings.piApiKey) {
    env.OPENAI_API_KEY = settings.piApiKey;
  }
  
  // Set offline/telemetry rules for hermetic execution
  env.PI_OFFLINE = "1";
  env.PI_TELEMETRY = "0";

  return env;
}

/** Strip markdown code fences the model sometimes wraps JSON in, then parse. */
function parseTurnJson<T>(finalResponse: string | undefined): T {
  const text = finalResponse?.trim();
  if (!text) throw new Error("Empty finalResponse from pi");
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

export async function runJsonPi<T>(
  prompt: string,
  outputSchema: object,
  opts: RunOptions = {},
): Promise<{ data: T; usage: unknown }> {
  const settings = loadSettings();
  const model = settings.piModelFast || "llama3.2";
  const binary = getPiBinaryPath();
  const env = buildEnv(settings);

  // Instruct the model to return JSON matching the schema
  const augmentedPrompt = `${prompt}\n\nYou MUST respond ONLY in valid JSON that matches the following schema:\n${JSON.stringify(outputSchema, null, 2)}`;

  const args = [
    "--mode", "json",
    "--print", augmentedPrompt,
    "--provider", "openai",
    "--model", model,
    "--no-tools" // Hermetic execution, no side effects
  ];

  try {
    const { stdout } = await execFileAsync(binary, args, {
      env,
      signal: opts.signal,
      maxBuffer: 10 * 1024 * 1024,
    });
    const parsed = parseTurnJson<T>(stdout);
    return { data: parsed, usage: null };
  } catch (err: any) {
    throw new CodexError("generic", `Pi CLI runJson failed: ${err.message || String(err)}`);
  }
}

export async function runJsonInThreadPi<T>(args: {
  outputSchema: object;
  opts?: RunOptions;
  resume?: { threadId: string; input: string };
  start?: { input: string };
}): Promise<{ data: T; usage: unknown; threadId: string | null }> {
  const settings = loadSettings();
  const model = settings.piModelSmart || "llama3.2";
  const binary = getPiBinaryPath();
  const env = buildEnv(settings);

  let prompt = "";
  let threadId = args.resume?.threadId;

  if (args.start) {
    prompt = `${args.start.input}\n\nYou MUST respond ONLY in valid JSON that matches the following schema:\n${JSON.stringify(args.outputSchema, null, 2)}`;
  } else if (args.resume) {
    prompt = `${args.resume.input}\n\nYou MUST respond ONLY in valid JSON that matches the following schema:\n${JSON.stringify(args.outputSchema, null, 2)}`;
  } else {
    throw new Error("runJsonInThreadPi: provide `start` or `resume`");
  }

  const cliArgs = [
    "--mode", "json",
    "--print", prompt,
    "--provider", "openai",
    "--model", model,
    "--no-tools"
  ];

  // If resuming, pass the session flag
  if (threadId) {
    cliArgs.push("--session", threadId);
  } else {
    // We need a unique session id so we can resume it later
    threadId = `pi-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    cliArgs.push("--session-id", threadId);
  }

  try {
    const { stdout } = await execFileAsync(binary, cliArgs, {
      env,
      signal: args.opts?.signal,
      maxBuffer: 10 * 1024 * 1024,
    });
    const parsed = parseTurnJson<T>(stdout);
    return { data: parsed, usage: null, threadId };
  } catch (err: any) {
    throw new CodexError("generic", `Pi CLI runJsonInThread failed: ${err.message || String(err)}`);
  }
}
