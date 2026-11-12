import { randomUUID } from 'crypto';
import { io } from 'socket.io-client';

const API = 'http://localhost:4000/api';
const WS = 'http://localhost:4000';
const PASS = 'Passw0rd!123';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const user = process.argv[2];
if (!user) {
  console.log('usage: npx tsx scripts/peer-bot.ts <username>');
  process.exit(1);
}

async function main() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: user, password: PASS }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const me = await res.json();

  const s = io(WS, {
    auth: { token: me.accessToken },
    transports: ['websocket'],
    reconnection: false,
  });
  await new Promise<void>((ok, bad) => {
    s.on('connect', () => ok());
    s.on('connect_error', bad);
  });
  console.log(
    `[${user}] online. commands (send from the app): edit | delete | flood | anything else = echo`,
  );

  const send = (conversationId: string, content: string) =>
    new Promise<any>((r) =>
      s.emit(
        'message:send',
        { conversationId, clientId: randomUUID(), content },
        r,
      ),
    );

  const typeThenSend = async (conversationId: string, content: string) => {
    s.emit('typing', { conversationId, isTyping: true });
    await sleep(1500);
    s.emit('typing', { conversationId, isTyping: false });
    return send(conversationId, content);
  };

  s.on('message:updated', (m: any) =>
    console.log(
      'updated:',
      m.id.slice(0, 8),
      m.deletedAt ? 'deleted' : m.content,
    ),
  );

  s.on('message:new', async (msg: any, ack?: () => void) => {
    if (typeof ack === 'function') ack(); // => DELIVERED عند المرسل
    if (msg.senderId === me.user.id) return;
    console.log('received:', msg.type, msg.content ?? '');

    await sleep(1000);
    s.emit('conversation:read', { conversationId: msg.conversationId }); // => READ
    if (msg.type !== 'TEXT')
      return void (await typeThenSend(
        msg.conversationId,
        `Got your ${msg.type}`,
      ));

    const cmd = (msg.content ?? '').trim().toLowerCase();
    if (cmd === 'edit') {
      const r = await typeThenSend(msg.conversationId, 'before edit');
      await sleep(2000);
      s.emit(
        'message:edit',
        { messageId: r.message.id, content: 'after edit' },
        () => {},
      );
    } else if (cmd === 'delete') {
      const r = await typeThenSend(msg.conversationId, 'this will be deleted');
      await sleep(2000);
      s.emit('message:delete', { messageId: r.message.id }, () => {});
    } else if (cmd === 'flood') {
      for (let i = 1; i <= 60; i++) {
        await send(msg.conversationId, `flood message ${i}`);
        await sleep(400);
      }
    } else {
      await typeThenSend(msg.conversationId, `Echo: ${msg.content}`);
    }
  });

  process.on('SIGINT', () => {
    s.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
