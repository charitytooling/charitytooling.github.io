// One-time / refreshable loader for the BMF + DAF reference tables that power
// the in-app Search and Metrics features.
//
// Reads the static daftooling.github.io data files (the same per-state IRS
// Business Master File shards the public dashboard serves) and bulk-upserts
// them into Supabase via the service role (bypasses RLS):
//   - public.bmf_orgs    <- every row across data/states/*.json (~697k)
//   - public.daf_orgs    <- one row per EIN in data/daf_history.json (~1.6k)
//   - public.daf_history <- one row per sponsor-year in daf_history.json (~9.5k)
//
// is_daf_sponsor is set from bootstrap.json's daf_eins[]. daf_orgs.name/state/
// ntee_major are backfilled from the matching BMF row during the streaming pass
// (the ~23 sponsors absent from the BMF keep nulls there).
//
// Idempotent: upserts on the primary key, so re-running refreshes in place when
// the IRS data updates. Generated columns (org_type, search_text) are computed
// by Postgres and intentionally omitted from the payloads.
//
// After a successful load, run `analyze public.bmf_orgs;` so the planner has
// fresh stats before the first query.
//
// SECURITY: requires the project's service role key. NEVER COMMIT THE KEY.
// Pass it via env on the command line only.
//
// Usage:
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<key> \
//   DAFTOOLING_DATA_DIR=<path|omit-for-default> \
//   node scripts/load-bmf.mjs [--dry-run]
//
// Default DAFTOOLING_DATA_DIR is `../daftooling.github.io/data` resolved
// relative to the parent of this repo (matches the side-by-side workspace).

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
// Node 20 lacks a global WebSocket; @supabase/realtime-js needs one at client
// construction. Pass the `ws` package as the transport (matches import-daf.mjs).
import ws from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// -----------------------------------------------------------------------------
// CLI / env
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = new Set(args).has('--dry-run');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEFAULT_DATA_DIR = path.resolve(repoRoot, '..', 'daftooling.github.io', 'data');
const DAFTOOLING_DATA_DIR = path.resolve(process.env.DAFTOOLING_DATA_DIR ?? DEFAULT_DATA_DIR);

if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('Missing required env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.');
  console.error('  SUPABASE_URL=https://<project>.supabase.co');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=<service role key>');
  console.error('Or pass --dry-run to validate parsing without any DB writes.');
  process.exit(1);
}

const BMF_BATCH = 500;
const DAF_BATCH = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const intOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// -----------------------------------------------------------------------------
// Load daftooling source data
// -----------------------------------------------------------------------------

console.log(`Node ${process.version}`);
console.log(`Reading daftooling data from ${DAFTOOLING_DATA_DIR}`);

const bootstrap = JSON.parse(await readFile(path.join(DAFTOOLING_DATA_DIR, 'bootstrap.json'), 'utf8'));
const dafEinSet = new Set(Array.isArray(bootstrap.daf_eins) ? bootstrap.daf_eins : []);
console.log(`Loaded ${dafEinSet.size} DAF EINs from bootstrap.json`);

const history = JSON.parse(await readFile(path.join(DAFTOOLING_DATA_DIR, 'daf_history.json'), 'utf8'));
console.log(`Loaded NPT DAF history for ${Object.keys(history).length} sponsors`);

const statesDir = path.join(DAFTOOLING_DATA_DIR, 'states');
const shardFiles = (await readdir(statesDir)).filter((f) => f.endsWith('.json')).sort();

// BMF display attrs for DAF sponsors, captured during the streaming pass so we
// can backfill daf_orgs without a second SQL join.
const dafAttr = new Map();

function toBmfRow(r) {
  return {
    ein: r.e,
    name: strOrNull(r.n) ?? r.e,
    city: strOrNull(r.c),
    state: strOrNull(r.s),
    zip: strOrNull(r.z),
    subsection: strOrNull(r.su),
    foundation_code: strOrNull(r.f),
    status: strOrNull(r.st),
    ntee: strOrNull(r.nt),
    ntee_major: strOrNull(r.nm),
    ruling: strOrNull(r.ru),
    revenue: numOrNull(r.r),
    assets: numOrNull(r.a),
    income: numOrNull(r.i),
    street: strOrNull(r.d?.street),
    in_care_of: strOrNull(r.d?.ico),
    deductibility: strOrNull(r.d?.ded),
    tax_period: strOrNull(r.d?.tp),
    is_daf_sponsor: dafEinSet.has(r.e),
  };
}

