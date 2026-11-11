import { Router, type Response } from 'express';
import { z } from 'zod';

import type { AccountService } from '../auth/accountService.js';
import type { DeviceFlow } from '../auth/deviceFlow.js';
import { DomainError } from '../errors.js';
import type { MagicLinkSender } from './delivery.js';
import { authOf, publicUser, requireAuth } from './middleware.js';
import type { RateLimiter } from './rateLimit.js';

const registerBody = z.object({
  email: z.string().max(254),
  displayName: z.string().max(80),
  password: z.string().max(512).optional(),
  acceptedConsentVersion: z.string(),
});
const loginBody = z.object({
  email: z.string().max(254),
  password: z.string().max(512),
  deviceLabel: z.string().max(80).optional(),
});
const magicRequestBody = z.object({
  email: z.string().max(254),
  purpose: z.enum(['signin', 'reset']),
});
const magicRedeemBody = z.object({
  token: z.string().max(256),
  newPassword: z.string().max(512).optional(),
  deviceLabel: z.string().max(80).optional(),
});
const profileBody = z
  .object({
    displayName: z.string().max(200).optional(),
    avatarUrl: z.string().max(100).nullable().optional(),
  })
  .refine((b) => b.displayName !== undefined || b.avatarUrl !== undefined, 'nothing to change');
const deviceStartBody = z.object({ deviceLabel: z.string().max(80).optional() });
const deviceApproveBody = z.object({ userCode: z.string().max(32) });
const devicePollBody = z.object({ requestId: z.string().max(64), pollSecret: z.string().max(256) });
const consentBody = z.object({ version: z.string() });

export interface AuthRouteDeps {
  accounts: AccountService;
  devices: DeviceFlow;
  sender: MagicLinkSender;
  /** Slows online guessing of passwords. Keyed by client address + email. */
  loginLimiter: RateLimiter;
  /** Slows magic-link requests and redemptions. Keyed by client address. */
  linkLimiter: RateLimiter;
  /** Called after a session is revoked, so a live socket on it can be dropped at once. */
  onSessionRevoked?: (sessionId: string) => void;
  /** Called after someone changes their name, so live rosters can show it at once. */
  onProfileChanged?: (userId: string) => void;
}

/**
 * Device-request failures all mean "no such request" and are answered as one 404, whatever the
 * cause, so a caller cannot tell an unknown id from a wrong secret or an expiry.
 */
async function orNotFound<T>(res: Response, work: Promise<T>): Promise<T | undefined> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof DomainError && error.code === 'invalid_token') {
      res.status(404).json({ error: 'invalid_token', message: 'invalid_token' });
      return undefined;
    }
    throw error;
  }
}

