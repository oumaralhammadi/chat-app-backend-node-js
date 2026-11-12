"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateDirect = getOrCreateDirect;
exports.listConversations = listConversations;
exports.getConversation = getConversation;
const client_1 = require("@prisma/client");
const prisma_1 = require("../config/prisma");
const httpError_1 = require("../middleware/httpError");
const user_service_1 = require("./user.service");
const conversationInclude = (userId) => ({
    members: { include: { user: { select: user_service_1.peerSelect } } },
    messages: {
        orderBy: { createdAt: 'desc' },
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
function format(row, userId) {
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
async function getOrCreateDirect(userId, peerId) {
    if (userId === peerId)
        throw new httpError_1.HttpError(400, 'Cannot start a conversation with yourself');
    const peer = await prisma_1.prisma.user.findUnique({
        where: { id: peerId },
        select: { id: true },
    });
    if (!peer)
        throw new httpError_1.HttpError(404, 'User not found');
    const directKey = [userId, peerId].sort().join(':');
    const include = conversationInclude(userId);
    let row = await prisma_1.prisma.conversation.findUnique({
        where: { directKey },
        include,
    });
    if (!row) {
        try {
            row = await prisma_1.prisma.conversation.create({
                data: {
                    directKey,
                    members: { create: [{ userId }, { userId: peerId }] },
                },
                include,
            });
        }
        catch (e) {
            // طلبان متزامنان: الثاني يفشل على القيد الفريد فنجلب الموجود
            if (e instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                e.code === 'P2002') {
                row = await prisma_1.prisma.conversation.findUnique({
                    where: { directKey },
                    include,
                });
            }
            else
                throw e;
        }
    }
    if (!row)
        throw new httpError_1.HttpError(500, 'Could not create conversation');
    return format(row, userId);
}
async function listConversations(userId, q) {
    const rows = await prisma_1.prisma.conversation.findMany({
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
async function getConversation(userId, id) {
    // شرط العضوية داخل الاستعلام نفسه: غير الأعضاء يحصلون على 404
    const row = await prisma_1.prisma.conversation.findFirst({
        where: { id, members: { some: { userId } } },
        include: conversationInclude(userId),
    });
    if (!row)
        throw new httpError_1.HttpError(404, 'Conversation not found');
    return format(row, userId);
}
