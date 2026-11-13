import { Badge, Button, Callout, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { useConfirmClick } from '../../hooks/useConfirmClick.js';
import { useIsDm } from '../../hooks/useIsDm.js';
import { useLoad } from '../../hooks/useLoad.js';
import { useReturnFocus } from '../../hooks/useReturnFocus.js';
import { ApiError } from '../../lib/api.js';
import { isShared } from '../../lib/phone/noteForm.js';
import { blobToDataUrl } from '../../lib/phone/dataUrl.js';
import {
  deleteHandout,
  handoutFile,
  handouts,
  hideHandout,
  showHandout,
} from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import type { HandoutItem } from '../../types/phone.js';
import { IconTool } from './IconTool.js';
import { LazyMarkdown } from './LazyMarkdown.js';
import { NoteEditor } from './NoteEditor.js';
import { PictureViewer } from './PictureViewer.js';

const KIND_LABEL = { text: 'Note', image: 'Pictures', map: 'Map', pdf: 'PDF' } as const;

type View = { page: 'list' } | { page: 'open'; id: string } | { page: 'write'; id?: string };

/** What the DM has shared with you. Tap one to read or look at it. The DM also writes and manages notes here. */
export function HandoutsTab({ campaignId }: { campaignId: string }) {
  const rev = usePhoneStore((s) => s.handoutsRev);
  const isDm = useIsDm(campaignId);
  const { data, error, loading, reload } = useLoad(
    () => handouts(campaignId),
    `${campaignId}:${rev}`,
  );
  const [view, setView] = useState<View>({ page: 'list' });
  const [notice, setNotice] = useState<string>();
  const open = view.page !== 'list' && view.id ? data?.find((h) => h.id === view.id) : undefined;
  useReturnFocus(view.page === 'list', 'new-note');

  // Someone took the handout back (or deleted it) while it was open.
  useEffect(() => {
    if (view.page !== 'list' && view.id && data && !open) {
      setView({ page: 'list' });
      setNotice('That handout was taken back or removed.');
    }
  }, [view, data, open]);

  if (view.page === 'write' && isDm) {
    return (
      <NoteEditor
        campaignId={campaignId}
        {...(open ? { note: open } : {})}
        onCancel={() => setView(open ? { page: 'open', id: open.id } : { page: 'list' })}
        onDone={(saved) => {
          reload();
          setView(open && saved ? { page: 'open', id: open.id } : { page: 'list' });
        }}
      />
    );
  }
  if (view.page === 'open' && open) {
    return (
      <HandoutView
        item={open}
        campaignId={campaignId}
        isDm={isDm}
        onBack={() => setView({ page: 'list' })}
        onEdit={() => setView({ page: 'write', id: open.id })}
        onChanged={reload}
        onDeleted={() => {
          setNotice(undefined);
          setView({ page: 'list' });
          reload();
        }}
      />
    );
  }
  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <div className="phone-head-row">
        <Heading size="5">Handouts</Heading>
        {isDm && (
          <IconTool
            label="New note"
            icon="plus"
            data-focus="new-note"
            onClick={() => {
              setNotice(undefined);
              setView({ page: 'write' });
            }}
          />
        )}
      </div>
      {notice && (
        <Callout.Root color="gray" role="status">
          <Callout.Text>{notice}</Callout.Text>
        </Callout.Root>
      )}
      {error && (
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {!loading && !error && (data?.length ?? 0) === 0 && (
        <Text color="gray">
          {isDm
            ? 'No handouts yet. Tap + to write a note.'
            : 'Nothing shared yet. Handouts the DM shows you appear here.'}
        </Text>
      )}
      {(data ?? []).map((h) => (
        <Card key={h.id} asChild size="2">
          <button
            type="button"
            className="phone-card-button"
            onClick={() => {
              setNotice(undefined);
              setView({ page: 'open', id: h.id });
            }}
          >
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
              <Flex gap="1" align="center" wrap="wrap" justify="end">
                {isDm && (
                  <Badge color={isShared(h) ? 'green' : 'amber'}>
                    {isShared(h) ? 'Shown' : 'Draft'}
                  </Badge>
                )}
                <Badge color="gray">{KIND_LABEL[h.kind]}</Badge>
              </Flex>
            </Flex>
          </button>
        </Card>
      ))}
    </Flex>
  );
}

function HandoutView({
  item,
  campaignId,
  isDm,
  onBack,
  onEdit,
  onChanged,
  onDeleted,
}: {
  item: HandoutItem;
  campaignId: string;
  isDm: boolean;
  onBack: () => void;
  onEdit: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const shared = isShared(item);
  async function run(call: () => Promise<unknown>, after: () => void) {
    setBusy(true);
    setError(undefined);
    try {
      await call();
      after();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }
  const remove = useConfirmClick(() => run(() => deleteHandout(campaignId, item.id), onDeleted));
  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <Flex align="center" gap="3">
        <Button variant="soft" onClick={onBack}>
          Back
        </Button>
        <Heading size="5" as="h2">
          {item.title}
        </Heading>
      </Flex>
      {isDm && (
        <Flex gap="2" wrap="wrap" align="center" className="phone-actions">
          <Badge color={shared ? 'green' : 'amber'}>
            {shared ? 'Shown to players' : 'Draft: only you see it'}
          </Badge>
          {item.kind === 'text' && (
            <IconTool label="Edit this note" icon="pencil" text="Edit" onClick={onEdit} />
          )}
          <IconTool
            label={shared ? 'Hide it from the players' : 'Show it to all players'}
            icon={shared ? 'eyeOff' : 'eye'}
            text={shared ? 'Hide' : 'Show'}
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  shared ? hideHandout(campaignId, item.id) : showHandout(campaignId, item.id),
                onChanged,
              )
            }
          />
          <IconTool
            label={remove.armed ? 'Press again to delete it for good' : 'Delete this handout'}
            icon="trash"
            text={remove.armed ? 'Press again to delete' : 'Delete'}
            danger
            disabled={busy}
            onClick={remove.press}
          />
        </Flex>
      )}
      {error && (
        <Text size="2" color="red" role="alert">
          {error}
        </Text>
      )}
      {item.kind === 'text' && item.body && <LazyMarkdown text={item.body} />}
      {(item.kind === 'image' || item.kind === 'map') && (
        <Pictures item={item} campaignId={campaignId} />
      )}
      {item.kind === 'pdf' && <PdfLink item={item} campaignId={campaignId} />}
      {item.kind !== 'text' && item.body && <Text size="2">{item.body}</Text>}
    </Flex>
  );
}

function Pictures({ item, campaignId }: { item: HandoutItem; campaignId: string }) {
  const [urls, setUrls] = useState<(string | undefined)[]>([]);
  const [error, setError] = useState<string>();
  const [viewing, setViewing] = useState<number>();
  useEffect(() => {
    let current = true;
    setUrls([]);
    for (let i = 0; i < Math.max(1, item.fileCount); i += 1) {
      handoutFile(campaignId, item.id, i)
        .then(blobToDataUrl)
        .then((url) => {
          if (current) setUrls((all) => Object.assign([...all], { [i]: url }));
        })
        .catch(() => current && setError('Could not load that picture.'));
    }
    return () => {
      current = false;
    };
  }, [item.id, item.fileCount, campaignId]);
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
function PdfLink({ item, campaignId }: { item: HandoutItem; campaignId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function open() {
    setBusy(true);
    setError(undefined);
    try {
      const blob = await handoutFile(campaignId, item.id, 0);
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
