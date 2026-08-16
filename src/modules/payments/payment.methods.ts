import { env } from "../../config/env";

export type PaymentMethodDto = {
  id: "pix" | "card";
  label: string;
  hint: string;
  available: boolean;
  provider?: "sandbox" | "efi" | null;
};

export function listPaymentMethods() {
  const methods: PaymentMethodDto[] = [
    {
      id: "pix",
      label: "PIX",
      hint: "Aprovação na hora",
      available: true,
      provider: env.PAYMENT_PROVIDER === "efi" ? "efi" : "sandbox",
    },
    {
      id: "card",
      label: "Cartão",
      hint: "Em breve",
      available: false,
      provider: null,
    },
  ];

  return {
    provider: env.PAYMENT_PROVIDER,
    methods,
  };
}
