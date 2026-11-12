"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPushToken = void 0;
const prisma_1 = require("../config/prisma");
const setPushToken = async (req, res) => {
    const token = req.body.token;
    const { sessionId } = req.auth;
    // نفس الجهاز لا يجب أن يبقى مسجلاً لحساب آخر (تبديل الحسابات)
    if (token) {
        await prisma_1.prisma.userSession.updateMany({
            where: { pushToken: token, id: { not: sessionId } },
            data: { pushToken: null },
        });
    }
    await prisma_1.prisma.userSession.update({
        where: { id: sessionId },
        data: { pushToken: token },
    });
    res.status(204).end();
};
exports.setPushToken = setPushToken;
