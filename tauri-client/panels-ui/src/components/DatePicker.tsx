import { Popover } from '@radix-ui/themes';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { monthGrid, parseIso, shiftMonth, toIso } from '../lib/calendar.js';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** A date control in the app's own style: a button that opens a small month calendar (never the OS date popup). */
export function DatePicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (iso: string) => void;
  label: string;
}) {
  const picked = parseIso(value);
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(
    picked ?? { year: today.getFullYear(), month: today.getMonth() },
  );
  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());
  const title = new Date(shown.year, shown.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const go = (delta: number) => setShown((s) => shiftMonth(s.year, s.month, delta));
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && picked) setShown({ year: picked.year, month: picked.month });
      }}
    >
      <Popover.Trigger>
        <button type="button" className="vtt-select vtt-select-button" aria-label={label}>
          <CalendarDays size={12} aria-hidden />
          {picked
            ? new Date(picked.year, picked.month, picked.day).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : 'Pick a date'}
        </button>
      </Popover.Trigger>
      <Popover.Content size="1" width="240px" align="start">
        <div className="vtt-cal">
          <div className="vtt-cal-head">
            <button
              type="button"
              className="vtt-cal-nav"
              aria-label="Previous month"
              onClick={() => go(-1)}
            >
              <ChevronLeft size={14} />
            </button>
            <b>{title}</b>
            <button
              type="button"
              className="vtt-cal-nav"
              aria-label="Next month"
              onClick={() => go(1)}
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="vtt-cal-grid" role="grid" aria-label={title}>
            {WEEKDAYS.map((d) => (
              <span key={d} className="vtt-cal-dow">
                {d}
              </span>
            ))}
            {monthGrid(shown.year, shown.month)
              .flat()
              .map((day, i) => {
                if (day === null) return <span key={i} />;
                const iso = toIso(shown.year, shown.month, day);
                return (
                  <button
                    key={i}
                    type="button"
                    className="vtt-cal-day"
                    aria-pressed={iso === value}
                    data-today={iso === todayIso || undefined}
                    onClick={() => {
                      onChange(iso);
                      setOpen(false);
                    }}
                  >
                    {day}
                  </button>
                );
              })}
          </div>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
