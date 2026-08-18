import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const OPENSSL_CANDIDATES = [
  "openssl",
  "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
  "C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe",
];

/**
 * Square Cloud Postgres needs TLS. Prisma's engine on Windows expects a
 * PKCS#12 identity (`sslidentity`), not a combined PEM used as key+cert.
 * Docs: https://help.squarecloud.app/en-us/article/prismaorm-how-to-connect-to-postgresql-p12-1l4opie/
 */
export function resolveSslCertPath(options: {
  pathEnv?: string;
  contentEnv?: string;
  filename: string;
}): string | undefined {
  const pathValue = options.pathEnv?.trim();
  if (pathValue) {
    const abs = isAbsolute(pathValue)
      ? pathValue
      : resolve(process.cwd(), pathValue);
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

function isLocalPostgres(databaseUrl: string) {
  try {
    const host = new URL(databaseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function findOpenSsl(): string {
  for (const candidate of OPENSSL_CANDIDATES) {
    try {
      execFileSync(candidate, ["version"], { stdio: "ignore" });
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "OpenSSL não encontrado. Instale o Git for Windows (inclui openssl) para gerar o .p12 da Square Cloud.",
  );
}

function extractPemBlocks(pem: string) {
  const key = pem.match(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9 ]*PRIVATE KEY-----/,
  )?.[0];
  const certs = [
    ...pem.matchAll(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
    ),
  ].map((m) => m[0]);
  return { key, certs };
}

function prismaRelative(absPath: string) {
  const prismaDir = resolve(process.cwd(), "prisma");
  return relative(prismaDir, absPath).replace(/\\/g, "/");
}

/** Split combined Square Cloud PEM and build a PKCS#12 identity for Prisma. */
export function ensurePostgresIdentity(
  pemPath: string,
  password: string,
): { identityPath: string; rootCertPath: string; password: string } {
  const pem = readFileSync(pemPath, "utf8").replace(/^\uFEFF/, "");
  const { key, certs } = extractPemBlocks(pem);
  if (!certs.length) {
    throw new Error(
      `O arquivo ${pemPath} não contém um CERTIFICATE. Baixe o PEM ou o .crt da Square Cloud.`,
    );
  }

  const dir = dirname(pemPath);
  const certPath = resolve(dir, "client.crt");
  const keyPath = resolve(dir, "client.key");
  const identityPath = resolve(dir, "client.p12");

  writeFileSync(certPath, `${certs.join("\n")}\n`, { mode: 0o600 });
  if (key) {
    writeFileSync(keyPath, `${key}\n`, { mode: 0o600 });
  }

  if (!key) {
    return { identityPath: certPath, rootCertPath: certPath, password };
  }

  const openssl = findOpenSsl();
  const args = [
    "pkcs12",
    "-export",
    "-out",
    identityPath,
    "-inkey",
    keyPath,
    "-in",
    certPath,
    "-passout",
    `pass:${password}`,
    "-legacy",
  ];

  try {
    execFileSync(openssl, args, { stdio: "ignore" });
  } catch {
    execFileSync(
      openssl,
      args.filter((a) => a !== "-legacy"),
      { stdio: "pipe" },
    );
  }

  if (!existsSync(identityPath)) {
    throw new Error("Falha ao gerar client.p12 a partir do certificate.pem");
  }

  return { identityPath, rootCertPath: certPath, password };
}

/** Append Square Cloud SSL query params for Prisma/libpq. */
export function withPostgresSsl(
  databaseUrl: string,
  certPath: string,
  p12Password = "elloot",
): string {
  if (isLocalPostgres(databaseUrl)) {
    return databaseUrl;
  }

  const url = new URL(databaseUrl);
  const identity = ensurePostgresIdentity(certPath, p12Password);

  url.searchParams.set("sslmode", "verify-full");
  url.searchParams.set("sslaccept", "accept_invalid_certs");
  url.searchParams.set("sslrootcert", prismaRelative(identity.rootCertPath));
  url.searchParams.set("sslidentity", prismaRelative(identity.identityPath));
  url.searchParams.set("sslpassword", identity.password);
  url.searchParams.delete("sslcert");
  url.searchParams.delete("sslkey");
  return url.toString();
}
