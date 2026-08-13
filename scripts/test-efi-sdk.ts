import { loadEnvironment } from "../src/config/load-env";
import { getEfiPay } from "../src/modules/payments/efi/efi.sdk";
import { wrapEfiError } from "../src/modules/payments/efi/efi.errors";
import { env } from "../src/config/env";

loadEnvironment();

void (async () => {
  const efipay = getEfiPay();
  const txid = "elo1234567890123456789012345";

  try {
    await efipay.pixDetailCharge({ txid });
    console.log("OK: API Efí respondeu.");
  } catch (err) {
    const e = err as { nome?: string; mensagem?: string };
    if (e?.nome === "cobranca_nao_encontrada") {
      console.log(
        `OK: autenticação Efí em ${env.EFI_SANDBOX ? "homologação" : "produção"} funcionou.`,
      );
      console.log(
        "(Cobrança de teste inexistente — esperado. Pode criar pedidos no app.)",
      );
      return;
    }

    const wrapped = wrapEfiError(err);
    console.error("Falha:", wrapped.message);
    if (wrapped.code === "EFI_API_ERROR") {
      console.error("Detalhe Efí:", err);
    }
    process.exitCode = 1;
  }
})();
