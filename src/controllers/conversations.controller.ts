import { Request, Response } from 'express';
import { z } from 'zod';
import * as svc from '../services/conversation.service';
import { listMessages } from '../services/message.service';
import { HttpError } from '../middleware/httpError';
import { sendAttachmentMessage } from '../services/message.service';
import { getIO, userRoom } from '../sockets/emitter';
import { deliver } from '../sockets/delivery';
import { pushNewMessage } from '../services/push.service';

export const create = async (req: Request, res: Response) =>
  res
    .status(201)
    .json(await svc.getOrCreateDirect(req.auth!.userId, req.body.userId));

export const list = async (req: Request, res: Response) => {
  const { q } = z
    .object({ q: z.string().trim().max(50).optional() })
    .parse(req.query);
  res.json(await svc.listConversations(req.auth!.userId, q || undefined));
};

export const getOne = async (req: Request, res: Response) =>
  res.json(await svc.getConversation(req.auth!.userId, String(req.params.id)));

export const messages = async (req: Request, res: Response) => {
  const q = z
    .object({
      before: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(30),
    })
    .parse(req.query);
  res.json(
    await listMessages(
      req.auth!.userId,
      String(req.params.id),
      q.before,
      q.limit,
    ),
  );
};

export const sendAttachment = async (req: Request, res: Response) => {
  if (!req.file)
    throw new HttpError(400, 'File is required (field name: file)');
  const body = z
    .object({
      clientId: z.string().min(8).max(64),
      caption: z.string().trim().max(1000).optional(),
      replyToId: z.string().uuid().optional(),
    })
    .parse(req.body);
  const userId = req.auth!.userId;

  const { message, recipientIds, duplicate } = await sendAttachmentMessage(
    userId,
    String(req.params.id),
    req.file,
    body,
  );

  if (!duplicate) {
    // أجهزتي الأخرى. إن أرسل العميل x-socket-id نستثني اتصاله هو لأنه يملك الرد أصلاً
    const mine = getIO().to(userRoom(userId));
    const socketId = req.header('x-socket-id');
    (socketId ? mine.except(socketId) : mine).emit('message:new', message);
    deliver(message, recipientIds);
    void pushNewMessage(message, recipientIds);
  }
  res.status(duplicate ? 200 : 201).json({ message });
};
