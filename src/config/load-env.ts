import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

/** Load .env first, then .env.local (local overrides). */
export function loadEnvironment() {
  const envPath = resolve(root, ".env");
  const localPath = resolve(root, ".env.local");

  if (existsSync(envPath)) {
    loadEnv({ path: envPath, quiet: true });
  }

  if (existsSync(localPath)) {
    loadEnv({ path: localPath, override: true, quiet: true });
  }
}
