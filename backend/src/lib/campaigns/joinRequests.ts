import { randomUUID } from 'node:crypto';

import {
  JOIN_DECIDED_VISIBLE_MS,
  JOIN_REPEAT_AFTER_MS,
  MAX_JOIN_MESSAGE,
  MAX_OPEN_JOIN_REQUESTS,
} from '../../consts/index.js';
import type { Campaign, JoinRequest, Membership, User } from '../../types/index.js';
import type { Clock } from '../auth/accountService.js';
import { stripUnshowable } from '../auth/deviceLabel.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';

/** What the service tells the rest of the app; every hook is optional so the rules run without a hub. */
export interface JoinRequestHooks {
  /** Stores a notification for each person (the schedule service's `notify`). */
  notify?: (
    userIds: string[],
    n: {
      campaignId: string | null;
      kind: string;
      title: string;
      body?: string;
      data?: Record<string, unknown>;
    },
  ) => Promise<void>;
  /** Sends a frame to every live socket of a person. */
  sendToUser?: (userId: string, type: string, data: unknown) => void;
  /** A campaign's roster changed (someone joined). */
  rosterChanged?: (campaignId: string) => void | Promise<void>;
}

export interface JoinRequestDeps {
  store: Store;
  hooks?: JoinRequestHooks;
  clock?: Clock;
  newId?: () => string;
}

/** The caller's own request on a campaign in the directory. */
export interface MyJoinState {
  id: string;
  status: 'pending' | 'declined';
  createdAt: number;
  /** Declined only: when they may ask again (epoch ms). */
  retryAfter?: number;
}

export interface OpenCampaignView {
  id: string;
  name: string;
  dmName: string;
  playerCount: number;
  myRequest: MyJoinState | null;
}

/** A request as the DM sees it. */
export interface DmJoinRequestView {
  id: string;
  campaignId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  message: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  /** Pending but Allow join (or the instance directory) is off: visible, cannot be approved. */
  closed: boolean;
}

/**
 * Asking to join a campaign (docs/architecture/CAMPAIGN-JOIN-REQUESTS.md). A signed-in person asks; the
 * campaign's current DM approves or declines. Authority is checked against the DM role at the moment of
 * the decision, so a DM swap moves pending requests to the new DM with no extra step.
 *
 * Refusals are non-leaky: the directory being off, the campaign not existing and Allow join being off all
 * answer `not_found`, so nobody can tell a hidden campaign from a missing one.
 */
export class JoinRequestService {
  private readonly store: Store;
  private readonly hooks: JoinRequestHooks;
  private readonly clock: Clock;
  private readonly newId: () => string;

  constructor(deps: JoinRequestDeps) {
    this.store = deps.store;
    this.hooks = deps.hooks ?? {};
    this.clock = deps.clock ?? { now: () => Date.now() };
    this.newId = deps.newId ?? randomUUID;
  }

  private async directoryOn(): Promise<boolean> {
    return (await this.store.getSettings()).campaignDirectory === 'on';
  }

  /** Campaigns open to requests that this person is not already in. Empty when the directory is off. */
  async listOpen(userId: string): Promise<OpenCampaignView[]> {
    if (!(await this.directoryOn())) return [];
    const mine = new Set(
      (await this.store.listMembershipsForUser(userId)).map((m) => m.campaignId),
    );
    const now = this.clock.now();
    const requests = await this.store.listJoinRequestsForUser(userId);
    const latest = new Map<string, JoinRequest>();
    for (const r of requests) {
      if (r.status === 'approved' || r.status === 'withdrawn') continue;
      const seen = latest.get(r.campaignId);
      if (!seen || r.createdAt >= seen.createdAt) latest.set(r.campaignId, r);
    }
    return (await this.store.listOpenCampaigns())
      .filter((c) => !mine.has(c.id))
      .map((c) => {
        const r = latest.get(c.id);
        let myRequest: MyJoinState | null = null;
        if (r?.status === 'pending') {
          myRequest = { id: r.id, status: 'pending', createdAt: r.createdAt };
        } else if (r?.status === 'declined') {
          const retryAfter = (r.decidedAt ?? r.createdAt) + JOIN_REPEAT_AFTER_MS;
          if (retryAfter > now) {
            myRequest = { id: r.id, status: 'declined', createdAt: r.createdAt, retryAfter };
          }
        }
        return { ...c, myRequest };
      });
  }

