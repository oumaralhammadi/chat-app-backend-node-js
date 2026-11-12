"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = void 0;
const prisma_1 = require("../config/prisma");
const token_service_1 = require("../services/token.service");
const httpError_1 = require("./httpError");
const requireAuth = async (req, _res, next) => {
    try {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer '))
            throw new httpError_1.HttpError(401, 'Missing token');
        let payload;
        try {
            payload = (0, token_service_1.verifyAccessToken)(header.slice(7));
        }
        catch {
            throw new httpError_1.HttpError(401, 'Invalid or expired token');
        }
        const session = await prisma_1.prisma.userSession.findUnique({
            where: { id: payload.sid },
        });
        if (!session || session.revokedAt || session.expiresAt < new Date()) {
            throw new httpError_1.HttpError(401, 'Session ended');
        }
        req.auth = { userId: payload.sub, sessionId: payload.sid };
        next();
    }
    catch (e) {
        next(e);
    }
};
exports.requireAuth = requireAuth;
