export type PresenceUpdatePayload = {
  userId: string;
  online: boolean;
  lastSeenAt: string | null;
};

export type RealtimeMessagePayload = {
  conversationId: string;
  message: {
    id: string;
    conversationId: string;
    senderId: string;
    body: string;
    clientId: string | null;
    readAt: string | null;
    createdAt: string;
    sender?: { id: string; name: string | null };
  };
};

export type RealtimeNotificationPayload = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
  meta?: unknown;
};

export type ClientToServerEvents = {
  "conversation:join": (
    payload: { conversationId: string },
    ack?: (res: { ok: boolean; error?: string }) => void,
  ) => void;
  "conversation:leave": (payload: { conversationId: string }) => void;
  "presence:subscribe": (payload: { userIds: string[] }) => void;
  "presence:unsubscribe": (payload: { userIds: string[] }) => void;
  "message:send": (
    payload: { conversationId: string; body: string; clientId?: string },
    ack?: (res: {
      ok: boolean;
      message?: RealtimeMessagePayload["message"];
      error?: string;
    }) => void,
  ) => void;
};

export type ServerToClientEvents = {
  "presence:update": (payload: PresenceUpdatePayload) => void;
  "message:new": (payload: RealtimeMessagePayload) => void;
  "notification:new": (payload: RealtimeNotificationPayload) => void;
};

export type InterServerEvents = Record<string, never>;

export type SocketData = {
  user: {
    id: string;
    email: string;
    role: "BUYER" | "SELLER" | "ADMIN";
  };
};