  /**
   * Asks to join. Succeeds with the same `pending` answer whether the request is new or a repeat of one
   * still open. Refused (409) for an existing member, a "no" less than 7 days old, or five open requests.
   */
  async request(user: User, campaignId: string, message?: string): Promise<{ status: 'pending' }> {
    const text = stripUnshowable(message ?? '', true);
    if ([...text].length > MAX_JOIN_MESSAGE) {
      throw new DomainError(
        'invalid_input',
        `the message can be up to ${MAX_JOIN_MESSAGE} characters`,
      );
    }
    if (!(await this.directoryOn())) throw new DomainError('not_found');
    if (await this.store.getMembership(campaignId, user.id)) {
      throw new DomainError('conflict', 'you are already in this campaign');
    }
    const campaign = await this.store.getCampaign(campaignId);
    if (!campaign || !campaign.allowJoin) throw new DomainError('not_found');

    const mine = await this.store.listJoinRequestsForUser(user.id);
    if (mine.some((r) => r.campaignId === campaignId && r.status === 'pending')) {
      return { status: 'pending' };
    }
    const now = this.clock.now();
    const recentNo = mine.some(
      (r) =>
        r.campaignId === campaignId &&
        r.status === 'declined' &&
        (r.decidedAt ?? r.createdAt) + JOIN_REPEAT_AFTER_MS > now,
    );
    if (recentNo) throw new DomainError('conflict', 'you can ask this table again in a few days');
    if ((await this.store.countOpenJoinRequestsByUser(user.id)) >= MAX_OPEN_JOIN_REQUESTS) {
      throw new DomainError(
        'conflict',
        `you already have ${MAX_OPEN_JOIN_REQUESTS} open requests; withdraw one first`,
      );
    }

    const request: JoinRequest = {
      id: this.newId(),
      campaignId,
      userId: user.id,
      message: text,
      status: 'pending',
      createdAt: now,
      decidedAt: null,
      decidedBy: null,
    };
    if (!(await this.store.createJoinRequest(request))) return { status: 'pending' };

    const dmIds = await this.dmIds(campaignId);
    for (const dmId of dmIds) {
      this.hooks.sendToUser?.(dmId, 'join.request', {
        campaignId,
        requestId: request.id,
        status: 'pending',
        userId: user.id,
        displayName: user.displayName,
        message: request.message,
        createdAt: now,
      });
    }
    await this.safely(() =>
      this.hooks.notify?.(dmIds, {
        campaignId,
        kind: 'join_request',
        title: `${user.displayName} wants to join ${campaign.name}`,
        body: request.message,
        data: { requestId: request.id, campaignId, userId: user.id },
      }),
    );
    return { status: 'pending' };
  }

  /** Takes back the caller's open request on a campaign. Nothing open is a quiet no-op. */
  async withdraw(user: User, campaignId: string): Promise<void> {
    const open = (await this.store.listJoinRequestsForUser(user.id, 'pending')).find(
      (r) => r.campaignId === campaignId,
    );
    if (!open) return;
    if (!(await this.store.decideJoinRequest(open.id, 'withdrawn', user.id, this.clock.now())))
      return;
    for (const dmId of await this.dmIds(campaignId)) {
      this.hooks.sendToUser?.(dmId, 'join.request', {
        campaignId,
        requestId: open.id,
        status: 'withdrawn',
        userId: user.id,
      });
    }
  }

  /** The DM's list: everything pending, plus what was decided in the last 30 days. */
  async listForDm(
    campaignId: string,
    dmUserId: string,
  ): Promise<{ allowJoin: boolean; requests: DmJoinRequestView[] }> {
    await this.requireDm(dmUserId, campaignId);
    const campaign = await this.requireCampaign(campaignId);
    const closed = !campaign.allowJoin || !(await this.directoryOn());
    const cutoff = this.clock.now() - JOIN_DECIDED_VISIBLE_MS;
    const views: DmJoinRequestView[] = [];
    for (const r of await this.store.listJoinRequestsForCampaign(campaignId)) {
      if (r.status === 'withdrawn') continue;
      if (r.status !== 'pending' && (r.decidedAt ?? r.createdAt) < cutoff) continue;
      const who = await this.store.getUser(r.userId);
      views.push({
        id: r.id,
        campaignId,
        userId: r.userId,
        displayName: who?.displayName ?? '',
        avatarUrl: who?.avatarUrl ?? null,
        message: r.message,
        status: r.status,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        decidedBy: r.decidedBy,
        closed: r.status === 'pending' && closed,
      });
    }
    return { allowJoin: campaign.allowJoin, requests: views };
  }

