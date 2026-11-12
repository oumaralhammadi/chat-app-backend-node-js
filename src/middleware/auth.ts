import { RequestHandler } from 'express';
import { prisma } from '../config/prisma';
import { verifyAccessToken } from '../services/token.service';
import { HttpError } from './httpError';

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new HttpError(401, 'Missing token');

    let payload;
    try {
      payload = verifyAccessToken(header.slice(7));
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }

    const session = await prisma.userSession.findUnique({
      where: { id: payload.sid },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new HttpError(401, 'Session ended');
    }
    req.auth = { userId: payload.sub, sessionId: payload.sid };
    next();
  } catch (e) {
    next(e);
  }
};
