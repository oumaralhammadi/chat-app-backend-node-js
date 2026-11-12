import { randomUUID } from 'crypto';
import { io, Socket } from 'socket.io-client';

const API = 'http://localhost:4000/api';
const WS = 'http://localhost:4000';
const PASS = 'Passw0rd!123';
let failed = 0;

const check = (name: string, ok: boolean, extra?: unknown) => {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}`,
    ok ? '' : (JSON.stringify(extra) ?? ''),
  );
  if (!ok) failed++;
};

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
    s.on('connect_error', reject);
  });

const waitFor = <T = any>(s: Socket, event: string, ms = 6000) =>
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

async function upload(
  token: string | null,
  convId: string,
  file: { data: Buffer; name: string; type?: string },
  fields: Record<string, string> = {},
) {
  const fd = new FormData();
  fd.append('clientId', fields.clientId ?? randomUUID());
  for (const [k, v] of Object.entries(fields))
    if (k !== 'clientId') fd.append(k, v);
  fd.append(
    'file',
    new Blob([file.data], { type: file.type ?? 'application/octet-stream' }),
    file.name,
  );
  const res = await fetch(`${API}/conversations/${convId}/attachments`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const t = await res.text();
  return { status: res.status, data: t ? JSON.parse(t) : null };
}

// صورة PNG حقيقية بحجم 1x1
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function main() {
  const ali = await login('ali');
  const sara = await login('sara');
  const noor = await login('noor');
  const conv = (
    await http('/conversations', {
      method: 'POST',
      token: ali.accessToken,
      body: { userId: sara.user.id },
    })
  ).data;
  const sA = await connect(ali.accessToken);
  const sS = await connect(sara.accessToken);

  // 1) صورة مع تعليق
  const incoming = waitFor(sS, 'message:new');
  const status = waitFor(sA, 'message:status');
  const r1 = await upload(
    ali.accessToken,
    conv.id,
    { data: PNG, name: 'pixel.png', type: 'image/png' },
    { caption: 'my pixel' },
  );
  check(
    'image upload returns 201 as IMAGE with caption',
    r1.status === 201 &&
      r1.data?.message?.type === 'IMAGE' &&
      r1.data.message.content === 'my pixel',
    r1,
  );
  const att = r1.data?.message?.attachments?.[0];
  check(
    'stored on Cloudinary with dimensions',
    Boolean(att?.url?.startsWith('https://res.cloudinary.com/')) &&
      att.width === 1 &&
      att.height === 1,
    att,
  );
  const m1 = await incoming;
  check(
    'recipient receives IMAGE message instantly',
    m1.id === r1.data.message.id && m1.attachments.length === 1,
    m1,
  );
  const st = await status;
  check('sender gets DELIVERED', st.messageIds.includes(m1.id), st);
  const imgRes = await fetch(att.url);
  check('image URL is reachable', imgRes.status === 200, imgRes.status);

  // 2) ملف نصي باسم عربي
  const text = 'تقرير تجريبي\nhello';
  const r2 = await upload(ali.accessToken, conv.id, {
    data: Buffer.from(text),
    name: 'ملاحظات.txt',
    type: 'text/plain',
  });
  const a2 = r2.data?.message?.attachments?.[0];
  check(
    'file upload: FILE type, Arabic filename preserved, size correct',
    r2.status === 201 &&
      r2.data.message.type === 'FILE' &&
      a2?.fileName === 'ملاحظات.txt' &&
      a2.sizeBytes === Buffer.byteLength(text),
    r2,
  );
  const fileRes = a2 ? await fetch(a2.url) : null;
  check(
    'file URL is reachable with correct content',
    fileRes?.status === 200 && (await fileRes.text()).includes('hello'),
    fileRes?.status,
  );

  // 3) الرفض
  const exe = await upload(ali.accessToken, conv.id, {
    data: Buffer.from('MZ\x90\x00\x03\x00\x00\x00'),
    name: 'virus.exe',
  });
  check('executable rejected (400)', exe.status === 400, exe);
  const fakePng = await upload(ali.accessToken, conv.id, {
    data: Buffer.from('just text, not an image'),
    name: 'fake.png',
    type: 'image/png',
  });
  check(
    'text disguised as PNG rejected (400)',
    fakePng.status === 400,
    fakePng,
  );
  const fakePdf = await upload(ali.accessToken, conv.id, {
    data: Buffer.from('not really a pdf'),
    name: 'fake.pdf',
    type: 'application/pdf',
  });
  check(
    'text disguised as PDF rejected (400)',
    fakePdf.status === 400,
    fakePdf,
  );
  const big = await upload(ali.accessToken, conv.id, {
    data: Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]),
    name: 'big.png',
    type: 'image/png',
  });
  check('image over 10MB rejected (413)', big.status === 413, big);
  const intruder = await upload(noor.accessToken, conv.id, {
    data: PNG,
    name: 'x.png',
    type: 'image/png',
  });
  check('non-member cannot upload (404)', intruder.status === 404, intruder);
  const anon = await upload(null, conv.id, {
    data: PNG,
    name: 'x.png',
    type: 'image/png',
  });
  check('no token rejected (401)', anon.status === 401, anon);

  // 4) تكرار الإرسال والرد
  const dupId = randomUUID();
  const d1 = await upload(
    sara.accessToken,
    conv.id,
    { data: PNG, name: 'a.png', type: 'image/png' },
    { clientId: dupId },
  );
  const d2 = await upload(
    sara.accessToken,
    conv.id,
    { data: PNG, name: 'a.png', type: 'image/png' },
    { clientId: dupId },
  );
  check(
    'same clientId returns the same message (200)',
    d1.status === 201 &&
      d2.status === 200 &&
      d1.data.message.id === d2.data.message.id,
    { d1: d1.status, d2: d2.status },
  );

  const rep = await upload(
    ali.accessToken,
    conv.id,
    { data: PNG, name: 'r.png', type: 'image/png' },
    { replyToId: r1.data.message.id },
  );
  check(
    'attachment reply carries quoted message',
    rep.data?.message?.replyTo?.id === r1.data.message.id,
    rep,
  );

  // 5) الحذف
  const upd = waitFor(sS, 'message:updated');
  await emit(sA, 'message:delete', { messageId: r1.data.message.id });
  const del = await upd;
  check(
    'delete hides attachments for the recipient',
    Boolean(del.deletedAt) && del.attachments.length === 0,
    del,
  );
  const hist = await http(`/conversations/${conv.id}/messages?limit=50`, {
    token: ali.accessToken,
  });
  const found = hist.data.messages.find(
    (m: any) => m.id === r1.data.message.id,
  );
  check(
    'history shows the deleted message without attachments',
    found?.attachments?.length === 0,
    found,
  );

  sA.close();
  sS.close();
  console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
