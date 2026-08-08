import { Router } from "express";
import type { Category, Prisma } from "@prisma/client";
import { withRlsTransaction } from "../../databases";
import { asyncHandler } from "../../lib/async-handler";

export const catalogRouter = Router();

const categoryPublicSelect = {
  id: true,
  parentId: true,
  externalId: true,
  name: true,
  slug: true,
  slugPath: true,
  status: true,
  orderInstruction: true,
  showInMenu: true,
  acceleratedRelease: true,
  interventionDeadlines: true,
  isFeatured: true,
  isAdult: true,
  imageUrl: true,
  iconUrl: true,
  hasWebp: true,
  templateDescription: true,
  balanceReleaseDays: true,
  keywords: true,
  descriptionSeo: true,
  titleSeo: true,
  subtitleSeo: true,
  slugSeo: true,
  defaultOrderBy: true,
  childrenExternalIds: true,
  requiredUserValidation: true,
  isNoindex: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

type CategoryRow = {
  id: string;
  parentId: string | null;
  externalId: number | null;
  name: string;
  slug: string;
  slugPath: string;
  status: Category["status"];
  orderInstruction: string | null;
  showInMenu: boolean;
  acceleratedRelease: boolean;
  interventionDeadlines: Category["interventionDeadlines"];
  isFeatured: boolean;
  isAdult: boolean;
  imageUrl: string | null;
  iconUrl: string | null;
  hasWebp: boolean;
  templateDescription: string | null;
  balanceReleaseDays: number;
  keywords: string | null;
  descriptionSeo: string | null;
  titleSeo: string | null;
  subtitleSeo: string | null;
  slugSeo: string | null;
  defaultOrderBy: string;
  childrenExternalIds: string | null;
  requiredUserValidation: boolean;
  isNoindex: boolean | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type SerializedCategory = {
  id: string;
  parentId: string | null;
  externalId: number | null;
  name: string;
  slug: string;
  slugPath: string;
  status: "active" | "inactive";
  orderInstruction: string;
  showInMenu: boolean;
  acceleratedRelease: boolean;
  interventionDeadlines: Category["interventionDeadlines"];
  isFeatured: boolean;
  isAdult: boolean;
  imageUrl: string | null;
  iconUrl: string | null;
  hasWebp: boolean;
  templateDescription: string | null;
  balanceReleaseDays: number;
  keywords: string | null;
  descriptionSeo: string | null;
  titleSeo: string | null;
  subtitleSeo: string | null;
  slugSeo: string | null;
  defaultOrderBy: string;
  childrenExternalIds: string | null;
  requiredUserValidation: boolean;
  isNoindex: boolean | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  children?: SerializedCategory[];
};

function serializeCategory(
  row: CategoryRow,
  children?: SerializedCategory[],
): SerializedCategory {
  return {
    id: row.id,
    parentId: row.parentId,
    externalId: row.externalId,
    name: row.name,
    slug: row.slug,
    slugPath: row.slugPath,
    status: row.status === "ACTIVE" ? "active" : "inactive",
    orderInstruction: row.orderInstruction ?? "",
    showInMenu: row.showInMenu,
    acceleratedRelease: row.acceleratedRelease,
    interventionDeadlines: row.interventionDeadlines,
    isFeatured: row.isFeatured,
    isAdult: row.isAdult,
    imageUrl: row.imageUrl,
    iconUrl: row.iconUrl,
    hasWebp: row.hasWebp,
    templateDescription: row.templateDescription,
    balanceReleaseDays: row.balanceReleaseDays,
    keywords: row.keywords,
    descriptionSeo: row.descriptionSeo,
    titleSeo: row.titleSeo,
    subtitleSeo: row.subtitleSeo,
    slugSeo: row.slugSeo,
    defaultOrderBy: row.defaultOrderBy,
    childrenExternalIds: row.childrenExternalIds,
    requiredUserValidation: row.requiredUserValidation,
    isNoindex: row.isNoindex,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(children ? { children } : {}),
  };
}

/** Full category tree (N levels), GGMAX-style marketplace catalog. */
catalogRouter.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const featuredOnly = req.query.featured === "1" || req.query.featured === "true";
    const menuOnly = req.query.menu === "1" || req.query.menu === "true";

    const rows = await withRlsTransaction({ actor: null }, (tx) =>
      tx.category.findMany({
        where: {
          status: "ACTIVE",
          ...(featuredOnly ? { isFeatured: true } : {}),
          ...(menuOnly ? { showInMenu: true } : {}),
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: categoryPublicSelect,
      }),
    );

    const byParent = new Map<string | null, CategoryRow[]>();
    for (const row of rows) {
      const key = row.parentId;
      const list = byParent.get(key) ?? [];
      list.push(row);
      byParent.set(key, list);
    }

    function build(parentId: string | null): SerializedCategory[] {
      const children = byParent.get(parentId) ?? [];
      return children.map((row) => {
        const nested = build(row.id);
        return serializeCategory(row, nested.length ? nested : undefined);
      });
    }

    res.json({ success: true, categories: build(null) });
  }),
);

