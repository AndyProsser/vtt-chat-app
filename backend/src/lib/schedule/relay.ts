import type { Notification, ScheduleStore } from './scheduleStore.js';

export interface RelayDeps {
  schedule: ScheduleStore;
  /** Sends to every live socket of a user. Returns nothing: offline users get it in their next snapshot. */
  sendToUser: (userId: string, type: string, data: unknown) => void;
  now?: () => number;
}

/** What a client sees of a notification. */
export const notificationView = (n: Notification) => ({
  id: n.id,
  campaignId: n.campaignId,
  kind: n.kind,
  title: n.title,
  body: n.body,
  data: n.data,
  at: n.createdAt,
});

/**
 * Pushes stored notifications to people who are connected. Everything is written to the database
 * first and pushed after, so it makes no difference whether the backend or the records worker created
 * it, and someone who is offline simply finds it in their next snapshot (SYNC-PROTOCOL.md, "Offline
 * delivery"). Each notification is pushed once.
 */
export class NotificationRelay {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  private readonly now: () => number;

  constructor(private readonly deps: RelayDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Pushes everything not yet pushed. Calls overlap safely: a second call waits for the first. */
  flush(): Promise<void> {
    const run = (this.running ?? Promise.resolve()).then(async () => {
      for (;;) {
        const batch = await this.deps.schedule.unpushedNotifications(200);
        if (batch.length === 0) return;
        for (const n of batch) this.deps.sendToUser(n.userId, 'notification', notificationView(n));
        await this.deps.schedule.markPushed(
          batch.map((n) => n.id),
          this.now(),
        );
      }
    });
    this.running = run.catch(() => undefined);
    return run;
  }

  start(intervalMs = 5000): void {
    this.timer ??= setInterval(() => void this.flush().catch(() => undefined), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
