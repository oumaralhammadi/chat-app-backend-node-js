import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { getIO, userRoom } from '../sockets/emitter';
import type { ChatMessage } from './message.service';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const FOREGROUND_TTL_MS = 45_000;

interface Ticket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

const headers = () => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  ...(env.EXPO_ACCESS_TOKEN
    ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` }
    : {}),
});

/** مفتوح = اتصال سوكت أرسل نبضة foreground خلال آخر 45 ثانية */
async function inForeground(userId: string) {
  const sockets = await getIO().in(userRoom(userId)).fetchSockets();
  return sockets.some(
    (s) =>
      s.data.foreground === true &&
      Date.now() - (s.data.fgAt ?? 0) < FOREGROUND_TTL_MS,
  );
}

function bodyOf(m: ChatMessage) {
  if (m.type === 'IMAGE') return m.content ? `📷 ${m.content}` : '📷';
  if (m.type === 'FILE') return `📎 ${m.attachments[0]?.fileName ?? ''}`.trim();
  return (m.content ?? '').slice(0, 180);
}

async function dropTokens(tokens: string[]) {
  if (tokens.length === 0) return;
  await prisma.userSession.updateMany({
    where: { pushToken: { in: tokens } },
    data: { pushToken: null },
  });
}

async function checkReceipts(items: { id: string; token: string }[]) {
  try {
    const res = await fetch(RECEIPTS_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ids: items.map((i) => i.id) }),
    });
    const json = (await res.json()) as {
      data?: Record<string, { details?: { error?: string } }>;
    };
    await dropTokens(
      items
        .filter(
          (i) => json.data?.[i.id]?.details?.error === 'DeviceNotRegistered',
        )
        .map((i) => i.token),
    );
  } catch (e) {
    console.error('push receipts error', e);
  }
}

/** لا يرمي أبداً: فشل الإشعار لا يجب أن يُفشل إرسال الرسالة */
export async function pushNewMessage(
  message: ChatMessage,
  recipientIds: string[],
) {
  try {
    const targets: string[] = [];
    for (const id of recipientIds)
      if (!(await inForeground(id))) targets.push(id);
    if (targets.length === 0) return;

    const [sender, sessions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: message.senderId },
        select: { displayName: true },
      }),
      prisma.userSession.findMany({
        where: {
          userId: { in: targets },
          pushToken: { not: null },
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { pushToken: true },
      }),
    ]);
    const tokens = [...new Set(sessions.map((s) => s.pushToken!))];
    if (tokens.length === 0) return;

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

    const dead: string[] = [];
    const receipts: { id: string; token: string }[] = [];

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
      const json = (await res.json()) as { data?: Ticket[] };
      json.data?.forEach((t, idx) => {
        if (t.status === 'ok' && t.id)
          receipts.push({ id: t.id, token: chunk[idx].to });
        else if (t.details?.error === 'DeviceNotRegistered')
          dead.push(chunk[idx].to);
        else console.warn('push ticket error:', t.details?.error ?? t.message);
      });
    }

    await dropTokens(dead);
    // الإيصالات تتوفر بعد دقائق: فحص أفضل جهد
    if (receipts.length > 0)
      setTimeout(() => void checkReceipts(receipts), 10 * 60_000).unref();
  } catch (e) {
    console.error('push error', e);
  }
}
