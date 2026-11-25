import { Button, Callout, Flex, Text, TextField } from '@radix-ui/themes';
import {
  BARD_PERSONAS,
  CAMPAIGN_DESCRIPTION_MAX,
  CAMPAIGN_NAME_MAX,
  DEFAULT_BARD,
  validateDetails,
  type BardId,
} from '@vtt-chat-app/shared';
import { useState } from 'react';

import { useLoad } from '../../hooks/useLoad.js';
import { ApiError } from '../../lib/api.js';
import {
  campaigns as loadCampaigns,
  leaveCampaign,
  storytellers,
  updateCampaign,
} from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import { BardBadge } from './BardBadge.js';
import { IconTool } from './IconTool.js';
import { LazyMarkdown } from './LazyMarkdown.js';
import { MarkdownField } from './MarkdownField.js';
import { StorytellerPicker } from './StorytellerPicker.js';

/**
 * The table's own page, opened by tapping its name: the name, the description, who tells the tales, and what you
 * can do about it. Everyone reads it. The Game Master edits the name and description and picks the storyteller; a
 * player can leave. Handing over the DM role and the rest stay in the desktop app.
 */
export function CampaignInfoScreen({
  campaignId,
  onLeft,
}: {
  campaignId: string;
  onLeft: () => void;
}) {
  const campaign = usePhoneStore((s) => s.campaigns.find((c) => c.id === campaignId));
  const dm = campaign?.role === 'dm';
  const teller = useLoad(() => storytellers(campaignId), `${campaignId}:${campaign?.bard ?? ''}`);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (!campaign) return <Text color="gray">This table is not in your list any more.</Text>;

  const chosenId = (campaign.bard ?? DEFAULT_BARD) as BardId;
  const effectiveId = (teller.data?.effective ?? chosenId) as BardId;
  const persona = BARD_PERSONAS.find((b) => b.id === effectiveId) ?? BARD_PERSONAS[0]!;
  const turnedOff = teller.data !== undefined && teller.data.effective !== chosenId;
  const chosenName = BARD_PERSONAS.find((b) => b.id === chosenId)?.name ?? 'That storyteller';

  const refresh = async () => usePhoneStore.getState().setCampaigns(await loadCampaigns());

  async function save() {
    const check = validateDetails(name, description);
    if (!check.ok) return setError(check.message);
    setBusy(true);
    setError(undefined);
    try {
      await updateCampaign(campaignId, { name: name.trim(), description: description.trim() });
      await refresh();
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function pickBard(id: BardId) {
    setBusy(true);
    setError(undefined);
    try {
      await updateCampaign(campaignId, { bard: id });
      await refresh();
      teller.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change the storyteller. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    setError(undefined);
    try {
      await leaveCampaign(campaignId);
      const mine = await loadCampaigns();
      const store = usePhoneStore.getState();
      store.setCampaigns(mine);
      store.pickCampaign(mine[0]?.id);
      onLeft();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not leave. Try again.');
      setBusy(false);
    }
  }

  return (
    <Flex direction="column" gap="4">
      {error && (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}

      {editing ? (
        <Flex direction="column" gap="3">
          <div className="phone-field">
            <label htmlFor="campaign-name" className="phone-label">
              Name
            </label>
            <TextField.Root
              id="campaign-name"
              size="3"
              value={name}
              maxLength={CAMPAIGN_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <MarkdownField
            id="campaign-description"
            label="Description"
            value={description}
            onChange={setDescription}
            max={CAMPAIGN_DESCRIPTION_MAX}
            rows={8}
            placeholder="What is this table about? New players read this on the invite page."
          />
          <Flex gap="2">
            <Button size="3" loading={busy} onClick={() => void save()}>
              Save
            </Button>
            <Button size="3" variant="soft" color="gray" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </Flex>
        </Flex>
      ) : (
        <section className="phone-info-card" aria-label="About this table">
          <Flex justify="between" align="start" gap="3">
            <Text size="5" weight="medium" className="phone-info-name">
              {campaign.name}
            </Text>
            {dm && (
              <IconTool
                small
                label="Edit the name and description"
                icon="pencil"
                onClick={() => {
                  setName(campaign.name);
                  setDescription(campaign.description ?? '');
                  setError(undefined);
                  setEditing(true);
                }}
              />
            )}
          </Flex>
          {campaign.description ? (
            <LazyMarkdown text={campaign.description} />
          ) : (
            <Text color="gray" size="2">
              {dm
                ? 'Add a description so players know what this table is about.'
                : 'The Game Master has not written a description yet.'}
            </Text>
          )}
          <Text size="1" color="gray">
            {dm ? 'You are the Game Master here.' : 'You are a player here.'} Roles belong to each
            table.
          </Text>
        </section>
      )}

      <section className="phone-info-card" aria-label="Storyteller">
        <Text size="1" weight="bold" color="gray" className="phone-info-label">
          Storyteller
        </Text>
        {dm && teller.data ? (
          <StorytellerPicker
            offered={teller.data.offered}
            chosen={chosenId}
            busy={busy}
            onPick={(id) => void pickBard(id)}
          />
        ) : (
          <Flex align="center" gap="3">
            <BardBadge id={effectiveId} size={44} />
            <Flex direction="column">
              <Text weight="medium">{persona.name}</Text>
              <Text size="2" color="gray">
                {persona.blurb}
              </Text>
            </Flex>
          </Flex>
        )}
        {turnedOff && (
          <Text size="1" color="amber">
            {chosenName} is turned off on this server, so {persona.name} tells the tales.
          </Text>
        )}
      </section>

      {!dm && (
        <section className="phone-info-card" aria-label="Leave this table">
          {confirmLeave ? (
            <Flex direction="column" gap="2">
              <Text size="2">Leave {campaign.name}? You can come back with a new invite.</Text>
              <Flex gap="2">
                <Button color="red" loading={busy} onClick={() => void leave()}>
                  Yes, leave
                </Button>
                <Button variant="soft" color="gray" onClick={() => setConfirmLeave(false)}>
                  Cancel
                </Button>
              </Flex>
            </Flex>
          ) : (
            <Flex align="center" justify="between" gap="3">
              <Text size="2" color="gray">
                Leave this table
              </Text>
              <IconTool
                small
                danger
                label="Leave this table…"
                icon="logOut"
                onClick={() => setConfirmLeave(true)}
              />
            </Flex>
          )}
        </section>
      )}
      {dm && (
        <Text size="1" color="gray">
          The Game Master cannot leave: hand over the DM role in the desktop app first.
        </Text>
      )}
    </Flex>
  );
}
