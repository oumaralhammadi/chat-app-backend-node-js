"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageInclude = void 0;
exports.serializeMessage = serializeMessage;
exports.getPeerIds = getPeerIds;
exports.sendMessage = sendMessage;
exports.editMessage = editMessage;
exports.deleteMessage = deleteMessage;
exports.forwardMessage = forwardMessage;
exports.markConversationRead = markConversationRead;
exports.markDelivered = markDelivered;
exports.syncSince = syncSince;
exports.listMessages = listMessages;
exports.sendAttachmentMessage = sendAttachmentMessage;
const prisma_1 = require("../config/prisma");
const httpError_1 = require("../middleware/httpError");
const crypto_1 = require("crypto");
const upload_1 = require("../middleware/upload");
const upload_service_1 = require("./upload.service");
exports.messageInclude = {
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
};
function serializeMessage(m) {
    // reads تحتوي قراءات الطرف الآخر فقط (المرسل لا يقرأ رسائله)
    const status = m.reads.length > 0 ? 'READ' : m.deliveredAt ? 'DELIVERED' : 'SENT';
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
            : m.attachments.map(({ id, url, fileName, mimeType, sizeBytes, width, height }) => ({
                id,
                url,
                fileName,
                mimeType,
                sizeBytes,
                width,
                height,
            })),
    };
}
/** أعضاء المحادثة الآخرون. غير الأعضاء يحصلون على 404 حتى لا نكشف وجودها */
async function getPeerIds(userId, conversationId) {
    const conv = await prisma_1.prisma.conversation.findFirst({
        where: { id: conversationId, members: { some: { userId } } },
        select: { members: { select: { userId: true } } },
    });
    if (!conv)
        throw new httpError_1.HttpError(404, 'Conversation not found');
    return conv.members.map((m) => m.userId).filter((id) => id !== userId);
}
async function sendMessage(userId, input) {
    const recipientIds = await getPeerIds(userId, input.conversationId);
    // idempotency: إعادة الإرسال بنفس clientId ترجع الرسالة الموجودة
    const existing = await prisma_1.prisma.message.findUnique({
        where: {
            senderId_clientId: { senderId: userId, clientId: input.clientId },
        },
        include: exports.messageInclude,
    });
    if (existing)
        return {
            message: serializeMessage(existing),
            recipientIds,
            duplicate: true,
        };
    if (input.replyToId) {
        const target = await prisma_1.prisma.message.findFirst({
            where: { id: input.replyToId, conversationId: input.conversationId },
            select: { id: true },
        });
        if (!target)
            throw new httpError_1.HttpError(400, 'Invalid reply target');
    }
    const [message] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.message.create({
            data: {
                conversationId: input.conversationId,
                senderId: userId,
                type: 'TEXT',
                content: input.content,
                clientId: input.clientId,
                replyToId: input.replyToId,
            },
            include: exports.messageInclude,
        }),
        prisma_1.prisma.conversation.update({
            where: { id: input.conversationId },
            data: { lastMessageAt: new Date() },
        }),
    ]);
    return { message: serializeMessage(message), recipientIds, duplicate: false };
}
async function getOwnMessage(userId, messageId) {
    const m = await prisma_1.prisma.message.findUnique({ where: { id: messageId } });
    if (!m || m.senderId !== userId)
        throw new httpError_1.HttpError(404, 'Message not found');
    return m;
}
async function editMessage(userId, messageId, content) {
    const m = await getOwnMessage(userId, messageId);
    if (m.deletedAt)
        throw new httpError_1.HttpError(400, 'Message was deleted');
    if (m.type !== 'TEXT')
        throw new httpError_1.HttpError(400, 'Only text messages can be edited');
    const updated = await prisma_1.prisma.message.update({
        where: { id: messageId },
        data: { content, isEdited: true, editedAt: new Date() },
        include: exports.messageInclude,
    });
    return {
        message: serializeMessage(updated),
        recipientIds: await getPeerIds(userId, m.conversationId),
    };
}
async function deleteMessage(userId, messageId) {
    const m = await getOwnMessage(userId, messageId);
    let assets = [];
    let updated;
    if (m.deletedAt) {
        updated = await prisma_1.prisma.message.findUniqueOrThrow({
            where: { id: messageId },
            include: exports.messageInclude,
        });
    }
    else {
        assets = await prisma_1.prisma.messageAttachment.findMany({
            where: { messageId },
            select: { publicId: true, mimeType: true },
        });
        [updated] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.message.update({
                where: { id: messageId },
                data: { deletedAt: new Date(), content: null },
                include: exports.messageInclude,
            }),
            prisma_1.prisma.messageAttachment.deleteMany({ where: { messageId } }),
        ]);
    }
    void (0, upload_service_1.destroyAssets)(assets);
    return {
        message: serializeMessage(updated),
        recipientIds: await getPeerIds(userId, m.conversationId),
    };
}
async function forwardMessage(userId, messageId, conversationIds) {
    const source = await prisma_1.prisma.message.findFirst({
        where: {
            id: messageId,
            deletedAt: null,
            conversation: { members: { some: { userId } } },
        },
    });
    if (!source)
        throw new httpError_1.HttpError(404, 'Message not found');
    if (source.type !== 'TEXT')
        throw new httpError_1.HttpError(400, 'Only text messages can be forwarded for now');
    const results = [];
    for (const conversationId of new Set(conversationIds)) {
        const recipientIds = await getPeerIds(userId, conversationId);
        const [message] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.message.create({
                data: {
                    conversationId,
                    senderId: userId,
                    type: 'TEXT',
                    content: source.content,
                    forwardedFromId: source.id,
                },
                include: exports.messageInclude,
            }),
            prisma_1.prisma.conversation.update({
                where: { id: conversationId },
                data: { lastMessageAt: new Date() },
            }),
        ]);
        results.push({ message: serializeMessage(message), recipientIds });
    }
    return results;
}
async function markConversationRead(userId, conversationId) {
    const peerIds = await getPeerIds(userId, conversationId);
    const unread = await prisma_1.prisma.message.findMany({
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
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.messageRead.createMany({
                data: messageIds.map((messageId) => ({ messageId, userId, readAt })),
                skipDuplicates: true,
            }),
            prisma_1.prisma.message.updateMany({
                where: { id: { in: messageIds }, deliveredAt: null },
                data: { deliveredAt: readAt },
            }),
        ]);
    }
    return { peerIds, messageIds, readAt };
}
/** يعلّم رسائل كمُسلَّمة للمستلم ويرجع ما تغيّر فعلاً (لإخطار المرسلين) */
async function markDelivered(recipientId, messageIds) {
    const rows = await prisma_1.prisma.message.findMany({
        where: {
            id: { in: messageIds },
            senderId: { not: recipientId },
            deliveredAt: null,
            conversation: { members: { some: { userId: recipientId } } },
        },
        select: { id: true, senderId: true, conversationId: true },
    });
    if (rows.length === 0)
        return [];
    await prisma_1.prisma.message.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { deliveredAt: new Date() },
    });
    return rows;
}
/** كل ما تغيّر منذ `since`: رسائل جديدة، تعديلات، حذف، وتحديثات حالة رسائلي */
async function syncSince(userId, since) {
    const serverTime = new Date(); // يؤخذ قبل الاستعلام كي لا يضيع شيء بين الاستعلام والمزامنة التالية
    const LIMIT = 1000;
    const rows = await prisma_1.prisma.message.findMany({
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
        include: exports.messageInclude,
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
async function listMessages(userId, conversationId, before, limit) {
    await getPeerIds(userId, conversationId);
    let cursorWhere = {};
    if (before) {
        const c = await prisma_1.prisma.message.findFirst({
            where: { id: before, conversationId },
            select: { id: true, createdAt: true },
        });
        if (!c)
            throw new httpError_1.HttpError(400, 'Invalid cursor');
        cursorWhere = {
            OR: [
                { createdAt: { lt: c.createdAt } },
                { createdAt: c.createdAt, id: { lt: c.id } },
            ],
        };
    }
    const rows = await prisma_1.prisma.message.findMany({
        where: { conversationId, ...cursorWhere },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: exports.messageInclude,
    });
    const page = rows.slice(0, limit);
    return {
        messages: page.map(serializeMessage),
        nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
}
async function sendAttachmentMessage(userId, conversationId, file, input) {
    const recipientIds = await getPeerIds(userId, conversationId);
    const existing = await prisma_1.prisma.message.findUnique({
        where: {
            senderId_clientId: { senderId: userId, clientId: input.clientId },
        },
        include: exports.messageInclude,
    });
    if (existing)
        return {
            message: serializeMessage(existing),
            recipientIds,
            duplicate: true,
        };
    const detected = (0, upload_1.detectAttachment)(file.buffer, file.originalname);
    if (!detected)
        throw new httpError_1.HttpError(400, 'Unsupported file type (images, PDF, Word/Excel/PowerPoint, TXT only)');
    const maxBytes = detected.kind === 'image' ? upload_1.MAX_IMAGE_BYTES : upload_1.MAX_FILE_BYTES;
    if (file.size > maxBytes)
        throw new httpError_1.HttpError(413, `File too large (max ${maxBytes / 1024 / 1024}MB)`);
    if (input.replyToId) {
        const target = await prisma_1.prisma.message.findFirst({
            where: { id: input.replyToId, conversationId },
            select: { id: true },
        });
        if (!target)
            throw new httpError_1.HttpError(400, 'Invalid reply target');
    }
    const uploaded = await (0, upload_service_1.uploadAttachment)(file.buffer, detected, (0, crypto_1.randomUUID)());
    try {
        const [message] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.message.create({
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
                            fileName: (0, upload_1.cleanFileName)(file.originalname, detected),
                            mimeType: detected.mime,
                            sizeBytes: file.size,
                            width: uploaded.width ?? null,
                            height: uploaded.height ?? null,
                        },
                    },
                },
                include: exports.messageInclude,
            }),
            prisma_1.prisma.conversation.update({
                where: { id: conversationId },
                data: { lastMessageAt: new Date() },
            }),
        ]);
        return {
            message: serializeMessage(message),
            recipientIds,
            duplicate: false,
        };
    }
    catch (e) {
        await (0, upload_service_1.destroyAssets)([
            { publicId: uploaded.public_id, mimeType: detected.mime },
        ]);
        throw e;
    }
}
