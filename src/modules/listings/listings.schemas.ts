import { z } from "zod";

const listingOfferSchema = z.object({
  title: z.string().trim().min(2).max(120),
  priceCents: z.number().int().positive().max(50_000_000),
  stockQuantity: z.number().int().positive().max(1_000_000).optional().default(1),
});

export const createListingSchema = z
  .object({
    categoryId: z.string().min(1),
    title: z.string().trim().min(5).max(120),
    description: z.string().trim().min(20).max(5000),
    priceCents: z.number().int().positive().max(50_000_000).optional(),
    stockQuantity: z.number().int().positive().max(1_000_000).optional().default(1),
    productType: z
      .enum(["CONTA", "ITEM", "SERVICO", "GOLD", "OUTROS"])
      .optional()
      .nullable(),
    listingModel: z.enum(["NORMAL", "DYNAMIC", "SERVICE"]).optional().default("NORMAL"),
    mediaUrls: z.array(z.url()).max(8).optional().default([]),
    publish: z.boolean().optional().default(false),
    offers: z.array(listingOfferSchema).min(2).max(30).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.listingModel === "DYNAMIC") {
      if (!data.offers || data.offers.length < 2) {
        ctx.addIssue({
          code: "custom",
          message: "Dynamic listings require at least 2 offers",
          path: ["offers"],
        });
      }
      return;
    }
    if (data.listingModel === "SERVICE") {
      // Service may use a minimum/quote price; still require a positive priceCents.
      if (data.priceCents == null || data.priceCents < 1) {
        ctx.addIssue({
          code: "custom",
          message: "Service listings require a starting price",
          path: ["priceCents"],
        });
      }
      return;
    }
    if (data.priceCents == null || data.priceCents < 1) {
      ctx.addIssue({
        code: "custom",
        message: "priceCents is required",
        path: ["priceCents"],
      });
    }
  });

export const updateListingSchema = z
  .object({
    categoryId: z.string().min(1).optional(),
    title: z.string().trim().min(5).max(120).optional(),
    description: z.string().trim().min(20).max(5000).optional(),
    priceCents: z.number().int().positive().max(50_000_000).optional(),
    stockQuantity: z.number().int().positive().max(1_000_000).optional(),
    productType: z
      .enum(["CONTA", "ITEM", "SERVICO", "GOLD", "OUTROS"])
      .optional()
      .nullable(),
    mediaUrls: z.array(z.url()).max(8).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });
