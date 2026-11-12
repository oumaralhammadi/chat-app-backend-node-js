"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socketAuth = socketAuth;
const prisma_1 = require("../config/prisma");
const token_service_1 = require("../services/token.service");
async function socketAuth(socket, next) {
    try {
        const token = socket.handshake.auth?.token;
        if (typeof token !== 'string')
            throw new Error('no token');
        const payload = (0, token_service_1.verifyAccessToken)(token);
        const session = await prisma_1.prisma.userSession.findUnique({
            where: { id: payload.sid },
        });
        if (!session || session.revokedAt || session.expiresAt < new Date())
            throw new Error('bad session');
        socket.data.userId = payload.sub;
        socket.data.sessionId = payload.sid;
        next();
    }
    catch {
        next(new Error('UNAUTHORIZED'));
    }
}
