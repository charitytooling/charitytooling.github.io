// One-time DAF sponsor backfill for public.customers.
//
// Reads the static daftooling.github.io data files, resolves every EIN in
// bootstrap.json's `daf_eins[]` against the per-state IRS Business Master File
// shards, joins NPT type metadata from daf_history.json, and upserts the
// resulting customer rows into Supabase via the service role (bypasses RLS).
//
// This script is intentionally one-shot:
//   - Idempotent: re-runs skip EINs that already exist for the target charity
//     (upsert with onConflict: 'charity_id,ein', ignoreDuplicates: true), so
//     manual edits a rep makes after the first import are preserved.
//   - Never deletes: EINs that drop out of future NPT reports stay until a
//     human archives them.
//   - Adds no contacts: the DAF dataset has no person-level info. Reps add
//     primary contacts later from the Update / Contact pages.
//
// SECURITY: requires the project's service role key. NEVER COMMIT THE KEY.
// Pass it via env on the command line only.
//
// Usage:
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<key> \
//   CHARITY_ID=<uuid|omit-to-auto-pick> \
//   DAFTOOLING_DATA_DIR=<path|omit-for-default> \
//   node scripts/import-daf.mjs [--dry-run]
//
// Default DAFTOOLING_DATA_DIR is `../daftooling.github.io/data` resolved
// relative to the parent of this repo (matches the workspace layout when
// both repos live side-by-side under the same Click-Construction folder).

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
// Node 20 lacks a global WebSocket constructor, which @supabase/realtime-js
// requires at SupabaseClient construction time. Pass the `ws` package as the
// transport so this script runs on the project's pinned Node version.
import ws from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// -----------------------------------------------------------------------------
// CLI / env
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);
const flagSet = new Set(args);
const DRY_RUN = flagSet.has('--dry-run');
// Optional `--emit-payloads <path>` writes the resolved payloads as JSON so
// the actual insert can be executed by an out-of-band tool (e.g. the Supabase
// MCP execute_sql) without ever handing the service role key to this script.
const emitIdx = args.indexOf('--emit-payloads');
const EMIT_PAYLOADS_TO = emitIdx >= 0 ? args[emitIdx + 1] ?? null : null;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHARITY_ID = process.env.CHARITY_ID ?? null;

const DEFAULT_DATA_DIR = path.resolve(repoRoot, '..', 'daftooling.github.io', 'data');
const DAFTOOLING_DATA_DIR = path.resolve(process.env.DAFTOOLING_DATA_DIR ?? DEFAULT_DATA_DIR);

// Real upserts need both credentials. --dry-run is allowed without them so
// the resolution counts and payload shape can be verified offline before
// trusting the service role key to a shell session.
if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error(
    'Missing required env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.',
  );
  console.error('  SUPABASE_URL=https://<project>.supabase.co');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=<service role key>');
  console.error('Or pass --dry-run to validate the resolution without any DB writes.');
  process.exit(1);
}

const BATCH_SIZE = 200;

// -----------------------------------------------------------------------------
// Load daftooling data
// -----------------------------------------------------------------------------

console.log(`Reading daftooling data from ${DAFTOOLING_DATA_DIR}`);

const bootstrapPath = path.join(DAFTOOLING_DATA_DIR, 'bootstrap.json');
const bootstrap = JSON.parse(await readFile(bootstrapPath, 'utf8'));
const dafEins = bootstrap.daf_eins;
if (!Array.isArray(dafEins) || dafEins.length === 0) {
  console.error('bootstrap.json has no daf_eins[]; aborting.');
  process.exit(1);
}
const dafEinSet = new Set(dafEins);
console.log(`Loaded ${dafEins.length} DAF EINs from bootstrap.json`);

const historyPath = path.join(DAFTOOLING_DATA_DIR, 'daf_history.json');
const history = JSON.parse(await readFile(historyPath, 'utf8'));
console.log(`Loaded NPT metadata for ${Object.keys(history).length} sponsors`);

