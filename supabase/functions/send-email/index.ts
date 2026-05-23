// send-email
//
// Body: {
//   customer_id: string,
//   charity_id: string,
//   subject: string,
//   body_html: string,
//   template_id?: string
// }
//
// Auth: caller must be a member of `charity_id`.
// Action: renders the template (Mustache vars filled by caller for now),
// sends through Resend, writes email_log + a synthetic note.

import { handleOptions, json } from '../_shared/cors.ts';
import { requireCharityMember, userClient } from '../_shared/supabase.ts';

interface Body {
  customer_id: string;
  charity_id: string;
  subject: string;
  body_html: string;
  template_id?: string;
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
    if (!body.customer_id || !body.charity_id || !body.subject || !body.body_html) {
      return json({ error: 'missing-fields' }, { status: 400 }, origin);
    }

    const supabase = userClient(req);
    const caller = await requireCharityMember(supabase, body.charity_id);

    const { data: charity, error: chErr } = await supabase
      .from('charities')
      .select('id, name, resend_from_email, resend_from_name')
      .eq('id', body.charity_id)
      .maybeSingle();
    if (chErr) return json({ error: chErr.message }, { status: 500 }, origin);
    if (!charity) return json({ error: 'charity-not-found' }, { status: 404 }, origin);

    const { data: customer, error: cuErr } = await supabase
      .from('customers')
      .select('id, first_name, last_name, display_name, email')
      .eq('id', body.customer_id)
      .maybeSingle();
    if (cuErr) return json({ error: cuErr.message }, { status: 500 }, origin);
    if (!customer?.email) return json({ error: 'customer-missing-email' }, { status: 400 }, origin);

    const fromAddr = charity.resend_from_email ?? Deno.env.get('RESEND_DEFAULT_FROM') ?? 'no-reply@charitytooling.com';
    const fromName = charity.resend_from_name ?? charity.name;

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
        to: customer.email,
        subject: body.subject,
        html: body.body_html,
      }),
    });
    const payload = await r.json();

    if (!r.ok) {
      return json({ error: 'resend-failed', detail: payload }, { status: 502 }, origin);
    }

    await supabase.from('email_log').insert({
      charity_id: body.charity_id,
      customer_id: body.customer_id,
      template_id: body.template_id ?? null,
      subject: body.subject,
      body_html: body.body_html,
      to_email: customer.email,
      resend_id: payload.id ?? null,
      status: 'sent',
      sent_by: caller.id,
    });

    await supabase.from('notes').insert({
      charity_id: body.charity_id,
      customer_id: body.customer_id,
      kind: 'email',
      body: `Email sent: ${body.subject}`,
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
