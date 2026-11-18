/**
 * Durable offline queue for event submissions.
 *
 * Records live in IndexedDB and are scoped to one organization/user pair, so
 * another account on the same device can never read or sync them. The module
 * has no React or HTTP dependencies; `outboxSync.js` owns flushing.
 */

export const OUTBOX_DB_NAME = 'lottrace-outbox';
export const OUTBOX_STORE_NAME = 'events';
const OUTBOX_DB_VERSION = 1;
const OWNER_INDEX = 'ownerKey';

let dbPromise = null;

/**
 * Builds the IndexedDB index key for one account.
 *
 * @param {string} organizationId
 * @param {string} userId
 * @returns {string}
 */
export const outboxOwnerKey = (organizationId, userId) => {
  if (!organizationId || !userId) {
    throw new Error('Outbox owner requires organizationId and userId');
  }
  return `${organizationId}:${userId}`;
};

/**
 * A 4xx that is not auth, timeout, or rate limiting will fail the same way on
 * every retry, so the record is parked instead of retried forever.
 *
 * @param {number} status
 * @returns {boolean}
 */
export const isPermanentFailure = (status) => (
  Number.isInteger(status)
  && status >= 400
  && status < 500
  && ![401, 408, 429].includes(status)
);

/**
 * @param {{
 *   organizationId: string,
 *   userId: string,
 *   payload: Object,
 *   idempotencyKey: string,
 *   id?: string,
 *   createdAt?: number,
 * }} input
 * @returns {Object}
 */
export const createOutboxRecord = ({
  organizationId,
  userId,
  payload,
  idempotencyKey,
  id = crypto.randomUUID(),
  createdAt = Date.now(),
}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Outbox payload must be an event payload object');
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
    throw new Error('Outbox record requires an idempotency key');
  }

  return {
    id,
    ownerKey: outboxOwnerKey(organizationId, userId),
    organizationId,
    userId,
    payload,
    idempotencyKey,
    createdAt,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    failedAt: null,
  };
};

const openDatabase = () => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable; cannot persist queued events'));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(OUTBOX_DB_NAME, OUTBOX_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OUTBOX_STORE_NAME)) {
          const store = db.createObjectStore(OUTBOX_STORE_NAME, { keyPath: 'id' });
          store.createIndex(OWNER_INDEX, 'ownerKey', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open the offline outbox'));
      request.onblocked = () => reject(new Error('Offline outbox upgrade is blocked by another tab'));
    });

    // Do not cache a failed open attempt: a later call may succeed.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }

  return dbPromise;
};

const withStore = async (mode, operation) => {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OUTBOX_STORE_NAME, mode);
    const store = transaction.objectStore(OUTBOX_STORE_NAME);
    let result;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error ?? new Error('Offline outbox transaction failed'));
    };

    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    transaction.onerror = () => fail(transaction.error);
    transaction.onabort = () => fail(transaction.error);

    try {
      operation(store, (value) => {
        result = value;
      });
    } catch (error) {
      settled = true;
      try {
        transaction.abort();
      } catch {
        // The transaction may already be aborted by the failed request.
      }
      reject(error);
    }
  });
};

const updateRecord = (id, update) => withStore('readwrite', (store) => {
  const request = store.get(id);
  request.onsuccess = () => {
    const record = request.result;
    if (!record) return;
    store.put(update(record));
  };
});

/**
 * Persists one event submission.
 *
 * @returns {Promise<Object>} the stored record
 */
export const enqueueEvent = async ({
  organizationId,
  userId,
  payload,
  idempotencyKey,
}) => {
  const record = createOutboxRecord({
    organizationId,
    userId,
    payload,
    idempotencyKey,
  });

  await withStore('readwrite', (store) => {
    store.add(record);
  });

  return record;
};

/**
 * Lists queued records oldest first for one account.
 *
 * @returns {Promise<Array<Object>>}
 */
export const listOutbox = async ({ organizationId, userId }) => {
  const ownerKey = outboxOwnerKey(organizationId, userId);

  return withStore('readonly', (store, setResult) => {
    const request = store.index(OWNER_INDEX).getAll(ownerKey);
    request.onsuccess = () => {
      const records = request.result ?? [];
      records.sort((a, b) => a.createdAt - b.createdAt);
      setResult(records);
    };
  });
};

/**
 * @returns {Promise<{ pending: number, failed: number }>}
 */
export const getOutboxCounts = async ({ organizationId, userId }) => {
  const records = await listOutbox({ organizationId, userId });
  const failed = records.filter((record) => record.failedAt).length;
  return { pending: records.length - failed, failed };
};

export const deleteOutboxRecord = (id) => withStore('readwrite', (store) => {
  store.delete(id);
});

/**
 * Records a retryable failure without parking the record.
 */
export const markOutboxAttempt = (id, message, at = Date.now()) => updateRecord(id, (record) => ({
  ...record,
  attempts: (record.attempts ?? 0) + 1,
  lastAttemptAt: at,
  lastError: message ?? null,
}));

/**
 * Parks a record that the API rejected permanently.
 */
export const markOutboxFailure = (id, message, at = Date.now()) => updateRecord(id, (record) => ({
  ...record,
  attempts: (record.attempts ?? 0) + 1,
  lastAttemptAt: at,
  lastError: message ?? null,
  failedAt: at,
}));

export const clearOutbox = () => withStore('readwrite', (store) => {
  store.clear();
});