export function authRoutes({
  accounts,
  devices,
  sender,
  loginLimiter,
  linkLimiter,
  onSessionRevoked,
  onProfileChanged,
}: AuthRouteDeps): Router {
  const router = Router();
  const auth = requireAuth(accounts);

  // Rare, heavy action → REST (SYNC-PROTOCOL.md). Returns the account and a first session so the
  // client is signed in straight after sign-up.
  router.post('/register', async (req, res) => {
    const body = registerBody.parse(req.body);
    const user = await accounts.register(body);
    const signedIn = body.password
      ? await accounts.signInWithPassword(body.email, body.password, req.header('x-device-label'))
      : undefined;
    res.status(201).json({ user: publicUser(user), sessionToken: signedIn?.sessionToken ?? null });
  });

  router.post('/login', async (req, res) => {
    const body = loginBody.parse(req.body);
    const key = `login:${req.ip}:${body.email.trim().toLowerCase()}`;
    if (!loginLimiter.allow(key)) {
      res
        .status(429)
        .json({ error: 'rate_limited', message: 'too many attempts; try again later' });
      return;
    }
    const result = await accounts.signInWithPassword(body.email, body.password, body.deviceLabel);
    loginLimiter.reset(key);
    res.json({
      user: publicUser(result.user),
      sessionToken: result.sessionToken,
      needsConsent: result.needsConsent,
    });
  });

  // Always answers the same way, whether or not the address has an account.
  router.post('/magic-link', async (req, res) => {
    const body = magicRequestBody.parse(req.body);
    if (!linkLimiter.allow(`link:${req.ip}`)) {
      res
        .status(429)
        .json({ error: 'rate_limited', message: 'too many requests; try again later' });
      return;
    }
    const issued = await accounts.requestMagicLink(body.email, body.purpose);
    if (issued) {
      await sender.send({
        email: body.email.trim().toLowerCase(),
        purpose: body.purpose,
        token: issued.token,
        expiresAt: issued.expiresAt,
      });
    }
    res.status(202).json({ ok: true });
  });

  router.post('/magic-link/redeem', async (req, res) => {
    const body = magicRedeemBody.parse(req.body);
    if (!linkLimiter.allow(`redeem:${req.ip}`)) {
      res
        .status(429)
        .json({ error: 'rate_limited', message: 'too many attempts; try again later' });
      return;
    }
    const result = await accounts.redeemMagicLink(body.token, {
      ...(body.newPassword === undefined ? {} : { newPassword: body.newPassword }),
      ...(body.deviceLabel === undefined ? {} : { deviceLabel: body.deviceLabel }),
    });
    res.json({
      user: publicUser(result.user),
      sessionToken: result.sessionToken,
      needsConsent: result.needsConsent,
    });
  });

  // The desktop app signs in without a form: it shows a code, a signed-in browser approves it.
  router.post('/device', async (req, res) => {
    const body = deviceStartBody.parse(req.body);
    if (!linkLimiter.allow(`device:${req.ip}`)) {
      res
        .status(429)
        .json({ error: 'rate_limited', message: 'too many requests; try again later' });
      return;
    }
    const label = body.deviceLabel ?? req.header('x-device-label');
    res.status(201).json(await devices.start({ deviceLabel: label, requestIp: req.ip }));
  });

  router.post('/device/poll', async (req, res) => {
    const body = devicePollBody.parse(req.body);
    if (!linkLimiter.allow(`device-poll:${req.ip}`)) {
      res
        .status(429)
        .json({ error: 'rate_limited', message: 'too many requests; try again later' });
      return;
    }
    const result = await orNotFound(res, devices.poll(body.requestId, body.pollSecret));
    if (!result) return;
    if ('pending' in result) {
      res.status(202).json({ pending: true });
      return;
    }
    res.json({
      user: publicUser(result.user),
      sessionToken: result.sessionToken,
      needsConsent: result.needsConsent,
    });
  });

  router.use(auth);

  router.get('/device/:userCode', async (req, res) => {
    if (!linkLimiter.allow(`device-approve:${req.ip}`)) {
      res
        .status(429)
        .json({ error: 'rate_limited', message: 'too many attempts; try again later' });
      return;
    }
    const info = await orNotFound(res, devices.describe(req.params.userCode ?? ''));
    if (info) res.json(info);
  });

  router.post('/device/approve', async (req, res) => {
    const body = deviceApproveBody.parse(req.body);
    if (!linkLimiter.allow(`device-approve:${req.ip}`)) {
      res
        .status(429)
        .json({ error: 'rate_limited', message: 'too many attempts; try again later' });
      return;
    }
    const approved = await orNotFound(
      res,
      devices.approve(authOf(res).user.id, body.userCode).then(() => true),
    );
    if (approved) res.status(204).end();
  });

  // The client calls this periodically; the ping inside `requireAuth` is what keeps it signed in.
  // A signed-in browser hands a short code to the desktop app, which redeems it at /magic-link/redeem.
  router.post('/link-codes', async (_req, res) => {
    const issued = await accounts.issueLinkCode(authOf(res).user.id);
    res.json({
      code: `${issued.code.slice(0, 4)}-${issued.code.slice(4)}`,
      expiresAt: issued.expiresAt,
    });
  });

  router.get('/me', (_req, res) => {
    res.json({ user: publicUser(authOf(res).user) });
  });

  router.patch('/me', async (req, res) => {
    const body = profileBody.parse(req.body);
    const user = await accounts.updateProfile(authOf(res).user.id, {
      ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      ...(body.avatarUrl === undefined ? {} : { avatarUrl: body.avatarUrl }),
    });
    onProfileChanged?.(user.id);
    res.json({ user: publicUser(user) });
  });

  router.post('/consent', async (req, res) => {
    const body = consentBody.parse(req.body);
    const user = await accounts.acceptConsent(authOf(res).user.id, body.version);
    res.json({ user: publicUser(user) });
  });

  router.get('/sessions', async (_req, res) => {
    const { user, session } = authOf(res);
    const sessions = await accounts.listSessions(user.id);
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceLabel: s.deviceLabel,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.id === session.id,
      })),
    });
  });

  // Remote sign-out of one device.
  router.delete('/sessions/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) throw new DomainError('invalid_input');
    await accounts.revokeSession(authOf(res).user.id, id);
    onSessionRevoked?.(id);
    res.status(204).end();
  });

  router.post('/logout', async (_req, res) => {
    const { user, session } = authOf(res);
    await accounts.revokeSession(user.id, session.id);
    onSessionRevoked?.(session.id);
    res.status(204).end();
  });

  return router;
}
