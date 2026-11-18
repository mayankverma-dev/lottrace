import { create } from 'zustand';

import { api } from './api';
import { useAuthStore } from '../stores/auth.store';
import {
  clearOutbox,
  deleteOutboxRecord,
  getOutboxCounts,
  isPermanentFailure,
  listOutbox,
  markOutboxAttempt,
  markOutboxFailure,
} from './outbox';

export const useSyncStore = create(() => ({
  pending: 0,
  failed: 0,
  syncing: false,
}));

const currentOwner = () => {
  const user = useAuthStore.getState().user;
  if (!user?.id || !user?.organizationId) return null;
  return { organizationId: user.organizationId, userId: user.id };
};

/**
 * Re-reads queued counts for the signed-in account.
 *
 * @returns {Promise<void>}
 */
export const refreshOutboxState = async () => {
  const owner = currentOwner();
  if (!owner) {
    useSyncStore.setState({ pending: 0, failed: 0 });
    return;
  }

  try {
    const counts = await getOutboxCounts(owner);
    useSyncStore.setState(counts);
  } catch (err) {
    console.error('Failed to read the offline outbox:', err);
  }
};

let activeFlush = null;

const runFlush = async ({ force }) => {
  const owner = currentOwner();
  if (!owner) return { synced: 0 };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await refreshOutboxState();
    return { synced: 0 };
  }

  useSyncStore.setState({ syncing: true });
  let synced = 0;

  try {
    const records = await listOutbox(owner);

    for (const record of records) {
      if (record.failedAt && !force) continue;

      try {
        await api.post('/events', record.payload, {
          headers: { 'Idempotency-Key': record.idempotencyKey },
        });
        await deleteOutboxRecord(record.id);
        synced += 1;
      } catch (err) {
        const status = err.response?.status;
        const message = err.response?.data?.message || err.message || 'Sync failed';

        if (status && isPermanentFailure(status)) {
          await markOutboxFailure(record.id, message);
          continue;
        }

        // Network, auth, timeout, or server failure: keep the record and stop
        // this pass so the next reconnect or manual retry can try again.
        await markOutboxAttempt(record.id, message);
        break;
      }
    }
  } finally {
    await refreshOutboxState();
    useSyncStore.setState({ syncing: false });
  }

  return { synced };
};

/**
 * Flushes queued events once. Concurrent callers share one pass, so a
 * reconnect event and a visibility change cannot double-submit.
 *
 * @param {{ force?: boolean }} [options] force retries parked records
 * @returns {Promise<{ synced: number }>}
 */
export const flushOutbox = ({ force = false } = {}) => {
  if (activeFlush) return activeFlush;

  activeFlush = runFlush({ force })
    .catch((err) => {
      console.error('Offline outbox sync failed:', err);
      return { synced: 0 };
    })
    .finally(() => {
      activeFlush = null;
    });

  return activeFlush;
};

/**
 * Removes every queued record, including other accounts' leftovers. Used on
 * explicit sign-out so a shared device never leaks another org's events.
 *
 * @returns {Promise<void>}
 */
export const purgeOutbox = async () => {
  try {
    await clearOutbox();
  } catch (err) {
    console.error('Failed to purge the offline outbox:', err);
  } finally {
    useSyncStore.setState({ pending: 0, failed: 0 });
  }
};
