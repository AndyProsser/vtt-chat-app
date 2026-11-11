import { Button, Callout, Flex } from '@radix-ui/themes';
import { useEffect } from 'react';

import { campaigns } from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import { saveCampaign } from '../../lib/phone/storage.js';

/**
 * The answer to a request this person made. Approved: the campaign list is fetched again and the banner offers to
 * switch to it. Declined: a short note (the open-tables list shows the date they can ask again).
 */
export function DecisionBanner() {
  const decision = usePhoneStore((s) => s.decision);
  const name = usePhoneStore((s) => s.campaigns.find((c) => c.id === decision?.campaignId)?.name);

  useEffect(() => {
    if (!decision?.approved) return;
    let current = true;
    campaigns()
      .then((mine) => {
        if (current) usePhoneStore.getState().setCampaigns(mine);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [decision]);

  if (!decision) return null;
  const store = usePhoneStore.getState();
  if (decision.approved && !name) return null;
  return (
    <Callout.Root
      color={decision.approved ? 'violet' : 'gray'}
      className="phone-banner"
      role="status"
      size="1"
    >
      <Flex align="center" justify="between" gap="3" wrap="wrap" style={{ width: '100%' }}>
        <Callout.Text>
          {decision.approved
            ? `You’re in ${name ?? 'a new table'}`
            : 'Not this time. A table turned down your request.'}
        </Callout.Text>
        <Flex gap="2">
          {decision.approved && (
            <Button
              size="1"
              onClick={() => {
                saveCampaign(decision.campaignId);
                store.pickCampaign(decision.campaignId);
                store.dismissDecision();
              }}
            >
              Switch
            </Button>
          )}
          <Button size="1" variant="soft" color="gray" onClick={() => store.dismissDecision()}>
            Dismiss
          </Button>
        </Flex>
      </Flex>
    </Callout.Root>
  );
}
