import { useAccount } from '../hooks/useAccount.js';
import { useJoinStore } from '../lib/joinStore.js';

/**
 * "You're in {campaign}": shown when a DM approves a request you made while you were in another
 * campaign. Switching is the same choice as the campaign menu; a "no" is shown in the open-tables list
 * and as a pop-up, not here. Same strip as the update banners.
 */
export function JoinNotice() {
  const decided = useJoinStore((s) => s.decided);
  const dismiss = useJoinStore((s) => s.dismissDecision);
  const account = useAccount();
  if (!decided?.approved) return null;
  const campaign = account.status?.campaigns.find((c) => c.id === decided.campaignId);
  return (
    <div className="vtt-update" role="status">
      <span>You&apos;re in {campaign?.name ?? 'a new campaign'}</span>
      {campaign && (
        <button
          type="button"
          className="vtt-pill"
          disabled={account.busy}
          onClick={() => void account.selectCampaign(campaign.id).then(dismiss)}
        >
          Switch
        </button>
      )}
      <button type="button" className="vtt-pill" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}
