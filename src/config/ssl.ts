import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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

type PostgresIdentity = {
  rootCertPath: string;
  certPath: string;
  keyPath?: string;
  identityPath?: string;
  password: string;
};

function unlinkIfExists(filePath: string) {
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

/**
 * Prisma's OpenSSL 3 engine (Linux / Square Cloud) cannot read PKCS#12
 * encrypted with RC2-40-CBC (`openssl pkcs12 -legacy`). Export AES first;
 * only use `-legacy` as a last resort on Windows.
 */
function exportPkcs12(
  openssl: string,
  identityPath: string,
  keyPath: string,
  certPath: string,
  password: string,
) {
  unlinkIfExists(identityPath);

  const base = [
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
  ];

  const attempts: string[][] = [
    [
      ...base,
      "-keypbe",
      "AES-256-CBC",
      "-certpbe",
      "AES-256-CBC",
      "-macalg",
      "SHA256",
    ],
    base,
  ];
  if (process.platform === "win32") {
    attempts.push([...base, "-legacy"]);
  }

  for (const args of attempts) {
    try {
      execFileSync(openssl, args, { stdio: "pipe" });
      if (existsSync(identityPath)) return;
    } catch {
      /* try next encoding */
    }
  }

  throw new Error("Falha ao gerar client.p12 a partir do certificate.pem");
}

/** Split combined Square Cloud PEM and build a PKCS#12 identity for Prisma. */
export function ensurePostgresIdentity(
  pemPath: string,
  password: string,
): PostgresIdentity {
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
    return { rootCertPath: certPath, certPath, password };
  }

  exportPkcs12(findOpenSsl(), identityPath, keyPath, certPath, password);
  return {
    rootCertPath: certPath,
    certPath,
    keyPath,
    identityPath,
    password,
  };
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
  url.searchParams.delete("sslcert");
  url.searchParams.delete("sslkey");
  url.searchParams.delete("sslidentity");
  url.searchParams.delete("sslpassword");

  if (identity.identityPath) {
    url.searchParams.set("sslidentity", prismaRelative(identity.identityPath));
    url.searchParams.set("sslpassword", identity.password);
  } else {
    url.searchParams.set("sslcert", prismaRelative(identity.certPath));
    if (identity.keyPath) {
      url.searchParams.set("sslkey", prismaRelative(identity.keyPath));
    }
  }

  return url.toString();
}
