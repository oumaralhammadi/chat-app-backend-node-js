"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userConnected = userConnected;
exports.userDisconnected = userDisconnected;
const prisma_1 = require("../config/prisma");
const emitter_1 = require("./emitter");
// عدد اتصالات كل مستخدم (جهاز/تبويب متعدد): يصبح offline عند إغلاق آخر اتصال
const connections = new Map();
async function peerIdsOf(userId) {
    const rows = await prisma_1.prisma.conversationMember.findMany({
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
        ...new Set(rows.flatMap((r) => r.conversation.members.map((m) => m.userId))),
    ];
}
async function userConnected(userId) {
    const n = (connections.get(userId) ?? 0) + 1;
    connections.set(userId, n);
    if (n !== 1)
        return;
    try {
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { isOnline: true },
        });
        (0, emitter_1.emitToUsers)(await peerIdsOf(userId), 'presence:update', {
            userId,
            isOnline: true,
            lastSeenAt: null,
        });
    }
    catch (e) {
        console.error('presence connect error', e);
    }
}
async function userDisconnected(userId) {
    const n = (connections.get(userId) ?? 1) - 1;
    if (n > 0) {
        connections.set(userId, n);
        return;
    }
    connections.delete(userId);
    try {
        const lastSeenAt = new Date();
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { isOnline: false, lastSeenAt },
        });
        (0, emitter_1.emitToUsers)(await peerIdsOf(userId), 'presence:update', {
            userId,
            isOnline: false,
            lastSeenAt,
        });
    }
    catch (e) {
        console.error('presence disconnect error', e);
    }
}
