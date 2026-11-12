"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushNewMessage = pushNewMessage;
const env_1 = require("../config/env");
const prisma_1 = require("../config/prisma");
const emitter_1 = require("../sockets/emitter");
const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const FOREGROUND_TTL_MS = 45_000;
const headers = () => ({
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(env_1.env.EXPO_ACCESS_TOKEN
        ? { Authorization: `Bearer ${env_1.env.EXPO_ACCESS_TOKEN}` }
        : {}),
});
/** مفتوح = اتصال سوكت أرسل نبضة foreground خلال آخر 45 ثانية */
async function inForeground(userId) {
    const sockets = await (0, emitter_1.getIO)().in((0, emitter_1.userRoom)(userId)).fetchSockets();
    return sockets.some((s) => s.data.foreground === true &&
        Date.now() - (s.data.fgAt ?? 0) < FOREGROUND_TTL_MS);
}
function bodyOf(m) {
    if (m.type === 'IMAGE')
        return m.content ? `📷 ${m.content}` : '📷';
    if (m.type === 'FILE')
        return `📎 ${m.attachments[0]?.fileName ?? ''}`.trim();
    return (m.content ?? '').slice(0, 180);
}
async function dropTokens(tokens) {
    if (tokens.length === 0)
        return;
    await prisma_1.prisma.userSession.updateMany({
        where: { pushToken: { in: tokens } },
        data: { pushToken: null },
    });
}
async function checkReceipts(items) {
    try {
        const res = await fetch(RECEIPTS_URL, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ ids: items.map((i) => i.id) }),
        });
        const json = (await res.json());
        await dropTokens(items
            .filter((i) => json.data?.[i.id]?.details?.error === 'DeviceNotRegistered')
            .map((i) => i.token));
    }
    catch (e) {
        console.error('push receipts error', e);
    }
}
/** لا يرمي أبداً: فشل الإشعار لا يجب أن يُفشل إرسال الرسالة */
async function pushNewMessage(message, recipientIds) {
    try {
        const targets = [];
        for (const id of recipientIds)
            if (!(await inForeground(id)))
                targets.push(id);
        if (targets.length === 0)
            return;
        const [sender, sessions] = await Promise.all([
            prisma_1.prisma.user.findUnique({
                where: { id: message.senderId },
                select: { displayName: true },
            }),
            prisma_1.prisma.userSession.findMany({
                where: {
                    userId: { in: targets },
                    pushToken: { not: null },
                    revokedAt: null,
                    expiresAt: { gt: new Date() },
                },
                select: { pushToken: true },
            }),
        ]);
        const tokens = [...new Set(sessions.map((s) => s.pushToken))];
        if (tokens.length === 0)
            return;
        const payload = tokens.map((to) => ({
            to,
            title: sender?.displayName ?? 'Chat',
            body: bodyOf(message),
            sound: 'default',
            priority: 'high',
            channelId: 'messages',
            data: {
                type: 'message',
                conversationId: message.conversationId,
                messageId: message.id,
            },
        }));
        const dead = [];
        const receipts = [];
        for (let i = 0; i < payload.length; i += 100) {
            const chunk = payload.slice(i, i + 100);
            const res = await fetch(SEND_URL, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify(chunk),
            });
            if (!res.ok) {
                console.error('expo push http error', res.status, await res.text());
                continue;
            }
            const json = (await res.json());
            json.data?.forEach((t, idx) => {
                if (t.status === 'ok' && t.id)
                    receipts.push({ id: t.id, token: chunk[idx].to });
                else if (t.details?.error === 'DeviceNotRegistered')
                    dead.push(chunk[idx].to);
                else
                    console.warn('push ticket error:', t.details?.error ?? t.message);
            });
        }
        await dropTokens(dead);
        // الإيصالات تتوفر بعد دقائق: فحص أفضل جهد
        if (receipts.length > 0)
            setTimeout(() => void checkReceipts(receipts), 10 * 60_000).unref();
    }
    catch (e) {
        console.error('push error', e);
    }
}
