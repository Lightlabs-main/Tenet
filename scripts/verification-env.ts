import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Environment = Record<string, string | undefined>;

function loadEnvFile(envPath: string, env: Environment): void {
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || env[key] !== undefined) continue;

    let value = trimmed.slice(separator + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    env[key] = value;
  }
}

/**
 * Load an explicitly selected deployment env first, then the checkout .env as
 * a fallback. Already-exported process variables always win. Values are parsed
 * as KEY=value; this never executes shell content or logs secrets.
 */
export function loadVerificationEnv(options: {
  cwd?: string;
  env?: Environment;
} = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const selectedEnvPath = env.TENET_ENV_FILE?.trim();

  if (selectedEnvPath) loadEnvFile(resolve(cwd, selectedEnvPath), env);
  loadEnvFile(resolve(cwd, ".env"), env);
}
