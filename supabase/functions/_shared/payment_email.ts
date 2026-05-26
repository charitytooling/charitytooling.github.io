// Shared rendering pipeline for donation-related emails.
//
// All four donation-method emails (Check, ACH/Wire, Cash receipt, Card)
// flow through the same three primitives so admins can override any of
// them via per-method columns on `public.charities`:
//
//   <method>_subject_template   text       (overrides the canonical subject)
//   <method>_body_template_md   text       (overrides the canonical body MD)
//   <method>_data_block         jsonb      (overrides labels/order/rows in
//                                           the structured table block)
//
// When all three are null for a given method, the canonical defaults are
// used unchanged -- the migration is fully backwards-compatible.
//
// Variables available in templates (substituted via `substituteTemplate`):
//   {{charity_name}}              text
//   {{ein}}                       text or empty
//   {{customer_display_name}}     text
//   {{contact_first_name}}        text or empty
//   {{contact_last_name}}         text or empty
//   {{rep_message}}               pre-rendered HTML (rep-authored intro)
//   {{data_block}}                pre-rendered HTML (the canonical table)
//   {{footer}}                    pre-rendered HTML (CharityTooling trust footer)
//   {{donate_url}}                card only -- Stripe hosted invoice URL
//   {{receipt_number}}            cash only
//   {{amount}}                    cash only -- already formatted as USD
//
// The CharityTooling footer is always appended to the assembled HTML
// regardless of whether the template references {{footer}}. We intentionally
// do not let admins remove it -- the trust framing is part of the product
// promise and must ship on every outbound message.

import { CHARITYTOOLING_FOOTER_HTML } from './footer.ts';

// Method discriminant used by `renderDataBlock` to pick the right canonical
// row set. The four values mirror the per-method tabs in the admin UI.
export type DonationMethod = 'check' | 'cash' | 'card' | 'ach';

// JSON shape stored in `<method>_data_block`. Each entry either references a
// canonical row by `key` (with optional label override and `omit` flag) or
// is a literal {label, value} pair via `custom: true`.
export type DataBlockRow =
  | { key: string; label?: string; omit?: boolean }
  | { custom: true; label: string; value: string };

export interface DataBlockConfig {
  rows: DataBlockRow[];
}

// All charity columns the renderers might read from. Kept loose so callers
// can pass the raw row object straight off Supabase.
export type CharityLike = Record<string, unknown>;

export interface AssembleArgs {
  // When non-empty, replaces the canonical subject string. Variables in the
  // template are substituted before send.
  subjectTemplate: string | null | undefined;
  // When non-empty, replaces the canonical body. The Markdown is rendered
  // with `markdownToEmailHtml` after `{{var}}` substitution. {{data_block}}
  // and {{footer}} let the admin compose where the canonical pieces appear.
  bodyTemplateMd: string | null | undefined;
  // Subject used when subjectTemplate is null/blank.
  fallbackSubject: string;
  // Body HTML used when bodyTemplateMd is null/blank. Already includes the
  // data block where appropriate; the footer is appended separately by
  // assembleEmail so it cannot be accidentally dropped.
  fallbackBodyHtml: string;
  vars: Record<string, string>;
}

export interface AssembledEmail {
  subject: string;
  html: string;
}

// `{{name}}` -> vars[name]. Unknown tokens are left as-is so admins notice
// typos. We intentionally do not support nested expressions, conditionals,
// or recursive expansion -- if someone needs that, they should override the
// whole body and pre-render it.
export function substituteTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return vars[name];
    }
    return match;
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Minimal subset: paragraphs, hard breaks, **bold**, *italic*, [link](url).
// Same shape as the helpers previously inlined into
// send-payment-instructions and DonationInstructionsCard so output stays
// byte-identical when no templates are set.
export function markdownToEmailHtml(md: string): string {
  return md
    .split(/\n{2,}/)
    .map((b) => {
      let body = escapeHtml(b).replace(/\n/g, '<br/>');
      body = body.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
      body = body.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      body = body.replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>');
      return `<p style="margin:0 0 8px">${body}</p>`;
    })
    .join('\n');
}

// Canonical row sets per method. Each entry resolves to either a single
// charity column (`column`), a multi-line group (`composite`), or a
// non-charity-derived value supplied by the caller (`derived`). The labels
// here are the defaults the donor sees when no `<method>_data_block`
// override is set; admins can rename via `data_block.rows[].label`.
type CanonicalRow = {
  key: string;
  label: string;
  monospace?: boolean;
  bold?: boolean;
  resolve: (charity: CharityLike) => string | null;
};

function trimOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  return String(value);
}

