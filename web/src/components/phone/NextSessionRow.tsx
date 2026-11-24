import { Flex, Text } from '@radix-ui/themes';
import { RSVP_CHOICES, nextSession, whenLabel, type RsvpChoice } from '@vtt-chat-app/shared';
import { useEffect, useState } from 'react';

import { answerRsvp, sessions } from '../../lib/phone/phoneApi.js';
import type { SessionItem } from '../../types/phone.js';
import { Icon, type IconName } from '@vtt-chat-app/ui-kit';

const ICON: Record<RsvpChoice, IconName> = { yes: 'check', late: 'clock', no: 'x' };

/**
 * The next session of one table, with a quick answer (can make it / running late / can't), under the table's card
 * in the picker, so a player can reply without opening the table. Shows nothing when there is no upcoming session
 * or the sessions cannot be read: the picker works without it.
 */
export function NextSessionRow({ campaignId }: { campaignId: string }) {
  const [next, setNext] = useState<SessionItem>();
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    sessions(campaignId)
      .then((list) => alive && setNext(nextSession(list, Date.now())))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [campaignId]);

  if (!next) return null;
  const answer = (status: RsvpChoice) => {
    const before = next.mine;
    setError(false);
    setNext({ ...next, mine: status });
    answerRsvp(campaignId, next.session.id, status).catch(() => {
      setNext((cur) => (cur ? { ...cur, mine: before } : cur));
      setError(true);
    });
  };
  return (
    <Flex align="center" gap="2" className="phone-next-session">
      <Icon name="sessions" size={14} />
      <Text size="2" color="gray" className="phone-next-when">
        {next.session.title} · {whenLabel(next.session.startsAt, Date.now())}
      </Text>
      <span
        className="phone-rsvp"
        role="group"
        aria-label={`Your answer for ${next.session.title}`}
      >
        {RSVP_CHOICES.map((c) => (
          <button
            key={c.status}
            type="button"
            className="phone-rsvp-button"
            aria-label={c.label}
            title={c.label}
            aria-pressed={next.mine === c.status}
            onClick={() => answer(c.status)}
          >
            <Icon name={ICON[c.status]} size={16} />
          </button>
        ))}
      </span>
      {error && (
        <Text size="1" color="red" role="alert">
          Could not save
        </Text>
      )}
    </Flex>
  );
}
