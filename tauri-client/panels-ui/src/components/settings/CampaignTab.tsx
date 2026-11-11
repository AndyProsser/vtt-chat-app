import { Button, Flex } from '@radix-ui/themes';
import { ArrowLeft, Compass } from 'lucide-react';
import { useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { isDm } from '../../lib/tableModel.js';
import { useTableStore } from '../../lib/tableStore.js';
import { CampaignSection } from './CampaignSection.js';
import { CharacterSection } from './CharacterSection.js';
import { JoinRequestsSection } from './JoinRequestsSection.js';
import { OpenCampaigns } from './OpenCampaigns.js';

/**
 * The campaign and your character in it, together. The DM does not play a character, so they see only
 * the campaign tools (and the join requests); the character panel appears when they swap to being a
 * player. "Find another table" swaps the tab for the list of tables open to requests, with a way back.
 */
export function CampaignTab() {
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const [finding, setFinding] = useState(false);
  if (finding) {
    return (
      <>
        <Button size="1" variant="ghost" color="gray" onClick={() => setFinding(false)}>
          <ArrowLeft size={14} /> Back
        </Button>
        <OpenCampaigns />
      </>
    );
  }
  return (
    <>
      <CampaignSection />
      {dm && status?.campaignId && <JoinRequestsSection campaignId={status.campaignId} />}
      {!dm && <CharacterSection />}
      <Flex className="vtt-settings-section">
        <Button size="1" variant="soft" onClick={() => setFinding(true)}>
          <Compass size={14} /> Find another table
        </Button>
      </Flex>
    </>
  );
}
