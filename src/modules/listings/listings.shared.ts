import type { Prisma } from "@prisma/client";

export const listingPublicSelect = {
  id: true,
  title: true,
  description: true,
  priceCents: true,
  stockQuantity: true,
  productType: true,
  listingModel: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: {
      id: true,
      slug: true,
      name: true,
      imageUrl: true,
      iconUrl: true,
      slugPath: true,
      parent: {
        select: {
          id: true,
          slug: true,
          name: true,
          imageUrl: true,
          iconUrl: true,
          slugPath: true,
        },
      },
    },
  },
  media: {
    orderBy: { sortOrder: "asc" as const },
    select: { id: true, url: true, sortOrder: true },
  },
  offers: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      id: true,
      title: true,
      priceCents: true,
      stockQuantity: true,
      sortOrder: true,
    },
  },
  seller: {
    select: { id: true, name: true },
  },
} satisfies Prisma.ListingSelect;
