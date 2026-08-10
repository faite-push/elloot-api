/**
 * End-to-end smoke test (no Redis required).
 * Usage: npx tsx scripts/e2e-flow.ts
 */
const BASE = process.env.API_URL ?? "http://localhost:5000";

type Json = Record<string, unknown>;

async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

function step(name: string) {
  console.log(`\n✓ ${name}`);
}

async function main() {
  console.log(`E2E against ${BASE}`);

  const health = await req("GET", "/api/health");
  if (!health.ok) throw new Error(`Health not ok: ${JSON.stringify(health)}`);
  step(`Health db=${health.db} redis=${health.redis}`);

  const stamp = Date.now();
  const sellerReg = await req("POST", "/api/auth/register", {
    email: `seller.${stamp}@elloot.test`,
    password: "password123",
    name: "Seller E2E",
  });
  let sellerToken = sellerReg.accessToken as string;
  step(`Seller registered ${(sellerReg.user as Json).email}`);

  const buyerReg = await req("POST", "/api/auth/register", {
    email: `buyer.${stamp}@elloot.test`,
    password: "password123",
    name: "Buyer E2E",
  });
  const buyerToken = buyerReg.accessToken as string;
  step(`Buyer registered ${(buyerReg.user as Json).email}`);

  const profile = await req(
    "PATCH",
    "/api/auth/me",
    { pixKey: `seller-pix-${stamp}@elloot.test` },
    sellerToken,
  );
  if (!(profile.user as Json).pixKey) throw new Error("pixKey not saved");
  step(`Seller pixKey set`);

  const catalog = await req("GET", "/api/catalog/categories");
  const roots = catalog.categories as Array<{
    slug: string;
    children?: Array<{
      id: string;
      slug: string;
      children?: Array<{ id: string; slug: string }>;
    }>;
  }>;

  function findLeaf(
    nodes: Array<{
      id?: string;
      slug: string;
      children?: Array<{ id: string; slug: string; children?: unknown[] }>;
    }>,
  ): { id: string; slug: string } | null {
    for (const node of nodes) {
      if (node.children?.length) {
        const nested = findLeaf(
          node.children as Array<{
            id: string;
            slug: string;
            children?: unknown[];
          }>,
        );
        if (nested) return nested;
      } else if (node.id) {
        return { id: node.id, slug: node.slug };
      }
    }
    return null;
  }

  const leaf = findLeaf(roots);
  const categoryId = leaf?.id;
  const categorySlug = leaf?.slug ?? roots[0]?.slug;
  if (!categoryId) throw new Error("No leaf category from seed");
  step(`Category leaf ${categoryId}`);

  const filtered = await req(
    "GET",
    `/api/catalog/listings?category=${encodeURIComponent(categorySlug!)}&limit=5`,
  );
  step(
    `Catalog filter category=${categorySlug} count=${(filtered.listings as unknown[]).length}`,
  );

  const listingRes = await req(
    "POST",
    "/api/listings",
    {
      categoryId,
      title: "E2E Free Fire account test listing",
      description:
        "Automated end-to-end listing used only for sandbox checkout verification.",
      priceCents: 5000,
      publish: true,
    },
    sellerToken,
  );
  const listingId = (listingRes.listing as Json).id as string;
  if (listingRes.accessToken) {
    sellerToken = listingRes.accessToken as string;
    step(`Listing created + JWT reissued as SELLER ${listingId}`);
  } else {
    step(`Listing created/published ${listingId}`);
  }

  // Cancel path: second listing/order cancelled before pay
  const listing2 = await req(
    "POST",
    "/api/listings",
    {
      categoryId,
      title: "E2E cancel-path listing for checkout",
      description:
        "Second listing used to verify buyer cancel releases reservation.",
      priceCents: 3000,
      publish: true,
    },
    sellerToken,
  );
  const listing2Id = (listing2.listing as Json).id as string;
  const cancelOrderRes = await req(
    "POST",
    "/api/orders",
    { listingId: listing2Id },
    buyerToken,
  );
  const cancelOrderId = (cancelOrderRes.order as Json).id as string;
  const cancelled = await req(
    "POST",
    `/api/orders/${cancelOrderId}/cancel`,
    undefined,
    buyerToken,
  );
  if ((cancelled.order as Json).status !== "CANCELLED") {
    throw new Error("Cancel failed");
  }
  step(`Order cancelled ${cancelOrderId}`);

  const orderRes = await req(
    "POST",
    "/api/orders",
    { listingId },
    buyerToken,
  );
  const order = orderRes.order as Json;
  const checkout = orderRes.checkout as Json;
  const orderId = order.id as string;
  const providerRef = checkout.providerRef as string;
  step(`Order ${orderId} checkout ${providerRef}`);

  const paid = await req(
    "POST",
    "/api/payments/sandbox/confirm",
    { providerRef },
    buyerToken,
  );
  step(`Payment confirmed alreadyPaid=${paid.alreadyPaid}`);

  const conv = await req(
    "GET",
    `/api/conversations/by-order/${orderId}`,
    undefined,
    buyerToken,
  );
  const conversationId = (conv.conversation as Json).id as string;
  const msg = await req(
    "POST",
    `/api/conversations/${conversationId}/messages`,
    { body: "Entrega em andamento — dados em breve." },
    sellerToken,
  );
  if (!(msg.message as Json).id) throw new Error("Message not created");
  step(`Chat message sent on conversation ${conversationId}`);

  const delivered = await req(
    "POST",
    `/api/orders/${orderId}/deliver`,
    undefined,
    sellerToken,
  );
  step(`Delivered status=${(delivered.order as Json).status}`);

  const confirmed = await req(
    "POST",
    `/api/orders/${orderId}/confirm`,
    undefined,
    buyerToken,
  );
  step(`Confirmed status=${(confirmed.order as Json).status}`);

  const wallet = await req("GET", "/api/wallet", undefined, sellerToken);
  step(
    `Seller wallet balanceCents=${wallet.balanceCents} (expected 4500 with 10% fee)`,
  );

  if (wallet.balanceCents !== 4500) {
    throw new Error(`Unexpected balance: ${wallet.balanceCents}`);
  }
  if ((confirmed.order as Json).status !== "COMPLETED") {
    throw new Error(`Unexpected final status`);
  }

  console.log("\nE2E PASSED");
}

main().catch((err) => {
  console.error("\nE2E FAILED:", err.message ?? err);
  process.exit(1);
});
