/**
 * P2-05 event-list benchmark.
 *
 * Run against a migrated, empty, disposable local database whose name ends in
 * `_bench`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p205_bench
 *   cd backend
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p205_bench \
 *     pnpm knex migrate:latest
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p205_bench \
 *     node scripts/benchmark-events-list.js
 *
 * The script refuses production, non-local hosts, and database names that do
 * not end in `_bench`. It inserts its own organization and never reads seed data.
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../src/db/knex');

const EVENT_COUNT = Number(process.env.BENCH_EVENTS || 1000000);
const BASE_TIME = '2026-01-01T00:00:00.000Z';

const assertDisposableTarget = () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run in production');
  }

  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required');

  const url = new URL(raw);
  const database = url.pathname.replace(/^\//, '');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  if (!local || url.hostname.includes('neon.tech') || !database.endsWith('_bench')) {
    throw new Error(`Refusing benchmark target ${url.hostname}/${database}`);
  }

  return { host: url.hostname, database };
};

const seedOrganization = async () => {
  const organizationId = uuidv4();
  const userId = uuidv4();
  const productId = uuidv4();
  const lotId = uuidv4();
  const locationId = uuidv4();

  await db('organizations').insert({
    id: organizationId,
    name: 'P2-05 benchmark',
    slug: `p2-05-bench-${organizationId.slice(0, 8)}`,
  });
  await db('users').insert({
    id: userId,
    organization_id: organizationId,
    first_name: 'P2',
    last_name: 'Benchmark',
    email: `${organizationId}@example.test`,
    role: 'org_admin',
    status: 'active',
  });
  await db('products').insert({
    id: productId,
    organization_id: organizationId,
    name: 'P2-05 benchmark product',
  });
  await db('lots').insert({
    id: lotId,
    organization_id: organizationId,
    product_id: productId,
    traceability_lot_code: `BENCH-${lotId.slice(0, 8)}`,
    quantity: 1,
    uom: 'kg',
  });
  await db('locations').insert({
    id: locationId,
    organization_id: organizationId,
    name: 'P2-05 benchmark location',
    type: 'plant',
  });

  return { organizationId, userId, lotId, locationId };
};

const seedEvents = async ({ organizationId, userId, locationId }) => {
  const startedAt = Date.now();

  await db.raw(`
    INSERT INTO events (
      id, organization_id, event_type, event_datetime, location_id,
      recorded_by, source, kde_payload, record_hash, prev_hash, chain_seq,
      hash_key_id, status, created_at
    )
    SELECT
      gen_random_uuid(),
      ?,
      (ARRAY['creation', 'receiving', 'transformation', 'shipping'])[1 + (g % 4)],
      ?::timestamptz + (g || ' milliseconds')::interval,
      CASE WHEN g % 2 = 0 THEN ?::uuid END,
      ?,
      (ARRAY['manual', 'scan', 'import', 'api'])[1 + (g % 4)],
      '{}'::jsonb,
      'bench-hash-' || g,
      'bench-prev-' || g,
      g,
      'bench-key',
      CASE
        WHEN g % 50 = 0 THEN 'void'
        WHEN g % 25 = 0 THEN 'amended'
        ELSE 'active'
      END,
      ?::timestamptz + (g || ' milliseconds')::interval
    FROM generate_series(1, ?) AS g
  `, [organizationId, BASE_TIME, locationId, userId, BASE_TIME, EVENT_COUNT]);

  console.log(`inserted ${EVENT_COUNT} events in ${Date.now() - startedAt}ms`);
};

const seedLinks = async ({ organizationId, lotId }) => {
  await db.raw(`
    INSERT INTO event_lot_links (
      organization_id, event_id, lot_id, direction, quantity, uom
    )
    SELECT ?, e.id, ?, 'output', 1, 'kg'
    FROM events e
    WHERE e.organization_id = ?
      AND e.chain_seq % 100 = 0
  `, [organizationId, lotId, organizationId]);

  // The bulk insert bypasses autovacuum's normal pacing; collect stats before
  // reading plans so the planner sees the real distribution.
  await db.raw('ANALYZE events');
  await db.raw('ANALYZE event_lot_links');
};

const explain = async (label, whereClause, bindings) => {
  const { rows } = await db.raw(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT
      events.*,
      locations.name AS location_name,
      users.first_name || ' ' || users.last_name AS recorded_by_name,
      (
        SELECT json_agg(json_build_object(
          'id', lots.id,
          'traceabilityLotCode', lots.traceability_lot_code,
          'direction', ell.direction,
          'quantity', ell.quantity,
          'uom', ell.uom
        ))
        FROM event_lot_links ell
        JOIN lots ON lots.id = ell.lot_id
        WHERE ell.event_id = events.id
      ) AS lot_links,
      to_char(events.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
    FROM events
    LEFT JOIN locations ON events.location_id = locations.id
    LEFT JOIN users ON events.recorded_by = users.id
    WHERE ${whereClause}
    ORDER BY events.created_at DESC, events.chain_seq DESC
    LIMIT 21
  `, bindings);

  console.log(`\n### ${label}`);
  console.log(rows.map((row) => row['QUERY PLAN']).join('\n'));
};

const main = async () => {
  const target = assertDisposableTarget();
  console.log(`benchmark target: ${target.host}/${target.database}`);

  if (!(await db.schema.hasTable('events'))) {
    throw new Error('Run pnpm knex migrate:latest before the benchmark');
  }

  const [{ count }] = await db('events').count('id as count');
  if (Number(count) !== 0) {
    throw new Error('Benchmark database must be empty; drop and recreate it');
  }

  const fixture = await seedOrganization();
  const { organizationId, userId, lotId, locationId } = fixture;

  await seedEvents(fixture);
  await seedLinks(fixture);

  const deepSeq = Math.max(1, Math.floor(EVENT_COUNT / 1000));
  const deep = await db('events')
    .where({ organization_id: organizationId, chain_seq: deepSeq })
    .first(
      db.raw(`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time`),
      'chain_seq'
    );

  if (!deep) throw new Error('Deep cursor fixture not found');

  const baseBindings = [organizationId];
  await explain('first page', 'events.organization_id = ?', baseBindings);
  await explain(
    'deep cursor page',
    'events.organization_id = ? AND (events.created_at, events.chain_seq) < (?::timestamptz, ?::bigint)',
    [organizationId, deep.cursor_time, String(deep.chain_seq)],
  );
  await explain(
    'eventType filter',
    'events.organization_id = ? AND events.event_type = ?',
    [organizationId, 'shipping'],
  );
  await explain(
    'status filter',
    'events.organization_id = ? AND events.status = ?',
    [organizationId, 'void'],
  );
  await explain(
    'source filter',
    'events.organization_id = ? AND events.source = ?',
    [organizationId, 'api'],
  );
  await explain(
    'location filter',
    'events.organization_id = ? AND events.location_id = ?',
    [organizationId, locationId],
  );
  await explain(
    'lot filter',
    `events.organization_id = ? AND EXISTS (
      SELECT 1 FROM event_lot_links
      WHERE event_lot_links.event_id = events.id
        AND event_lot_links.lot_id = ?
    )`,
    [organizationId, lotId],
  );

  console.log(`\nbenchmark organization: ${organizationId}`);
  console.log(`benchmark user: ${userId}`);
};

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
