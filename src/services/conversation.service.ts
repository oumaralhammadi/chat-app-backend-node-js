import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { HttpError } from '../middleware/httpError';
import { peerSelect } from './user.service';

const conversationInclude = (userId: string) => ({
  members: { include: { user: { select: peerSelect } } },
  messages: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      type: true,
      content: true,
      senderId: true,
      createdAt: true,
      deletedAt: true,
    },
  },
  // غير المقروء: رسائل الطرف الآخر غير المحذوفة التي لا يوجد لي سجل قراءة لها
  _count: {
    select: {
      messages: {
        where: {
          senderId: { not: userId },
          deletedAt: null,
          reads: { none: { userId } },
        },
      },
    },
  },
});

type Row = Prisma.ConversationGetPayload<{
  include: ReturnType<typeof conversationInclude>;
}>;

function format(row: Row, userId: string) {
  const peer = row.members.find((m) => m.userId !== userId)?.user ?? null;
  const last = row.messages[0] ?? null;
  return {
    id: row.id,
    type: row.type,
    lastMessageAt: row.lastMessageAt,
    peer,
    lastMessage: last
      ? { ...last, content: last.deletedAt ? null : last.content }
      : null,
    unreadCount: row._count.messages,
  };
}

export async function getOrCreateDirect(userId: string, peerId: string) {
  if (userId === peerId)
    throw new HttpError(400, 'Cannot start a conversation with yourself');
  const peer = await prisma.user.findUnique({
    where: { id: peerId },
    select: { id: true },
  });
  if (!peer) throw new HttpError(404, 'User not found');

  const directKey = [userId, peerId].sort().join(':');
  const include = conversationInclude(userId);

  let row = await prisma.conversation.findUnique({
    where: { directKey },
    include,
  });
  if (!row) {
    try {
      row = await prisma.conversation.create({
        data: {
          directKey,
          members: { create: [{ userId }, { userId: peerId }] },
        },
        include,
      });
    } catch (e) {
      // طلبان متزامنان: الثاني يفشل على القيد الفريد فنجلب الموجود
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        row = await prisma.conversation.findUnique({
          where: { directKey },
          include,
        });
      } else throw e;
    }
  }
  if (!row) throw new HttpError(500, 'Could not create conversation');
  return format(row, userId);
}

export async function listConversations(userId: string, q?: string) {
  const rows = await prisma.conversation.findMany({
    where: {
      AND: [
        { members: { some: { userId } } },
        ...(q
          ? [
              {
                members: {
                  some: {
                    userId: { not: userId },
                    user: {
                      OR: [
                        { displayName: { contains: q } },
                        { username: { contains: q } },
                      ],
                    },
                  },
                },
              },
            ]
          : []),
      ],
    },
    include: conversationInclude(userId),
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => format(r, userId));
}

export async function getConversation(userId: string, id: string) {
  // شرط العضوية داخل الاستعلام نفسه: غير الأعضاء يحصلون على 404
  const row = await prisma.conversation.findFirst({
    where: { id, members: { some: { userId } } },
    include: conversationInclude(userId),
  });
  if (!row) throw new HttpError(404, 'Conversation not found');
  return format(row, userId);
}