  /**
   * Approve (adds the person as a player, once) or decline. Only the campaign's current DM; an Admin who is
   * not the DM is refused. Deciding the same way twice is a harmless repeat; the opposite way is a conflict.
   */
  async decide(
    campaignId: string,
    requestId: string,
    dmUserId: string,
    approve: boolean,
  ): Promise<{ request: JoinRequest; joined: boolean }> {
    await this.requireDm(dmUserId, campaignId);
    const campaign = await this.requireCampaign(campaignId);
    const existing = await this.store.getJoinRequest(requestId);
    if (!existing || existing.campaignId !== campaignId) throw new DomainError('not_found');
    const wanted = approve ? 'approved' : 'declined';
    if (existing.status === wanted) return { request: existing, joined: false };
    if (existing.status !== 'pending') {
      throw new DomainError('conflict', 'that request was already dealt with');
    }
    if (approve && (!campaign.allowJoin || !(await this.directoryOn()))) {
      throw new DomainError('conflict', 'joining is closed; turn Allow join on to approve');
    }

    const now = this.clock.now();
    let won = false;
    let joined = false;
    await this.store.transaction(async (tx) => {
      won = await tx.decideJoinRequest(requestId, wanted, dmUserId, now);
      if (!won || !approve) return;
      if (!(await tx.getMembership(campaignId, existing.userId))) {
        await tx.putMembership(newPlayer(campaignId, existing.userId, now));
        joined = true;
      }
    });
    const current = (await this.store.getJoinRequest(requestId)) ?? existing;
    if (!won) {
      if (current.status === wanted) return { request: current, joined: false };
      throw new DomainError('conflict', 'that request was already dealt with');
    }

    this.hooks.sendToUser?.(existing.userId, 'join.decided', {
      campaignId,
      requestId,
      approved: approve,
    });
    await this.safely(() =>
      this.hooks.notify?.([existing.userId], {
        campaignId: approve ? campaignId : null,
        kind: 'join_decision',
        title: approve ? `You're in ${campaign.name}` : 'Not this time',
        body: approve ? '' : `Your request to join ${campaign.name} was declined.`,
        data: { requestId, campaignId, approved: approve },
      }),
    );
    if (joined) await this.safely(() => this.hooks.rosterChanged?.(campaignId));
    return { request: current, joined };
  }

  /** The DM's Allow-join switch. Returns the campaign as stored. */
  async setAllowJoin(campaignId: string, dmUserId: string, allowJoin: boolean): Promise<Campaign> {
    await this.requireDm(dmUserId, campaignId);
    await this.store.setCampaignAllowJoin(campaignId, allowJoin);
    return this.requireCampaign(campaignId);
  }

  private async dmIds(campaignId: string): Promise<string[]> {
    return (await this.store.listMemberships(campaignId))
      .filter((m) => m.role === 'dm')
      .map((m) => m.userId);
  }

  private async requireDm(userId: string, campaignId: string): Promise<void> {
    const m = await this.store.getMembership(campaignId, userId);
    if (m?.role !== 'dm') throw new DomainError('forbidden', 'only the DM can do that');
  }

  private async requireCampaign(campaignId: string): Promise<Campaign> {
    const campaign = await this.store.getCampaign(campaignId);
    if (!campaign) throw new DomainError('not_found');
    return campaign;
  }

  /** A failed side effect (notification, socket) must not undo or fail the decision. */
  private async safely(work: () => void | Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      console.error('[backend] join request side effect failed', error);
    }
  }
}

function newPlayer(campaignId: string, userId: string, now: number): Membership {
  return {
    campaignId,
    userId,
    role: 'player',
    activeCharacterId: null,
    suspendedCharacterId: null,
    joinedAt: now,
  };
}
