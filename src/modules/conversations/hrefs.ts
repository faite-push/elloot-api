/** Frontend path helpers for notification deep-links. */
export const routes = {
  conversation: (id: string) => `/dashboard/messages/${id}`,
  order: (id: string) => `/orders/${id}`,
  dashboardNotifications: "/dashboard/notifications",
} as const;
