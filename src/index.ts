import { createApp } from "./app";
import { env } from "./config/env";
import { connectRedis } from "./databases";
import { startJobPoller } from "./modules/jobs/jobs.poller";

async function main() {
  try {
    await connectRedis();
  } catch (error) {
    console.warn("Redis unavailable at boot (continuing):", error);
  }

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`elloot-api listening on http://localhost:${env.PORT}`);
    startJobPoller();
  });
}

void main();
