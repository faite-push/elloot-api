import { env } from "../../../config/env";
import { AppError } from "../../../lib/errors";

type EfiApiError = {
  nome?: string;
  mensagem?: string;
  message?: string;
};

export function orderToEfiTxid(orderId: string) {
  const base = `elo${orderId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const txid = base.slice(0, 35);
  if (txid.length < 26) {
    return txid.padEnd(26, "0");
  }
  return txid;
}

export function centsToEfiAmount(cents: number) {
  return (cents / 100).toFixed(2);
}

export function wrapEfiError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object"
        ? String(
            (err as EfiApiError).mensagem ??
              (err as EfiApiError).message ??
              (err as Error).message ??
              "",
          )
        : "";

  const lower = raw.toLowerCase();

  if (
    lower.includes("socket hang up") ||
    lower.includes("sandbox e certificate") ||
    lower.includes("econnreset")
  ) {
    const envHint = env.EFI_SANDBOX
      ? "Homologação: certificado .p12, Client_Id e Client_Secret da aplicação de Homologação, com EFI_SANDBOX=true."
      : "Produção: certificado .p12, Client_Id e Client_Secret da aplicação de Produção, com EFI_SANDBOX=false.";
    return new AppError(
      502,
      `Não foi possível conectar à API Pix da Efí. ${envHint}`,
      "EFI_TLS_CONFIG",
    );
  }

  if (raw) {
    return new AppError(502, raw, "EFI_API_ERROR");
  }

  return new AppError(
    502,
    "Erro inesperado na integração Efí",
    "EFI_API_ERROR",
  );
}
