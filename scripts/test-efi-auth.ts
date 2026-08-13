import { readFileSync } from "node:fs";
import { Agent, request } from "node:https";
import { resolve } from "node:path";
import { loadEnvironment } from "../src/config/load-env";

loadEnvironment();

const clientId = process.env.EFI_CLIENT_ID;
const clientSecret = process.env.EFI_CLIENT_SECRET;
const certPath = process.env.EFI_CERT_PATH;
const passphrase = process.env.EFI_CERT_PASSPHRASE ?? "";

if (!clientId || !clientSecret || !certPath) {
  console.error("Missing EFI_CLIENT_ID, EFI_CLIENT_SECRET or EFI_CERT_PATH");
  process.exit(1);
}

const resolved = resolve(process.cwd(), certPath);
console.log("Cert:", resolved);

const agent = new Agent({
  pfx: readFileSync(resolved),
  passphrase,
});

const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

const body = JSON.stringify({ grant_type: "client_credentials" });

void (async () => {
  await new Promise<void>((resolvePromise, reject) => {
  const req = request(
    "https://pix-h.api.efipay.com.br/oauth/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      agent,
    },
    (res) => {
      let raw = "";
      res.on("data", (chunk) => {
        raw += chunk.toString("utf8");
      });
      res.on("end", () => {
        console.log("HTTP", res.statusCode);
        console.log(raw.slice(0, 800));
        resolvePromise();
      });
    },
  );
  req.on("error", reject);
  req.write(body);
  req.end();
  });
})().catch((err) => {
  console.error("error", err);
  process.exit(1);
});
