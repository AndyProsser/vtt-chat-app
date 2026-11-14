import { Popover } from '@radix-ui/themes';
import { Activity, ArrowLeft, Menu, Power, ScrollText, Settings } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { pendingCount } from '../lib/joinRequests.js';
import { useJoinStore } from '../lib/joinStore.js';
import { appQuit, panelOpen } from '../lib/tauriBridge.js';
import { ConnectionPanel } from './ConnectionPanel.js';
import { SettingsContent } from './SettingsWindow.js';
import { ToolButton } from './ToolButton.js';

type View = 'menu' | 'settings' | 'quality';

function Item({
  icon,
  label,
  onClick,
  badge,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  badge?: number;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={danger ? 'vtt-menu-item vtt-menu-danger' : 'vtt-menu-item'}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {badge ? (
        <span className="vtt-tab-badge" aria-label={`${badge} waiting`}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The burger menu at the right of the top bar: the things you reach for rarely (session history, the DM's connection quality,
 * settings, quit), so the bar keeps room for the record timer and the table tools. Settings and the connection view open inside
 * the same popover with a back arrow. Your status is the pill above the microphone, not here.
 */
export function MainMenu({ dm }: { dm: boolean }) {
  const waiting = useJoinStore((s) => pendingCount(s.inbox));
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('menu');
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setView('menu');
      }}
    >
      <Popover.Trigger>
        <ToolButton
          label={
            waiting > 0
              ? `Menu (${waiting} join request${waiting === 1 ? '' : 's'})`
              : 'Menu: history, settings, quit'
          }
          className="vtt-cog"
        >
          <Menu size={15} />
          {waiting > 0 && <span className="vtt-cog-dot" aria-hidden />}
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content
        size="1"
        align="end"
        className={view === 'settings' ? 'vtt-settings-pop' : 'vtt-menu-pop'}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {view === 'menu' ? (
          <nav className="vtt-menu" aria-label="Menu">
            <Item
              icon={<ScrollText size={14} />}
              label="Session history"
              onClick={() => {
                void panelOpen('history');
                setOpen(false);
              }}
            />
            {dm && (
              <Item
                icon={<Activity size={14} />}
                label="Connection quality"
                onClick={() => setView('quality')}
              />
            )}
            <Item
              icon={<Settings size={14} />}
              label="Settings"
              badge={waiting}
              onClick={() => setView('settings')}
            />
            <hr className="vtt-menu-sep" />
            <Item
              icon={<Power size={14} />}
              label="Quit VTT Chat"
              danger
              onClick={() => void appQuit()}
            />
          </nav>
        ) : (
          <>
            <button type="button" className="vtt-menu-back" onClick={() => setView('menu')}>
              <ArrowLeft size={14} aria-hidden /> Menu
            </button>
            {view === 'settings' ? <SettingsContent /> : <ConnectionPanel />}
          </>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
