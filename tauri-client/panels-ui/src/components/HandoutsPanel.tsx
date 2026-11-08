import { Button, Callout, Card, Flex, Text } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { accountErrorMessage, campaignApi, campaignFile } from '../lib/tauriBridge.js';
import type { Handout } from '../types/index.js';

function Picture({ id, title }: { id: string; title: string }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    campaignFile(`handouts/${id}/file`)
      .then((s) => !cancelled && setSrc(s))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (failed)
    return (
      <Text size="1" color="gray">
        Could not load the picture.
      </Text>
    );
  return src ? <img src={src} alt={title} style={{ maxWidth: '100%', borderRadius: 6 }} /> : null;
}

function Item({ h, dm, act }: { h: Handout; dm: boolean; act: (p: string) => void }) {
  return (
    <Card>
      <Flex direction="column" gap="2">
        <Flex justify="between" align="center" gap="2">
          <Text weight="bold" size="2">
            {h.title}
          </Text>
          {dm && (
            <Flex gap="1">
              <Button size="1" variant="soft" onClick={() => act(`handouts/${h.id}/show`)}>
                Show all
              </Button>
              <Button
                size="1"
                variant="soft"
                color="gray"
                onClick={() => act(`handouts/${h.id}/hide`)}
              >
                Hide
              </Button>
            </Flex>
          )}
        </Flex>
        {h.kind === 'text' && (
          <Text size="2" style={{ whiteSpace: 'pre-wrap' }}>
            {h.body}
          </Text>
        )}
        {(h.kind === 'image' || h.kind === 'map') && h.hasFile && (
          <Picture id={h.id} title={h.title} />
        )}
        {h.kind === 'pdf' && (
          <Text size="1" color="gray">
            A PDF — open it from the web page.
          </Text>
        )}
      </Flex>
    </Card>
  );
}

export function HandoutsPanel() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const { data, error, reload } = useCampaignQuery<{ handouts: Handout[] }>('handouts', [
    'handout.',
  ]);
  const [actionError, setActionError] = useState<string>();

  async function act(path: string) {
    try {
      setActionError(undefined);
      await campaignApi('POST', path, path.endsWith('/show') ? { to: 'all' } : {});
      reload();
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }

  return (
    <Flex direction="column" gap="2" p="3">
      <Text weight="bold">Handouts</Text>
      {(error ?? actionError) && (
        <Callout.Root color="red" size="1">
          <Callout.Text>{error ?? actionError}</Callout.Text>
        </Callout.Root>
      )}
      {data?.handouts.length === 0 && (
        <Text size="2" color="gray">
          Nothing has been shared yet.
        </Text>
      )}
      {data?.handouts.map((h) => (
        <Item key={h.id} h={h} dm={dm} act={(p) => void act(p)} />
      ))}
    </Flex>
  );
}
