import { CalendarClock, Check, Clock, History, NotebookPen, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { useCampaignQuery } from '../../hooks/useCampaignQuery.js';
import {
  DEFAULT_DURATION,
  DURATION_OPTIONS,
  TIME_OPTIONS,
  defaultSlot,
  attendanceOpen,
  formatRange,
  nextSessionTitle,
  startsAtOf,
} from '../../lib/schedule.js';
import { isDm } from '../../lib/tableModel.js';
import { useTableStore } from '../../lib/tableStore.js';
import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import type { RsvpStatus, SessionView } from '../../types/index.js';
import { MarkdownEditor } from '../MarkdownEditor.js';
import { MarkdownView } from '../MarkdownView.js';
import { ToolButton } from '../ToolButton.js';

const RSVP: { status: RsvpStatus; label: string; icon: typeof Check }[] = [
  { status: 'yes', label: 'Can make it', icon: Check },
  { status: 'late', label: 'Running late', icon: Clock },
  { status: 'no', label: "Can't make it", icon: X },
];

const durationLabel = (m: number) =>
  m % 60 === 0 ? `${m / 60} h` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h 30`;

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
  const [noteFor, setNoteFor] = useState<string>();
  const [noteDraft, setNoteDraft] = useState('');
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
      <div>
        <ToolButton
          label={showPast ? 'Hide previous sessions' : 'Show previous sessions'}
          pressed={showPast}
          onClick={() => setShowPast((v) => !v)}
        >
          <History size={14} />
        </ToolButton>
      </div>
      {data && upcoming.length === 0 && <span className="vtt-muted">No session is scheduled.</span>}
      {upcoming.map((v) => {
        const open = attendanceOpen(v.session.startsAt, Date.now());
        return (
          <div key={v.session.id} className="vtt-session">
            <div className="vtt-session-head">
              <b>{v.session.title}</b>
              {dm && (
                <ToolButton
                  label="Cancel this session"
                  danger
                  onClick={() => void run(() => campaignApi('DELETE', `sessions/${v.session.id}`))}
                >
                  <Trash2 size={14} />
                </ToolButton>
              )}
            </div>
            <span className="vtt-muted">
              <CalendarClock size={13} style={{ verticalAlign: '-2px' }} />{' '}
              {formatRange(v.session.startsAt, v.session.durationMinutes)}
            </span>
            {noteFor === v.session.id ? (
              <>
                <MarkdownEditor value={noteDraft} onChange={setNoteDraft} />
                <div className="vtt-form-row">
                  <ToolButton
                    label="Save the note"
                    onClick={() =>
                      void run(async () => {
                        await campaignApi('PATCH', `sessions/${v.session.id}`, {
                          notes: noteDraft,
                        });
                        setNoteFor(undefined);
                      })
                    }
                  >
                    <Check size={14} />
                  </ToolButton>
                  <ToolButton label="Cancel" onClick={() => setNoteFor(undefined)}>
                    <X size={14} />
                  </ToolButton>
                </div>
              </>
            ) : (
              <>
                {v.session.notes && <MarkdownView text={v.session.notes} />}
                {dm && (
                  <div>
                    <ToolButton
                      label={v.session.notes ? 'Edit the note' : 'Add a note for this session'}
                      onClick={() => {
                        setNoteFor(v.session.id);
                        setNoteDraft(v.session.notes);
                      }}
                    >
                      <NotebookPen size={14} />
                    </ToolButton>
                  </div>
                )}
              </>
            )}
            <div className="vtt-rsvp">
              {RSVP.map(({ status: s, label, icon: Icon }) => (
                <ToolButton
                  key={s}
                  label={
                    open
                      ? label
                      : `${label} (attendance is closed: the session started over 4 hours ago)`
                  }
                  disabled={!open}
                  pressed={v.mine === s}
                  text={String(v.counts[s])}
                  onClick={() =>
                    void run(() =>
                      campaignApi('PUT', `sessions/${v.session.id}/rsvp`, { status: s }),
                    )
                  }
                >
                  <Icon size={14} />
                </ToolButton>
              ))}
            </div>
          </div>
        );
      })}
      {dm && !adding && (
        <div>
          <ToolButton label="Schedule a session" onClick={() => setAdding(true)} text="Schedule">
            <Plus size={14} />
          </ToolButton>
        </div>
      )}
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
          <input
            className="vtt-input"
            aria-label="Title"
            value={title ?? suggested}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="vtt-form-row">
            <input
              className="vtt-date"
              type="date"
              aria-label="Date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <select
              className="vtt-select"
              aria-label="Start time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className="vtt-select"
              aria-label="Duration"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {durationLabel(d)}
                </option>
              ))}
            </select>
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
