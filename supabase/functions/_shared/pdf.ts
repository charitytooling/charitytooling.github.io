// Minimal donation-receipt PDF generator.
//
// We avoid pulling in @react-pdf/renderer (which has heavy deps in Deno) and
// instead emit a hand-rolled PDF with a single Helvetica page. This is enough
// for IRS Pub 1771 compliance which only requires the charity's identifying
// info, donor identifying info, amount, date, method, and a statement that no
// goods or services were exchanged.

interface RenderArgs {
  charity: Record<string, unknown>;
  customer: Record<string, unknown>;
  donation: {
    receipt_number: string;
    amount_cents: number;
    method: string;
    received_date: string;
    reference?: string;
  };
}

export async function renderReceiptPdf(args: RenderArgs): Promise<Uint8Array> {
  const lines = composeLines(args);
  const pdf = buildPdf(lines);
  return new TextEncoder().encode(pdf);
}

function composeLines(args: RenderArgs): { text: string; size: number; bold?: boolean }[] {
  const c = args.charity;
  const d = args.donation;
  const cu = args.customer;
  const amount = (d.amount_cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  const donorName = (cu.display_name as string) ?? `${cu.first_name ?? ''} ${cu.last_name ?? ''}`.trim();
  const donorAddr = [cu.address_line1, cu.city, cu.state, cu.postal_code].filter(Boolean).join(', ');
  const charityAddr = [c.address_line1, c.city, c.state, c.postal_code].filter(Boolean).join(', ');

  return [
    { text: c.name as string, size: 20, bold: true },
    { text: charityAddr, size: 10 },
    { text: c.ein ? `EIN: ${c.ein}` : '', size: 10 },
    { text: '', size: 10 },
    { text: 'Official Donation Receipt', size: 16, bold: true },
    { text: `Receipt #${d.receipt_number}`, size: 12 },
    { text: `Date received: ${d.received_date}`, size: 12 },
    { text: '', size: 10 },
    { text: 'Donor', size: 12, bold: true },
    { text: donorName, size: 12 },
    { text: donorAddr, size: 10 },
    { text: cu.email ? `Email: ${cu.email}` : '', size: 10 },
    { text: '', size: 10 },
    { text: `Amount: ${amount}`, size: 14, bold: true },
    { text: `Method: ${d.method}${d.reference ? ` (${d.reference})` : ''}`, size: 12 },
    { text: '', size: 10 },
    {
      text:
        (c.receipt_disclaimer as string) ??
        'No goods or services were provided in exchange for this contribution.',
      size: 10,
    },
    { text: '', size: 10 },
    { text: c.receipt_signatory_name ? `Acknowledged by ${c.receipt_signatory_name}` : '', size: 10 },
  ].filter((l) => l.text !== '' || true);
}

function buildPdf(lines: { text: string; size: number; bold?: boolean }[]): string {
  // Build a very small single-page PDF using Helvetica.
  // Coordinates are in points (72 per inch). Page is US Letter (612 x 792).
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;

  let y = pageHeight - margin;
  const contentStream: string[] = ['BT'];
  for (const ln of lines) {
    if (!ln.text) {
      y -= ln.size * 0.6;
      continue;
    }
    const font = ln.bold ? '/F2' : '/F1';
    contentStream.push(`${font} ${ln.size} Tf`);
    contentStream.push(`1 0 0 1 ${margin} ${y} Tm`);
    contentStream.push(`(${escapePdf(ln.text)}) Tj`);
    y -= ln.size * 1.4;
  }
  contentStream.push('ET');
  const content = contentStream.join('\n');

  const objects: string[] = [];

  // Object 1: Catalog
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  // Object 2: Pages
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  // Object 3: Page
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
  );
  // Object 4: Helvetica
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  // Object 5: Helvetica-Bold
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  // Object 6: Content stream
  const stream = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objects.push(stream);

  const header = '%PDF-1.4\n';
  const offsets: number[] = [];
  let body = '';
  let cursor = header.length;
  objects.forEach((obj, i) => {
    offsets.push(cursor);
    const entry = `${i + 1} 0 obj\n${obj}\nendobj\n`;
    body += entry;
    cursor += entry.length;
  });
  const xrefOffset = header.length + body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return header + body + xref + trailer;
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
