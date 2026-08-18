/**
 * Load SSL-aware DATABASE_URL (env.ts) then run a command (Prisma CLI).
 * Prisma CLI does not run our SSL/.p12 helper by itself.
 */
import { spawn } from "node:child_process";
import "../src/config/env";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: tsx scripts/with-db-env.ts <command> [...args]");
  process.exit(1);
}

const child = spawn(args[0], args.slice(1), {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
