import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { edgeFunctions } from '@/lib/edgeFunctions';
import { supabase } from '@/lib/supabase';
import { renderTemplate, useTemplates } from '@/state/templates';
import type { CustomerRow } from '@/state/customers';
import { displayName, primaryContact, sortedContacts } from '@/state/customers';

export function EmailComposer({ customer, onClose }: { customer: CustomerRow; onClose: () => void }) {
  const templates = useTemplates(customer.charity_id);
  const usable = (templates.data ?? []).filter((t) => t.kind !== 'donation_receipt');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [includeDonate, setIncludeDonate] = useState(false);
  const [donateAmountUsd, setDonateAmountUsd] = useState('');

  // Build the recipient list once per customer: every contact that has an
  // email. Default the picker to the primary so the previous behaviour
  // (always-to-primary) is preserved.
  const emailContacts = useMemo(
    () => sortedContacts(customer).filter((c) => !!c.email?.trim()),
    [customer],
  );
  const primary = primaryContact(customer);
  const [contactId, setContactId] = useState<string>(() => {
    if (primary?.email) return primary.id;
    return emailContacts[0]?.id ?? '';
  });
  const chosen = emailContacts.find((c) => c.id === contactId) ?? primary ?? emailContacts[0] ?? null;

  const charity = useQuery({
    queryKey: ['charity-stripe', customer.charity_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('charities')
        .select('stripe_charges_enabled')
        .eq('id', customer.charity_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const stripeReady = charity.data?.stripe_charges_enabled === true;

  // Resolve `{{customer.first_name|last_name|email|phone}}` against the
  // chosen contact for back-compat with existing templates. Also expose
  // `{{contact.*}}` so new templates can be explicit.
  const vars: Record<string, string> = useMemo(
    () => ({
      'customer.first_name': chosen?.first_name ?? '',
      'customer.last_name': chosen?.last_name ?? '',
      'customer.display_name': displayName(customer),
      'customer.email': chosen?.email ?? '',
      'customer.phone': chosen?.phone ?? '',
      'contact.first_name': chosen?.first_name ?? '',
      'contact.last_name': chosen?.last_name ?? '',
      'contact.email': chosen?.email ?? '',
      'contact.phone': chosen?.phone ?? '',
      'contact.note': chosen?.note ?? '',
    }),
    [customer, chosen],
  );

  useEffect(() => {
    if (!templateId) return;
    const t = usable.find((x) => x.id === templateId);
    if (!t) return;
    setSubject(renderTemplate(t.subject, vars));
    setBody(renderTemplate(t.body_md, vars));
  }, [templateId, usable, vars]);

  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: async () => {
      let finalBody = body;
      if (includeDonate && stripeReady) {
        const amountCents = donateAmountUsd
          ? Math.round(parseFloat(donateAmountUsd) * 100)
          : undefined;
        const { url } = await edgeFunctions.stripeCheckout({
          charity_id: customer.charity_id,
          customer_id: customer.id,
          amount_cents: amountCents,
        });
        finalBody = `${body}\n\n[Donate now](${url})`;
      }
      const bodyHtml = simpleMarkdownToHtml(finalBody);
      return edgeFunctions.sendEmail({
        charity_id: customer.charity_id,
        customer_id: customer.id,
        contact_id: chosen?.id,
        subject,
        body_html: bodyHtml,
        template_id: templateId ?? undefined,
      });
    },
    onSuccess: () => {
      // The send-email Edge Function inserts a notes row and bumps
      // last_contacted_at server-side. Refresh those caches so the History
      // panel and Ledger reflect the change immediately.
      qc.invalidateQueries({ queryKey: ['notes', customer.id] });
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer_ids_with_open_followups'] });
      onClose();
    },
  });

  return (
    <Modal title={`Email ${displayName(customer)}`} onClose={onClose}>
      <div className="space-y-3">
        {usable.length > 0 && (
          <div>
            <label className="label">Template</label>
            <select
              className="field"
              value={templateId ?? ''}
              onChange={(e) => setTemplateId(e.target.value || null)}
            >
              <option value="">(blank)</option>
              {usable.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">To</label>
          {emailContacts.length > 1 ? (
            <select
              className="field"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              {emailContacts.map((c) => {
                const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
                return (
                  <option key={c.id} value={c.id}>
                    {name ? `${name} <${c.email}>` : c.email}
                    {c.is_primary ? ' (primary)' : ''}
                  </option>
                );
              })}
            </select>
          ) : (
            <input className="field" value={chosen?.email ?? ''} disabled />
          )}
        </div>
        <div>
          <label className="label">Subject</label>
          <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <label className="label">Body (markdown)</label>
          <textarea
            className="field font-mono text-sm"
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        {stripeReady && (
          <div className="border-t border-ink-100 dark:border-ink-800 pt-3 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeDonate}
                onChange={(e) => setIncludeDonate(e.target.checked)}
              />
              Include a "Donate now" Stripe checkout link
            </label>
            {includeDonate && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-500 dark:text-ink-400">Suggested amount (USD):</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="1"
                  className="field w-32"
                  value={donateAmountUsd}
                  onChange={(e) => setDonateAmountUsd(e.target.value)}
                  placeholder="(donor picks)"
                />
              </div>
            )}
          </div>
        )}
        {send.error && <p className="text-red-600 text-sm">{(send.error as Error).message}</p>}
        <div className="flex gap-2 pt-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose} disabled={send.isPending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={!subject || !body || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Tiny markdown helper - enough for paragraphs, line breaks, and links.
 * For richer templates, replace this with `marked` later.
 */
function simpleMarkdownToHtml(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocks = md.split(/\n{2,}/).map((b) => {
    let body = escape(b).replace(/\n/g, '<br/>');
    body = body.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
    body = body.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    body = body.replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>');
    return `<p>${body}</p>`;
  });
  return blocks.join('\n');
}
