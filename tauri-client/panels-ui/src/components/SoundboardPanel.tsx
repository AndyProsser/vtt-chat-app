import { Button, Callout, Card, Flex, Slider, Text } from '@radix-ui/themes';
import { useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { accountErrorMessage, syncCommand } from '../lib/tauriBridge.js';
import type { SoundLibrary } from '../types/index.js';

/**
 * The DM's soundboard. The buttons only *ask*; the server picks the take and tells every client
 * (this one included), and each plays it locally in Rust — nothing goes through the voice channel.
 */
export function SoundboardPanel() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const { data, error } = useCampaignQuery<SoundLibrary>('soundboard/library', []);
  const [master, setMaster] = useState(100);
  const [actionError, setActionError] = useState<string>();

  async function send(t: string, d: Record<string, unknown>) {
    try {
      setActionError(undefined);
      await syncCommand(t, d);
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }

  if (!dm) {
    return (
      <Flex p="3">
        <Text size="2" color="gray">
          The soundboard is the DM&apos;s. You&apos;ll hear it when they play something.
        </Text>
      </Flex>
    );
  }
  return (
    <Flex direction="column" gap="3" p="3">
      <Flex justify="between" align="center">
        <Text weight="bold">Soundboard</Text>
        <Button size="1" color="red" variant="soft" onClick={() => void send('sound.stop', {})}>
          Stop all
        </Button>
      </Flex>
      <Flex align="center" gap="2">
        <Text size="1" color="gray">
          Volume
        </Text>
        <Slider
          value={[master]}
          min={0}
          max={100}
          onValueChange={([v]) => setMaster(v ?? 100)}
          onValueCommit={([v]) => void send('sound.volume', { master: (v ?? 100) / 100 })}
        />
      </Flex>
      {(error ?? actionError) && (
        <Callout.Root color="red" size="1">
          <Callout.Text>{error ?? actionError}</Callout.Text>
        </Callout.Root>
      )}
      {data?.scenes.length ? (
        <Flex direction="column" gap="1">
          <Text size="2" weight="bold">
            Scenes
          </Text>
          {data.scenes.map((s) => (
            <Flex key={s.id} gap="2" align="center" justify="between">
              <Text size="2">{s.name}</Text>
              <Flex gap="1">
                <Button size="1" onClick={() => void send('scene.start', { sceneId: s.id })}>
                  Start
                </Button>
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  onClick={() => void send('scene.stop', {})}
                >
                  End
                </Button>
              </Flex>
            </Flex>
          ))}
        </Flex>
      ) : null}
      {data?.boards.map((b) => (
        <Card key={b.id}>
          <Flex direction="column" gap="2">
            <Text size="2" weight="bold">
              {b.name}
            </Text>
            <Flex gap="2" wrap="wrap">
              {b.buttons.map((btn) => (
                <Button
                  key={btn.id}
                  variant={btn.mode === 'loop' ? 'outline' : 'soft'}
                  title={btn.note || undefined}
                  onClick={() =>
                    void send('sound.play', {
                      soundId: btn.soundId,
                      mode: btn.mode,
                      volume: btn.volume,
                    })
                  }
                >
                  {btn.mode === 'loop' ? '↻ ' : ''}
                  {btn.label}
                </Button>
              ))}
            </Flex>
          </Flex>
        </Card>
      ))}
      {data && data.boards.length === 0 && data.scenes.length === 0 && (
        <Text size="2" color="gray">
          Your library has no boards or scenes yet.
        </Text>
      )}
    </Flex>
  );
}
