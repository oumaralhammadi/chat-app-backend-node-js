import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessPayload {
  sub: string;
  sid: string;
}

export const signAccessToken = (userId: string, sessionId: string) =>
  jwt.sign({ sub: userId, sid: sessionId }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES as jwt.SignOptions['expiresIn'],
  });

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;

export const generateRefreshToken = () =>
  crypto.randomBytes(48).toString('hex');

export const hashToken = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

export const generateResetCode = () =>
  crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
