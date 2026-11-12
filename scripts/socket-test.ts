import { randomUUID } from 'crypto';
import { io, Socket } from 'socket.io-client';

const API = 'http://localhost:4000/api';
const WS = 'http://localhost:4000';
const PASS = 'Passw0rd!123';
let failed = 0;

const check = (name: string, ok: boolean, extra?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, ok ? '' : (extra ?? ''));
  if (!ok) failed++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  return { status: res.status, data: t ? JSON.parse(t) : null };
}

const login = async (identifier: string) =>
  (
    await http('/auth/login', {
      method: 'POST',
      body: { identifier, password: PASS },
    })
  ).data;

const connect = (token: string) =>
  new Promise<Socket>((resolve, reject) => {
    const s = io(WS, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => {
      s.close();
      reject(e);
    });
  });

// يستدعي ack تلقائياً (مطلوب لحدث message:new)
const waitFor = <T = any>(s: Socket, event: string, ms = 4000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timeout waiting for ${event}`)),
      ms,
    );
    s.once(event, (data: T, ack?: () => void) => {
      clearTimeout(t);
      if (typeof ack === 'function') ack();
      resolve(data);
    });
  });

const emit = <T = any>(s: Socket, event: string, data: unknown) =>
  new Promise<T>((resolve) => s.emit(event, data, resolve));

async function main() {
  const ali = await login('ali');
  const sara = await login('sara');
  const conv = (
    await http('/conversations', {
      method: 'POST',
      token: ali.accessToken,
      body: { userId: sara.user.id },
    })
  ).data;

  // 0) رفض التوكن الخاطئ
  await connect('bad-token').then(
    () => check('bad token rejected', false),
    (e) => check('bad token rejected', e.message === 'UNAUTHORIZED', e.message),
  );

  const sA = await connect(ali.accessToken);
  let sS = await connect(sara.accessToken);

  // 1) إرسال + استلام فوري + DELIVERED
  const incoming = waitFor(sS, 'message:new');
  const status = waitFor(sA, 'message:status');
  const clientId = randomUUID();
  const ack = await emit(sA, 'message:send', {
    conversationId: conv.id,
    content: 'Hello Sara',
    clientId,
  });
  check('send ack ok (SENT)', ack.ok && ack.message.status === 'SENT', ack);
  const msg = await incoming;
  check(
    'recipient receives message instantly',
    msg.content === 'Hello Sara' && msg.senderId === ali.user.id,
    msg,
  );
  const st = await status;
  check(
    'sender gets DELIVERED',
    st.status === 'DELIVERED' && st.messageIds.includes(ack.message.id),
    st,
  );

  // 2) idempotency
  const dup = await emit(sA, 'message:send', {
    conversationId: conv.id,
    content: 'Hello Sara',
    clientId,
  });
  check(
    'resend with same clientId returns same message',
    dup.ok && dup.message.id === ack.message.id,
    dup,
  );

  // 3) مستخدم غير عضو
  await http('/auth/register', {
    method: 'POST',
    body: {
      email: 'noor@test.com',
      username: 'noor',
      password: PASS,
      displayName: 'Noor',
    },
  });
  const noor = await login('noor');
  const sN = await connect(noor.accessToken);
  const intruder = await emit(sN, 'message:send', {
    conversationId: conv.id,
    content: 'hack',
    clientId: randomUUID(),
  });
  check('non-member cannot send', intruder.ok === false, intruder);
  const intruderHistory = await http(`/conversations/${conv.id}/messages`, {
    token: noor.accessToken,
  });
  check(
    'non-member cannot read history (404)',
    intruderHistory.status === 404,
    intruderHistory,
  );
  sN.close();

  // 4) مؤشر الكتابة
  const typing = waitFor(sA, 'typing');
  await emit(sS, 'typing', { conversationId: conv.id, isTyping: true });
  const ty = await typing;
  check(
    'typing indicator',
    ty.userId === sara.user.id && ty.isTyping === true,
    ty,
  );

  // 5) الرد على رسالة
  const replyIncoming = waitFor(sA, 'message:new');
  const replyAck = await emit(sS, 'message:send', {
    conversationId: conv.id,
    content: 'Hi Ali!',
    clientId: randomUUID(),
    replyToId: ack.message.id,
  });
  const reply = await replyIncoming;
  check(
    'reply carries quoted message',
    reply.replyTo?.id === ack.message.id,
    reply,
  );

  // 6) القراءة
  const readEv = waitFor(sA, 'messages:read');
  await emit(sS, 'conversation:read', { conversationId: conv.id });
  const rd = await readEv;
  check(
    'read receipt reaches sender',
    rd.messageIds.includes(ack.message.id),
    rd,
  );

  // 7) التعديل ثم الحذف
  const updEdit = waitFor(sS, 'message:updated');
  await emit(sA, 'message:edit', {
    messageId: ack.message.id,
    content: 'Hello Sara (edited)',
  });
  const ed = await updEdit;
  check(
    'edit propagates',
    ed.isEdited === true && ed.content === 'Hello Sara (edited)',
    ed,
  );

  const updDel = waitFor(sS, 'message:updated');
  await emit(sA, 'message:delete', { messageId: ack.message.id });
  const del = await updDel;
  check(
    'delete propagates (content hidden)',
    del.deletedAt && del.content === null,
    del,
  );

  const editOthers = await emit(sS, 'message:edit', {
    messageId: replyAck.message.id.replace(/./, 'x'),
    content: 'x',
  });
  const editForeign = await emit(sS, 'message:edit', {
    messageId: ack.message.id,
    content: 'x',
  });
  check(
    "cannot edit someone else's message",
    editForeign.ok === false && editOthers.ok === false,
    editForeign,
  );

  // 8) حالة الاتصال + انقطاع + رسالة فائتة + sync
  const base = await emit(sS, 'sync:request', {
    since: new Date().toISOString(),
  });
  const presence = waitFor(sA, 'presence:update');
  sS.close();
  const pr = await presence;
  check(
    'presence offline broadcast',
    pr.userId === sara.user.id && pr.isOnline === false,
    pr,
  );
  await sleep(200);

  const missed = await emit(sA, 'message:send', {
    conversationId: conv.id,
    content: 'sent while you were offline',
    clientId: randomUUID(),
  });
  check(
    'message to offline user stays SENT',
    missed.ok && missed.message.status === 'SENT',
    missed,
  );

  sS = await connect(sara.accessToken);
  const deliveredEv = waitFor(sA, 'message:status');
  const sync = await emit(sS, 'sync:request', { since: base.serverTime });
  check(
    'sync returns missed message',
    sync.ok && sync.messages.some((m: any) => m.id === missed.message.id),
    sync,
  );
  const dv = await deliveredEv;
  check(
    'sender notified DELIVERED after sync',
    dv.messageIds.includes(missed.message.id),
    dv,
  );

  // 9) تقسيم الصفحات
  const p1 = await http(`/conversations/${conv.id}/messages?limit=2`, {
    token: ali.accessToken,
  });
  check(
    'page 1 has 2 messages and a cursor',
    p1.data.messages.length === 2 && p1.data.nextCursor,
    p1.data,
  );
  const p2 = await http(
    `/conversations/${conv.id}/messages?limit=2&before=${p1.data.nextCursor}`,
    { token: ali.accessToken },
  );
  const ids1 = new Set(p1.data.messages.map((m: any) => m.id));
  check(
    'page 2 continues without overlap',
    p2.data.messages.length >= 1 &&
      p2.data.messages.every((m: any) => !ids1.has(m.id)),
    p2.data,
  );

  // 10) تسجيل الخروج يقطع الاتصال
  const dropped = new Promise<string>((r) =>
    sA.once('disconnect', (reason) => r(reason)),
  );
  await http('/auth/logout', { method: 'POST', token: ali.accessToken });
  const reason = await Promise.race([
    dropped,
    sleep(3000).then(() => 'still-connected'),
  ]);
  check('logout disconnects the socket', reason !== 'still-connected', reason);

  sS.close();
  console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
