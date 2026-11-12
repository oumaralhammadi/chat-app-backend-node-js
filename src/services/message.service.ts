import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { HttpError } from '../middleware/httpError';
import { randomUUID } from 'crypto';
import {
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  cleanFileName,
  detectAttachment,
} from '../middleware/upload';
import { destroyAssets, uploadAttachment } from './upload.service';

export const messageInclude = {
  replyTo: {
    select: {
      id: true,
      senderId: true,
      type: true,
      content: true,
      deletedAt: true,
    },
  },
  attachments: true,
  reads: { select: { userId: true } },
} satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export function serializeMessage(m: MessageRow) {
  // reads تحتوي قراءات الطرف الآخر فقط (المرسل لا يقرأ رسائله)
  const status =
    m.reads.length > 0 ? 'READ' : m.deliveredAt ? 'DELIVERED' : 'SENT';
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    type: m.type,
    content: m.deletedAt ? null : m.content,
    clientId: m.clientId,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          senderId: m.replyTo.senderId,
          type: m.replyTo.type,
          content: m.replyTo.deletedAt
            ? null
            : (m.replyTo.content?.slice(0, 200) ?? null),
          isDeleted: Boolean(m.replyTo.deletedAt),
        }
      : null,
    isForwarded: Boolean(m.forwardedFromId),
    isEdited: m.isEdited,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
    createdAt: m.createdAt,
    status,
    attachments: m.deletedAt
      ? []
      : m.attachments.map(
          ({ id, url, fileName, mimeType, sizeBytes, width, height }) => ({
            id,
            url,
            fileName,
            mimeType,
            sizeBytes,
            width,
            height,
          }),
        ),
  };
}

export type ChatMessage = ReturnType<typeof serializeMessage>;

/** أعضاء المحادثة الآخرون. غير الأعضاء يحصلون على 404 حتى لا نكشف وجودها */
export async function getPeerIds(
  userId: string,
  conversationId: string,
): Promise<string[]> {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, members: { some: { userId } } },
    select: { members: { select: { userId: true } } },
  });
  if (!conv) throw new HttpError(404, 'Conversation not found');
  return conv.members.map((m) => m.userId).filter((id) => id !== userId);
}

export async function sendMessage(
  userId: string,
  input: {
    conversationId: string;
    clientId: string;
    content: string;
    replyToId?: string;
  },
) {
  const recipientIds = await getPeerIds(userId, input.conversationId);

  // idempotency: إعادة الإرسال بنفس clientId ترجع الرسالة الموجودة
  const existing = await prisma.message.findUnique({
    where: {
      senderId_clientId: { senderId: userId, clientId: input.clientId },
    },
    include: messageInclude,
  });
  if (existing)
    return {
      message: serializeMessage(existing),
      recipientIds,
      duplicate: true,
    };

  if (input.replyToId) {
    const target = await prisma.message.findFirst({
      where: { id: input.replyToId, conversationId: input.conversationId },
      select: { id: true },
    });
    if (!target) throw new HttpError(400, 'Invalid reply target');
  }

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: userId,
        type: 'TEXT',
        content: input.content,
        clientId: input.clientId,
        replyToId: input.replyToId,
      },
      include: messageInclude,
    }),
    prisma.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: new Date() },
    }),
  ]);
  return { message: serializeMessage(message), recipientIds, duplicate: false };
}

async function getOwnMessage(userId: string, messageId: string) {
  const m = await prisma.message.findUnique({ where: { id: messageId } });
  if (!m || m.senderId !== userId)
    throw new HttpError(404, 'Message not found');
  return m;
}

export async function editMessage(
  userId: string,
  messageId: string,
  content: string,
) {
  const m = await getOwnMessage(userId, messageId);
  if (m.deletedAt) throw new HttpError(400, 'Message was deleted');
  if (m.type !== 'TEXT')
    throw new HttpError(400, 'Only text messages can be edited');

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { content, isEdited: true, editedAt: new Date() },
    include: messageInclude,
  });
  return {
    message: serializeMessage(updated),
    recipientIds: await getPeerIds(userId, m.conversationId),
  };
}

export async function deleteMessage(userId: string, messageId: string) {
  const m = await getOwnMessage(userId, messageId);
  let assets: { publicId: string | null; mimeType: string }[] = [];
  let updated;

  if (m.deletedAt) {
    updated = await prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: messageInclude,
    });
  } else {
    assets = await prisma.messageAttachment.findMany({
      where: { messageId },
      select: { publicId: true, mimeType: true },
    });
    [updated] = await prisma.$transaction([
      prisma.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), content: null },
        include: messageInclude,
      }),
      prisma.messageAttachment.deleteMany({ where: { messageId } }),
    ]);
  }
  void destroyAssets(assets);
  return {
    message: serializeMessage(updated),
    recipientIds: await getPeerIds(userId, m.conversationId),
  };
}

export async function forwardMessage(
  userId: string,
  messageId: string,
  conversationIds: string[],
) {
  const source = await prisma.message.findFirst({
    where: {
      id: messageId,
      deletedAt: null,
      conversation: { members: { some: { userId } } },
    },
  });
  if (!source) throw new HttpError(404, 'Message not found');
  if (source.type !== 'TEXT')
    throw new HttpError(400, 'Only text messages can be forwarded for now');

  const results: { message: ChatMessage; recipientIds: string[] }[] = [];
  for (const conversationId of new Set(conversationIds)) {
    const recipientIds = await getPeerIds(userId, conversationId);
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId,
          senderId: userId,
          type: 'TEXT',
          content: source.content,
          forwardedFromId: source.id,
        },
        include: messageInclude,
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    results.push({ message: serializeMessage(message), recipientIds });
  }
  return results;
}

