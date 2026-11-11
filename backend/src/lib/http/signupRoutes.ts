import { Router } from 'express';
import { z } from 'zod';

import type { SignupService } from '../auth/signupService.js';
import type { RateLimiter } from './rateLimit.js';

// The service enforces the real limits (name 1-80, message 500, after stripping); these only bound the work.
const signupBody = z.object({
  email: z.string().max(254),
  displayName: z.string().max(1000),
  message: z.string().max(5000).optional(),
});

export interface SignupRouteDeps {
  signups: SignupService;
  /** A few requests per hour per address: a visitor sends one, a script is slowed to a crawl. */
  signupLimiter: RateLimiter;
}

/**
 * `POST /api/signup-requests` — public. A visitor asks for an account; the operator decides in the
 * Admin CLI. The answer is the same `202` whether or not the address already has an account or a
 * request waiting. `404` when the operator has the feature off.
 */
export function signupRoutes({ signups, signupLimiter }: SignupRouteDeps): Router {
  const router = Router();
  router.post('/', async (req, res, next) => {
    try {
      if (!signupLimiter.allow(`signup:${req.ip}`)) {
        res
          .status(429)
          .json({ error: 'rate_limited', message: 'too many requests; try again later' });
        return;
      }
      const body = signupBody.parse(req.body);
      await signups.submit({
        email: body.email,
        displayName: body.displayName,
        ...(body.message !== undefined ? { message: body.message } : {}),
      });
      res.status(202).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
