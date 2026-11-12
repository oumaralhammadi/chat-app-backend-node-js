import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { registerChatHandlers } from './chat.handlers';
import { socketAuth } from './auth';
import { setIO, userRoom } from './emitter';
import { userConnected, userDisconnected } from './presence';

export function initSocket(server: HttpServer) {
  const io = new Server(server, {
    cors: { origin: '*' },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1e6,
  });
  setIO(io);
  io.use(socketAuth);

  io.on('connection', (socket) => {
    const userId: string = socket.data.userId;
    // غرفة لكل مستخدم (كل أجهزته) + غرفة للجلسة لإغلاقها عند تسجيل الخروج
    socket.join([userRoom(userId), `session:${socket.data.sessionId}`]);

    registerChatHandlers(socket);
    void userConnected(userId);
    socket.on('disconnect', () => void userDisconnected(userId));
  });

  return io;
}
