import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";

/**
 * Square Cloud managed DBs require TLS with their .pem
 * (same file as ca/cert/key). See:
 * https://docs.squarecloud.app/en/tutorials/how-to-deploy-your-database
 */
export function resolveSslCertPath(options: {
  pathEnv?: string;
  contentEnv?: string;
  filename: string;
}): string | undefined {
  const pathValue = options.pathEnv?.trim();
  if (pathValue) {
    const abs = isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), pathValue);
    if (!existsSync(abs)) {
      throw new Error(`SSL certificate not found at ${abs}`);
    }
    return abs;
  }

  const content = options.contentEnv?.trim();
  if (!content) return undefined;

  const pem = content.includes("BEGIN")
    ? content.replace(/\\n/g, "\n")
    : Buffer.from(content, "base64").toString("utf8");

  const dir = resolve(tmpdir(), "elloot-certs");
  mkdirSync(dir, { recursive: true });
  const filePath = resolve(dir, options.filename);
  writeFileSync(filePath, pem, { encoding: "utf8", mode: 0o600 });
  return filePath;
}

/** Append Square Cloud SSL query params for Prisma/libpq. */
export function withPostgresSsl(databaseUrl: string, certPath: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("sslmode", "verify-ca");
  url.searchParams.set("sslrootcert", certPath);
  url.searchParams.set("sslcert", certPath);
  url.searchParams.set("sslkey", certPath);
  return url.toString();
}
