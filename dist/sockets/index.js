"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocket = initSocket;
const socket_io_1 = require("socket.io");
const chat_handlers_1 = require("./chat.handlers");
const auth_1 = require("./auth");
const emitter_1 = require("./emitter");
const presence_1 = require("./presence");
function initSocket(server) {
    const io = new socket_io_1.Server(server, {
        cors: { origin: '*' },
        pingInterval: 25_000,
        pingTimeout: 20_000,
        maxHttpBufferSize: 1e6,
    });
    (0, emitter_1.setIO)(io);
    io.use(auth_1.socketAuth);
    io.on('connection', (socket) => {
        const userId = socket.data.userId;
        // غرفة لكل مستخدم (كل أجهزته) + غرفة للجلسة لإغلاقها عند تسجيل الخروج
        socket.join([(0, emitter_1.userRoom)(userId), `session:${socket.data.sessionId}`]);
        (0, chat_handlers_1.registerChatHandlers)(socket);
        void (0, presence_1.userConnected)(userId);
        socket.on('disconnect', () => void (0, presence_1.userDisconnected)(userId));
    });
    return io;
}
