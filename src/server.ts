import http from 'http';
import { app } from './app';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { initSocket } from './sockets';

const server = http.createServer(app);
initSocket(server);

async function main() {
  // بعد أي إعادة تشغيل لا يوجد أحد متصل فعلياً
  await prisma.user.updateMany({
    where: { isOnline: true },
    data: { isOnline: false },
  });
  server.listen(env.PORT, '0.0.0.0', () =>
    console.log(`API running on http://localhost:${env.PORT}`),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
