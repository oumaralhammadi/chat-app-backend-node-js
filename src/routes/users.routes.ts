import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/users.controller';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/httpError';
import { avatarUpload } from '../middleware/upload';
import { validate } from '../middleware/validate';

const router = Router();
router.use(requireAuth);

router.patch(
  '/me',
  validate(
    z
      .object({
        displayName: z.string().trim().min(1).max(60).optional(),
        statusText: z.string().trim().max(200).nullable().optional(),
      })
      .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
  ),
  asyncHandler(c.updateMe),
);

router.post('/me/avatar', avatarUpload, asyncHandler(c.uploadAvatar));
router.delete('/me/avatar', asyncHandler(c.removeAvatar));
router.get('/search', asyncHandler(c.search));

export default router;
