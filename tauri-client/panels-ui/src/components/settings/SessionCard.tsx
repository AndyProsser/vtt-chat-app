import { CalendarClock, Check, Clock, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import {
  DURATION_OPTIONS,
  TIME_OPTIONS,
  attendanceOpen,
  canDelete,
  formatRange,
  slotOf,
  startsAtOf,
} from '../../lib/schedule.js';
import type { RsvpStatus, SessionView } from '../../types/index.js';
import { MarkdownEditor } from '../MarkdownEditor.js';
import { MarkdownView } from '../MarkdownView.js';
import { ToolButton } from '../ToolButton.js';

const RSVP: { status: RsvpStatus; label: string; icon: typeof Check }[] = [
  { status: 'yes', label: 'Can make it', icon: Check },
  { status: 'late', label: 'Running late', icon: Clock },
  { status: 'no', label: "Can't make it", icon: X },
];

export const durationLabel = (m: number) =>
  m % 60 === 0 ? `${m / 60} h` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h 30`;

/**
 * One session. Attendance is top right; Edit and Delete are bottom right. The DM can edit any session
 * (name, start, length, a Markdown note) but delete only one that has not started.
 */
export function SessionCard({
  view,
  dm,
  onRsvp,
  onSave,
  onDelete,
}: {
  view: SessionView;
  dm: boolean;
  onRsvp: (status: RsvpStatus) => void;
  onSave: (patch: {
    title: string;
    startsAt: number;
    durationMinutes: number;
    notes: string;
  }) => Promise<void>;
  onDelete: () => void;
}) {
  const { session } = view;
  const now = Date.now();
  const open = attendanceOpen(session.startsAt, now);
  const [editing, setEditing] = useState(false);
  const initial = slotOf(session.startsAt);
  const [title, setTitle] = useState(session.title);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(session.durationMinutes);
  const [notes, setNotes] = useState(session.notes);
  const startsAt = startsAtOf(date, time);
  const times = TIME_OPTIONS.includes(time) ? TIME_OPTIONS : [...TIME_OPTIONS, time].sort();
  const durations = DURATION_OPTIONS.includes(duration)
    ? DURATION_OPTIONS
    : [...DURATION_OPTIONS, duration].sort((a, b) => a - b);

  function begin() {
    const slot = slotOf(session.startsAt);
    setTitle(session.title);
    setDate(slot.date);
    setTime(slot.time);
    setDuration(session.durationMinutes);
    setNotes(session.notes);
    setEditing(true);
  }

  if (editing) {
    return (
      <form
        className="vtt-session"
        onSubmit={(e) => {
          e.preventDefault();
          if (startsAt === undefined || title.trim() === '') return;
          void onSave({
            title: title.trim(),
            startsAt,
            durationMinutes: duration,
            notes,
          }).then(() => setEditing(false));
        }}
      >
        <input
          className="vtt-input"
          aria-label="Title"
          value={title}
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
            {times.map((t) => (
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
            {durations.map((d) => (
              <option key={d} value={d}>
                {durationLabel(d)}
              </option>
            ))}
          </select>
        </div>
        {startsAt !== undefined && (
          <span className="vtt-muted">{formatRange(startsAt, duration)}</span>
        )}
        <MarkdownEditor value={notes} onChange={setNotes} />
        <div className="vtt-session-foot">
          <ToolButton label="Cancel" onClick={() => setEditing(false)}>
            <X size={14} />
          </ToolButton>
          <ToolButton
            label="Save the changes"
            submit
            disabled={startsAt === undefined || title.trim() === ''}
          >
            <Check size={14} />
          </ToolButton>
        </div>
      </form>
    );
  }

  return (
    <div className="vtt-session">
      <div className="vtt-session-head">
        <b>{session.title}</b>
        <div className="vtt-rsvp">
          {RSVP.map(({ status: s, label, icon: Icon }) => (
            <ToolButton
              key={s}
              label={open ? label : `${label} (attendance is closed: it started over 4 hours ago)`}
              disabled={!open}
              pressed={view.mine === s}
              text={String(view.counts[s])}
              onClick={() => onRsvp(s)}
            >
              <Icon size={14} />
            </ToolButton>
          ))}
        </div>
      </div>
      <span className="vtt-muted">
        <CalendarClock size={13} style={{ verticalAlign: '-2px' }} />{' '}
        {formatRange(session.startsAt, session.durationMinutes)}
      </span>
      {session.notes && <MarkdownView text={session.notes} />}
      {dm && (
        <div className="vtt-session-foot">
          <ToolButton label="Edit this session" onClick={begin}>
            <Pencil size={14} />
          </ToolButton>
          {canDelete(session.startsAt, now) && (
            <ToolButton label="Cancel this session" danger onClick={onDelete}>
              <Trash2 size={14} />
            </ToolButton>
          )}
        </div>
      )}
    </div>
  );
}
