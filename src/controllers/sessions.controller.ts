import { Request, Response } from 'express';
import { prisma } from '../config/prisma';

export const setPushToken = async (req: Request, res: Response) => {
  const token: string | null = req.body.token;
  const { sessionId } = req.auth!;
  // نفس الجهاز لا يجب أن يبقى مسجلاً لحساب آخر (تبديل الحسابات)
  if (token) {
    await prisma.userSession.updateMany({
      where: { pushToken: token, id: { not: sessionId } },
      data: { pushToken: null },
    });
  }
  await prisma.userSession.update({
    where: { id: sessionId },
    data: { pushToken: token },
  });
  res.status(204).end();
};
