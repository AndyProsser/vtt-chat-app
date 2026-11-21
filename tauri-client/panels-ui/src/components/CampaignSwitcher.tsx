import { Popover, TextField } from '@radix-ui/themes';
import { RSVP_CHOICES, whenLabel, type RsvpChoice } from '@vtt-chat-app/shared';
import { CalendarClock, Check, Clock, Crown, KeyRound, Plus, Swords, X } from 'lucide-react';
import { useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useTableSessions } from '../hooks/useTableSessions.js';
import { useTableStore } from '../lib/tableStore.js';
import { ToolButton } from './ToolButton.js';

const ICONS: Record<RsvpChoice, typeof Check> = { yes: Check, late: Clock, no: X };

/**
 * Which campaign this window is in. A player can be in several (each with its own DM); choosing one
 * leaves the current table and voice room and joins the other. Join with an invite code, or start one.
 */
export function CampaignSwitcher() {
  const account = useAccount();
  const { status } = account;
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const recording = useTableStore((s) => s.recording !== null);
  const { next, rsvp } = useTableSessions(status?.campaigns.map((c) => c.id) ?? [], open);
  const [rsvpError, setRsvpError] = useState<string>();
  if (!status) return null;
  const current = status.campaigns.find((c) => c.id === status.campaignId);
  // A DM cannot leave a campaign that is recording; players come and go.
  const held = recording && current?.role === 'dm';
  const label = current?.name ?? 'Campaign';
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <ToolButton
          label={held ? 'Stop the recording before switching campaigns' : 'Switch campaign'}
          text={label}
        >
          <Swords size={15} />
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content size="1" width="320px" align="start">
        <div className="vtt-groups">
          {status.campaigns.map((c) => {
            const n = next[c.id];
            return (
              <div key={c.id} className="vtt-campaign-row">
                <button
                  type="button"
                  className="vtt-campaign"
                  title={c.name}
                  disabled={account.busy || held || c.id === status.campaignId}
                  onClick={() => void account.selectCampaign(c.id).then(() => setOpen(false))}
                >
                  <span className="vtt-campaign-name">
                    {c.role === 'dm' && <Crown size={13} aria-label="You are the DM" />}
                    <span>{c.name}</span>
                  </span>
                  {c.id === status.campaignId && (
                    <Check size={14} aria-label="Current" className="vtt-campaign-check" />
                  )}
                </button>
                {n && (
                  <div className="vtt-campaign-next">
                    <CalendarClock size={12} aria-hidden="true" />
                    <span className="vtt-campaign-when" title={n.title}>
                      {n.title} · {whenLabel(n.startsAt, Date.now())}
                    </span>
                    <span
                      className="vtt-rsvp"
                      role="group"
                      aria-label={`Your answer for ${n.title}`}
                    >
                      {RSVP_CHOICES.map((choice) => {
                        const Icon = ICONS[choice.status];
                        return (
                          <button
                            key={choice.status}
                            type="button"
                            className="vtt-rsvp-button"
                            aria-label={choice.label}
                            title={choice.label}
                            aria-pressed={n.mine === choice.status}
                            onClick={() => {
                              setRsvpError(undefined);
                              void rsvp(c.id, n.id, choice.status).catch(() =>
                                setRsvpError('Could not save your answer.'),
                              );
                            }}
                          >
                            <Icon size={12} />
                          </button>
                        );
                      })}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          <form
            className="vtt-form-row"
            onSubmit={(e) => {
              e.preventDefault();
              void account.addCampaign('join', code).then(() => setCode(''));
            }}
          >
            <TextField.Root
              size="1"
              style={{ flex: 1 }}
              aria-label="Invite code"
              placeholder="Invite code…"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <ToolButton
              label="Join with this code"
              submit
              disabled={code.trim() === '' || account.busy || held}
            >
              <KeyRound size={14} />
            </ToolButton>
          </form>
          <form
            className="vtt-form-row"
            onSubmit={(e) => {
              e.preventDefault();
              void account.addCampaign('create', name).then(() => setName(''));
            }}
          >
            <TextField.Root
              size="1"
              style={{ flex: 1 }}
              aria-label="New campaign"
              placeholder="New campaign (you will be its DM)…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <ToolButton
              label="Create it"
              submit
              disabled={name.trim() === '' || account.busy || held}
            >
              <Plus size={14} />
            </ToolButton>
          </form>
          {held && (
            <span className="vtt-muted">
              A recording is running. Stop it before switching campaigns.
            </span>
          )}
          {rsvpError && (
            <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
              {rsvpError}
            </div>
          )}
          {account.error && (
            <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
              {account.error}
            </div>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
