/** In-memory presence: userId → active socket ids. */
const onlineSockets = new Map<string, Set<string>>();

export function addPresenceSocket(userId: string, socketId: string): boolean {
  let set = onlineSockets.get(userId);
  if (!set) {
    set = new Set();
    onlineSockets.set(userId, set);
  }
  const wasOffline = set.size === 0;
  set.add(socketId);
  return wasOffline;
}

export function removePresenceSocket(
  userId: string,
  socketId: string,
): boolean {
  const set = onlineSockets.get(userId);
  if (!set) return true;
  set.delete(socketId);
  if (set.size === 0) {
    onlineSockets.delete(userId);
    return true;
  }
  return false;
}

export function isUserOnline(userId: string): boolean {
  const set = onlineSockets.get(userId);
  return Boolean(set && set.size > 0);
}

export function getOnlineUserIds(userIds: string[]): string[] {
  return userIds.filter((id) => isUserOnline(id));
}
