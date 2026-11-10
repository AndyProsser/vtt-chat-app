import { Popover } from '@radix-ui/themes';
import { Check, Crown, KeyRound, Plus, Swords } from 'lucide-react';
import { useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useTableStore } from '../lib/tableStore.js';
import { ToolButton } from './ToolButton.js';

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
      <Popover.Content size="1" width="300px" align="start">
        <div className="vtt-groups">
          {status.campaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              className="vtt-campaign"
              disabled={account.busy || held || c.id === status.campaignId}
              onClick={() => void account.selectCampaign(c.id).then(() => setOpen(false))}
            >
              <span>
                {c.role === 'dm' && <Crown size={13} aria-label="You are the DM" />} {c.name}
              </span>
              {c.id === status.campaignId && <Check size={14} aria-label="Current" />}
            </button>
          ))}
          <form
            className="vtt-form-row"
            onSubmit={(e) => {
              e.preventDefault();
              void account.addCampaign('join', code).then(() => setCode(''));
            }}
          >
            <input
              className="vtt-input"
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
            <input
              className="vtt-input"
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
