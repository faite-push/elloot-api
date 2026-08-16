/** Frontend path helpers for notification deep-links. */
export const routes = {
  conversation: (id: string) => `/dashboard/messages/${id}`,
  order: (id: string) => `/orders/${id}`,
  listing: (id: string) => `/listings/${id}`,
  dashboardListings: "/dashboard/listings",
  dashboardSales: "/dashboard/sales",
  dashboardPurchases: "/dashboard/purchases",
  dashboardWithdrawals: "/dashboard/withdrawals",
  dashboardNotifications: "/dashboard/notifications",
} as const;
