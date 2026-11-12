"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.login = login;
exports.refresh = refresh;
exports.logout = logout;
exports.getMe = getMe;
exports.forgotPassword = forgotPassword;
exports.resetPassword = resetPassword;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../config/prisma");
const env_1 = require("../config/env");
const httpError_1 = require("../middleware/httpError");
const token_service_1 = require("./token.service");
const mail_service_1 = require("./mail.service");
const publicUserSelect = {
    id: true,
    email: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    statusText: true,
    createdAt: true,
};
async function createSession(userId, deviceName) {
    const refreshToken = (0, token_service_1.generateRefreshToken)();
    const expiresAt = new Date(Date.now() + env_1.env.REFRESH_TOKEN_DAYS * 86_400_000);
    const session = await prisma_1.prisma.userSession.create({
        data: {
            userId,
            refreshTokenHash: (0, token_service_1.hashToken)(refreshToken),
            deviceName,
            expiresAt,
        },
    });
    return { accessToken: (0, token_service_1.signAccessToken)(userId, session.id), refreshToken };
}
async function register(input) {
    const email = input.email.toLowerCase();
    const username = input.username.toLowerCase();
    const exists = await prisma_1.prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
        select: { email: true },
    });
    if (exists) {
        throw new httpError_1.HttpError(409, exists.email === email
            ? 'Email already in use'
            : 'Username already taken');
    }
    const user = await prisma_1.prisma.user.create({
        data: {
            email,
            username,
            displayName: input.displayName,
            passwordHash: await bcryptjs_1.default.hash(input.password, 12),
        },
        select: publicUserSelect,
    });
    return { user, ...(await createSession(user.id, input.deviceName)) };
}
async function login(input) {
    const id = input.identifier.toLowerCase();
    const user = await prisma_1.prisma.user.findFirst({
        where: { OR: [{ email: id }, { username: id }] },
    });
    // رسالة موحدة حتى لا نكشف وجود الحساب
    if (!user || !(await bcryptjs_1.default.compare(input.password, user.passwordHash))) {
        throw new httpError_1.HttpError(401, 'Invalid credentials');
    }
    const { passwordHash, ...publicUser } = user;
    return {
        user: publicUser,
        ...(await createSession(user.id, input.deviceName)),
    };
}
async function refresh(refreshToken) {
    const session = await prisma_1.prisma.userSession.findUnique({
        where: { refreshTokenHash: (0, token_service_1.hashToken)(refreshToken) },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
        throw new httpError_1.HttpError(401, 'Invalid refresh token');
    }
    const newRefresh = (0, token_service_1.generateRefreshToken)();
    await prisma_1.prisma.userSession.update({
        where: { id: session.id },
        data: {
            refreshTokenHash: (0, token_service_1.hashToken)(newRefresh),
            lastUsedAt: new Date(),
            expiresAt: new Date(Date.now() + env_1.env.REFRESH_TOKEN_DAYS * 86_400_000),
        },
    });
    return {
        accessToken: (0, token_service_1.signAccessToken)(session.userId, session.id),
        refreshToken: newRefresh,
    };
}
async function logout(sessionId) {
    await prisma_1.prisma.userSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date(), pushToken: null },
    });
}
async function getMe(userId) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: publicUserSelect,
    });
    if (!user)
        throw new httpError_1.HttpError(404, 'User not found');
    return user;
}
async function forgotPassword(email) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
    });
    if (!user)
        return; // لا نكشف هل البريد مسجل أم لا
    const code = (0, token_service_1.generateResetCode)();
    await prisma_1.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma_1.prisma.passwordResetToken.create({
        data: {
            userId: user.id,
            codeHash: (0, token_service_1.hashToken)(code),
            expiresAt: new Date(Date.now() + 15 * 60_000),
        },
    });
    await (0, mail_service_1.sendMail)(user.email, 'Password reset code', `Your reset code is ${code}. It expires in 15 minutes.`);
}
async function resetPassword(email, code, newPassword) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
    });
    const token = user &&
        (await prisma_1.prisma.passwordResetToken.findFirst({
            where: {
                userId: user.id,
                codeHash: (0, token_service_1.hashToken)(code),
                usedAt: null,
                expiresAt: { gt: new Date() },
            },
        }));
    if (!user || !token)
        throw new httpError_1.HttpError(400, 'Invalid or expired code');
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: await bcryptjs_1.default.hash(newPassword, 12) },
        }),
        prisma_1.prisma.passwordResetToken.update({
            where: { id: token.id },
            data: { usedAt: new Date() },
        }),
        prisma_1.prisma.userSession.updateMany({
            where: { userId: user.id, revokedAt: null },
            data: { revokedAt: new Date() },
        }),
    ]);
}