// Stream each per-state shard. Only keep rows whose EIN appears in dafEinSet
// to bound memory: the BMF is ~700k rows total but we only care about ~1.6k.
const statesDir = path.join(DAFTOOLING_DATA_DIR, 'states');
const shardFiles = (await readdir(statesDir)).filter((f) => f.endsWith('.json')).sort();

const bmfByEin = new Map();
for (const file of shardFiles) {
  const shardPath = path.join(statesDir, file);
  const rows = JSON.parse(await readFile(shardPath, 'utf8'));
  let kept = 0;
  for (const row of rows) {
    if (row && typeof row.e === 'string' && dafEinSet.has(row.e)) {
      bmfByEin.set(row.e, row);
      kept++;
    }
  }
  if (kept > 0) {
    // Short label so the log stays scannable, e.g. "states/CA.e9032892.json -> 412"
    console.log(`  ${file}: matched ${kept}`);
  }
}
console.log(
  `Indexed ${bmfByEin.size} BMF rows across ${shardFiles.length} state shards ` +
    `(${dafEins.length - bmfByEin.size} EINs unresolved)`,
);

// -----------------------------------------------------------------------------
// Supabase client + charity resolution
// -----------------------------------------------------------------------------

let supabase = null;
let charityId = CHARITY_ID;

if (DRY_RUN && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  // Offline preview mode: skip the DB roundtrip entirely so the user can
  // eyeball the payload shape without exposing the service role key.
  charityId = charityId ?? '00000000-0000-0000-0000-000000000000';
  console.log(`Target charity: ${charityId} (dry-run placeholder, no DB lookup)`);
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
  if (!charityId) {
    const { data: charities, error } = await supabase
      .from('charities')
      .select('id, name')
      .order('name');
    if (error) {
      console.error('Could not list charities to auto-pick a target:', error.message);
      process.exit(1);
    }
    if (!charities || charities.length === 0) {
      console.error('No charities found. Create one before importing DAFs.');
      process.exit(1);
    }
    if (charities.length > 1) {
      console.error('Multiple charities found; pass CHARITY_ID=<uuid> to disambiguate:');
      for (const c of charities) console.error(`  ${c.id}  ${c.name}`);
      process.exit(1);
    }
    charityId = charities[0].id;
    console.log(`Target charity (auto-picked): ${charities[0].name} (${charityId})`);
  } else {
    const { data: row, error } = await supabase
      .from('charities')
      .select('id, name')
      .eq('id', charityId)
      .maybeSingle();
    if (error) {
      console.error('Could not look up charity:', error.message);
      process.exit(1);
    }
    if (!row) {
      console.error(`CHARITY_ID ${charityId} does not exist in this project.`);
      process.exit(1);
    }
    console.log(`Target charity: ${row.name} (${charityId})`);
  }
}

// -----------------------------------------------------------------------------
// Build customer payloads
// -----------------------------------------------------------------------------

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const unresolved = [];
const payloads = [];
for (const ein of dafEins) {
  const bmf = bmfByEin.get(ein);
  if (!bmf) {
    unresolved.push(ein);
    continue;
  }
  const nptType = strOrNull(history[ein]?.type);
  payloads.push({
    charity_id: charityId,
    ein,
    display_name: strOrNull(bmf.n),
    address_line1: strOrNull(bmf.d?.street),
    city: strOrNull(bmf.c),
    state: strOrNull(bmf.s),
    postal_code: strOrNull(bmf.z),
    filing_revenue: numOrNull(bmf.r),
    filing_income: numOrNull(bmf.i),
    filing_assets: numOrNull(bmf.a),
    filing_tax_period: strOrNull(bmf.d?.tp),
    tags: ['DAF', ...(nptType ? [nptType] : [])],
  });
}

console.log(`Built ${payloads.length} customer payloads`);
if (unresolved.length > 0) {
  console.log(`Unresolved (no BMF row, will skip): ${unresolved.length}`);
}

