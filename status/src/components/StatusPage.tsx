import { Badge, Card, Flex, Heading, Text } from '@radix-ui/themes';

import { SERVICE_LABELS } from '../consts/index.js';
import poster from '../assets/poster-fumble.webp';
import { PictureBanner } from './PictureBanner.js';
import { SiteHeader } from './SiteHeader.js';
import { useStatus } from '../hooks/useStatus.js';
import { ago, headline, pipelineLine } from '../lib/summary.js';
import type { StatusSnapshot } from '../types/index.js';

export function StatusPage() {
  const { snapshot, reachable } = useStatus();
  return (
    <div className="site-shell">
      <SiteHeader current="status" />
      <Flex direction="column" gap="4" className="site-column" asChild>
        <main>
          <PictureBanner src={poster}>
            <Heading size="5">Is the table up?</Heading>
          </PictureBanner>
          {!snapshot && reachable && <Text color="gray">Checking the server…</Text>}
          {!reachable && (
            <Banner
              tone="down"
              text="Cannot reach the server"
              note={snapshot ? 'Showing the last known state.' : undefined}
            />
          )}
          {snapshot && reachable && <Body snapshot={snapshot} />}
          {snapshot && !reachable && <Body snapshot={snapshot} stale />}
        </main>
      </Flex>
    </div>
  );
}

function Banner({
  tone,
  text,
  note,
}: {
  tone: 'ok' | 'warn' | 'down';
  text: string;
  note?: string | undefined;
}) {
  return (
    <div className={`status-banner status-banner-${tone}`} role="status">
      <span className="status-dot" aria-hidden />
      <Flex direction="column">
        <Heading size="5" as="h2">
          {text}
        </Heading>
        {note && <Text size="2">{note}</Text>}
      </Flex>
    </div>
  );
}

function Body({ snapshot, stale = false }: { snapshot: StatusSnapshot; stale?: boolean }) {
  const h = headline(snapshot);
  return (
    <>
      {!stale && <Banner tone={h.tone} text={h.text} />}
      <Card>
        <Flex direction="column" gap="2">
          <Heading size="3" as="h2">
            Services
          </Heading>
          {snapshot.services.map((s) => (
            <Flex key={s.name} justify="between" align="center">
              <Text>{SERVICE_LABELS[s.name] ?? s.name}</Text>
              <Badge color={s.ok ? 'green' : 'red'}>{s.ok ? 'Running' : 'Down'}</Badge>
            </Flex>
          ))}
        </Flex>
      </Card>
      <Card>
        <Flex direction="column" gap="2">
          <Heading size="3" as="h2">
            Right now
          </Heading>
          <Row label="Players connected" value={String(snapshot.players.online)} />
          <Row
            label="Session recording"
            value={
              snapshot.recording.active > 0
                ? `${snapshot.recording.active} recording`
                : 'Not recording'
            }
          />
          {snapshot.storage && (
            <Row
              label="Recording storage"
              value={`${snapshot.storage.freePercent}% free${snapshot.storage.low ? ' (running low)' : ''}`}
            />
          )}
          <Row label="Summaries queue" value={pipelineLine(snapshot.pipeline)} />
          {snapshot.pipeline?.last && (
            <Row
              label="Last summary job"
              value={`${snapshot.pipeline.last.state === 'done' ? 'Finished' : 'Failed'} ${ago(snapshot.pipeline.last.at, snapshot.at)}`}
            />
          )}
        </Flex>
      </Card>
      <Text size="1" color="gray">
        Updated {ago(snapshot.at, Date.now())}. This page refreshes itself while it is open.
      </Text>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Flex justify="between" align="center" gap="3">
      <Text color="gray">{label}</Text>
      <Text weight="medium">{value}</Text>
    </Flex>
  );
}
