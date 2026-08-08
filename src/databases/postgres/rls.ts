import { randomBytes } from "node:crypto";
import type { LedgerType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./client";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type RlsActor = {
  id: string;
  role: "BUYER" | "SELLER" | "ADMIN";
};

type TxOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  asService?: boolean;
  actor?: RlsActor | null;
};

function newId() {
  return `c${Date.now().toString(36)}${randomBytes(10).toString("hex")}`;
}

async function applySession(tx: Prisma.TransactionClient, options: TxOptions) {
  await tx.$executeRawUnsafe(`SET LOCAL ROLE elloot_app`);

  const userId = options.actor?.id ?? "";
  const role = options.actor?.role ?? "";
  const isService = options.asService ? "on" : "off";

  await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.user_role', ${role}, true)`;
  await tx.$executeRaw`SELECT set_config('app.is_service', ${isService}, true)`;
}

export async function withRlsTransaction<T>(
  options: TxOptions,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await applySession(tx, options);
      return fn(tx);
    },
    {
      isolationLevel: options.isolationLevel ?? "ReadCommitted",
      maxWait: 5_000,
      timeout: 15_000,
    },
  );
}

export async function withServiceTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  actor?: RlsActor | null,
): Promise<T> {
  return withRlsTransaction({ asService: true, actor: actor ?? null }, fn);
}

/** Append-only atomic wallet credit (advisory lock + FOR UPDATE inside SQL). */
export async function creditWallet(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    orderId?: string | null;
    type: LedgerType;
    amountCents: number;
    description?: string;
  },
) {
  const id = newId();
  await tx.$executeRawUnsafe(
    `SELECT service_credit_wallet($1, $2, $3, $4::"LedgerType", $5::integer, $6)`,
    id,
    input.userId,
    input.orderId ?? null,
    input.type,
    Number(input.amountCents),
    input.description ?? null,
  );
  return id;
}

export type LockedListing = {
  id: string;
  sellerId: string;
  categoryId: string;
  title: string;
  description: string;
  priceCents: number;
  status: string;
};

export async function lockListingForUpdate(
  tx: Prisma.TransactionClient,
  listingId: string,
): Promise<LockedListing | null> {
  const rows = await tx.$queryRaw<LockedListing[]>`
    SELECT id, "sellerId", "categoryId", title, description, "priceCents", status::text AS status
    FROM listings
    WHERE id = ${listingId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export type LockedOrder = {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amountCents: number;
  feeCents: number;
  status: string;
};

export async function lockOrderForUpdate(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<LockedOrder | null> {
  const rows = await tx.$queryRaw<LockedOrder[]>`
    SELECT id, "listingId", "buyerId", "sellerId", "amountCents", "feeCents", status::text AS status
    FROM orders
    WHERE id = ${orderId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}