// -----------------------------------------------------------------------------
// Supabase client
// -----------------------------------------------------------------------------

let supabase = null;
if (!DRY_RUN) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
}

async function upsertAll(table, rows, conflict, batchSize) {
  let done = 0;
  const total = rows.length;
  for (let i = 0; i < total; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    if (!DRY_RUN) {
      let err = null;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          const res = await supabase.from(table).upsert(batch, { onConflict: conflict });
          err = res.error;
        } catch (e) {
          err = e;
        }
        if (!err) break;
        if (attempt < 5) await sleep(500 * attempt);
      }
      if (err) {
        console.error(`  ${table} batch at ${i} (${batch.length} rows) failed after retries: ${err.message ?? err}`);
        if (err.cause) console.error('    cause:', err.cause?.message ?? err.cause);
        if (err.details) console.error('    details:', err.details);
        if (err.hint) console.error('    hint:', err.hint);
        process.exit(1);
      }
    }
    done += batch.length;
    if (!DRY_RUN && total > batchSize && done % (batchSize * 20) < batchSize) {
      console.log(`    …${table} ${done}/${total}`);
    }
  }
  return done;
}

// -----------------------------------------------------------------------------
// Pass 1: stream state shards -> bmf_orgs (and capture DAF attrs)
// -----------------------------------------------------------------------------

let bmfTotal = 0;
let dafSponsorsInBmf = 0;
for (const file of shardFiles) {
  const rows = JSON.parse(await readFile(path.join(statesDir, file), 'utf8'));
  const payload = [];
  for (const r of rows) {
    if (!r || typeof r.e !== 'string') continue;
    if (dafEinSet.has(r.e)) {
      dafAttr.set(r.e, { name: strOrNull(r.n), state: strOrNull(r.s), ntee_major: strOrNull(r.nm) });
      dafSponsorsInBmf++;
    }
    payload.push(toBmfRow(r));
  }
  const n = await upsertAll('bmf_orgs', payload, 'ein', BMF_BATCH);
  bmfTotal += n;
  console.log(`  ${file}: ${DRY_RUN ? 'parsed' : 'upserted'} ${n}`);
}
console.log(`bmf_orgs: ${bmfTotal} rows (${dafSponsorsInBmf} are DAF sponsors present in the BMF)`);

// -----------------------------------------------------------------------------
// Pass 2: daf_history.json -> daf_orgs + daf_history
// -----------------------------------------------------------------------------

const dafOrgs = [];
const dafHistory = [];
for (const [ein, rec] of Object.entries(history)) {
  const attr = dafAttr.get(ein) ?? {};
  dafOrgs.push({
    ein,
    type: strOrNull(rec.type),
    subtype: strOrNull(rec.subtype),
    name: attr.name ?? null,
    state: attr.state ?? null,
    ntee_major: attr.ntee_major ?? null,
  });
  for (const y of rec.years ?? []) {
    dafHistory.push({
      ein,
      year: intOrNull(y.y),
      fiscal_year_end: intOrNull(y.y),
      accounts: intOrNull(y.acc),
      contributions: numOrNull(y.con),
      grants: numOrNull(y.g),
      assets: numOrNull(y.a),
    });
  }
}
const dafOrgsN = await upsertAll('daf_orgs', dafOrgs, 'ein', DAF_BATCH);
const dafHistN = await upsertAll('daf_history', dafHistory.filter((h) => h.year != null), 'ein,year', DAF_BATCH);
console.log(`daf_orgs: ${dafOrgsN} rows`);
console.log(`daf_history: ${dafHistN} rows`);

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

if (DRY_RUN) {
  console.log('\n--dry-run: no DB writes. Sample bmf_orgs row:');
  const sampleShard = JSON.parse(await readFile(path.join(statesDir, shardFiles[0]), 'utf8'));
  console.log(JSON.stringify(toBmfRow(sampleShard[0]), null, 2));
  console.log('Sample daf_orgs:', JSON.stringify(dafOrgs[0], null, 2));
  console.log('Sample daf_history:', JSON.stringify(dafHistory[0], null, 2));
  process.exit(0);
}

console.log('\nDone. Remember to run `analyze public.bmf_orgs;` for fresh planner stats.');
