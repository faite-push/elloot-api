import { resolve } from "node:path";
import EfiPay from "sdk-node-apis-efi";
import { env } from "../../../config/env";

let client: EfiPay | null = null;

export function getEfiPay(): EfiPay {
  if (!client) {
    const certPath = resolve(process.cwd(), env.EFI_CERT_PATH!);
    const options: {
      client_id: string;
      client_secret: string;
      certificate: string;
      cert_base64: false;
      sandbox: boolean;
      pemKey?: string;
    } = {
      client_id: env.EFI_CLIENT_ID!,
      client_secret: env.EFI_CLIENT_SECRET!,
      certificate: certPath,
      cert_base64: false,
      sandbox: env.EFI_SANDBOX,
    };

    if (env.EFI_PEM_KEY_PATH) {
      options.pemKey = resolve(process.cwd(), env.EFI_PEM_KEY_PATH);
    }

    client = new EfiPay(options);
  }
  return client;
}

export function resetEfiPayClient() {
  client = null;
}
