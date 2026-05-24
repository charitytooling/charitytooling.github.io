// send-payment-instructions
//
// Body: {
//   charity_id: string,
//   customer_id: string,
//   contact_id?: string,           // omitted -> falls back to primary contact
//   method: 'check' | 'ach',
//   rep_message_md?: string        // optional rep-authored intro prepended above the canonical block
// }
//
// Auth: caller must be a member of `charity_id`.
// Action: pulls the charity's per-method payment fields, renders a canonical
//   HTML email (the rep cannot edit the bank-detail block on send), pushes
//   it through Resend, then writes email_log + a synthetic note (kind=email)
//   so the action shows up on the contact's History card. Bumps
//   customers.last_contacted_at exactly like `send-email`.

import { handleOptions, json } from '../_shared/cors.ts';
import { CHARITYTOOLING_FOOTER_HTML } from '../_shared/footer.ts';
import { requireCharityMember, userClient } from '../_shared/supabase.ts';

interface Body {
  charity_id: string;
  customer_id: string;
  contact_id?: string;
  method: 'check' | 'ach';
  rep_message_md?: string;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, { status: 405 }, origin);
  }

  try {
    const body = (await req.json()) as Partial<Body>;
    if (!body.charity_id || !body.customer_id || !body.method) {
      return json({ error: 'missing-fields' }, { status: 400 }, origin);
    }
    if (body.method !== 'check' && body.method !== 'ach') {
      return json({ error: 'unsupported-method' }, { status: 400 }, origin);
    }

    const supabase = userClient(req);
    const caller = await requireCharityMember(supabase, body.charity_id);

    const { data: charity, error: chErr } = await supabase
      .from('charities')
      .select('*')
      .eq('id', body.charity_id)
      .maybeSingle();
    if (chErr) return json({ error: chErr.message }, { status: 500 }, origin);
    if (!charity) return json({ error: 'charity-not-found' }, { status: 404 }, origin);

    const { data: customer, error: cuErr } = await supabase
      .from('customers')
      .select('id, display_name')
      .eq('id', body.customer_id)
      .maybeSingle();
    if (cuErr) return json({ error: cuErr.message }, { status: 500 }, origin);
    if (!customer) return json({ error: 'customer-not-found' }, { status: 404 }, origin);

    let contact: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null = null;
    if (body.contact_id) {
      const r = await supabase
        .from('customer_contacts')
        .select('id, first_name, last_name, email')
        .eq('id', body.contact_id)
        .eq('customer_id', body.customer_id)
        .maybeSingle();
      if (r.error) return json({ error: r.error.message }, { status: 500 }, origin);
      contact = r.data;
    } else {
      const r = await supabase
        .from('customer_contacts')
        .select('id, first_name, last_name, email')
        .eq('customer_id', body.customer_id)
        .eq('is_primary', true)
        .maybeSingle();
      if (r.error) return json({ error: r.error.message }, { status: 500 }, origin);
      contact = r.data;
    }
    if (!contact?.email) {
      return json({ error: 'customer-missing-email' }, { status: 400 }, origin);
    }
    const toEmail = contact.email;

    let subject: string;
    let canonicalHtml: string;
    if (body.method === 'check') {
      const validation = validateCheckConfig(charity);
      if (validation) return json({ error: validation }, { status: 400 }, origin);
      subject = `How to donate by check to ${charity.name}`;
      canonicalHtml = renderCheckHtml(charity);
    } else {
      const validation = validateAchConfig(charity);
      if (validation) return json({ error: validation }, { status: 400 }, origin);
      subject = `How to donate by ACH or wire to ${charity.name}`;
      canonicalHtml = renderAchHtml(charity);
    }

    const greetingName = contact.first_name?.trim() || contact.last_name?.trim() || '';
    const greeting = greetingName ? `<p>Hi ${escapeHtml(greetingName)},</p>` : '';
    const repBlock = body.rep_message_md?.trim()
      ? `<div style="margin:0 0 16px">${simpleMarkdownToHtml(body.rep_message_md.trim())}</div>`
      : '';

    const html = `
      ${greeting}
      ${repBlock}
      ${canonicalHtml}
      ${CHARITYTOOLING_FOOTER_HTML}
    `;

    const fromAddr = (charity.resend_from_email as string | null)
      ?? Deno.env.get('RESEND_DEFAULT_FROM')
      ?? 'no-reply@charitytooling.com';
    const fromName = (charity.resend_from_name as string | null) ?? (charity.name as string);

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json({ error: 'resend-not-configured' }, { status: 500 }, origin);

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <${fromAddr}>`,
        to: toEmail,
        subject,
        html,
      }),
    });
    const payload = await r.json();
    if (!r.ok) {
      return json({ error: 'resend-failed', detail: payload }, { status: 502 }, origin);
    }

    await supabase.from('email_log').insert({
      charity_id: body.charity_id,
      customer_id: body.customer_id,
      subject,
      body_html: html,
      to_email: toEmail,
      resend_id: payload.id ?? null,
      status: 'sent',
      sent_by: caller.id,
    });

    await supabase.from('notes').insert({
      charity_id: body.charity_id,
      customer_id: body.customer_id,
      kind: 'email',
      body: body.method === 'check'
        ? 'Payment instructions sent: check'
        : 'Payment instructions sent: ACH/wire',
      created_by: caller.id,
    });

    await supabase
      .from('customers')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', body.customer_id);

    return json({ ok: true, resend_id: payload.id ?? null }, {}, origin);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }, origin);
  }
});

function validateCheckConfig(charity: Record<string, unknown>): string | null {
  if (!charity.check_payable_to) return 'check-payable-to-not-configured';
  if (!charity.check_mail_to_line1) return 'check-mail-to-not-configured';
  return null;
}

function validateAchConfig(charity: Record<string, unknown>): string | null {
  if (!charity.ach_bank_name) return 'ach-bank-not-configured';
  if (!charity.ach_routing_number) return 'ach-routing-not-configured';
  if (!charity.ach_account_number) return 'ach-account-not-configured';
  return null;
}

function renderCheckHtml(charity: Record<string, unknown>): string {
  const payable = escapeHtml(charity.check_payable_to as string);
  const memo = charity.check_memo_default ? escapeHtml(charity.check_memo_default as string) : '';
  const addressLines = [
    charity.check_payable_to,
    charity.check_mail_to_line1,
    charity.check_mail_to_line2,
    [charity.check_mail_to_city, charity.check_mail_to_state]
      .filter((v) => !!v)
      .join(', ') + (charity.check_mail_to_postal_code ? ` ${charity.check_mail_to_postal_code}` : ''),
  ]
    .map((l) => (typeof l === 'string' ? l.trim() : ''))
    .filter((l) => !!l);

  const intro = charity.check_instructions_md
    ? simpleMarkdownToHtml(charity.check_instructions_md as string)
    : `<p>Thank you for considering a gift to <strong>${escapeHtml(charity.name as string)}</strong>. Here is how to send a contribution by check:</p>`;

  return `
    ${intro}
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;line-height:1.5">
      <tr>
        <td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap">Make payable to</td>
        <td style="padding:6px 0;font-weight:600">${payable}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap">Mail to</td>
        <td style="padding:6px 0">${addressLines.map((l) => escapeHtml(l)).join('<br/>')}</td>
      </tr>
      ${memo ? `<tr>
        <td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap">Memo line</td>
        <td style="padding:6px 0">${memo}</td>
      </tr>` : ''}
    </table>
    ${charity.ein ? `<p style="font-size:13px;color:#64748b">EIN: ${escapeHtml(charity.ein as string)}</p>` : ''}
  `;
}

function renderAchHtml(charity: Record<string, unknown>): string {
  const intro = charity.ach_instructions_md
    ? simpleMarkdownToHtml(charity.ach_instructions_md as string)
    : `<p>Thank you for considering a gift to <strong>${escapeHtml(charity.name as string)}</strong>. Here are the bank details for an ACH or wire transfer:</p>`;

  const rows: Array<[string, string | null | undefined]> = [
    ['Bank', charity.ach_bank_name as string | null],
    ['Account name', charity.ach_account_name as string | null],
    ['Account type', charity.ach_account_type as string | null],
    ['Routing (ABA)', charity.ach_routing_number as string | null],
    ['Account number', charity.ach_account_number as string | null],
    ['SWIFT / BIC (wire)', charity.wire_swift_bic as string | null],
  ];

  const renderedRows = rows
    .filter(([, v]) => !!(v && String(v).trim()))
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>
          <td style="padding:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(String(value))}</td>
        </tr>`,
    )
    .join('');

  const intermediary = charity.wire_intermediary_md
    ? `<div style="margin-top:16px"><div style="color:#64748b;font-size:13px;margin-bottom:4px">Intermediary / wire instructions</div>${simpleMarkdownToHtml(charity.wire_intermediary_md as string)}</div>`
    : '';

  return `
    ${intro}
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;line-height:1.5">
      ${renderedRows}
    </table>
    ${intermediary}
    ${charity.ein ? `<p style="font-size:13px;color:#64748b">EIN: ${escapeHtml(charity.ein as string)}</p>` : ''}
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Same minimal markdown helper used by the EmailComposer client. Kept inline
// rather than imported to keep the Deno bundle self-contained.
function simpleMarkdownToHtml(md: string): string {
  const blocks = md.split(/\n{2,}/).map((b) => {
    let body = escapeHtml(b).replace(/\n/g, '<br/>');
    body = body.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
    body = body.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    body = body.replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>');
    return `<p style="margin:0 0 8px">${body}</p>`;
  });
  return blocks.join('\n');
}
