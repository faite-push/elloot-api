import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env";
import { withServiceTransaction } from "../databases";
import { AppError } from "../lib/errors";
import { verifyAccessToken } from "../middleware/auth";
import { sendConversationMessage } from "../modules/conversations/conversations.service";
import {
  addPresenceSocket,
  isUserOnline,
  removePresenceSocket,
} from "./presence";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "./types";

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

let io: RealtimeServer | null = null;

export function getIO(): RealtimeServer | null {
  return io;
}

export function userRoom(userId: string) {
  return `user:${userId}`;
}

export function conversationRoom(conversationId: string) {
  return `conversation:${conversationId}`;
}

export function presenceRoom(userId: string) {
  return `presence:${userId}`;
}

export function attachRealtime(httpServer: HttpServer): RealtimeServer {
  const origins = env.CORS_ORIGIN.split(",").map((o) => o.trim());

  io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    path: "/socket.io",
    cors: {
      origin: origins,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const raw =
        (typeof socket.handshake.auth?.token === "string"
          ? socket.handshake.auth.token
          : null) ??
        (typeof socket.handshake.headers.authorization === "string" &&
        socket.handshake.headers.authorization.startsWith("Bearer ")
          ? socket.handshake.headers.authorization.slice("Bearer ".length)
          : null);
      if (!raw) {
        return next(new Error("UNAUTHORIZED"));
      }
      socket.data.user = verifyAccessToken(raw);
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    void socket.join(userRoom(user.id));

    const becameOnline = addPresenceSocket(user.id, socket.id);
    void touchLastSeen(user.id).then((lastSeenAt) => {
      if (becameOnline) {
        io?.to(presenceRoom(user.id)).emit("presence:update", {
          userId: user.id,
          online: true,
          lastSeenAt,
        });
      }
    });

    socket.on("presence:subscribe", (payload) => {
      const ids = Array.isArray(payload?.userIds)
        ? payload.userIds.filter((id) => typeof id === "string").slice(0, 50)
        : [];
      for (const id of ids) {
        void socket.join(presenceRoom(id));
        socket.emit("presence:update", {
          userId: id,
          online: isUserOnline(id),
          lastSeenAt: null,
        });
      }
      // Enrich with lastSeenAt from DB for offline users.
      if (ids.length > 0) {
        void withServiceTransaction(async (tx) => {
          const users = await tx.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, lastSeenAt: true },
          });
          for (const u of users) {
            socket.emit("presence:update", {
              userId: u.id,
              online: isUserOnline(u.id),
              lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
            });
          }
        }).catch(() => undefined);
      }
    });

    socket.on("presence:unsubscribe", (payload) => {
      const ids = Array.isArray(payload?.userIds)
        ? payload.userIds.filter((id) => typeof id === "string")
        : [];
      for (const id of ids) {
        void socket.leave(presenceRoom(id));
      }
    });

    socket.on("conversation:join", async (payload, ack) => {
      try {
        const conversationId = payload?.conversationId;
        if (!conversationId) {
          ack?.({ ok: false, error: "INVALID_PAYLOAD" });
          return;
        }
        await assertCanJoinConversation(user.id, user.role, conversationId);
        await socket.join(conversationRoom(conversationId));
        ack?.({ ok: true });
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof AppError ? err.code : "FORBIDDEN",
        });
      }
    });

    socket.on("conversation:leave", (payload) => {
      if (payload?.conversationId) {
        void socket.leave(conversationRoom(payload.conversationId));
      }
    });

    socket.on("message:send", async (payload, ack) => {
      try {
        const conversationId = payload?.conversationId;
        const body = payload?.body;
        if (!conversationId || typeof body !== "string") {
          ack?.({ ok: false, error: "INVALID_PAYLOAD" });
          return;
        }
        const { message } = await sendConversationMessage({
          conversationId,
          body,
          clientId: payload.clientId,
          actor: user,
        });
        ack?.({ ok: true, message });
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof AppError ? err.code : "SEND_FAILED",
        });
      }
    });

    socket.on("disconnect", () => {
      const wentOffline = removePresenceSocket(user.id, socket.id);
      if (!wentOffline) return;
      void touchLastSeen(user.id).then((lastSeenAt) => {
        io?.to(presenceRoom(user.id)).emit("presence:update", {
          userId: user.id,
          online: false,
          lastSeenAt,
        });
      });
    });
  });

  return io;
}

async function touchLastSeen(userId: string): Promise<string | null> {
  try {
    const user = await withServiceTransaction(async (tx) =>
      tx.user.update({
        where: { id: userId },
        data: { lastSeenAt: new Date() },
        select: { lastSeenAt: true },
      }),
    );
    return user.lastSeenAt?.toISOString() ?? null;
  } catch {
    return new Date().toISOString();
  }
}

async function assertCanJoinConversation(
  userId: string,
  role: string,
  conversationId: string,
) {
  const conversation = await withServiceTransaction(async (tx) =>
    tx.conversation.findUnique({
      where: { id: conversationId },
      select: {
        order: { select: { buyerId: true, sellerId: true } },
      },
    }),
  );
  if (!conversation) {
    throw new AppError(404, "Conversation not found", "CONVERSATION_NOT_FOUND");
  }
  const { buyerId, sellerId } = conversation.order;
  if (buyerId !== userId && sellerId !== userId && role !== "ADMIN") {
    throw new AppError(403, "Forbidden", "FORBIDDEN");
  }
}