// -----------------------------------------------------------------------------
// Dry run: print a sample and exit
// -----------------------------------------------------------------------------

if (EMIT_PAYLOADS_TO) {
  await writeFile(EMIT_PAYLOADS_TO, JSON.stringify(payloads, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${payloads.length} payloads to ${EMIT_PAYLOADS_TO}`);
}

if (DRY_RUN) {
  console.log('\n--dry-run set. Sample of first 3 payloads:\n');
  for (const p of payloads.slice(0, 3)) {
    console.log(JSON.stringify(p, null, 2));
  }
  if (unresolved.length > 0) {
    console.log(`\nUnresolved EINs (${unresolved.length}):`);
    console.log(unresolved.join(', '));
  }
  console.log('\nDry run complete. No DB writes performed.');
  process.exit(0);
}

// -----------------------------------------------------------------------------
// Filter out EINs already present, then plain-insert in batches
// -----------------------------------------------------------------------------
//
// We can't use upsert with ON CONFLICT here because the unique index on
// (charity_id, ein) is partial (WHERE ein IS NOT NULL), and PostgREST's
// conflict inference doesn't accept partial indexes. Instead, do a pre-pass
// to find existing EINs and skip them client-side. This preserves the
// idempotency the upsert was giving us.

console.log(`\nLooking up existing EINs for this charity...`);
const existing = new Set();
const allEins = payloads.map((p) => p.ein);
for (let i = 0; i < allEins.length; i += 500) {
  const chunk = allEins.slice(i, i + 500);
  const { data, error } = await supabase
    .from('customers')
    .select('ein')
    .eq('charity_id', charityId)
    .in('ein', chunk);
  if (error) {
    console.error('Existence check failed:', error.message);
    process.exit(1);
  }
  for (const row of data ?? []) existing.add(row.ein);
}
console.log(`Found ${existing.size} EIN(s) already present; will skip those.`);

const toInsert = payloads.filter((p) => !existing.has(p.ein));
console.log(`Inserting ${toInsert.length} new customer row(s) in batches of ${BATCH_SIZE}...`);

let inserted = 0;
let errored = 0;
const batches = Math.ceil(toInsert.length / BATCH_SIZE);

for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
  const batch = toInsert.slice(i, i + BATCH_SIZE);
  const idx = Math.floor(i / BATCH_SIZE) + 1;
  const { error } = await supabase.from('customers').insert(batch);
  if (error) {
    errored += batch.length;
    console.error(`  Batch ${idx}/${batches}: ERROR (${batch.length} rows) - ${error.message}`);
  } else {
    inserted += batch.length;
    console.log(`  Batch ${idx}/${batches}: inserted ${batch.length}`);
  }
}

// -----------------------------------------------------------------------------
// Verify counts against the DB
// -----------------------------------------------------------------------------

const eins = payloads.map((p) => p.ein);
const presentCount = await countEinsPresent(supabase, charityId, eins);
console.log(
  `\nDone. Inserted ${inserted} new row(s); ${existing.size} already existed; ` +
    `${presentCount} of ${payloads.length} DAF EINs now present.`,
);
if (errored > 0) {
  console.log(`Errored rows: ${errored}. Re-run the script; existence check will skip everything already inserted.`);
}
if (unresolved.length > 0) {
  console.log(`\nUnresolved EINs (no BMF row, manual follow-up if desired):`);
  console.log(unresolved.join(', '));
}

async function countEinsPresent(client, charity, einList) {
  // Postgres has a limit on the size of an IN-list filter when sent through
  // PostgREST. Chunk the lookup so we don't hit URL length limits at ~1500
  // EINs.
  let total = 0;
  for (let i = 0; i < einList.length; i += 500) {
    const chunk = einList.slice(i, i + 500);
    const { count, error } = await client
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('charity_id', charity)
      .in('ein', chunk);
    if (error) {
      console.error('Verification query failed:', error.message);
      return -1;
    }
    total += count ?? 0;
  }
  return total;
}
