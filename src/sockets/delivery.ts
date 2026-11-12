import { ChatMessage, markDelivered } from '../services/message.service';
import { emitToUsers, getIO, userRoom } from './emitter';

export function notifyDelivered(
  rows: { id: string; senderId: string; conversationId: string }[],
) {
  const groups = new Map<
    string,
    { senderId: string; conversationId: string; messageIds: string[] }
  >();
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
    emitToUsers([g.senderId], 'message:status', {
      conversationId: g.conversationId,
      messageIds: g.messageIds,
      status: 'DELIVERED',
    });
  }
}

/** يرسل الرسالة للمستلم ويطلب تأكيداً من جهازه. التأكيد وحده يجعلها DELIVERED */
export function deliver(message: ChatMessage, recipientIds: string[]) {
  if (recipientIds.length === 0) return;
  getIO()
    .to(recipientIds.map(userRoom))
    .timeout(5000)
    .emit(
      'message:new',
      message,
      async (_err: unknown, responses: unknown[]) => {
        try {
          if (!responses || responses.length === 0) return; // غير متصل: تُسلَّم عبر sync لاحقاً
          notifyDelivered(await markDelivered(recipientIds[0], [message.id]));
        } catch (e) {
          console.error('deliver error', e);
        }
      },
    );
}
