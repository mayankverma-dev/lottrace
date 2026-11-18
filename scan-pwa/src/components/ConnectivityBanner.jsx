import { toast } from 'sonner';

import { flushOutbox, useSyncStore } from '@/lib/outboxSync';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Button } from '@/components/ui/button';

const BANNER_CLASS = 'border-b px-4 py-2 text-center text-xs flex flex-wrap items-center justify-center gap-2';

/**
 * Single global connectivity banner. Replaces per-page offline banners so the
 * PWA never shows the same warning twice.
 */
export const ConnectivityBanner = () => {
  const isOnline = useOnlineStatus();
  const { pending, failed, syncing } = useSyncStore();

  const retry = async (force) => {
    const result = await flushOutbox({ force });
    if (result.synced > 0) {
      toast.success(`Synced ${result.synced} queued event${result.synced === 1 ? '' : 's'}`);
    } else {
      toast.error('Could not sync queued events yet. Try again.');
    }
  };

  if (syncing) {
    return (
      <div className={`${BANNER_CLASS} border-blue-200 bg-blue-50 text-blue-800`}>
        Syncing queued events…
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className={`${BANNER_CLASS} border-amber-200 bg-amber-50 text-amber-800`}>
        You're offline — events will sync when reconnected.
        {pending > 0 && <span>{pending} event{pending === 1 ? '' : 's'} queued.</span>}
      </div>
    );
  }

  if (failed > 0) {
    return (
      <div className={`${BANNER_CLASS} border-red-200 bg-red-50 text-red-800`}>
        {failed} queued event{failed === 1 ? '' : 's'} could not sync.
        <Button size="sm" variant="outline" onClick={() => retry(true)}>
          Retry
        </Button>
      </div>
    );
  }

  if (pending > 0) {
    return (
      <div className={`${BANNER_CLASS} border-blue-200 bg-blue-50 text-blue-800`}>
        {pending} event{pending === 1 ? '' : 's'} queued.
        <Button size="sm" variant="outline" onClick={() => retry(false)}>
          Sync now
        </Button>
      </div>
    );
  }

  return null;
};
