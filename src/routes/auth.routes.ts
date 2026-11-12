import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import * as c from '../controllers/auth.controller';
import { asyncHandler } from '../middleware/httpError';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(rateLimit({ windowMs: 15 * 60_000, limit: 50 }));

const password = z.string().min(8).max(72);

const perEmail = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit,
    keyGenerator: (req) =>
      `${req.path}:${String(req.body?.email ?? 'anon').toLowerCase()}`,
    message: { message: 'Too many attempts' },
  });

router.post(
  '/register',
  validate(
    z.object({
      email: z.string().email().max(191),
      username: z.string().regex(/^[a-zA-Z0-9_]{3,30}$/),
      password,
      displayName: z.string().trim().min(1).max(60),
      deviceName: z.string().max(100).optional(),
    }),
  ),
  asyncHandler(c.register),
);

router.post(
  '/login',
  validate(
    z.object({
      identifier: z.string().min(1),
      password: z.string().min(1),
      deviceName: z.string().max(100).optional(),
    }),
  ),
  asyncHandler(c.login),
);

router.post(
  '/refresh',
  validate(z.object({ refreshToken: z.string().min(1) })),
  asyncHandler(c.refresh),
);
router.post('/logout', requireAuth, asyncHandler(c.logout));
router.get('/me', requireAuth, asyncHandler(c.me));

router.post(
  '/forgot-password',
  perEmail(3),
  validate(z.object({ email: z.string().email() })),
  asyncHandler(c.forgotPassword),
);
router.post(
  '/reset-password',
  perEmail(5),
  validate(
    z.object({
      email: z.string().email(),
      code: z.string().length(6),
      newPassword: password,
    }),
  ),
  asyncHandler(c.resetPassword),
);

export default router;
