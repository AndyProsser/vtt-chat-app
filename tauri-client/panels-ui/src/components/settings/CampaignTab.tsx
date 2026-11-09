import { useAccount } from '../../hooks/useAccount.js';
import { useTableFeed } from '../../hooks/useTableFeed.js';
import { isDm } from '../../lib/tableModel.js';
import { useTableStore } from '../../lib/tableStore.js';
import { CampaignSection } from './CampaignSection.js';
import { CharacterSection } from './CharacterSection.js';

/**
 * The campaign and your character in it, together. The DM does not play a character, so they see only
 * the campaign tools; the character panel appears when they swap to being a player.
 */
export function CampaignTab() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  return (
    <>
      <CampaignSection />
      {!dm && <CharacterSection />}
    </>
  );
}
