import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { HttpError } from '../middleware/httpError';
import {
  generateRefreshToken,
  generateResetCode,
  hashToken,
  signAccessToken,
} from './token.service';
import { sendMail } from './mail.service';

const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  statusText: true,
  createdAt: true,
} as const;

async function createSession(userId: string, deviceName?: string) {
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000);
  const session = await prisma.userSession.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      deviceName,
      expiresAt,
    },
  });
  return { accessToken: signAccessToken(userId, session.id), refreshToken };
}

export async function register(input: {
  email: string;
  username: string;
  password: string;
  displayName: string;
  deviceName?: string;
}) {
  const email = input.email.toLowerCase();
  const username = input.username.toLowerCase();

  const exists = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { email: true },
  });
  if (exists) {
    throw new HttpError(
      409,
      exists.email === email
        ? 'Email already in use'
        : 'Username already taken',
    );
  }

  const user = await prisma.user.create({
    data: {
      email,
      username,
      displayName: input.displayName,
      passwordHash: await bcrypt.hash(input.password, 12),
    },
    select: publicUserSelect,
  });
  return { user, ...(await createSession(user.id, input.deviceName)) };
}

export async function login(input: {
  identifier: string;
  password: string;
  deviceName?: string;
}) {
  const id = input.identifier.toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: id }, { username: id }] },
  });
  // رسالة موحدة حتى لا نكشف وجود الحساب
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid credentials');
  }
  const { passwordHash, ...publicUser } = user;
  return {
    user: publicUser,
    ...(await createSession(user.id, input.deviceName)),
  };
}

export async function refresh(refreshToken: string) {
  const session = await prisma.userSession.findUnique({
    where: { refreshTokenHash: hashToken(refreshToken) },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new HttpError(401, 'Invalid refresh token');
  }
  const newRefresh = generateRefreshToken();
  await prisma.userSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: hashToken(newRefresh),
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000),
    },
  });
  return {
    accessToken: signAccessToken(session.userId, session.id),
    refreshToken: newRefresh,
  };
}

export async function logout(sessionId: string) {
  await prisma.userSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date(), pushToken: null },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });
  if (!user) throw new HttpError(404, 'User not found');
  return user;
}

export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!user) return; // لا نكشف هل البريد مسجل أم لا
  const code = generateResetCode();
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      codeHash: hashToken(code),
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
  await sendMail(
    user.email,
    'Password reset code',
    `Your reset code is ${code}. It expires in 15 minutes.`,
  );
}

export async function resetPassword(
  email: string,
  code: string,
  newPassword: string,
) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  const token =
    user &&
    (await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        codeHash: hashToken(code),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    }));
  if (!user || !token) throw new HttpError(400, 'Invalid or expired code');

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12) },
    }),
    prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    }),
    prisma.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
