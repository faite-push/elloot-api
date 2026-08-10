import { createApp } from "./app";
import { env } from "./config/env";
import { connectRedis } from "./databases";
import { startJobPoller } from "./modules/jobs/jobs.poller";
import { attachRealtime } from "./realtime/io";
import { createServer } from "node:http";

async function main() {
  try {
    await connectRedis();
  } catch (error) {
    console.warn("Redis unavailable at boot (continuing):", error);
  }

  const app = createApp();
  const server = createServer(app);
  attachRealtime(server);

  server.listen(env.PORT, () => {
    console.log(`elloot-api listening on http://localhost:${env.PORT}`);
    console.log(`socket.io attached at /socket.io`);
    startJobPoller();
  });
}

void main();
