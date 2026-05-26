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
// Action: pulls the charity's per-method payment fields, renders an email
//   honoring any per-method subject/body/data-block override stored on the
//   charity row (see _shared/payment_email.ts), pushes it through Resend,
//   then writes email_log + a synthetic note (kind=email) so the action
//   shows up on the contact's History card. Bumps customers.last_contacted_at
//   exactly like `send-email`.

import { handleOptions, json } from '../_shared/cors.ts';
import {
  assembleEmail,
  escapeHtml,
  markdownToEmailHtml,
  renderDataBlock,
  type DataBlockConfig,
} from '../_shared/payment_email.ts';
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

    if (body.method === 'check') {
      const validation = validateCheckConfig(charity);
      if (validation) return json({ error: validation }, { status: 400 }, origin);
    } else {
      const validation = validateAchConfig(charity);
      if (validation) return json({ error: validation }, { status: 400 }, origin);
    }

    const subjectTemplate =
      body.method === 'check'
        ? (charity.check_subject_template as string | null)
        : (charity.ach_subject_template as string | null);
    const bodyTemplate =
      body.method === 'check'
        ? (charity.check_body_template_md as string | null)
        : (charity.ach_body_template_md as string | null);
    const dataBlockConfig =
      body.method === 'check'
        ? ((charity.check_data_block as DataBlockConfig | null) ?? null)
        : ((charity.ach_data_block as DataBlockConfig | null) ?? null);

    const dataBlockHtml = renderDataBlock({
      method: body.method,
      charity: charity as Record<string, unknown>,
      config: dataBlockConfig,
    });

    const greetingName = contact.first_name?.trim() || contact.last_name?.trim() || '';
    const greetingHtml = greetingName ? `<p>Hi ${escapeHtml(greetingName)},</p>` : '';
    const repMessageHtml = body.rep_message_md?.trim()
      ? `<div style="margin:0 0 16px">${markdownToEmailHtml(body.rep_message_md.trim())}</div>`
      : '';

    const fallbackSubject =
      body.method === 'check'
        ? `How to donate by check to ${charity.name}`
        : `How to donate by ACH or wire to ${charity.name}`;

    // Canonical fallback body mirrors what the prior hard-coded
    // renderCheckHtml/renderAchHtml produced: optional intro Markdown,
    // the structured table, and (when known) the EIN line. Greeting and
    // rep-authored block are prepended outside the renderer so admins can
    // ship custom bodies that include {{rep_message}} in any position.
    const introMd =
      body.method === 'check'
        ? (charity.check_instructions_md as string | null)
        : (charity.ach_instructions_md as string | null);
    const introHtml = introMd
      ? markdownToEmailHtml(introMd)
      : body.method === 'check'
        ? `<p>Thank you for considering a gift to <strong>${escapeHtml(charity.name as string)}</strong>. Here is how to send a contribution by check:</p>`
        : `<p>Thank you for considering a gift to <strong>${escapeHtml(charity.name as string)}</strong>. Here are the bank details for an ACH or wire transfer:</p>`;
    const intermediaryHtml =
      body.method === 'ach' && charity.wire_intermediary_md
        ? `<div style="margin-top:16px"><div style="color:#64748b;font-size:13px;margin-bottom:4px">Intermediary / wire instructions</div>${markdownToEmailHtml(charity.wire_intermediary_md as string)}</div>`
        : '';
    const einLine = charity.ein
      ? `<p style="font-size:13px;color:#64748b">EIN: ${escapeHtml(charity.ein as string)}</p>`
      : '';

    const fallbackBodyHtml = `
      ${greetingHtml}
      ${repMessageHtml}
      ${introHtml}
      ${dataBlockHtml}
      ${intermediaryHtml}
      ${einLine}
    `;

    const { subject, html } = assembleEmail({
      subjectTemplate,
      bodyTemplateMd: bodyTemplate,
      fallbackSubject,
      fallbackBodyHtml,
      vars: {
        charity_name: charity.name as string,
        ein: (charity.ein as string | null) ?? '',
        customer_display_name: (customer.display_name as string | null) ?? '',
        contact_first_name: contact.first_name ?? '',
        contact_last_name: contact.last_name ?? '',
        rep_message: repMessageHtml,
        data_block: dataBlockHtml,
        // {{footer}} is set inside assembleEmail; if the admin places the
        // placeholder in their template we substitute the canonical HTML
        // there, otherwise it is trailing-appended. See payment_email.ts.
      },
    });

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
