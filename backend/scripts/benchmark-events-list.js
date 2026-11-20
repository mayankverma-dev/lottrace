/**
 * P2-05/P2-41 event-list benchmark.
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
// Keep in sync with DATE_FILTER_MATCH_LIMIT in the events service.
const DATE_FILTER_MATCH_LIMIT = 50000;

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

const selectList = `
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
`;

// Mirrors the service's keyset path: select the page keys from an index-only
// subquery, then join details for at most one page.
const keysetPageSql = (whereClause) => `
  SELECT ${selectList}
  FROM events
  JOIN (
    SELECT organization_id, created_at, chain_seq
    FROM events
    WHERE ${whereClause}
    ORDER BY created_at DESC, chain_seq DESC
    LIMIT 21
  ) page
    ON page.organization_id = events.organization_id
   AND page.chain_seq = events.chain_seq
  LEFT JOIN locations ON events.location_id = locations.id
  LEFT JOIN users ON events.recorded_by = users.id
  ORDER BY page.created_at DESC, page.chain_seq DESC
`;

// Mirrors the service's date-first path: materialize a bounded set of date
// matches, then sort that set by the public list order.
const dateFirstSql = (whereClause) => `
  WITH matched AS (
    SELECT organization_id, created_at, chain_seq
    FROM events
    WHERE ${whereClause}
    ORDER BY event_datetime DESC
    LIMIT ${DATE_FILTER_MATCH_LIMIT + 1}
  )
  SELECT ${selectList},
    (SELECT count(*) FROM matched) AS matched_count
  FROM events
  JOIN (
    SELECT organization_id, created_at, chain_seq
    FROM matched
    ORDER BY created_at DESC, chain_seq DESC
    LIMIT 21
  ) page
    ON page.organization_id = events.organization_id
   AND page.chain_seq = events.chain_seq
  LEFT JOIN locations ON events.location_id = locations.id
  LEFT JOIN users ON events.recorded_by = users.id
  ORDER BY page.created_at DESC, page.chain_seq DESC
`;

const explain = async (label, sql, bindings) => {
  const { rows } = await db.raw(`EXPLAIN (ANALYZE, BUFFERS)\n${sql}`, bindings);

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

  // A bulk-loaded table has no visibility map, so every index-only scan falls
  // back to the heap. Autovacuum sets it in production; do it explicitly so
  // the benchmark measures steady-state plans.
  await db.raw('VACUUM (ANALYZE) events');

  const deepSeq = Math.max(1, Math.floor(EVENT_COUNT / 1000));
  const deep = await db('events')
    .where({ organization_id: organizationId, chain_seq: deepSeq })
    .first(
      db.raw(`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time`),
      'chain_seq'
    );

  if (!deep) throw new Error('Deep cursor fixture not found');

  const baseBindings = [organizationId];
  await explain('first page', keysetPageSql('events.organization_id = ?'), baseBindings);
  await explain(
    'deep cursor page',
    keysetPageSql('events.organization_id = ? AND (events.created_at, events.chain_seq) < (?::timestamptz, ?::bigint)'),
    [organizationId, deep.cursor_time, String(deep.chain_seq)],
  );
  await explain(
    'eventType filter',
    keysetPageSql('events.organization_id = ? AND events.event_type = ?'),
    [organizationId, 'shipping'],
  );
  await explain(
    'status filter',
    keysetPageSql('events.organization_id = ? AND events.status = ?'),
    [organizationId, 'void'],
  );
  await explain(
    'source filter',
    keysetPageSql('events.organization_id = ? AND events.source = ?'),
    [organizationId, 'api'],
  );
  await explain(
    'location filter',
    keysetPageSql('events.organization_id = ? AND events.location_id = ?'),
    [organizationId, locationId],
  );
  await explain(
    'lot filter',
    keysetPageSql(`events.organization_id = ? AND EXISTS (
      SELECT 1 FROM event_lot_links
      WHERE event_lot_links.event_id = events.id
        AND event_lot_links.lot_id = ?
    )`),
    [organizationId, lotId],
  );

  const dateWhere = 'events.organization_id = ? AND events.event_datetime >= ? AND events.event_datetime <= ?';
  const baseMs = Date.parse(BASE_TIME);
  const dateRanges = [
    ['date range narrow (10s)', baseMs + 10000, baseMs + 20000],
    ['date range full', baseMs, baseMs + EVENT_COUNT],
  ];

  for (const [label, fromMs, toMs] of dateRanges) {
    const bindings = [organizationId, new Date(fromMs).toISOString(), new Date(toMs).toISOString()];
    const { rows: [{ n }] } = await db.raw(`
      SELECT count(*)::int AS n
      FROM (
        SELECT 1 FROM events
        WHERE ${dateWhere}
        ORDER BY event_datetime DESC
        LIMIT ${DATE_FILTER_MATCH_LIMIT + 1}
      ) probe
    `, bindings);
    const path = n > DATE_FILTER_MATCH_LIMIT ? 'keyset fallback' : 'date-first';

    console.log(`\n### ${label} — ${n} matching rows, service path: ${path}`);
    await explain(`${label} date-first`, dateFirstSql(dateWhere), bindings);
    await explain(`${label} keyset`, keysetPageSql(dateWhere), bindings);
  }

  console.log(`\nbenchmark organization: ${organizationId}`);
  console.log(`benchmark user: ${userId}`);
};

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
