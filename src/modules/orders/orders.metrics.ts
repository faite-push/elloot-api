import type { Prisma } from "@prisma/client";

export const SELLER_METRIC_RANGES = ["7d", "30d", "90d", "365d"] as const;
export type SellerMetricRange = (typeof SELLER_METRIC_RANGES)[number] | "custom";
export type MetricsGranularity = "day" | "hour";

const RANGE_DAYS: Record<Exclude<SellerMetricRange, "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

const TZ = "America/Sao_Paulo";
const WEEKDAYS_PT = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

const COUNTED_STATUSES = new Set([
  "PAID",
  "DELIVERED",
  "COMPLETED",
  "DISPUTED",
]);

type OrderRow = {
  id: string;
  status: string;
  amountCents: number;
  feeCents: number;
  createdAt: Date;
  paidAt: Date | null;
  completedAt: Date | null;
  buyerId: string;
  listing: { id: string; title: string };
};

type SeriesPoint = {
  date: string;
  sales: number;
  completed: number;
  grossCents: number;
  netCents: number;
};

type Kpis = {
  salesCount: number;
  completedCount: number;
  pendingCount: number;
  disputedCount: number;
  cancelledCount: number;
  cancelledCents: number;
  grossCents: number;
  netCents: number;
  feesCents: number;
  avgTicketCents: number;
  conversionPercent: number;
  activeListings: number;
  uniqueBuyers: number;
};

export type MetricsWindow = {
  start: Date;
  end: Date;
  days: number;
  range: SellerMetricRange;
};

function dayKey(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}

function hourInTz(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0);
}

function weekdayInTz(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).formatToParts(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[parts.find((p) => p.type === "weekday")?.value ?? "Sun"] ?? 0;
}

function startOfTodayInTz() {
  const key = dayKey(new Date());
  return new Date(`${key}T00:00:00-03:00`);
}

function parseDayUtc(day: string) {
  const [yearRaw, monthRaw, dayRaw] = day.split("-");
  return {
    year: Number(yearRaw),
    month: Number(monthRaw),
    day: Number(dayRaw),
  };
}

function daysBetweenInclusive(fromDay: string, toDay: string) {
  const from = parseDayUtc(fromDay);
  const to = parseDayUtc(toDay);
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.floor((toMs - fromMs) / 86_400_000) + 1;
}

export function rangeWindow(range: Exclude<SellerMetricRange, "custom">): MetricsWindow {
  const days = RANGE_DAYS[range];
  const start = startOfTodayInTz();
  start.setDate(start.getDate() - (days - 1));
  const end = new Date(`${dayKey(new Date())}T23:59:59.999-03:00`);
  return { start, end, days, range };
}

