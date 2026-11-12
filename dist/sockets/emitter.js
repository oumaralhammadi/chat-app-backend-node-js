"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRoom = exports.getIO = exports.setIO = void 0;
exports.emitToUsers = emitToUsers;
let io = null;
const setIO = (server) => {
    io = server;
};
exports.setIO = setIO;
const getIO = () => {
    if (!io)
        throw new Error('Socket.IO is not initialized');
    return io;
};
exports.getIO = getIO;
const userRoom = (userId) => `user:${userId}`;
exports.userRoom = userRoom;
function emitToUsers(userIds, event, payload) {
    // مهم: to([]) بقائمة فارغة يبث للجميع، لذلك نمنع ذلك صراحة
    if (userIds.length === 0)
        return;
    (0, exports.getIO)().to(userIds.map(exports.userRoom)).emit(event, payload);
}
