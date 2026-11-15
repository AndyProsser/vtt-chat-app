import { Button, TextField } from '@radix-ui/themes';
import { Pencil } from 'lucide-react';
import { useState } from 'react';

import {
  CAMPAIGN_DESCRIPTION_MAX,
  CAMPAIGN_NAME_MAX,
  characterCount,
  validateDetails,
} from '../../lib/campaignDetails.js';
import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import type { CampaignSummary } from '../../types/index.js';
import { MarkdownEditor } from '../MarkdownEditor.js';
import { MarkdownView } from '../MarkdownView.js';
import { ToolButton } from '../ToolButton.js';

/**
 * The campaign's name and description. Everyone reads them here; the DM can edit them. The description is
 * also what a new player sees on the invite page, so the editor says who can read it. After a save the
 * server tells every connected client (`campaign.updated`), so the new name shows up everywhere.
 */
export function CampaignDetails({
  campaign,
  dm,
  onSaved,
}: {
  campaign: CampaignSummary;
  dm: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function startEditing() {
    setName(campaign.name);
    setDescription(campaign.description);
    setError(undefined);
    setEditing(true);
  }

  async function save() {
    const check = validateDetails(name, description);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await campaignApi('PATCH', '', { name, description });
      await onSaved();
      setEditing(false);
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    const count = characterCount(description.trim());
    return (
      <form
        className="vtt-session"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField.Root
          aria-label="Campaign name"
          value={name}
          maxLength={CAMPAIGN_NAME_MAX * 2}
          onChange={(e) => setName(e.target.value)}
        />
        <MarkdownEditor value={description} onChange={setDescription} />
        <span className={count > CAMPAIGN_DESCRIPTION_MAX ? 'vtt-composer-error' : 'vtt-muted'}>
          {count} / {CAMPAIGN_DESCRIPTION_MAX}. Anyone with an invite link can read this, so keep
          secrets out of it.
        </span>
        {error && (
          <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
            {error}
          </div>
        )}
        <div className="vtt-form-row">
          <Button size="1" type="submit" loading={busy}>
            Save
          </Button>
          <Button
            size="1"
            type="button"
            variant="soft"
            color="gray"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="vtt-sessions">
      <div className="vtt-session-head">
        <b className="vtt-head">{campaign.name}</b>
        {dm && (
          <ToolButton label="Edit name and description" onClick={startEditing}>
            <Pencil size={14} />
          </ToolButton>
        )}
      </div>
      {campaign.description ? (
        <MarkdownView text={campaign.description} />
      ) : (
        dm && (
          <span className="vtt-muted">
            Add a description so players know what this table is about.
          </span>
        )
      )}
    </div>
  );
}
