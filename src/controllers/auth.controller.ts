import { Request, Response } from 'express';
import * as auth from '../services/auth.service';
import { getIO } from '../sockets/emitter';
export const register = async (req: Request, res: Response) =>
  res.status(201).json(await auth.register(req.body));

export const login = async (req: Request, res: Response) =>
  res.json(await auth.login(req.body));

export const refresh = async (req: Request, res: Response) =>
  res.json(await auth.refresh(req.body.refreshToken));

export const logout = async (req: Request, res: Response) => {
  const { sessionId } = req.auth!;
  await auth.logout(sessionId);
  getIO().in(`session:${sessionId}`).disconnectSockets(true);
  res.status(204).end();
};

export const me = async (req: Request, res: Response) =>
  res.json(await auth.getMe(req.auth!.userId));

export const forgotPassword = async (req: Request, res: Response) => {
  await auth.forgotPassword(req.body.email);
  res.json({ message: 'If the email exists, a reset code was sent' });
};

export const resetPassword = async (req: Request, res: Response) => {
  await auth.resetPassword(req.body.email, req.body.code, req.body.newPassword);
  res.json({ message: 'Password updated' });
};
