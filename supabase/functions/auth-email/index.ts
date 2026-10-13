// auth-email
//
// Supabase Auth "Send Email" hook. Supabase calls this instead of its own
// mailer for every sign-in email (invite, password reset, sign-in link,
// confirmation, email change, reauthentication code). We pick the app from
// the link the email will open (costtooling.com → CostTooling, otherwise
// CharityTooling), write a short branded email that names the inviter and
// the company or charity when we know them, and send it through Resend.
//
// Auth: no JWT. Supabase signs each call with the Standard Webhooks scheme
// using the secret in SEND_EMAIL_HOOK_SECRET (the same value set as
// hook_send_email_secrets on the project). Anything unsigned is refused.
//
// Response contract: 200 with {} on success; { error: { http_code, message } }
// otherwise, which makes Supabase report the failure to the caller.

import { Webhook } from 'npm:standardwebhooks@1.0.0';

type ActionType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'reauthentication' | string;

interface HookPayload {
  user: { id: string; email: string; user_metadata?: Record<string, unknown>; new_email?: string };
  email_data: {
    token: string; token_hash: string; redirect_to: string; email_action_type: ActionType;
    site_url: string; token_new?: string; token_hash_new?: string;
  };
}

const BRANDS = {
  ct: {
    name: 'CostTooling',
    from: 'CostTooling <hello@costtooling.com>',
    fallbackFrom: 'CostTooling <hello@charitytooling.com>',
    site: 'https://costtooling.com',
    what: 'the job tracker',
    mark: 'CT', markBg: '#f2c230', markFg: '#111111', button: '#111111', buttonFg: '#f2c230',
    forgot: 'open costtooling.com, tap the account button, then "Forgot password?"',
    footer: 'Step-by-step photos: costtooling.com/guide',
    footerUrl: 'https://costtooling.com/guide/',
  },
  charity: {
    name: 'CharityTooling',
    from: 'CharityTooling <hello@charitytooling.com>',
    fallbackFrom: 'CharityTooling <auth@charitytooling.com>',
    site: 'https://charitytooling.com',
    what: 'the donor and outreach tool',
    mark: '♥', markBg: '#2f63e8', markFg: '#ffffff', button: '#2f63e8', buttonFg: '#ffffff',
    forgot: 'open charitytooling.com, click "Sign in", then "Forgot password?"',
    footer: 'Questions? Reply to this email.',
    footerUrl: '',
  },
} as const;
type Brand = typeof BRANDS[keyof typeof BRANDS];

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const str = (v: unknown) => (typeof v === 'string' && v.trim()) ? v.trim() : '';
const firstName = (full: string, email: string) => (full.split(/\s+/)[0] || email.split('@')[0] || 'there');

function appFor(redirectTo: string, meta: Record<string, unknown>): keyof typeof BRANDS {
  try { const h = new URL(redirectTo).hostname; if (/costtooling\.com$/.test(h) || h === '127.0.0.1') return 'ct'; if (/charitytooling\.com$/.test(h)) return 'charity'; } catch { /* no redirect */ }
  return meta.app === 'ct' ? 'ct' : 'charity';
}

