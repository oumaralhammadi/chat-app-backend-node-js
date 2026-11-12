import { Socket } from 'socket.io';
import { prisma } from '../config/prisma';
import { verifyAccessToken } from '../services/token.service';

export async function socketAuth(socket: Socket, next: (err?: Error) => void) {
  try {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') throw new Error('no token');

    const payload = verifyAccessToken(token);
    const session = await prisma.userSession.findUnique({
      where: { id: payload.sid },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date())
      throw new Error('bad session');

    socket.data.userId = payload.sub;
    socket.data.sessionId = payload.sid;
    next();
  } catch {
    next(new Error('UNAUTHORIZED'));
  }
}
