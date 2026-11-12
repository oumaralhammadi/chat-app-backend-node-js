import { Socket } from 'socket.io';
import { z, ZodError, ZodType } from 'zod';
import { HttpError } from '../middleware/httpError';
import { pushNewMessage } from '../services/push.service';
import {
  ChatMessage,
  deleteMessage,
  editMessage,
  forwardMessage,
  getPeerIds,
  markConversationRead,
  markDelivered,
  sendMessage,
  syncSince,
} from '../services/message.service';
import { emitToUsers, getIO, userRoom } from './emitter';
import { deliver, notifyDelivered } from './delivery';

const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(4000);

const sendSchema = z.object({
  conversationId: uuid,
  clientId: z.string().min(8).max(64),
  content: text,
  replyToId: uuid.optional(),
});
const editSchema = z.object({ messageId: uuid, content: text });
const deleteSchema = z.object({ messageId: uuid });
const forwardSchema = z.object({
  messageId: uuid,
  conversationIds: z.array(uuid).min(1).max(5),
});
const readSchema = z.object({ conversationId: uuid });
const typingSchema = z.object({ conversationId: uuid, isTyping: z.boolean() });
const syncSchema = z.object({ since: z.string().datetime().nullable() });
const appStateSchema = z.object({ foreground: z.boolean() });

function createLimiter(max: number, windowMs: number) {
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

export function registerChatHandlers(socket: Socket) {
  const userId: string = socket.data.userId;
  const sendLimit = createLimiter(30, 10_000);
  const typingLimit = createLimiter(40, 10_000);

  const on = <T>(
    event: string,
    schema: ZodType<T>,
    fn: (data: T) => Promise<Record<string, unknown>>,
  ) => {
    socket.on(event, async (raw: unknown, ack?: unknown) => {
      const reply =
        typeof ack === 'function' ? (ack as (r: object) => void) : () => {};
      try {
        reply({ ok: true, ...(await fn(schema.parse(raw))) });
      } catch (e) {
        if (e instanceof HttpError) reply({ ok: false, error: e.message });
        else if (e instanceof ZodError)
          reply({ ok: false, error: 'Invalid data' });
        else {
          console.error(`[${event}]`, e);
          reply({ ok: false, error: 'Server error' });
        }
      }
    });
  };

  const toMyOtherDevices = (event: string, payload: unknown) =>
    socket.to(userRoom(userId)).emit(event, payload);

  on('message:send', sendSchema, async (d) => {
    if (!sendLimit()) throw new HttpError(429, 'Too many messages');
    const { message, recipientIds, duplicate } = await sendMessage(userId, d);
    if (!duplicate) {
      toMyOtherDevices('message:new', message);
      deliver(message, recipientIds);
      void pushNewMessage(message, recipientIds);
    }
    return { message };
  });

  on('message:edit', editSchema, async ({ messageId, content }) => {
    const { message, recipientIds } = await editMessage(
      userId,
      messageId,
      content,
    );
    emitToUsers(recipientIds, 'message:updated', message);
    toMyOtherDevices('message:updated', message);
    return { message };
  });

  on('message:delete', deleteSchema, async ({ messageId }) => {
    const { message, recipientIds } = await deleteMessage(userId, messageId);
    emitToUsers(recipientIds, 'message:updated', message);
    toMyOtherDevices('message:updated', message);
    return { message };
  });

  on(
    'message:forward',
    forwardSchema,
    async ({ messageId, conversationIds }) => {
      if (!sendLimit()) throw new HttpError(429, 'Too many messages');
      const results = await forwardMessage(userId, messageId, conversationIds);
      for (const { message, recipientIds } of results) {
        toMyOtherDevices('message:new', message);
        deliver(message, recipientIds);
        void pushNewMessage(message, recipientIds);
      }
      return { messages: results.map((r) => r.message) };
    },
  );

  on('conversation:read', readSchema, async ({ conversationId }) => {
    const { peerIds, messageIds, readAt } = await markConversationRead(
      userId,
      conversationId,
    );
    if (messageIds.length > 0) {
      const payload = { conversationId, readerId: userId, messageIds, readAt };
      emitToUsers(peerIds, 'messages:read', payload);
      toMyOtherDevices('messages:read', payload);
    }
    return { count: messageIds.length };
  });

  on('typing', typingSchema, async ({ conversationId, isTyping }) => {
    if (!typingLimit()) return {};
    const peers = await getPeerIds(userId, conversationId);
    emitToUsers(peers, 'typing', { conversationId, userId, isTyping });
    return {};
  });

  on('sync:request', syncSchema, async ({ since }) => {
    if (!since)
      return { serverTime: new Date(), messages: [], truncated: false };
    const r = await syncSince(userId, new Date(since));
    notifyDelivered(r.delivered);
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