function compose(p: HookPayload, b: Brand) {
  const meta = p.user.user_metadata ?? {};
  const first = firstName(str(meta.full_name), p.user.email);
  const inviter = str(meta.invited_by_name);
  const tenant = str(meta.tenant_name);
  const type = p.email_data.email_action_type;
  const verify = (hash: string, t: string) => `${Deno.env.get('SUPABASE_URL')}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=${encodeURIComponent(t)}&redirect_to=${encodeURIComponent(p.email_data.redirect_to || b.site)}`;
  const expiry = 'The button works for one hour and only once.';
  let subject: string, lead: string, button: string | null = null, link = verify(p.email_data.token_hash, type), after: string, code: string | null = null;

  switch (type) {
    case 'invite': {
      const where = tenant ? `${b.what} for ${tenant}` : b.what;
      subject = inviter && tenant ? `${inviter} added you to ${tenant} on ${b.name}` : `You're set up on ${b.name}`;
      lead = `${inviter || 'Someone on your team'} set you up on ${b.name}, ${where}. Tap the button, choose a password, and you're in.`;
      button = `Open ${b.name}`;
      after = `${expiry} If it has expired, ${b.forgot}, and we'll send a fresh one.`;
      break;
    }
    case 'recovery':
      subject = `Reset your ${b.name} password`;
      lead = `Tap the button to choose a new password for ${b.name}.`;
      button = 'Choose a new password';
      after = `${expiry} If you didn't ask for this, ignore this email. Your password stays the same.`;
      break;
    case 'magiclink':
      subject = `Your ${b.name} sign-in link`;
      lead = `Tap the button to sign in to ${b.name}. No password needed.`;
      button = `Sign in to ${b.name}`;
      after = `${expiry} If you didn't ask for this, ignore this email.`;
      break;
    case 'signup':
      subject = `Confirm your email for ${b.name}`;
      lead = `Tap the button to confirm this email address and finish setting up ${b.name}.`;
      button = 'Confirm email';
      after = expiry;
      break;
    case 'email_change':
      subject = `Confirm your new email for ${b.name}`;
      lead = `You asked to change your ${b.name} sign-in email${p.user.new_email ? ` to ${p.user.new_email}` : ''}. Tap the button to confirm.`;
      button = 'Confirm new email';
      link = verify(p.email_data.token_hash_new || p.email_data.token_hash, 'email_change');
      after = `${expiry} If you didn't ask for this, ignore this email and nothing changes.`;
      break;
    case 'reauthentication':
      subject = `Your ${b.name} code is ${p.email_data.token}`;
      lead = `Type this code into ${b.name} to continue.`;
      code = p.email_data.token;
      after = 'The code works for one hour. If you didn\'t ask for it, ignore this email.';
      break;
    default:
      subject = `${b.name}: action needed`;
      lead = `Tap the button to continue in ${b.name}.`;
      button = 'Continue';
      after = expiry;
  }

  const text = [`Hi ${first},`, '', lead, '', button ? `${button}: ${link}` : `Your code: ${code}`, '', after, '', b.footer, b.footerUrl].filter(l => l !== undefined).join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f2ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1b1a17">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ec"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;border:1px solid #e6e2d8">
<tr><td style="padding:28px 28px 8px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="width:40px;height:40px;border-radius:11px;background:${b.markBg};color:${b.markFg};font-weight:700;font-size:16px;text-align:center;vertical-align:middle">${esc(b.mark)}</td>
    <td style="padding-left:12px;font-size:18px;font-weight:700">${esc(b.name)}</td>
  </tr></table>
</td></tr>
<tr><td style="padding:12px 28px 0;font-size:19px;line-height:1.5">Hi ${esc(first)},</td></tr>
<tr><td style="padding:12px 28px 0;font-size:19px;line-height:1.5">${esc(lead)}</td></tr>
${button ? `<tr><td style="padding:24px 28px 0"><a href="${esc(link)}" style="display:inline-block;background:${b.button};color:${b.buttonFg};text-decoration:none;font-weight:700;font-size:19px;padding:16px 26px;border-radius:14px">${esc(button)}</a></td></tr>` : ''}
${code ? `<tr><td style="padding:24px 28px 0"><div style="display:inline-block;font-family:Menlo,Consolas,monospace;font-size:34px;letter-spacing:.25em;font-weight:700;background:#f4f2ec;border-radius:14px;padding:16px 22px">${esc(code)}</div></td></tr>` : ''}
<tr><td style="padding:22px 28px 0;font-size:16px;line-height:1.5;color:#5f5b52">${esc(after)}</td></tr>
<tr><td style="padding:22px 28px 28px;font-size:15px;line-height:1.5;color:#5f5b52;border-top:1px solid #efece4;margin-top:22px">${b.footerUrl ? `<a href="${esc(b.footerUrl)}" style="color:#5f5b52">${esc(b.footer)}</a>` : esc(b.footer)}</td></tr>
</table>
${button ? `<p style="max-width:520px;margin:16px 0 0;font-size:13px;line-height:1.5;color:#8a857a">If the button doesn't work, copy this address into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>` : ''}
</td></tr></table></body></html>`;
  return { subject, html, text };
}

async function send(from: string, to: string, subject: string, html: string, text: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body };
}

const fail = (code: number, message: string) => new Response(JSON.stringify({ error: { http_code: code, message } }), { status: code, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail(405, 'method-not-allowed');
  const secret = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').replace('v1,whsec_', '');
  if (!secret) return fail(500, 'hook-secret-not-configured');
  const raw = await req.text();
  let payload: HookPayload;
  try {
    payload = new Webhook(secret).verify(raw, Object.fromEntries(req.headers)) as HookPayload;
  } catch (e) {
    return fail(401, `bad-signature: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!payload?.user?.email || !payload?.email_data) return fail(400, 'bad-payload');

  const to = payload.email_data.email_action_type === 'email_change' && payload.user.new_email ? payload.user.new_email : payload.user.email;
  const brand = BRANDS[appFor(payload.email_data.redirect_to, payload.user.user_metadata ?? {})];
  const { subject, html, text } = compose(payload, brand);

  // Send from the app's own domain; if Resend refuses that sender (domain not
  // verified yet), fall back to the charitytooling.com domain with the same
  // display name so the email still arrives.
  let res = await send(brand.from, to, subject, html, text);
  if (!res.ok && /domain|not verified|from/i.test(res.body)) { console.warn('auth-email: sender rejected, using fallback', brand.from, res.body.slice(0, 160)); res = await send(brand.fallbackFrom, to, subject, html, text); }
  if (!res.ok) { console.error('auth-email resend failed', res.status, res.body); return fail(500, `resend-failed: ${res.status}`); }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
});
