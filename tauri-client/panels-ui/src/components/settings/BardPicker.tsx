import { BARD_PERSONAS, DEFAULT_BARD, type BardId } from '@vtt-chat-app/shared';
import { Button, Callout } from '@radix-ui/themes';
import { Check, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import type { CampaignSummary } from '../../types/index.js';

/**
 * Who tells this campaign's tales: one of five preset bards, the same for every session. The Game Master chooses;
 * everyone else reads the choice. Stored and shown from 0.6.0 (the AI work makes it do something). The drunkard
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
        <span className="vtt-muted">
          {current.name}: {current.blurb}
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
      <div className="vtt-bards" role="radiogroup" aria-label="Storyteller">
        {BARD_PERSONAS.map((b) => {
          const on = b.id === current.id;
          return (
            <div key={b.id} className="vtt-bard-wrap">
              <button
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                className={`vtt-bard${on ? ' vtt-bard-on' : ''}`}
                onClick={() => pick(b.id)}
              >
                <span className="vtt-bard-tick">{on && <Check size={14} />}</span>
                <span className="vtt-bard-text">
                  <b>{b.name}</b>
                  <small>
                    {b.blurb}
                    {b.id === DEFAULT_BARD ? ' (the default)' : ''}
                  </small>
                </span>
              </button>
              {asking === b.id && b.warning && (
                <Callout.Root color="amber" size="1">
                  <Callout.Icon>
                    <TriangleAlert size={14} />
                  </Callout.Icon>
                  <Callout.Text>
                    {b.warning}
                    <span className="vtt-form-row" style={{ marginTop: 6 }}>
                      <Button size="1" loading={busy} onClick={() => void choose(b.id)}>
                        Choose the Drunken Bard
                      </Button>
                      <Button
                        size="1"
                        variant="soft"
                        color="gray"
                        onClick={() => setAsking(undefined)}
                      >
                        Cancel
                      </Button>
                    </span>
                  </Callout.Text>
                </Callout.Root>
              )}
            </div>
          );
        })}
      </div>
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