/** Flat list of mid-level / leaf categories useful for chips & carousels. */
catalogRouter.get(
  "/categories/flat",
  asyncHandler(async (req, res) => {
    const parent =
      typeof req.query.parent === "string" ? req.query.parent.trim() : undefined;
    const featuredOnly = req.query.featured === "1" || req.query.featured === "true";
    const menuOnly = req.query.menu === "1" || req.query.menu === "true";

    const categories = await withRlsTransaction({ actor: null }, async (tx) => {
      let parentId: string | undefined;
      if (parent) {
        const p = await tx.category.findFirst({
          where: {
            status: "ACTIVE",
            OR: [{ id: parent }, { slug: parent }, { slugPath: parent }],
          },
          select: { id: true },
        });
        parentId = p?.id;
        if (!parentId) return [];
      }

      return tx.category.findMany({
        where: {
          status: "ACTIVE",
          ...(parentId
            ? { parentId }
            : { parentId: { not: null } }),
          ...(featuredOnly ? { isFeatured: true } : {}),
          ...(menuOnly ? { showInMenu: true } : {}),
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          ...categoryPublicSelect,
          parent: {
            select: { id: true, name: true, slug: true, slugPath: true },
          },
        },
      });
    });

    res.json({
      success: true,
      categories: categories.map((row) => ({
        ...serializeCategory(row),
        parent: row.parent,
      })),
    });
  }),
);

catalogRouter.get(
  "/listings",
  asyncHandler(async (req, res) => {
    const take = Math.min(Number(req.query.limit) || 20, 50);
    const category =
      typeof req.query.category === "string"
        ? req.query.category.trim()
        : typeof req.query.game === "string"
          ? req.query.game.trim()
          : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const minPrice = Number(req.query.minPriceCents);
    const maxPrice = Number(req.query.maxPriceCents);
    const priceFilter =
      Number.isFinite(minPrice) || Number.isFinite(maxPrice)
        ? {
            ...(Number.isFinite(minPrice) ? { gte: minPrice } : {}),
            ...(Number.isFinite(maxPrice) ? { lte: maxPrice } : {}),
          }
        : undefined;

    const listings = await withRlsTransaction({ actor: null }, async (tx) => {
      let categoryFilter: Prisma.CategoryWhereInput | undefined;
      if (category) {
        const match = await tx.category.findFirst({
          where: {
            status: "ACTIVE",
            OR: [
              { id: category },
              { slug: category },
              { slugPath: category },
              { slugPath: { endsWith: `/${category}` } },
            ],
          },
          select: { id: true, slugPath: true },
        });
        if (!match) {
          return [];
        }
        // Include the category itself and all descendants
        categoryFilter = {
          OR: [
            { id: match.id },
            { slugPath: { startsWith: `${match.slugPath}/` } },
          ],
        };
      }

      return tx.listing.findMany({
        where: {
          status: "ACTIVE",
          ...(priceFilter ? { priceCents: priceFilter } : {}),
          ...(q
            ? {
                OR: [
                  { title: { contains: q, mode: "insensitive" } },
                  { description: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
          category: {
            status: "ACTIVE",
            ...categoryFilter,
          },
        },
        take,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          title: true,
          priceCents: true,
          status: true,
          createdAt: true,
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
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: { url: true },
          },
          seller: {
            select: { id: true, name: true },
          },
        },
      });
    });

    const nextCursor =
      listings.length === take ? listings[listings.length - 1]?.id : null;

    res.json({ listings, nextCursor });
  }),
);
