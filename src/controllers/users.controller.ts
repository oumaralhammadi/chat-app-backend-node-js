import { Request, Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/httpError';
import * as users from '../services/user.service';

export const updateMe = async (req: Request, res: Response) =>
  res.json(await users.updateProfile(req.auth!.userId, req.body));

export const uploadAvatar = async (req: Request, res: Response) => {
  if (!req.file)
    throw new HttpError(400, 'Avatar file is required (field name: avatar)');
  res.json(await users.setAvatar(req.auth!.userId, req.file.buffer));
};

export const search = async (req: Request, res: Response) => {
  const { q } = z
    .object({ q: z.string().trim().min(2).max(50) })
    .parse(req.query);
  res.json(await users.searchUsers(req.auth!.userId, q));
};

export const removeAvatar = async (req: Request, res: Response) =>
  res.json(await users.removeAvatar(req.auth!.userId));
