import { BARD_PERSONAS, DEFAULT_BARD, type BardId } from '@vtt-chat-app/shared';
import { Button, Callout, Select } from '@radix-ui/themes';
import { TriangleAlert } from 'lucide-react';

import { BardAvatar } from './BardAvatar.js';
import { useState } from 'react';

import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import type { CampaignSummary } from '../../types/index.js';

/**
 * Who tells this campaign's tales: one of five preset bards, the same for every session. The Game Master chooses;
 * everyone else reads the choice. Stored and shown from 0.6.0 (the AI work makes it do something). The tipsy minstrel
 * says what it means right where it is chosen, and needs a second click: that persona may let Game Master secrets
 * slip into the tale on purpose.
 */
export function BardPicker({
  campaign,
  dm,
  onSaved,
}: {
  campaign: CampaignSummary;
  dm: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const current = BARD_PERSONAS.find((b) => b.id === campaign.bard) ?? BARD_PERSONAS[0]!;
  const [asking, setAsking] = useState<BardId>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function choose(bard: BardId) {
    setBusy(true);
    setError(undefined);
    try {
      await campaignApi('PATCH', '', { bard });
      await onSaved();
      setAsking(undefined);
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function pick(id: BardId) {
    if (id === current.id) return;
    const persona = BARD_PERSONAS.find((b) => b.id === id);
    if (persona?.warning) setAsking(id);
    else void choose(id);
  }

  if (!dm) {
    return (
      <section className="vtt-session">
        <b>Storyteller</b>
        <span className="vtt-bard-text vtt-bard-readonly">
          <BardAvatar id={current.id} />
          <span className="vtt-bard-text">
            <b>{current.name}</b>
            <small>{current.blurb}</small>
          </span>
        </span>
      </section>
    );
  }
  return (
    <section className="vtt-session">
      <b>Storyteller</b>
      <span className="vtt-muted">
        The bard who tells each session&apos;s tale, as if following the party around. Same bard for
        every session.
      </span>
      <Select.Root
        size="2"
        value={current.id}
        disabled={busy}
        onValueChange={(v) => pick(v as BardId)}
      >
        <Select.Trigger aria-label="Storyteller" className="vtt-bard-trigger" />
        <Select.Content position="popper">
          {BARD_PERSONAS.map((b) => (
            <Select.Item key={b.id} value={b.id} className="vtt-bard-item">
              <BardAvatar id={b.id} />
              <span className="vtt-bard-text">
                <b>{b.name}</b>
                <small>
                  {b.blurb}
                  {b.id === DEFAULT_BARD ? ' (the default)' : ''}
                </small>
              </span>
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <span className="vtt-muted">{current.blurb}</span>
      {asking && (
        <Callout.Root color="amber" size="1">
          <Callout.Icon>
            <TriangleAlert size={14} />
          </Callout.Icon>
          <Callout.Text>
            {BARD_PERSONAS.find((b) => b.id === asking)?.warning}
            <span className="vtt-form-row" style={{ marginTop: 6 }}>
              <Button size="1" loading={busy} onClick={() => void choose(asking)}>
                Choose {BARD_PERSONAS.find((b) => b.id === asking)?.name}
              </Button>
              <Button size="1" variant="soft" color="gray" onClick={() => setAsking(undefined)}>
                Cancel
              </Button>
            </span>
          </Callout.Text>
        </Callout.Root>
      )}
      {current.warning && (
        <span className="vtt-muted">
          <TriangleAlert size={12} /> {current.warning}
        </span>
      )}
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </section>
  );
}
