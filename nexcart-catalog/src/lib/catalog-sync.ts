/**
 * Catalog sync — shared logic used by:
 *   • scripts/sync.ts  (CLI, run via npm run sync)
 *   • src/app/api/cron/sync/route.ts  (HTTP endpoint, called by Vercel Cron)
 *
 * Two Prisma clients:
 *   catalogDb → DATABASE_URL (this app's catalog DB, writes go here)
 *   sourceDb  → SOURCE_DATABASE_URL (main app's DB, raw-reads only)
 */

import { PrismaClient } from "@prisma/client";

export async function runSync(): Promise<{ ok: boolean; message: string }> {
  if (!process.env.SOURCE_DATABASE_URL) {
    throw new Error("SOURCE_DATABASE_URL is not set — see .env.example");
  }

  const catalogDb = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  const sourceDb = new PrismaClient({
    datasources: { db: { url: process.env.SOURCE_DATABASE_URL } },
  });

  try {
    await syncCategories(sourceDb, catalogDb);
    await syncSellers(sourceDb, catalogDb);
    const syncedProductIds = await syncProducts(sourceDb, catalogDb);
    await syncVariants(sourceDb, catalogDb, syncedProductIds);
    await syncReviews(sourceDb, catalogDb, syncedProductIds);
    await syncStoreCollections(sourceDb, catalogDb);
    return { ok: true, message: "Catalog sync complete" };
  } finally {
    await catalogDb.$disconnect();
    await sourceDb.$disconnect();
  }
}

// ── Sync helpers ─────────────────────────────────────────────────────────────

async function syncCategories(sourceDb: PrismaClient, catalogDb: PrismaClient) {
  const rows = await sourceDb.$queryRaw<any[]>`
    SELECT id, name, slug, description, image, "isActive", "sortOrder", "createdAt"
    FROM "Category"
  `;
  for (const c of rows) {
    await catalogDb.category.upsert({
      where: { id: c.id },
      create: c,
      update: { ...c, id: undefined },
    });
  }
  console.log(`[sync] categories: ${rows.length}`);
}

async function syncSellers(sourceDb: PrismaClient, catalogDb: PrismaClient) {
  const rows = await sourceDb.$queryRaw<any[]>`
    SELECT id, "sellerId", "storeName", "storeHandle", description, logo, banner, status, rating,
           "totalRatings", "totalReviews", "totalOrders", "isVerified", "isLocalStore",
           "storeAddress", "pickupHours", "pickupAcceptsCOD", highlights, "quickTags",
           "storeColor", "storePaused", "storePausedMsg", "galleryProductIds"
    FROM "Seller"
    WHERE status = 'APPROVED'
  `;
  for (const s of rows) {
    await catalogDb.seller.upsert({
      where: { id: s.id },
      create: { ...s, updatedAt: new Date() },
      update: { ...s, id: undefined, updatedAt: new Date() },
    });
  }
  console.log(`[sync] sellers: ${rows.length}`);
}

/**
 * Returns only the product IDs that were actually written to the catalog DB.
 * Callers must use this list for variants/reviews so FK constraints are satisfied.
 */
async function syncProducts(
  sourceDb: PrismaClient,
  catalogDb: PrismaClient
): Promise<string[]> {
  const rows = await sourceDb.$queryRaw<any[]>`
    SELECT id, "productId", "sellerId", "categoryId", name, description, "deliveryInfo",
           price, "comparePrice", stock, images, tags, "isActive", "isFeatured",
           "isFlashSale", condition, specifications, "variantImages", rating,
           "reviewCount", "salesCount", "gstRate", "hsnCode", "createdAt", "updatedAt"
    FROM "Product"
    WHERE "isActive" = true
  `;

  const existingSellerIds = new Set(
    (await catalogDb.seller.findMany({ select: { id: true } })).map((s) => s.id)
  );

  const syncedIds: string[] = [];
  for (const p of rows) {
    if (!existingSellerIds.has(p.sellerId)) continue; // skip orphaned products
    await catalogDb.product.upsert({
      where: { id: p.id },
      create: p,
      update: { ...p, id: undefined },
    });
    syncedIds.push(p.id as string);
  }
  console.log(`[sync] products: ${syncedIds.length}/${rows.length}`);
  return syncedIds; // ← only synced IDs, prevents FK violations downstream
}

async function syncVariants(
  sourceDb: PrismaClient,
  catalogDb: PrismaClient,
  productIds: string[]
) {
  if (productIds.length === 0) return;
  const rows = await sourceDb.$queryRaw<any[]>`
    SELECT id, "productId", name, value, stock, price, "comparePrice"
    FROM "ProductVariant"
    WHERE "productId" = ANY(${productIds})
  `;
  for (const v of rows) {
    await catalogDb.productVariant.upsert({
      where: { id: v.id },
      create: v,
      update: { ...v, id: undefined },
    });
  }
  console.log(`[sync] variants: ${rows.length}`);
}

async function syncReviews(
  sourceDb: PrismaClient,
  catalogDb: PrismaClient,
  productIds: string[]
) {
  if (productIds.length === 0) return;
  const rows = await sourceDb.$queryRaw<any[]>`
    SELECT r.id, r."productId",
           COALESCE(u.name, 'Anonymous') AS "userName",
           u.avatar AS "userAvatar",
           r.rating, r.title, r.body, r.images, r."helpfulCount",
           r."sellerReply", r."sellerRepliedAt", r."createdAt"
    FROM "Review" r
    JOIN "User" u ON u.id = r."userId"
    WHERE r."productId" = ANY(${productIds})
    ORDER BY r."createdAt" DESC
    LIMIT 5000
  `;
  for (const r of rows) {
    await catalogDb.review.upsert({
      where: { id: r.id },
      create: r,
      update: { ...r, id: undefined },
    });
  }
  console.log(`[sync] reviews: ${rows.length}`);
}

async function syncStoreCollections(
  sourceDb: PrismaClient,
  catalogDb: PrismaClient
) {
  const sellerIds = (
    await catalogDb.seller.findMany({ select: { id: true } })
  ).map((s) => s.id);
  if (sellerIds.length === 0) return;

  const rows = await sourceDb.$queryRaw<any[]>`
    SELECT id, "sellerId", name, image, "filterTag", "productIds", "sortOrder"
    FROM "StoreCollection"
    WHERE "sellerId" = ANY(${sellerIds})
  `;
  for (const c of rows) {
    await catalogDb.storeCollection.upsert({
      where: { id: c.id },
      create: c,
      update: { ...c, id: undefined },
    });
  }
  console.log(`[sync] store collections: ${rows.length}`);
}
