import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/conversations.controller';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/httpError';
import { validate } from '../middleware/validate';
import rateLimit from 'express-rate-limit';
import { attachmentUpload } from '../middleware/upload';

const router = Router();
router.use(requireAuth);

router.post(
  '/',
  validate(z.object({ userId: z.string().uuid() })),
  asyncHandler(c.create),
);
router.get('/', asyncHandler(c.list));
router.get('/:id', asyncHandler(c.getOne));
router.get('/:id/messages', asyncHandler(c.messages));
router.post(
  '/:id/attachments',
  rateLimit({ windowMs: 60_000, limit: 20 }),
  attachmentUpload,
  asyncHandler(c.sendAttachment),
);
export default router;
