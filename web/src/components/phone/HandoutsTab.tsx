import { Badge, Button, Callout, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { useLoad } from '../../hooks/useLoad.js';
import { blobToDataUrl } from '../../lib/phone/dataUrl.js';
import { handoutFile, handouts } from '../../lib/phone/phoneApi.js';
import type { HandoutItem } from '../../types/phone.js';
import { PictureViewer } from './PictureViewer.js';

const KIND_LABEL = { text: 'Note', image: 'Pictures', map: 'Map', pdf: 'PDF' } as const;

/** What the DM has shared with you. Tap one to read or look at it. */
export function HandoutsTab({ token, campaignId }: { token: string; campaignId: string }) {
  const { data, error, loading } = useLoad(() => handouts(token, campaignId), campaignId);
  const [open, setOpen] = useState<HandoutItem>();
  if (open) {
    return (
      <HandoutView
        item={open}
        token={token}
        campaignId={campaignId}
        onBack={() => setOpen(undefined)}
      />
    );
  }
  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <Heading size="5">Handouts</Heading>
      {error && (
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {!loading && !error && (data?.length ?? 0) === 0 && (
        <Text color="gray">Nothing shared yet. Handouts the DM shows you appear here.</Text>
      )}
      {(data ?? []).map((h) => (
        <Card key={h.id} asChild size="2">
          <button type="button" className="phone-card-button" onClick={() => setOpen(h)}>
            <Flex justify="between" align="center" gap="3">
              <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                <Text size="3" weight="medium">
                  {h.title}
                </Text>
                {h.kind === 'text' && h.body && (
                  <Text size="2" color="gray" className="phone-clamp">
                    {h.body}
                  </Text>
                )}
              </Flex>
              <Badge color="gray">{KIND_LABEL[h.kind]}</Badge>
            </Flex>
          </button>
        </Card>
      ))}
    </Flex>
  );
}

function HandoutView({
  item,
  token,
  campaignId,
  onBack,
}: {
  item: HandoutItem;
  token: string;
  campaignId: string;
  onBack: () => void;
}) {
  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <Flex align="center" gap="3">
        <Button variant="soft" onClick={onBack}>
          Back
        </Button>
        <Heading size="5">{item.title}</Heading>
      </Flex>
      {item.kind === 'text' && <div className="phone-note">{item.body}</div>}
      {(item.kind === 'image' || item.kind === 'map') && (
        <Pictures item={item} token={token} campaignId={campaignId} />
      )}
      {item.kind === 'pdf' && <PdfLink item={item} token={token} campaignId={campaignId} />}
      {item.kind !== 'text' && item.body && <Text size="2">{item.body}</Text>}
    </Flex>
  );
}

function Pictures({
  item,
  token,
  campaignId,
}: {
  item: HandoutItem;
  token: string;
  campaignId: string;
}) {
  const [urls, setUrls] = useState<(string | undefined)[]>([]);
  const [error, setError] = useState<string>();
  const [viewing, setViewing] = useState<number>();
  useEffect(() => {
    let current = true;
    setUrls([]);
    for (let i = 0; i < Math.max(1, item.fileCount); i += 1) {
      handoutFile(token, campaignId, item.id, i)
        .then(blobToDataUrl)
        .then((url) => {
          if (current) setUrls((all) => Object.assign([...all], { [i]: url }));
        })
        .catch(() => current && setError('Could not load that picture.'));
    }
    return () => {
      current = false;
    };
  }, [item.id, item.fileCount, token, campaignId]);
  const ready = urls.filter((u): u is string => u !== undefined);
  return (
    <Flex direction="column" gap="3">
      {Array.from({ length: Math.max(1, item.fileCount) }, (_, i) =>
        urls[i] ? (
          <button
            key={i}
            type="button"
            className="phone-picture-button"
            aria-label={`Open picture ${i + 1} full screen`}
            onClick={() => setViewing(i)}
          >
            <img src={urls[i]} alt={`${item.title}, picture ${i + 1}`} className="phone-picture" />
          </button>
        ) : (
          <div key={i} className="phone-picture phone-picture-loading" aria-busy />
        ),
      )}
      {error && (
        <Text size="2" color="red" role="alert">
          {error}
        </Text>
      )}
      {viewing !== undefined && ready.length === Math.max(1, item.fileCount) && (
        <PictureViewer
          urls={ready}
          title={item.title}
          start={viewing}
          onClose={() => setViewing(undefined)}
        />
      )}
    </Flex>
  );
}

/** A PDF opens in the phone's own viewer: fetch it with the sign-in, then open the result in a new tab. */
function PdfLink({
  item,
  token,
  campaignId,
}: {
  item: HandoutItem;
  token: string;
  campaignId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function open() {
    setBusy(true);
    setError(undefined);
    try {
      const blob = await handoutFile(token, campaignId, item.id, 0);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('Could not open that PDF.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Flex direction="column" gap="2" align="start">
      <Button size="3" loading={busy} onClick={() => void open()}>
        Open the PDF
      </Button>
      {error && (
        <Text size="2" color="red" role="alert">
          {error}
        </Text>
      )}
    </Flex>
  );
}
