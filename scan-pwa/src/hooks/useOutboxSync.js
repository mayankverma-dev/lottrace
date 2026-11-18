import { useEffect } from 'react';
import { toast } from 'sonner';

import { useAuthStore } from '../stores/auth.store';
import { flushOutbox, refreshOutboxState } from '../lib/outboxSync';
import { useOnlineStatus } from './useOnlineStatus';

/**
 * Mounts once per signed-in layout: loads queued counts, flushes on reconnect,
 * and retries when the app becomes visible again after being backgrounded.
 */
export const useOutboxSync = () => {
  const userId = useAuthStore((state) => state.user?.id);
  const organizationId = useAuthStore((state) => state.user?.organizationId);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    if (!userId || !organizationId) return undefined;

    let cancelled = false;

    const sync = async () => {
      const result = await flushOutbox();
      if (!cancelled && result.synced > 0) {
        toast.success(`Synced ${result.synced} queued event${result.synced === 1 ? '' : 's'}`);
      }
    };

    refreshOutboxState();
    if (isOnline) sync();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) sync();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [userId, organizationId, isOnline]);
};
