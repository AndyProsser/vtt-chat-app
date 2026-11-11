import { TextField } from '@radix-ui/themes';
import { CalendarPlus, Check, History, X } from 'lucide-react';
import { useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { useCampaignQuery } from '../../hooks/useCampaignQuery.js';
import {
  DEFAULT_DURATION,
  DURATION_OPTIONS,
  TIME_OPTIONS,
  defaultSlot,
  formatRange,
  nextSessionTitle,
  startsAtOf,
} from '../../lib/schedule.js';
import { isDm } from '../../lib/tableModel.js';
import { useTableStore } from '../../lib/tableStore.js';
import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import type { SessionView } from '../../types/index.js';
import { SectionHeading } from './SectionHeading.js';
import { SessionCard, durationLabel } from './SessionCard.js';
import { Dropdown } from '../Dropdown.js';
import { DatePicker } from '../DatePicker.js';
import { ToolButton } from '../ToolButton.js';

/** Upcoming sessions with one-tap RSVPs; the DM schedules the next one in a single compact row. */
export function SessionsSection() {
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const [showPast, setShowPast] = useState(false);
  const { data, error, reload } = useCampaignQuery<{ sessions: SessionView[] }>(
    showPast ? 'sessions/past' : 'sessions',
    ['notification', 'session.'],
  );
  const slot = defaultSlot(new Date());
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState<string>();
  const [date, setDate] = useState(slot.date);
  const [time, setTime] = useState(slot.time);
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [actionError, setActionError] = useState<string>();

  async function run(call: () => Promise<unknown>) {
    try {
      setActionError(undefined);
      await call();
      reload();
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }

  const all = data?.sessions ?? [];
  const upcoming = all.filter((s) => s.session.cancelledAt === null);
  const suggested = nextSessionTitle(all.map((s) => s.session.title));
  const startsAt = startsAtOf(date, time);

  return (
    <div className="vtt-sessions">
      {(error ?? actionError) && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error ?? actionError}
        </div>
      )}
      <div className="vtt-page-head">
        <SectionHeading
          title="Sessions"
          hint={
            showPast
              ? 'Previous sessions.'
              : 'Upcoming sessions. Tap to say whether you can make it.'
          }
        />
        <div className="vtt-page-head-actions">
          <ToolButton
            label={showPast ? 'Hide previous sessions' : 'Show previous sessions'}
            pressed={showPast}
            onClick={() => setShowPast((v) => !v)}
          >
            <History size={16} />
          </ToolButton>
          {dm && !adding && (
            <ToolButton label="Schedule a session" onClick={() => setAdding(true)}>
              <CalendarPlus size={16} />
            </ToolButton>
          )}
        </div>
      </div>
      {data && upcoming.length === 0 && <span className="vtt-muted">No session is scheduled.</span>}
      {upcoming.map((v) => (
        <SessionCard
          key={v.session.id}
          view={v}
          dm={dm}
          onRsvp={(status) =>
            void run(() => campaignApi('PUT', `sessions/${v.session.id}/rsvp`, { status }))
          }
          onSave={(patch) => run(() => campaignApi('PATCH', `sessions/${v.session.id}`, patch))}
          onDelete={() => void run(() => campaignApi('DELETE', `sessions/${v.session.id}`))}
        />
      ))}
      {dm && adding && (
        <form
          className="vtt-session"
          onSubmit={(e) => {
            e.preventDefault();
            if (startsAt === undefined) return;
            void run(() =>
              campaignApi('POST', 'sessions', {
                title: (title ?? suggested).trim(),
                startsAt,
                durationMinutes: duration,
              }),
            ).then(() => {
              setAdding(false);
              setTitle(undefined);
            });
          }}
        >
          <TextField.Root
            size="1"
            aria-label="Title"
            value={title ?? suggested}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="vtt-form-row">
            <DatePicker label="Date" value={date} onChange={setDate} />
            <Dropdown
              label="Start time"
              value={time}
              onChange={setTime}
              options={TIME_OPTIONS.map((t) => ({ value: t, label: t }))}
            />
            <Dropdown
              label="Duration"
              value={String(duration)}
              onChange={(v) => setDuration(Number(v))}
              options={DURATION_OPTIONS.map((d) => ({ value: String(d), label: durationLabel(d) }))}
            />
          </div>
          {startsAt !== undefined && (
            <span className="vtt-muted">{formatRange(startsAt, duration)}</span>
          )}
          <div className="vtt-form-row">
            <ToolButton label="Schedule it" submit text="Schedule">
              <Check size={14} />
            </ToolButton>
            <ToolButton label="Cancel" onClick={() => setAdding(false)}>
              <X size={14} />
            </ToolButton>
          </div>
        </form>
      )}
    </div>
  );
}
