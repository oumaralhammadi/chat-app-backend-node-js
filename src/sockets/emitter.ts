import { Server } from 'socket.io';

let io: Server | null = null;

export const setIO = (server: Server) => {
  io = server;
};

export const getIO = () => {
  if (!io) throw new Error('Socket.IO is not initialized');
  return io;
};

export const userRoom = (userId: string) => `user:${userId}`;

export function emitToUsers(
  userIds: string[],
  event: string,
  payload: unknown,
) {
  // مهم: to([]) بقائمة فارغة يبث للجميع، لذلك نمنع ذلك صراحة
  if (userIds.length === 0) return;
  getIO().to(userIds.map(userRoom)).emit(event, payload);
}
