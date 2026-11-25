import { BARD_IDS, DEFAULT_BARD, type BardId } from '@vtt-chat-app/shared';
import { pickQuip, type Quip } from '@vtt-chat-app/ui-kit';
import { ChevronRight, Crown } from 'lucide-react';
import { useState } from 'react';

import { campaignBlurb } from '../lib/campaignBlurb.js';
import type { CampaignSummary } from '../types/index.js';
import { BardAvatar } from './settings/BardAvatar.js';

let lastQuip: Quip | undefined;

const bardOf = (id: string): BardId =>
  (BARD_IDS as readonly string[]).includes(id) ? (id as BardId) : DEFAULT_BARD;

/**
 * Which campaign to open, when a person is in more than one: a card for each (its storyteller's badge, its name, a line
 * of its description, the crown if they run it), and a dry word from someone who never existed. The word is chosen once
 * per visit and never the one shown last time.
 */
export function CampaignChooser({
  campaigns,
  name,
  busy,
  onChoose,
}: {
  campaigns: CampaignSummary[];
  name: string | null;
  busy: boolean;
  onChoose: (id: string) => void;
}) {
  const [quip] = useState(() => (lastQuip = pickQuip(Math.random, lastQuip)));
  return (
    <div className="vtt-chooser">
      <header className="vtt-chooser-head">
        <h2>Choose a campaign</h2>
        <p>{name ? `Welcome back, ${name}. The table is waiting.` : 'The table is waiting.'}</p>
      </header>
      <ul className="vtt-chooser-list">
        {campaigns.map((c) => {
          const dm = c.role === 'dm';
          const blurb = campaignBlurb(c.description);
          return (
            <li key={c.id}>
              <button
                type="button"
                className="vtt-camp-card"
                disabled={busy}
                onClick={() => onChoose(c.id)}
              >
                <BardAvatar id={bardOf(c.bard)} size={38} />
                <span className="vtt-camp-text">
                  <b>{c.name}</b>
                  <small>{blurb || (dm ? 'You run this one.' : 'You play in this one.')}</small>
                </span>
                {dm && (
                  <span className="vtt-camp-dm" title="You are the Dungeon Master here">
                    <Crown size={13} aria-hidden /> DM
                  </span>
                )}
                <ChevronRight size={18} className="vtt-camp-go" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <figure className="vtt-quip">
        <blockquote>{`“${quip.quote}”`}</blockquote>
        <figcaption>{`— ${quip.by}`}</figcaption>
      </figure>
    </div>
  );
}
