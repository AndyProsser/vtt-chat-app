import { Button } from '@radix-ui/themes';
import { Copy, Crown, LogOut, RotateCcw, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { inviteLink, inviteMessage, otherPlayers } from '../../lib/invites.js';
import { isDm } from '../../lib/tableModel.js';
import { useTableStore } from '../../lib/tableStore.js';
import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import { MemberAvatar } from '../MemberAvatar.js';
import { CampaignDetails } from './CampaignDetails.js';
import { ToolButton } from '../ToolButton.js';

/**
 * This campaign's own tools. Roles are per campaign: the DM here may be a player elsewhere. The DM
 * invites people and can swap places with a player (the old DM becomes a player); anyone can leave.
 * System-wide administration is not here: that is the `vtt-admin` command line.
 */
export function CampaignSection() {
  const account = useAccount();
  const { status } = account;
  const members = useTableStore((s) => s.members);
  const selfId = status?.userId ?? null;
  const dm = isDm(members, selfId);
  const recording = useTableStore((s) => s.recording !== null);
  const campaign = status?.campaigns.find((c) => c.id === status.campaignId);
  const [link, setLink] = useState<string>();
  const [note, setNote] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<string>();
  const [error, setError] = useState<string>();

  async function run(call: () => Promise<unknown>) {
    try {
      setError(undefined);
      await call();
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }

  if (!campaign) return <span className="vtt-muted">Choose a campaign first.</span>;
  return (
    <div className="vtt-sessions">
      <CampaignDetails
        campaign={campaign}
        dm={dm}
        onSaved={() => account.addCampaign('refresh', '')}
      />
      <span className="vtt-muted">
        {dm ? 'You are the DM here.' : 'You are a player here.'} Roles belong to each campaign.
      </span>
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      {dm && (
        <section className="vtt-session">
          <div className="vtt-session-head">
            <b>Invite someone</b>
            <ToolButton
              label="Make an invite link (works for the whole group until it expires)"
              onClick={() =>
                void run(async () => {
                  const r = await campaignApi<{ code: string }>('POST', 'invites', {});
                  setNote(undefined);
                  setLink(inviteLink(status?.server ?? '', r.code));
                })
              }
            >
              <UserPlus size={14} />
            </ToolButton>
          </div>
          <span className="vtt-muted">
            One link works for the whole group until it expires. Paste it into your group chat.
          </span>
          {note && <span className="vtt-muted">{note}</span>}
          {link && (
            <>
              <div className="vtt-form-row">
                <code className="vtt-code">{link}</code>
                <ToolButton
                  label="Copy just the link"
                  onClick={() => void navigator.clipboard?.writeText(link)}
                >
                  <Copy size={14} />
                </ToolButton>
              </div>
              <div className="vtt-form-row">
                <Button
                  size="1"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      inviteMessage({
                        campaignName: campaign.name,
                        dmName: status?.displayName ?? undefined,
                        link,
                      }),
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? 'Copied' : 'Copy invite message'}
                </Button>
              </div>
            </>
          )}
          <div className="vtt-session-head">
            <span className="vtt-muted">Stop every invite link that is still in use.</span>
            {confirm === 'reset-invites' ? (
              <span className="vtt-form-row">
                <ToolButton
                  label="Yes, stop all invite links"
                  danger
                  onClick={() =>
                    void run(async () => {
                      await campaignApi('DELETE', 'invites');
                      setLink(undefined);
                      setConfirm(undefined);
                      setNote(
                        'Every invite link has stopped working. Make a new one when you need it.',
                      );
                    })
                  }
                >
                  <RotateCcw size={14} />
                </ToolButton>
                <ToolButton label="Cancel" onClick={() => setConfirm(undefined)}>
                  ×
                </ToolButton>
              </span>
            ) : (
              <ToolButton label="Reset invite links…" onClick={() => setConfirm('reset-invites')}>
                <RotateCcw size={14} />
              </ToolButton>
            )}
          </div>
        </section>
      )}
      {dm && (
        <section className="vtt-session">
          <b>Hand over the DM role</b>
          <span className="vtt-muted">
            {recording
              ? 'A recording is running. Stop it before handing over the DM role.'
              : 'You and the player swap places; you become a player.'}
          </span>
          {otherPlayers(members, selfId).length === 0 && (
            <span className="vtt-muted">No other players yet.</span>
          )}
          {otherPlayers(members, selfId).map((m) => {
            const label = m.character?.name ?? m.displayName;
            return (
              <div key={m.userId} className="vtt-groups-row">
                <span className="vtt-member-line">
                  <MemberAvatar member={m} />
                  {label}
                </span>
                {confirm === m.userId ? (
                  <span className="vtt-form-row">
                    <ToolButton
                      label={`Yes, make ${label} the DM`}
                      danger
                      onClick={() =>
                        void run(async () => {
                          await campaignApi('POST', 'dm-swap', { newDmUserId: m.userId });
                          setConfirm(undefined);
                          await account.addCampaign('refresh', '');
                        })
                      }
                    >
                      <Crown size={14} />
                    </ToolButton>
                    <ToolButton label="Cancel" onClick={() => setConfirm(undefined)}>
                      ×
                    </ToolButton>
                  </span>
                ) : (
                  <ToolButton
                    label={`Make ${label} the DM…`}
                    disabled={recording}
                    onClick={() => setConfirm(m.userId)}
                  >
                    <Crown size={14} />
                  </ToolButton>
                )}
              </div>
            );
          })}
        </section>
      )}
      <section className="vtt-session">
        <div className="vtt-session-head">
          <b>Leave this campaign</b>
          {confirm === 'leave' ? (
            <span className="vtt-form-row">
              <ToolButton
                label="Yes, leave"
                danger
                onClick={() =>
                  void run(async () => {
                    await campaignApi('POST', 'leave', {});
                    await account.addCampaign('refresh', '');
                  })
                }
              >
                <LogOut size={14} />
              </ToolButton>
              <ToolButton label="Cancel" onClick={() => setConfirm(undefined)}>
                ×
              </ToolButton>
            </span>
          ) : (
            <ToolButton
              label={dm ? 'Hand over the DM role before you can leave' : 'Leave this campaign…'}
              danger
              disabled={dm}
              onClick={() => setConfirm('leave')}
            >
              <LogOut size={14} />
            </ToolButton>
          )}
        </div>
        <span className="vtt-muted">
          {dm
            ? 'The DM cannot leave until another player has been made the DM (above): a campaign always has one.'
            : 'Your characters and history here stay with the campaign.'}
        </span>
      </section>
    </div>
  );
}
