import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Icon, Input } from '../../../../../core/ui/index.ts';
import { roomPath } from '../../../lib/roomLink.ts';
import { useConnectionStore, type ConnectionStatus } from '../../../store/connectionStore.ts';

const LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  offline: 'Offline — your edits are kept and sent when you’re back',
};

const DOT: Record<ConnectionStatus, string> = {
  connected: 'bg-success',
  connecting: 'bg-warning',
  offline: 'bg-danger',
};

export type RoomStatusProps = {
  /** The app's connection store unless a test passes its own. */
  store?: typeof useConnectionStore;
};

/** Header part of a room: are my edits reaching the others, and the link to invite them. */
export function RoomStatus({ store = useConnectionStore }: RoomStatusProps) {
  const status = store((s) => s.status);
  const roomId = store((s) => s.roomId);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'refused'>('idle');
  if (!roomId) return null;
  const link = `${window.location.origin}${roomPath(roomId)}`;

  const copyLink = () => {
    navigator.clipboard.writeText(link).then(
      () => setCopy('copied'),
      () => setCopy('refused'), // e.g. no permission: show the link to copy by hand
    );
  };

  return (
    <div className="flex items-center gap-3 text-sm">
      <p role="status" className="flex items-center gap-2 text-muted">
        <span aria-hidden="true" className={`size-2 rounded-full ${DOT[status]}`} />
        {LABEL[status]}
      </p>
      {copy === 'refused' ? (
        <Input
          aria-label="Room link"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 w-56 text-xs"
        />
      ) : (
        <Button size="sm" onClick={copyLink}>
          <Icon icon={Link2} />
          {copy === 'copied' ? 'Link copied' : 'Copy link'}
        </Button>
      )}
    </div>
  );
}
