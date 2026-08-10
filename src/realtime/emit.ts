import { getIO, conversationRoom, userRoom } from "./io";
import type {
  PresenceUpdatePayload,
  RealtimeMessagePayload,
  RealtimeNotificationPayload,
} from "./types";

export function emitMessageNew(payload: RealtimeMessagePayload) {
  getIO()
    ?.to(conversationRoom(payload.conversationId))
    .emit("message:new", payload);
}

export function emitNotificationNew(
  userId: string,
  payload: RealtimeNotificationPayload,
) {
  getIO()?.to(userRoom(userId)).emit("notification:new", payload);
}

export function emitPresenceUpdate(payload: PresenceUpdatePayload) {
  getIO()?.to(`presence:${payload.userId}`).emit("presence:update", payload);
}
