import {
  creditWallet,
  lockOrderForUpdate,
  withServiceTransaction,
} from "../src/databases";

async function main() {
  const orderId = process.argv[2];
  if (!orderId) throw new Error("orderId required");

  try {
    await withServiceTransaction(async (tx) => {
      const order = await lockOrderForUpdate(tx, orderId);
      console.log("order", order);
      if (!order) return;

      await creditWallet(tx, {
        userId: order.sellerId,
        orderId: order.id,
        type: "CREDIT_SALE",
        amountCents: order.amountCents - order.feeCents,
        description: "debug credit",
      });
      console.log("credit ok");
    });
  } catch (error) {
    console.error("ERR", error);
  }
}

void main();
