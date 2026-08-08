import { PrismaClient, type Prisma } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

type GgmaxCategory = {
  id: number;
  parent_id: number;
  name: string;
  order_instruction?: string | null;
  show_in_menu?: number | boolean | null;
  accelerated_release?: number | boolean | null;
  intervention_deadlines?: string | Record<string, number> | null;
  is_featured?: number | boolean | null;
  is_adult?: number | boolean | null;
  image?: string | null;
  icon?: string | null;
  has_webp?: number | boolean | null;
  template_description?: string | null;
  slug: string;
  date_created?: string | null;
  date_updated?: string | null;
  status?: string | null;
  balance_release_days?: number | null;
  keywords?: string | null;
  description_seo?: string | null;
  title_seo?: string | null;
  subtitle_seo?: string | null;
  slug_seo?: string | null;
  default_order_by?: string | null;
  children_ids?: string | null;
  slug_path?: string | null;
  required_user_validation?: number | boolean | null;
  is_noindex?: number | boolean | null;
  subcategories?: GgmaxCategory[] | null;
};

const GGMAX_MEDIA_BASE =
  process.env.GGMAX_CATEGORY_MEDIA_BASE ??
  "https://cdn.ggmax.com.br/category-images";

function asBool(value: unknown, fallback = false) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function asOptionalBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return asBool(value);
}

function parseDeadlines(
  value: GgmaxCategory["intervention_deadlines"],
): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  if (typeof value === "object") return value as Prisma.InputJsonValue;
  if (typeof value === "string" && value.trim()) {
    try {
      return JSON.parse(value) as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** GGMAX CDN: https://cdn.ggmax.com.br/category-images/{hash}.jpg */
function mediaUrl(file: string | null | undefined, _hasWebp: boolean) {
  if (!file) return null;
  return `${GGMAX_MEDIA_BASE.replace(/\/$/, "")}/${file}`;
}

function parseDate(value: string | null | undefined) {
  if (!value) return undefined;
  const d = new Date(value.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function loadGgmaxFile(): GgmaxCategory[] {
  const file = path.join(__dirname, "data", "ggmax-categories.json");
  if (!existsSync(file)) {
    throw new Error(
      `Missing ${file}. Save the GGMAX /api/categories response there.`,
    );
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    data?: GgmaxCategory[];
  };
  if (!Array.isArray(raw.data) || raw.data.length === 0) {
    throw new Error("ggmax-categories.json has no data[]");
  }
  return raw.data;
}

function fieldsOf(node: GgmaxCategory, sortOrder: number) {
  const hasWebp = asBool(node.has_webp);
  const slugPath = node.slug_path?.trim() || `/${node.slug}`;
  const deadlines = parseDeadlines(node.intervention_deadlines);

  return {
    externalId: node.id,
    name: node.name,
    slug: node.slug,
    slugPath,
    status:
      node.status?.toLowerCase() === "inactive"
        ? ("INACTIVE" as const)
        : ("ACTIVE" as const),
    orderInstruction: node.order_instruction || null,
    showInMenu: asBool(node.show_in_menu),
    acceleratedRelease: asBool(node.accelerated_release),
    interventionDeadlines: deadlines === undefined ? undefined : deadlines,
    isFeatured: asBool(node.is_featured),
    isAdult: asBool(node.is_adult),
    imageUrl: mediaUrl(node.image, hasWebp),
    iconUrl: mediaUrl(node.icon, hasWebp),
    hasWebp,
    templateDescription: node.template_description || null,
    balanceReleaseDays: node.balance_release_days ?? 7,
    keywords: node.keywords || null,
    descriptionSeo: node.description_seo || null,
    titleSeo: node.title_seo || null,
    subtitleSeo: node.subtitle_seo || null,
    slugSeo: node.slug_seo || null,
    defaultOrderBy: node.default_order_by || "best-selling",
    childrenExternalIds: node.children_ids || null,
    requiredUserValidation: asBool(node.required_user_validation),
    isNoindex: asOptionalBool(node.is_noindex),
    sortOrder,
    createdAt: parseDate(node.date_created),
    updatedAt: parseDate(node.date_updated),
  };
}

async function upsertTree(
  node: GgmaxCategory,
  parentId: string | null,
  sortOrder: number,
) {
  const fields = fieldsOf(node, sortOrder);
  const row = await prisma.category.upsert({
    where: { externalId: node.id },
    create: {
      ...fields,
      parentId,
    },
    update: {
      ...fields,
      parentId,
    },
  });

  const children = node.subcategories ?? [];
  for (let i = 0; i < children.length; i++) {
    await upsertTree(children[i]!, row.id, i);
  }
  return row.id;
}

async function main() {
  await prisma.listingOffer.deleteMany({});
  await prisma.listingMedia.deleteMany({});
  await prisma.listing.deleteMany({});
  await prisma.category.deleteMany({});

  const roots = loadGgmaxFile();
  for (let i = 0; i < roots.length; i++) {
    await upsertTree(roots[i]!, null, i);
  }

  await seedSections();

  const total = await prisma.category.count();
  const rootsCount = await prisma.category.count({ where: { parentId: null } });
  const depth3 = await prisma.category.count({
    where: { parent: { parentId: { not: null } } },
  });
  console.log(
    `Seed OK: ${rootsCount} roots, ${total} categories total, ${depth3} sections (depth 3+)`,
  );
}

type SectionFile = Array<{
  parentExternalId: number;
  sections: Array<{ externalId: number; name: string; slug: string }>;
}>;

async function seedSections() {
  const file = path.join(__dirname, "data", "ggmax-category-sections.json");
  if (!existsSync(file)) {
    console.warn("No ggmax-category-sections.json — skipping depth-3 seed");
    return;
  }
  const groups = JSON.parse(readFileSync(file, "utf8")) as SectionFile;

  for (const group of groups) {
    const parent = await prisma.category.findUnique({
      where: { externalId: group.parentExternalId },
    });
    if (!parent) continue;

    for (let i = 0; i < group.sections.length; i++) {
      const section = group.sections[i]!;
      const slugPath = `${parent.slugPath.replace(/\/$/, "")}/${section.slug}`;
      await prisma.category.upsert({
        where: { externalId: section.externalId },
        create: {
          externalId: section.externalId,
          parentId: parent.id,
          name: section.name,
          slug: section.slug,
          slugPath,
          status: "ACTIVE",
          sortOrder: i,
        },
        update: {
          parentId: parent.id,
          name: section.name,
          slug: section.slug,
          slugPath,
          status: "ACTIVE",
          sortOrder: i,
        },
      });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
