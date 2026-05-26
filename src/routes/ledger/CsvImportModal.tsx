import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/Modal';

interface ParsedRow {
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
}

const FIELDS = ['display_name', 'first_name', 'last_name', 'email', 'phone', 'website'] as const;
type CanonicalField = (typeof FIELDS)[number];

const ALIASES: Record<CanonicalField, string[]> = {
  display_name: ['display_name', 'displayname', 'full name', 'fullname', 'name', 'donor', 'donor name'],
  first_name: ['first_name', 'first name', 'firstname', 'given name', 'first'],
  last_name: ['last_name', 'last name', 'lastname', 'surname', 'family name', 'last'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'phone number', 'mobile', 'cell', 'telephone'],
  website: ['website', 'site', 'url', 'web'],
};

// UTF-8 BOM so Excel on Windows opens it as UTF-8; CRLF for Excel-friendly line
// endings. Canonical headers ensure detectMapping() auto-fills every column
// when the user re-uploads this file after editing.
const SAMPLE_CSV =
  '\ufeff' +
  [
    'display_name,first_name,last_name,email,phone,website',
    'Jane Doe,Jane,Doe,jane@example.org,555-123-4567,janesfoundation.org',
    ',Carlos,Mendez,carlos@example.com,(212) 555-0199,',
    'Hopeful Hearts Foundation,,,info@hopefulhearts.example,,hopefulhearts.example',
  ].join('\r\n') + '\r\n';

function detectMapping(headers: string[]): Record<CanonicalField, string | null> {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  const mapping = {} as Record<CanonicalField, string | null>;
  for (const field of FIELDS) {
    const idx = normalized.findIndex((h) => ALIASES[field].includes(h));
    mapping[field] = idx >= 0 ? headers[idx] : null;
  }
  return mapping;
}

