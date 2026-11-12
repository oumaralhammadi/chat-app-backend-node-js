import { prisma } from '../config/prisma';
import { emitToUsers } from './emitter';

// عدد اتصالات كل مستخدم (جهاز/تبويب متعدد): يصبح offline عند إغلاق آخر اتصال
const connections = new Map<string, number>();

async function peerIdsOf(userId: string) {
  const rows = await prisma.conversationMember.findMany({
    where: { userId },
    select: {
      conversation: {
        select: {
          members: {
            where: { userId: { not: userId } },
            select: { userId: true },
          },
        },
      },
    },
  });
  return [
    ...new Set(
      rows.flatMap((r) => r.conversation.members.map((m) => m.userId)),
    ),
  ];
}

export async function userConnected(userId: string) {
  const n = (connections.get(userId) ?? 0) + 1;
  connections.set(userId, n);
  if (n !== 1) return;
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { isOnline: true },
    });
    emitToUsers(await peerIdsOf(userId), 'presence:update', {
      userId,
      isOnline: true,
      lastSeenAt: null,
    });
  } catch (e) {
    console.error('presence connect error', e);
  }
}

export async function userDisconnected(userId: string) {
  const n = (connections.get(userId) ?? 1) - 1;
  if (n > 0) {
    connections.set(userId, n);
    return;
  }
  connections.delete(userId);
  try {
    const lastSeenAt = new Date();
    await prisma.user.update({
      where: { id: userId },
      data: { isOnline: false, lastSeenAt },
    });
    emitToUsers(await peerIdsOf(userId), 'presence:update', {
      userId,
      isOnline: false,
      lastSeenAt,
    });
  } catch (e) {
    console.error('presence disconnect error', e);
  }
}
