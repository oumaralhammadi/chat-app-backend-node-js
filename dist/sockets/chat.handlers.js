"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChatHandlers = registerChatHandlers;
const zod_1 = require("zod");
const httpError_1 = require("../middleware/httpError");
const push_service_1 = require("../services/push.service");
const message_service_1 = require("../services/message.service");
const emitter_1 = require("./emitter");
const delivery_1 = require("./delivery");
const uuid = zod_1.z.string().uuid();
const text = zod_1.z.string().trim().min(1).max(4000);
const sendSchema = zod_1.z.object({
    conversationId: uuid,
    clientId: zod_1.z.string().min(8).max(64),
    content: text,
    replyToId: uuid.optional(),
});
const editSchema = zod_1.z.object({ messageId: uuid, content: text });
const deleteSchema = zod_1.z.object({ messageId: uuid });
const forwardSchema = zod_1.z.object({
    messageId: uuid,
    conversationIds: zod_1.z.array(uuid).min(1).max(5),
});
const readSchema = zod_1.z.object({ conversationId: uuid });
const typingSchema = zod_1.z.object({ conversationId: uuid, isTyping: zod_1.z.boolean() });
const syncSchema = zod_1.z.object({ since: zod_1.z.string().datetime().nullable() });
const appStateSchema = zod_1.z.object({ foreground: zod_1.z.boolean() });
function createLimiter(max, windowMs) {
    let count = 0;
    let resetAt = Date.now() + windowMs;
    return () => {
        const now = Date.now();
        if (now > resetAt) {
            count = 0;
            resetAt = now + windowMs;
        }
        return ++count <= max;
    };
}
function registerChatHandlers(socket) {
    const userId = socket.data.userId;
    const sendLimit = createLimiter(30, 10_000);
    const typingLimit = createLimiter(40, 10_000);
    const on = (event, schema, fn) => {
        socket.on(event, async (raw, ack) => {
            const reply = typeof ack === 'function' ? ack : () => { };
            try {
                reply({ ok: true, ...(await fn(schema.parse(raw))) });
            }
            catch (e) {
                if (e instanceof httpError_1.HttpError)
                    reply({ ok: false, error: e.message });
                else if (e instanceof zod_1.ZodError)
                    reply({ ok: false, error: 'Invalid data' });
                else {
                    console.error(`[${event}]`, e);
                    reply({ ok: false, error: 'Server error' });
                }
            }
        });
    };
    const toMyOtherDevices = (event, payload) => socket.to((0, emitter_1.userRoom)(userId)).emit(event, payload);
    on('message:send', sendSchema, async (d) => {
        if (!sendLimit())
            throw new httpError_1.HttpError(429, 'Too many messages');
        const { message, recipientIds, duplicate } = await (0, message_service_1.sendMessage)(userId, d);
        if (!duplicate) {
            toMyOtherDevices('message:new', message);
            (0, delivery_1.deliver)(message, recipientIds);
            void (0, push_service_1.pushNewMessage)(message, recipientIds);
        }
        return { message };
    });
    on('message:edit', editSchema, async ({ messageId, content }) => {
        const { message, recipientIds } = await (0, message_service_1.editMessage)(userId, messageId, content);
        (0, emitter_1.emitToUsers)(recipientIds, 'message:updated', message);
        toMyOtherDevices('message:updated', message);
        return { message };
    });
    on('message:delete', deleteSchema, async ({ messageId }) => {
        const { message, recipientIds } = await (0, message_service_1.deleteMessage)(userId, messageId);
        (0, emitter_1.emitToUsers)(recipientIds, 'message:updated', message);
        toMyOtherDevices('message:updated', message);
        return { message };
    });
    on('message:forward', forwardSchema, async ({ messageId, conversationIds }) => {
        if (!sendLimit())
            throw new httpError_1.HttpError(429, 'Too many messages');
        const results = await (0, message_service_1.forwardMessage)(userId, messageId, conversationIds);
        for (const { message, recipientIds } of results) {
            toMyOtherDevices('message:new', message);
            (0, delivery_1.deliver)(message, recipientIds);
            void (0, push_service_1.pushNewMessage)(message, recipientIds);
        }
        return { messages: results.map((r) => r.message) };
    });
    on('conversation:read', readSchema, async ({ conversationId }) => {
        const { peerIds, messageIds, readAt } = await (0, message_service_1.markConversationRead)(userId, conversationId);
        if (messageIds.length > 0) {
            const payload = { conversationId, readerId: userId, messageIds, readAt };
            (0, emitter_1.emitToUsers)(peerIds, 'messages:read', payload);
            toMyOtherDevices('messages:read', payload);
        }
        return { count: messageIds.length };
    });
    on('typing', typingSchema, async ({ conversationId, isTyping }) => {
        if (!typingLimit())
            return {};
        const peers = await (0, message_service_1.getPeerIds)(userId, conversationId);
        (0, emitter_1.emitToUsers)(peers, 'typing', { conversationId, userId, isTyping });
        return {};
    });
    on('sync:request', syncSchema, async ({ since }) => {
        if (!since)
            return { serverTime: new Date(), messages: [], truncated: false };
        const r = await (0, message_service_1.syncSince)(userId, new Date(since));
        (0, delivery_1.notifyDelivered)(r.delivered);
        return {
            serverTime: r.serverTime,
            messages: r.messages,
            truncated: r.truncated,
        };
    });
    on('app:state', appStateSchema, async ({ foreground }) => {
        socket.data.foreground = foreground;
        socket.data.fgAt = Date.now();
        return {};
    });
}