export function windowFromDates(fromDay: string, toDay: string): MetricsWindow | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay)) {
    return null;
  }
  const start = new Date(`${fromDay}T00:00:00-03:00`);
  const end = new Date(`${toDay}T23:59:59.999-03:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return null;
  }
  const days = daysBetweenInclusive(fromDay, toDay);
  if (days < 1 || days > 366) return null;
  return { start, end, days, range: "custom" };
}

export function previousWindow(window: MetricsWindow): MetricsWindow {
  const endKey = dayKey(new Date(window.start.getTime() - 1));
  const { year, month, day } = parseDayUtc(endKey);
  const startUtc = new Date(
    Date.UTC(year, month - 1, day - (window.days - 1)),
  );
  const startKey = startUtc.toISOString().slice(0, 10);
  return {
    start: new Date(`${startKey}T00:00:00-03:00`),
    end: new Date(`${endKey}T23:59:59.999-03:00`),
    days: window.days,
    range: "custom",
  };
}

function fillDays(start: Date, days: number) {
  const first = dayKey(start);
  const { year, month, day } = parseDayUtc(first);
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    const utc = new Date(Date.UTC(year, month - 1, day + i));
    keys.push(utc.toISOString().slice(0, 10));
  }
  return keys;
}

function emptyPoint(date: string): SeriesPoint {
  return { date, sales: 0, completed: 0, grossCents: 0, netCents: 0 };
}

function buildHourSeries(day: string, orders: OrderRow[]) {
  const byHour = new Map(
    Array.from({ length: 24 }, (_, hour) => {
      const key = `${day}T${String(hour).padStart(2, "0")}`;
      return [key, emptyPoint(key)] as const;
    }),
  );

  for (const order of orders) {
    if (!COUNTED_STATUSES.has(order.status)) continue;
    const pointDate = order.paidAt ?? order.createdAt;
    if (dayKey(pointDate) !== day) continue;
    const key = `${day}T${String(hourInTz(pointDate)).padStart(2, "0")}`;
    const point = byHour.get(key);
    if (!point) continue;
    point.sales += 1;
    point.grossCents += order.amountCents;
    if (order.status === "COMPLETED") {
      point.completed += 1;
      point.netCents += order.amountCents - order.feeCents;
    }
  }

  return Array.from({ length: 24 }, (_, hour) => {
    const key = `${day}T${String(hour).padStart(2, "0")}`;
    return byHour.get(key)!;
  });
}

function buildDaySeries(start: Date, days: number, orders: OrderRow[]) {
  const keys = fillDays(start, days);
  const byDay = new Map(keys.map((date) => [date, emptyPoint(date)]));

  for (const order of orders) {
    if (!COUNTED_STATUSES.has(order.status)) continue;
    const pointDate = order.paidAt ?? order.createdAt;
    const key = dayKey(pointDate);
    const point = byDay.get(key);
    if (!point) continue;
    point.sales += 1;
    point.grossCents += order.amountCents;
    if (order.status === "COMPLETED") {
      point.completed += 1;
      point.netCents += order.amountCents - order.feeCents;
    }
  }

  return keys.map((date) => byDay.get(date)!);
}

function computeKpis(orders: OrderRow[], activeListings: number): Kpis {
  let salesCount = 0;
  let completedCount = 0;
  let pendingCount = 0;
  let disputedCount = 0;
  let cancelledCount = 0;
  let cancelledCents = 0;
  let grossCents = 0;
  let netCents = 0;
  let feesCents = 0;
  const buyers = new Set<string>();

  for (const order of orders) {
    if (
      order.status === "CANCELLED" ||
      order.status === "EXPIRED" ||
      order.status === "REFUNDED"
    ) {
      cancelledCount += 1;
      cancelledCents += order.amountCents;
    }
    if (order.status === "DISPUTED") disputedCount += 1;
    if (order.status === "PAID" || order.status === "DELIVERED") pendingCount += 1;

    if (!COUNTED_STATUSES.has(order.status)) continue;

    salesCount += 1;
    buyers.add(order.buyerId);
    grossCents += order.amountCents;
    feesCents += order.feeCents;
    if (order.status === "COMPLETED") {
      completedCount += 1;
      netCents += order.amountCents - order.feeCents;
    }
  }

  return {
    salesCount,
    completedCount,
    pendingCount,
    disputedCount,
    cancelledCount,
    cancelledCents,
    grossCents,
    netCents,
    feesCents,
    avgTicketCents: salesCount > 0 ? Math.round(grossCents / salesCount) : 0,
    conversionPercent:
      salesCount + cancelledCount > 0
        ? Math.round((completedCount / (salesCount + cancelledCount)) * 100)
        : 0,
    activeListings,
    uniqueBuyers: buyers.size,
  };
}

function percentDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function buildHeatmap(orders: OrderRow[]) {
  const cells = Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 24 }, (_, hour) => ({
      weekday,
      weekdayLabel: WEEKDAYS_PT[weekday]!,
      hour,
      sales: 0,
    })),
  );

  let totalSales = 0;
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const byHour = Array.from({ length: 24 }, () => 0);

  for (const order of orders) {
    if (!COUNTED_STATUSES.has(order.status)) continue;
    const pointDate = order.paidAt ?? order.createdAt;
    const weekday = weekdayInTz(pointDate);
    const hour = hourInTz(pointDate);
    cells[weekday]![hour]!.sales += 1;
    byWeekday[weekday]! += 1;
    byHour[hour]! += 1;
    totalSales += 1;
  }

  let peakWeekday = 0;
  let peakHour = 0;
  for (let i = 1; i < 7; i++) {
    if ((byWeekday[i] ?? 0) > (byWeekday[peakWeekday] ?? 0)) peakWeekday = i;
  }
  for (let i = 1; i < 24; i++) {
    if ((byHour[i] ?? 0) > (byHour[peakHour] ?? 0)) peakHour = i;
  }

  const flat = cells.flat();
  const max = Math.max(0, ...flat.map((c) => c.sales));

  return {
    cells: flat,
    max,
    totalSales,
    avgDailySales: totalSales > 0 ? Math.round((totalSales / 7) * 10) / 10 : 0,
    peakWeekdayLabel: WEEKDAYS_PT[peakWeekday]!,
    peakHourLabel: `${String(peakHour).padStart(2, "0")}h–${String((peakHour + 1) % 24).padStart(2, "0")}h`,
  };
}

function buildBuyers(
  currentOrders: OrderRow[],
  priorBuyerIds: Set<string>,
) {
  const buyerOrders = new Map<string, number>();
  for (const order of currentOrders) {
    if (!COUNTED_STATUSES.has(order.status)) continue;
    buyerOrders.set(order.buyerId, (buyerOrders.get(order.buyerId) ?? 0) + 1);
  }

  let frequent = 0;
  let neu = 0;
  for (const [buyerId, count] of buyerOrders) {
    if (priorBuyerIds.has(buyerId) || count > 1) frequent += 1;
    else neu += 1;
  }

  const total = buyerOrders.size;
  return {
    total,
    frequent,
    new: neu,
    repurchaseRatePercent:
      total > 0 ? Math.round((frequent / total) * 1000) / 10 : 0,
  };
}

function buildListings(
  orders: OrderRow[],
  funnelByListing: Map<
    string,
    { uniqueVisits: number; intentCount: number; intentCents: number; viewKeys: Set<string> }
  >,
) {
  const byListing = new Map<
    string,
    {
      listingId: string;
      title: string;
      sales: number;
      completed: number;
      buyers: Set<string>;
      revenueCents: number;
      feesCents: number;
      netCents: number;
    }
  >();

  for (const order of orders) {
    if (!COUNTED_STATUSES.has(order.status)) continue;
    const row = byListing.get(order.listing.id) ?? {
      listingId: order.listing.id,
      title: order.listing.title,
      sales: 0,
      completed: 0,
      buyers: new Set<string>(),
      revenueCents: 0,
      feesCents: 0,
      netCents: 0,
    };
    row.sales += 1;
    row.buyers.add(order.buyerId);
    row.revenueCents += order.amountCents;
    row.feesCents += order.feeCents;
    if (order.status === "COMPLETED") {
      row.completed += 1;
      row.netCents += order.amountCents - order.feeCents;
    }
    byListing.set(order.listing.id, row);
  }

  // Include listings that only had views/intents (no sales yet).
  for (const [listingId, funnel] of funnelByListing) {
    if (byListing.has(listingId)) continue;
    if (funnel.uniqueVisits === 0 && funnel.intentCount === 0) continue;
    byListing.set(listingId, {
      listingId,
      title: "Anúncio",
      sales: 0,
      completed: 0,
      buyers: new Set(),
      revenueCents: 0,
      feesCents: 0,
      netCents: 0,
    });
  }

  const totalRevenue = [...byListing.values()].reduce(
    (sum, row) => sum + row.revenueCents,
    0,
  );

  return [...byListing.values()]
    .map((row) => {
      const funnel = funnelByListing.get(row.listingId);
      const uniqueVisits = funnel?.uniqueVisits ?? 0;
      const purchaseIntents = funnel?.intentCount ?? 0;
      return {
        listingId: row.listingId,
        title: row.title,
        sales: row.sales,
        completed: row.completed,
        buyers: row.buyers.size,
        revenueCents: row.revenueCents,
        feesCents: row.feesCents,
        netCents: row.netCents,
        uniqueVisits,
        purchaseIntents,
        conversionPercent:
          uniqueVisits > 0
            ? Math.round((row.sales / uniqueVisits) * 1000) / 10
            : 0,
        sharePercent:
          totalRevenue > 0
            ? Math.round((row.revenueCents / totalRevenue) * 1000) / 10
            : 0,
        profitabilityPercent:
          row.revenueCents > 0
            ? Math.round((row.netCents / row.revenueCents) * 1000) / 10
            : 0,
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents || b.sales - a.sales);
}

export function aggregateSellerMetrics(
  currentOrders: OrderRow[],
  previousOrders: OrderRow[],
  priorBuyerIds: Set<string>,
  currentFunnel: {
    uniqueVisits: number;
    purchaseIntents: number;
    uniquePurchaseIntents: number;
    purchaseIntentCents: number;
    byListing: Map<
      string,
      { uniqueVisits: number; intentCount: number; intentCents: number; viewKeys: Set<string> }
    >;
  },
  previousFunnel: {
    uniqueVisits: number;
    purchaseIntents: number;
    uniquePurchaseIntents: number;
    purchaseIntentCents: number;
  },
  window: MetricsWindow,
  previous: MetricsWindow,
  activeListings: number,
  listingTitles?: Map<string, string>,
) {
  const { start, end, days, range } = window;
  const granularity: MetricsGranularity = days === 1 ? "hour" : "day";
  const series =
    granularity === "hour"
      ? buildHourSeries(dayKey(start), currentOrders)
      : buildDaySeries(start, days, currentOrders);

  const kpis = computeKpis(currentOrders, activeListings);
  const previousKpis = computeKpis(previousOrders, activeListings);

  const listingConversionPercent =
    currentFunnel.uniqueVisits > 0
      ? Math.round((kpis.salesCount / currentFunnel.uniqueVisits) * 1000) / 10
      : 0;
  const previousListingConversion =
    previousFunnel.uniqueVisits > 0
      ? Math.round(
          (previousKpis.salesCount / previousFunnel.uniqueVisits) * 1000,
        ) / 10
      : 0;

  const byStatus = new Map<string, { status: string; count: number; amountCents: number }>();
  for (const order of currentOrders) {
    const bucket = byStatus.get(order.status) ?? {
      status: order.status,
      count: 0,
      amountCents: 0,
    };
    bucket.count += 1;
    bucket.amountCents += order.amountCents;
    byStatus.set(order.status, bucket);
  }

  const listings = buildListings(currentOrders, currentFunnel.byListing).map(
    (row) => ({
      ...row,
      title: listingTitles?.get(row.listingId) ?? row.title,
    }),
  );
  const buyers = buildBuyers(currentOrders, priorBuyerIds);
  const heatmap = buildHeatmap(currentOrders);

  const comparison = {
    salesCount: percentDelta(kpis.salesCount, previousKpis.salesCount),
    grossCents: percentDelta(kpis.grossCents, previousKpis.grossCents),
    netCents: percentDelta(kpis.netCents, previousKpis.netCents),
    completedCount: percentDelta(kpis.completedCount, previousKpis.completedCount),
    cancelledCount: percentDelta(kpis.cancelledCount, previousKpis.cancelledCount),
    disputedCount: percentDelta(kpis.disputedCount, previousKpis.disputedCount),
    uniqueBuyers: percentDelta(kpis.uniqueBuyers, previousKpis.uniqueBuyers),
    avgTicketCents: percentDelta(kpis.avgTicketCents, previousKpis.avgTicketCents),
    uniqueVisits: percentDelta(
      currentFunnel.uniqueVisits,
      previousFunnel.uniqueVisits,
    ),
    purchaseIntents: percentDelta(
      currentFunnel.purchaseIntents,
      previousFunnel.purchaseIntents,
    ),
    listingConversionPercent: percentDelta(
      listingConversionPercent,
      previousListingConversion,
    ),
  };

  return {
    range,
    granularity,
    from: start.toISOString(),
    to: end.toISOString(),
    previousFrom: previous.start.toISOString(),
    previousTo: previous.end.toISOString(),
    kpis: {
      ...kpis,
      uniqueVisits: currentFunnel.uniqueVisits,
      purchaseIntents: currentFunnel.purchaseIntents,
      purchaseIntentCents: currentFunnel.purchaseIntentCents,
      listingConversionPercent,
    },
    previousKpis: {
      ...previousKpis,
      uniqueVisits: previousFunnel.uniqueVisits,
      purchaseIntents: previousFunnel.purchaseIntents,
      purchaseIntentCents: previousFunnel.purchaseIntentCents,
      listingConversionPercent: previousListingConversion,
    },
    comparison,
    series,
    byStatus: [...byStatus.values()].sort((a, b) => b.count - a.count),
    listings,
    topListings: listings.slice(0, 8),
    buyers,
    heatmap,
    funnel: {
      uniqueVisits: currentFunnel.uniqueVisits,
      purchaseIntents: currentFunnel.purchaseIntents,
      uniquePurchaseIntents: currentFunnel.uniquePurchaseIntents,
      purchaseIntentCents: currentFunnel.purchaseIntentCents,
      salesCount: kpis.salesCount,
      grossCents: kpis.grossCents,
      visitToIntentPercent:
        currentFunnel.uniqueVisits > 0
          ? Math.round(
              (currentFunnel.uniquePurchaseIntents /
                currentFunnel.uniqueVisits) *
                1000,
            ) / 10
          : 0,
      intentToSalePercent:
        currentFunnel.uniquePurchaseIntents > 0
          ? Math.round(
              (kpis.salesCount / currentFunnel.uniquePurchaseIntents) * 1000,
            ) / 10
          : 0,
      visitToSalePercent: listingConversionPercent,
    },
    costs: {
      grossCents: kpis.grossCents,
      feesCents: kpis.feesCents,
      netCents: kpis.netCents,
      feeSharePercent:
        kpis.grossCents > 0
          ? Math.round((kpis.feesCents / kpis.grossCents) * 1000) / 10
          : 0,
    },
  };
}

export async function loadSellerMetricOrders(
  tx: Prisma.TransactionClient,
  sellerId: string,
  start: Date,
  end: Date,
) {
  return tx.order.findMany({
    where: {
      sellerId,
      createdAt: { gte: start, lte: end },
    },
    orderBy: { createdAt: "asc" },
    take: 5000,
    select: {
      id: true,
      status: true,
      amountCents: true,
      feeCents: true,
      createdAt: true,
      paidAt: true,
      completedAt: true,
      buyerId: true,
      listing: { select: { id: true, title: true } },
    },
  });
}

export async function loadPriorBuyerIds(
  tx: Prisma.TransactionClient,
  sellerId: string,
  before: Date,
) {
  const rows = await tx.order.findMany({
    where: {
      sellerId,
      createdAt: { lt: before },
      status: { in: ["PAID", "DELIVERED", "COMPLETED", "DISPUTED"] },
    },
    distinct: ["buyerId"],
    select: { buyerId: true },
    take: 10_000,
  });
  return new Set(rows.map((row) => row.buyerId));
}