function checkAddressLines(charity: CharityLike): string[] {
  const lines = [
    trimOrNull(charity.check_payable_to),
    trimOrNull(charity.check_mail_to_line1),
    trimOrNull(charity.check_mail_to_line2),
    [trimOrNull(charity.check_mail_to_city), trimOrNull(charity.check_mail_to_state)]
      .filter((x): x is string => !!x)
      .join(', ') +
      (trimOrNull(charity.check_mail_to_postal_code)
        ? ` ${trimOrNull(charity.check_mail_to_postal_code)}`
        : ''),
  ];
  return lines.map((l) => (l ?? '').trim()).filter((l) => l.length > 0);
}

const CHECK_CANONICAL: CanonicalRow[] = [
  {
    key: 'check_payable_to',
    label: 'Make payable to',
    bold: true,
    resolve: (c) => trimOrNull(c.check_payable_to),
  },
  {
    // Logical "block" key covering the whole mailing address, rendered as
    // multiple <br/>-separated lines.
    key: 'check_mail_to',
    label: 'Mail to',
    resolve: (c) => {
      const lines = checkAddressLines(c);
      return lines.length > 0 ? lines.map(escapeHtml).join('<br/>') : null;
    },
  },
  {
    key: 'check_memo_default',
    label: 'Memo line',
    resolve: (c) => trimOrNull(c.check_memo_default),
  },
];

const ACH_CANONICAL: CanonicalRow[] = [
  { key: 'ach_bank_name', label: 'Bank', resolve: (c) => trimOrNull(c.ach_bank_name) },
  { key: 'ach_account_name', label: 'Account name', resolve: (c) => trimOrNull(c.ach_account_name) },
  { key: 'ach_account_type', label: 'Account type', resolve: (c) => trimOrNull(c.ach_account_type) },
  {
    key: 'ach_routing_number',
    label: 'Routing (ABA)',
    monospace: true,
    resolve: (c) => trimOrNull(c.ach_routing_number),
  },
  {
    key: 'ach_account_number',
    label: 'Account number',
    monospace: true,
    resolve: (c) => trimOrNull(c.ach_account_number),
  },
  {
    key: 'wire_swift_bic',
    label: 'SWIFT / BIC (wire)',
    monospace: true,
    resolve: (c) => trimOrNull(c.wire_swift_bic),
  },
];

// Canonical rows shown in the cash receipt "data block". The amount and
// receipt number come from the live donation, not the charity row, so they
// are passed in via `extra`.
function cashCanonical(extra: { receipt_number: string; amount: string }): CanonicalRow[] {
  return [
    { key: 'receipt_number', label: 'Receipt #', resolve: () => extra.receipt_number },
    { key: 'amount', label: 'Amount', resolve: () => extra.amount },
  ];
}

// Canonical rows for the card email. The donate URL is supplied by the
// caller (created upstream by Stripe). The amount is optional; when null
// the row is omitted.
function cardCanonical(extra: { donate_url: string; amount: string | null }): CanonicalRow[] {
  return [
    {
      key: 'donate_url',
      label: 'Give by card',
      resolve: () => `<a href="${escapeHtml(extra.donate_url)}">${escapeHtml(extra.donate_url)}</a>`,
    },
    ...(extra.amount
      ? [{ key: 'amount', label: 'Amount', resolve: () => extra.amount! }]
      : []),
  ];
}

// Builds the structured data block as an HTML <table>. Honors a
// `<method>_data_block` override: rename labels (`row.label`), drop rows
// (`row.omit`), reorder rows (array order), or inject literal rows
// (`{ custom: true, label, value }`). When `config` is null/empty, the
// canonical row set for the method is used as-is.
export function renderDataBlock(args: {
  method: DonationMethod;
  charity: CharityLike;
  config: DataBlockConfig | null | undefined;
  // Method-specific extras the canonical row set needs. Cash needs the
  // receipt number + formatted amount; card needs the donate URL.
  cashExtra?: { receipt_number: string; amount: string };
  cardExtra?: { donate_url: string; amount: string | null };
}): string {
  const canonical: CanonicalRow[] = (() => {
    switch (args.method) {
      case 'check':
        return CHECK_CANONICAL;
      case 'ach':
        return ACH_CANONICAL;
      case 'cash':
        return cashCanonical(
          args.cashExtra ?? { receipt_number: '', amount: '' },
        );
      case 'card':
        return cardCanonical(
          args.cardExtra ?? { donate_url: '', amount: null },
        );
    }
  })();
  const byKey = new Map<string, CanonicalRow>();
  for (const r of canonical) byKey.set(r.key, r);

  // Resolve to a list of rendered rows in display order.
  const rendered: Array<{ label: string; value: string; monospace?: boolean; bold?: boolean }> = [];

  const cfgRows = args.config?.rows;
  if (cfgRows && cfgRows.length > 0) {
    for (const row of cfgRows) {
      if ('custom' in row && row.custom) {
        if (!row.label?.trim() || !row.value?.trim()) continue;
        rendered.push({ label: row.label.trim(), value: escapeHtml(row.value.trim()) });
        continue;
      }
      if ('omit' in row && row.omit) continue;
      if ('key' in row) {
        const c = byKey.get(row.key);
        if (!c) continue;
        const value = c.resolve(args.charity);
        if (!value) continue;
        const label = (row.label?.trim() || c.label);
        // `check_mail_to` and `donate_url` resolve to pre-built HTML; other
        // canonical rows resolve to plain strings that still need escaping.
        const valueHtml =
          row.key === 'check_mail_to' || row.key === 'donate_url'
            ? value
            : escapeHtml(value);
        rendered.push({ label, value: valueHtml, monospace: c.monospace, bold: c.bold });
      }
    }
  } else {
    for (const c of canonical) {
      const value = c.resolve(args.charity);
      if (!value) continue;
      const valueHtml =
        c.key === 'check_mail_to' || c.key === 'donate_url' ? value : escapeHtml(value);
      rendered.push({ label: c.label, value: valueHtml, monospace: c.monospace, bold: c.bold });
    }
  }

  if (rendered.length === 0) return '';

  const rows = rendered
    .map((r) => {
      const valueStyles = ['padding:6px 0'];
      if (r.bold) valueStyles.push('font-weight:600');
      if (r.monospace) valueStyles.push('font-family:ui-monospace,SFMono-Regular,Menlo,monospace');
      return `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap">${escapeHtml(r.label)}</td>
          <td style="${valueStyles.join(';')}">${r.value}</td>
        </tr>`;
    })
    .join('');

  return `
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;line-height:1.5">
      ${rows}
    </table>
  `;
}

