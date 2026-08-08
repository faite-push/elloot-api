import { env } from "../../config/env";
import {
  autoReleaseDueEscrows,
  expirePendingOrders,
} from "../orders/orders.lifecycle";

let timer: ReturnType<typeof setInterval> | null = null;

async function tick() {
  try {
    const expired = await expirePendingOrders();
    const released = await autoReleaseDueEscrows();
    if (expired.expired > 0 || released.released > 0) {
      console.log(
        `[jobs] expired=${expired.expired} autoReleased=${released.released}`,
      );
    }
  } catch (error) {
    console.error("[jobs] poll failed:", error);
  }
}

export function startJobPoller() {
  if (env.JOB_POLL_MS <= 0) {
    console.log("[jobs] poller disabled (JOB_POLL_MS=0)");
    return;
  }
  if (timer) return;

  void tick();
  timer = setInterval(() => void tick(), env.JOB_POLL_MS);
  timer.unref?.();
  console.log(`[jobs] poller every ${env.JOB_POLL_MS}ms`);
}

export function stopJobPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
