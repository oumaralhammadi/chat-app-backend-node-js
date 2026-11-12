"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyDelivered = notifyDelivered;
exports.deliver = deliver;
const message_service_1 = require("../services/message.service");
const emitter_1 = require("./emitter");
function notifyDelivered(rows) {
    const groups = new Map();
    for (const r of rows) {
        const key = `${r.senderId}|${r.conversationId}`;
        const g = groups.get(key) ?? {
            senderId: r.senderId,
            conversationId: r.conversationId,
            messageIds: [],
        };
        g.messageIds.push(r.id);
        groups.set(key, g);
    }
    for (const g of groups.values()) {
        (0, emitter_1.emitToUsers)([g.senderId], 'message:status', {
            conversationId: g.conversationId,
            messageIds: g.messageIds,
            status: 'DELIVERED',
        });
    }
}
/** يرسل الرسالة للمستلم ويطلب تأكيداً من جهازه. التأكيد وحده يجعلها DELIVERED */
function deliver(message, recipientIds) {
    if (recipientIds.length === 0)
        return;
    (0, emitter_1.getIO)()
        .to(recipientIds.map(emitter_1.userRoom))
        .timeout(5000)
        .emit('message:new', message, async (_err, responses) => {
        try {
            if (!responses || responses.length === 0)
                return; // غير متصل: تُسلَّم عبر sync لاحقاً
            notifyDelivered(await (0, message_service_1.markDelivered)(recipientIds[0], [message.id]));
        }
        catch (e) {
            console.error('deliver error', e);
        }
    });
}