export function CsvImportModal({ charityId, onClose }: { charityId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [rawText, setRawText] = useState('');
  const [headerRow, setHeaderRow] = useState<string[] | null>(null);
  const [dataRows, setDataRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<CanonicalField, string | null>>({
    display_name: null,
    first_name: null,
    last_name: null,
    email: null,
    phone: null,
    website: null,
  });
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setRawText(text);
      parseText(text);
    };
    reader.readAsText(file);
  }

  function parseText(text: string) {
    setError(null);
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    if (parsed.errors.length) {
      setError(parsed.errors[0].message);
      return;
    }
    const headers = parsed.meta.fields ?? [];
    setHeaderRow(headers);
    setDataRows(parsed.data);
    setMapping(detectMapping(headers));
  }

  const preview: ParsedRow[] = useMemo(() => {
    if (!headerRow) return [];
    return dataRows.slice(0, 5).map((row) => mapRow(row, mapping));
  }, [dataRows, headerRow, mapping]);

  const importable: ParsedRow[] = useMemo(() => {
    return dataRows
      .map((row) => mapRow(row, mapping))
      .filter((r) => r.email || r.phone || r.display_name || r.first_name || r.last_name);
  }, [dataRows, mapping]);

  const importMut = useMutation({
    mutationFn: async () => {
      // Dedupe by email (case-insensitive) against existing customer
      // contacts in this charity. Email lives on customer_contacts now, so
      // join through there and read back the customer ids we already have.
      const emails = importable
        .map((r) => r.email?.toLowerCase())
        .filter((e): e is string => !!e);
      let existing: Set<string> = new Set();
      if (emails.length) {
        const { data: existingRows, error } = await supabase
          .from('customer_contacts')
          .select('email')
          .eq('charity_id', charityId)
          .in('email', emails);
        if (error) throw error;
        existing = new Set((existingRows ?? []).map((r) => (r.email ?? '').toLowerCase()));
      }

      const fresh = importable.filter((r) => !r.email || !existing.has(r.email.toLowerCase()));
      const batches: ParsedRow[][] = [];
      for (let i = 0; i < fresh.length; i += 200) batches.push(fresh.slice(i, i + 200));
      let inserted = 0;
      for (const batch of batches) {
        // Insert customers first (only the columns that still live on
        // public.customers) and read back the new ids so we can attach the
        // seeded primary contact for each row.
        const customerPayload = batch.map((r) => ({
          charity_id: charityId,
          display_name: r.display_name,
          website: r.website,
        }));
        const { data: createdRows, error } = await supabase
          .from('customers')
          .insert(customerPayload)
          .select('id');
        if (error) throw error;
        const ids = (createdRows ?? []).map((r) => r.id);
        if (ids.length !== batch.length) {
          throw new Error('Insert returned a mismatched number of rows.');
        }

        // Best-effort contact seed for rows that carry any person fields.
        const contactPayload = batch
          .map((r, i) => ({
            customer_id: ids[i],
            charity_id: charityId,
            first_name: r.first_name,
            last_name: r.last_name,
            email: r.email,
            phone: r.phone,
            is_primary: true,
          }))
          .filter(
            (c) => c.first_name || c.last_name || c.email || c.phone,
          );
        if (contactPayload.length > 0) {
          const { error: cErr } = await supabase
            .from('customer_contacts')
            .insert(contactPayload);
          if (cErr) throw cErr;
        }
        inserted += batch.length;
      }
      return { inserted, skipped: importable.length - fresh.length };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers', charityId] });
    },
  });

  if (importMut.isSuccess) {
    return (
      <Modal title="Import CSV" onClose={onClose}>
        <p>Imported {importMut.data.inserted} customer{importMut.data.inserted === 1 ? '' : 's'}.</p>
        {importMut.data.skipped > 0 && (
          <p className="text-ink-500 dark:text-ink-400 text-sm mt-1">
            Skipped {importMut.data.skipped} row{importMut.data.skipped === 1 ? '' : 's'} that matched existing emails.
          </p>
        )}
        <button type="button" className="btn-primary w-full mt-4" onClick={onClose}>
          Done
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Import CSV" onClose={onClose}>
      <div className="space-y-3">
        {!headerRow ? (
          <>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              Upload a CSV with at least one of: name, email, phone, website.
            </p>
            <button
              type="button"
              className="btn-ghost w-full"
              onClick={downloadSampleCsv}
            >
              Download sample
            </button>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            <div className="text-xs text-ink-500 dark:text-ink-400">Or paste CSV text:</div>
            <textarea
              className="field h-32 font-mono text-xs"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              onBlur={() => rawText && parseText(rawText)}
              placeholder={'name,email,phone,website\nJane Doe,jane@example.org,555-1212,janesfoundation.org'}
            />
          </>
        ) : (
          <>
            <div>
              <p className="text-sm font-medium mb-1">Map columns</p>
              <div className="space-y-2">
                {FIELDS.map((f) => (
                  <div key={f} className="flex items-center gap-2 text-sm">
                    <span className="w-28 text-ink-500 dark:text-ink-400 capitalize">{f.replace('_', ' ')}</span>
                    <select
                      className="field flex-1"
                      value={mapping[f] ?? ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || null }))}
                    >
                      <option value="">(ignore)</option>
                      {headerRow.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-1">Preview ({importable.length} rows)</p>
              <div className="text-xs text-ink-700 dark:text-ink-200 max-h-40 overflow-auto border border-ink-100 dark:border-ink-800 rounded-lg p-2">
                {preview.map((p, i) => (
                  <div key={i} className="border-b border-ink-100 dark:border-ink-800 py-1 last:border-b-0">
                    {(p.display_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '(no name)')}
                    {p.email && <span className="text-ink-400 dark:text-ink-500"> - {p.email}</span>}
                    {p.phone && <span className="text-ink-400 dark:text-ink-500"> - {p.phone}</span>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {importMut.error && <p className="text-red-600 text-sm">{(importMut.error as Error).message}</p>}

        <div className="flex gap-2 pt-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose} disabled={importMut.isPending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={importable.length === 0 || importMut.isPending}
            onClick={() => importMut.mutate()}
          >
            {importMut.isPending ? 'Importing...' : `Import ${importable.length}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function mapRow(row: Record<string, string>, mapping: Record<CanonicalField, string | null>): ParsedRow {
  function get(field: CanonicalField): string | null {
    const col = mapping[field];
    if (!col) return null;
    const v = row[col]?.trim();
    return v || null;
  }
  return {
    display_name: get('display_name'),
    first_name: get('first_name'),
    last_name: get('last_name'),
    email: get('email')?.toLowerCase() ?? null,
    phone: get('phone'),
    website: get('website'),
  };
}

function downloadSampleCsv() {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'charitytooling-customer-import-sample.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke; Safari sometimes cancels the download if we revoke too soon.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
