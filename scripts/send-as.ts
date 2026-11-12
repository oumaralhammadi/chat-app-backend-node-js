import { randomUUID } from 'crypto';
import { io } from 'socket.io-client';

const API = 'http://localhost:4000/api';
const WS = 'http://localhost:4000';
const PASS = 'Passw0rd!123';

const [, , from, to, ...rest] = process.argv;
const text = rest.join(' ') || 'Hello!';
if (!from || !to) {
  console.log('usage: npx tsx scripts/send-as.ts <from> <to> [text]');
  process.exit(1);
}

async function http(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
) {
  const res = await fetch(API + path, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${t}`);
  return t ? JSON.parse(t) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const me = await http('/auth/login', {
    method: 'POST',
    body: { identifier: from, password: PASS },
  });
  const found = await http(`/users/search?q=${encodeURIComponent(to)}`, {
    token: me.accessToken,
  });
  const target = found.find((u: any) => u.username === to.toLowerCase());
  if (!target) throw new Error(`user "${to}" not found`);
  const conv = await http('/conversations', {
    method: 'POST',
    token: me.accessToken,
    body: { userId: target.id },
  });

  const s = io(WS, {
    auth: { token: me.accessToken },
    transports: ['websocket'],
    reconnection: false,
  });
  await new Promise<void>((res, rej) => {
    s.on('connect', () => res());
    s.on('connect_error', rej);
  });
  console.log(`${from} connected (online)`);
  s.on('message:status', (p) =>
    console.log('status ->', p.status, p.messageIds.length, 'message(s)'),
  );
  s.on('messages:read', (p) => console.log('read by', p.readerId));

  s.emit('typing', { conversationId: conv.id, isTyping: true });
  console.log('typing...');
  await sleep(2500);
  s.emit(
    'message:send',
    { conversationId: conv.id, clientId: randomUUID(), content: text },
    (ack: any) => console.log('sent:', ack.ok ? ack.message.status : ack.error),
  );
  s.emit('typing', { conversationId: conv.id, isTyping: false });

  console.log('staying online for 20s...');
  await sleep(20_000);
  s.close();
  console.log('done');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
