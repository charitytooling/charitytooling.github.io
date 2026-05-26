// Client-side mirror of supabase/functions/_shared/payment_email.ts.
//
// Two pieces of code render donation emails:
//   - The Edge Functions in supabase/functions/* (Deno, runs at send time).
//   - The "Preview email" panel in src/routes/admin/DonationInstructionsCard.tsx
//     (browser, runs while the admin is editing templates).
//
// Both must produce the same HTML so admins see exactly what donors will
// receive. Deno and Vite can't share source today, so the two files are
// hand-mirrored. If you change one, change the other or the preview will
// drift from reality.

const CHARITYTOOLING_FOOTER_HTML = `
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px" />
  <p style="font-size:12px;color:#64748b;line-height:1.5;margin:0">
    Sent via <a href="https://charitytooling.com" style="color:#2563eb;text-decoration:none">CharityTooling</a> -
    we only work with charities that spend 95%+ of revenue on charitable programs,
    verified against their IRS Form 990.
    <a href="https://charitytooling.com" style="color:#2563eb;text-decoration:none">Learn how we verify.</a>
  </p>
`;

export type DonationMethod = 'check' | 'cash' | 'card' | 'ach';

export type DataBlockRow =
  | { key: string; label?: string; omit?: boolean }
  | { custom: true; label: string; value: string };

export interface DataBlockConfig {
  rows: DataBlockRow[];
}

export type CharityLike = Record<string, unknown>;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

export function substituteTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return vars[name];
    }
    return match;
  });
}

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
  { key: 'check_payable_to', label: 'Make payable to', bold: true, resolve: (c) => trimOrNull(c.check_payable_to) },
  {
    key: 'check_mail_to',
    label: 'Mail to',
    resolve: (c) => {
      const lines = checkAddressLines(c);
      return lines.length > 0 ? lines.map(escapeHtml).join('<br/>') : null;
    },
  },
  { key: 'check_memo_default', label: 'Memo line', resolve: (c) => trimOrNull(c.check_memo_default) },
];

const ACH_CANONICAL: CanonicalRow[] = [
  { key: 'ach_bank_name', label: 'Bank', resolve: (c) => trimOrNull(c.ach_bank_name) },
  { key: 'ach_account_name', label: 'Account name', resolve: (c) => trimOrNull(c.ach_account_name) },
  { key: 'ach_account_type', label: 'Account type', resolve: (c) => trimOrNull(c.ach_account_type) },
  { key: 'ach_routing_number', label: 'Routing (ABA)', monospace: true, resolve: (c) => trimOrNull(c.ach_routing_number) },
  { key: 'ach_account_number', label: 'Account number', monospace: true, resolve: (c) => trimOrNull(c.ach_account_number) },
  { key: 'wire_swift_bic', label: 'SWIFT / BIC (wire)', monospace: true, resolve: (c) => trimOrNull(c.wire_swift_bic) },
];

function cashCanonical(extra: { receipt_number: string; amount: string }): CanonicalRow[] {
  return [
    { key: 'receipt_number', label: 'Receipt #', resolve: () => extra.receipt_number },
    { key: 'amount', label: 'Amount', resolve: () => extra.amount },
  ];
}

function cardCanonical(extra: { donate_url: string; amount: string | null }): CanonicalRow[] {
  return [
    {
      key: 'donate_url',
      label: 'Give by card',
      resolve: () => `<a href="${escapeHtml(extra.donate_url)}">${escapeHtml(extra.donate_url)}</a>`,
    },
    ...(extra.amount ? [{ key: 'amount', label: 'Amount', resolve: () => extra.amount! }] : []),
  ];
}

// Returns the canonical row keys for a method in display order. Used by the
// admin's "Reset to default" button so it can re-build the data_block from
// the canonical defaults.
export function canonicalRowsFor(method: DonationMethod): Array<{ key: string; label: string }> {
  switch (method) {
    case 'check':
      return CHECK_CANONICAL.map((r) => ({ key: r.key, label: r.label }));
    case 'ach':
      return ACH_CANONICAL.map((r) => ({ key: r.key, label: r.label }));
    case 'cash':
      return cashCanonical({ receipt_number: '', amount: '' }).map((r) => ({ key: r.key, label: r.label }));
    case 'card':
      return cardCanonical({ donate_url: '', amount: '' }).map((r) => ({ key: r.key, label: r.label }));
  }
}

export function renderDataBlock(args: {
  method: DonationMethod;
  charity: CharityLike;
  config: DataBlockConfig | null | undefined;
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
        return cashCanonical(args.cashExtra ?? { receipt_number: '', amount: '' });
      case 'card':
        return cardCanonical(args.cardExtra ?? { donate_url: '', amount: null });
    }
  })();
  const byKey = new Map<string, CanonicalRow>();
  for (const r of canonical) byKey.set(r.key, r);

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
        const label = row.label?.trim() || c.label;
        const valueHtml =
          row.key === 'check_mail_to' || row.key === 'donate_url' ? value : escapeHtml(value);
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
  working = substituteTemplate(working, vars);
  let rendered = markdownToEmailHtml(working);
  for (const [sentinel, html] of sentinelToHtml.entries()) {
    rendered = rendered.replace(
      new RegExp(`<p style="[^"]*">\\s*${sentinel}\\s*</p>`, 'g'),
      html,
    );
    rendered = rendered.split(sentinel).join(html);
  }
  return rendered;
}

export interface AssembleArgs {
  subjectTemplate: string | null | undefined;
  bodyTemplateMd: string | null | undefined;
  fallbackSubject: string;
  fallbackBodyHtml: string;
  vars: Record<string, string>;
}

export interface AssembledEmail {
  subject: string;
  html: string;
}

export function assembleEmail(args: AssembleArgs): AssembledEmail {
  const vars = { ...args.vars, footer: CHARITYTOOLING_FOOTER_HTML };
  const subject = args.subjectTemplate?.trim()
    ? substituteTemplate(args.subjectTemplate.trim(), vars)
    : args.fallbackSubject;
  const bodyHtml = args.bodyTemplateMd?.trim()
    ? renderBodyTemplate(args.bodyTemplateMd, vars)
    : args.fallbackBodyHtml;
  const adminPlacedFooter =
    !!args.bodyTemplateMd?.trim() && /\{\{\s*footer\s*\}\}/.test(args.bodyTemplateMd);
  const html = adminPlacedFooter ? bodyHtml : `${bodyHtml}\n${CHARITYTOOLING_FOOTER_HTML}`;
  return { subject, html };
}