export async function markConversationRead(
  userId: string,
  conversationId: string,
) {
  const peerIds = await getPeerIds(userId, conversationId);
  const unread = await prisma.message.findMany({
    where: {
      conversationId,
      senderId: { not: userId },
      deletedAt: null,
      reads: { none: { userId } },
    },
    select: { id: true },
    take: 1000,
  });
  const readAt = new Date();
  const messageIds = unread.map((m) => m.id);
  if (messageIds.length > 0) {
    await prisma.$transaction([
      prisma.messageRead.createMany({
        data: messageIds.map((messageId) => ({ messageId, userId, readAt })),
        skipDuplicates: true,
      }),
      prisma.message.updateMany({
        where: { id: { in: messageIds }, deliveredAt: null },
        data: { deliveredAt: readAt },
      }),
    ]);
  }
  return { peerIds, messageIds, readAt };
}

/** يعلّم رسائل كمُسلَّمة للمستلم ويرجع ما تغيّر فعلاً (لإخطار المرسلين) */
export async function markDelivered(recipientId: string, messageIds: string[]) {
  const rows = await prisma.message.findMany({
    where: {
      id: { in: messageIds },
      senderId: { not: recipientId },
      deliveredAt: null,
      conversation: { members: { some: { userId: recipientId } } },
    },
    select: { id: true, senderId: true, conversationId: true },
  });
  if (rows.length === 0) return [];
  await prisma.message.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { deliveredAt: new Date() },
  });
  return rows;
}

/** كل ما تغيّر منذ `since`: رسائل جديدة، تعديلات، حذف، وتحديثات حالة رسائلي */
export async function syncSince(userId: string, since: Date) {
  const serverTime = new Date(); // يؤخذ قبل الاستعلام كي لا يضيع شيء بين الاستعلام والمزامنة التالية
  const LIMIT = 1000;
  const rows = await prisma.message.findMany({
    where: {
      conversation: { members: { some: { userId } } },
      OR: [
        { createdAt: { gt: since } },
        { editedAt: { gt: since } },
        { deletedAt: { gt: since } },
        { senderId: userId, deliveredAt: { gt: since } },
        { senderId: userId, reads: { some: { readAt: { gt: since } } } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: LIMIT + 1,
    include: messageInclude,
  });
  const truncated = rows.length > LIMIT;
  const page = rows.slice(0, LIMIT);

  const pendingIds = page
    .filter((m) => m.senderId !== userId && !m.deliveredAt)
    .map((m) => m.id);
  const delivered = pendingIds.length
    ? await markDelivered(userId, pendingIds)
    : [];

  return {
    serverTime,
    messages: page.map(serializeMessage),
    truncated,
    delivered,
  };
}

/** الأحدث أولاً. cursor = id آخر رسالة وصلتك. مناسب لـ FlatList المقلوبة */
export async function listMessages(
  userId: string,
  conversationId: string,
  before: string | undefined,
  limit: number,
) {
  await getPeerIds(userId, conversationId);

  let cursorWhere: Prisma.MessageWhereInput = {};
  if (before) {
    const c = await prisma.message.findFirst({
      where: { id: before, conversationId },
      select: { id: true, createdAt: true },
    });
    if (!c) throw new HttpError(400, 'Invalid cursor');
    cursorWhere = {
      OR: [
        { createdAt: { lt: c.createdAt } },
        { createdAt: c.createdAt, id: { lt: c.id } },
      ],
    };
  }

  const rows = await prisma.message.findMany({
    where: { conversationId, ...cursorWhere },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: messageInclude,
  });
  const page = rows.slice(0, limit);
  return {
    messages: page.map(serializeMessage),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  };
}

export async function sendAttachmentMessage(
  userId: string,
  conversationId: string,
  file: Express.Multer.File,
  input: { clientId: string; caption?: string; replyToId?: string },
) {
  const recipientIds = await getPeerIds(userId, conversationId);

  const existing = await prisma.message.findUnique({
    where: {
      senderId_clientId: { senderId: userId, clientId: input.clientId },
    },
    include: messageInclude,
  });
  if (existing)
    return {
      message: serializeMessage(existing),
      recipientIds,
      duplicate: true,
    };

  const detected = detectAttachment(file.buffer, file.originalname);
  if (!detected)
    throw new HttpError(
      400,
      'Unsupported file type (images, PDF, Word/Excel/PowerPoint, TXT only)',
    );
  const maxBytes = detected.kind === 'image' ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (file.size > maxBytes)
    throw new HttpError(
      413,
      `File too large (max ${maxBytes / 1024 / 1024}MB)`,
    );

  if (input.replyToId) {
    const target = await prisma.message.findFirst({
      where: { id: input.replyToId, conversationId },
      select: { id: true },
    });
    if (!target) throw new HttpError(400, 'Invalid reply target');
  }

  const uploaded = await uploadAttachment(file.buffer, detected, randomUUID());
  try {
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId,
          senderId: userId,
          type: detected.kind === 'image' ? 'IMAGE' : 'FILE',
          content: input.caption || null,
          clientId: input.clientId,
          replyToId: input.replyToId,
          attachments: {
            create: {
              url: uploaded.secure_url,
              publicId: uploaded.public_id,
              fileName: cleanFileName(file.originalname, detected),
              mimeType: detected.mime,
              sizeBytes: file.size,
              width: uploaded.width ?? null,
              height: uploaded.height ?? null,
            },
          },
        },
        include: messageInclude,
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return {
      message: serializeMessage(message),
      recipientIds,
      duplicate: false,
    };
  } catch (e) {
    await destroyAssets([
      { publicId: uploaded.public_id, mimeType: detected.mime },
    ]);
    throw e;
  }
}
