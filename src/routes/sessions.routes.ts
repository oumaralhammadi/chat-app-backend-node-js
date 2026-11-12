import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/sessions.controller';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/httpError';
import { validate } from '../middleware/validate';

const router = Router();
router.use(requireAuth);

router.put(
  '/push-token',
  validate(
    z.object({
      token: z
        .string()
        .regex(/^Expo(nent)?PushToken\[.+\]$/)
        .max(255)
        .nullable(),
    }),
  ),
  asyncHandler(c.setPushToken),
);

export default router;