// Block-level placeholders carry pre-rendered HTML (a <table>, a <hr>+<p>
// footer, or a multi-paragraph rep intro). When admins drop these into a
// Markdown body, we must *not* let the Markdown renderer wrap them in
// `<p style="...">...</p>` -- a `<table>` inside a `<p>` is invalid in HTML
// and renders unpredictably across Gmail / Apple Mail / Outlook web.
//
// To get this right we pre-replace block placeholders with private-use
// Unicode sentinels (which `escapeHtml` and the Markdown helper leave
// untouched), then run Markdown, then substitute the sentinels back --
// stripping any `<p>` wrapper the renderer may have added when a sentinel
// occupied its own line.
const BLOCK_PLACEHOLDERS = ['data_block', 'footer', 'rep_message'] as const;

function renderBodyTemplate(bodyTemplateMd: string, vars: Record<string, string>): string {
  let working = bodyTemplateMd.trim();
  const sentinelToHtml = new Map<string, string>();
  BLOCK_PLACEHOLDERS.forEach((name, i) => {
    const html = vars[name];
    if (typeof html !== 'string') return;
    const sentinel = `\uE0F0BLOCK${i}\uE0F0`;
    sentinelToHtml.set(sentinel, html);
    working = working.split(`{{${name}}}`).join(sentinel);
    working = working.split(`{{ ${name} }}`).join(sentinel);
  });
  // Inline (non-block) substitutions happen on the raw Markdown so admins
  // can use {{charity_name}} inside bold/italic without surprises.
  working = substituteTemplate(working, vars);
  let rendered = markdownToEmailHtml(working);
  for (const [sentinel, html] of sentinelToHtml.entries()) {
    // Strip the wrapping <p style="..."> when a sentinel is the *only*
    // content of its paragraph. This keeps the canonical table/footer/
    // rep-message HTML at block level, where it belongs.
    rendered = rendered.replace(
      new RegExp(`<p style="[^"]*">\\s*${sentinel}\\s*</p>`, 'g'),
      html,
    );
    rendered = rendered.split(sentinel).join(html);
  }
  return rendered;
}

// Final assembly. Mirrors the per-function handcrafted strings but routes
// through the shared template machinery so admin overrides take effect.
//
// Footer handling: admins do not need (and cannot truly suppress) the
// CharityTooling trust footer. They CAN choose where it lands by writing
// `{{footer}}` somewhere in their body template -- in that case we
// substitute the canonical footer HTML there and skip the trailing append.
// Otherwise we always trailing-append. We override `vars.footer` here so
// callers cannot accidentally pass an empty string.
export function assembleEmail(args: AssembleArgs): AssembledEmail {
  const vars = { ...args.vars, footer: CHARITYTOOLING_FOOTER_HTML };
  const subject = args.subjectTemplate?.trim()
    ? substituteTemplate(args.subjectTemplate.trim(), vars)
    : args.fallbackSubject;

  const bodyHtml = args.bodyTemplateMd?.trim()
    ? renderBodyTemplate(args.bodyTemplateMd, vars)
    : args.fallbackBodyHtml;

  const adminPlacedFooter = !!args.bodyTemplateMd?.trim() && /\{\{\s*footer\s*\}\}/.test(args.bodyTemplateMd);
  const html = adminPlacedFooter ? bodyHtml : `${bodyHtml}\n${CHARITYTOOLING_FOOTER_HTML}`;

  return { subject, html };
}
