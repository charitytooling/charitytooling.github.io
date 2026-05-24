// Footer appended to outbound CharityTooling emails. Inline-styled with no
// images so it renders reliably in Gmail, Apple Mail, and Outlook web. Kept
// here so `send-email`, `send-receipt`, and `send-payment-instructions` all
// stay in sync.

export const CHARITYTOOLING_FOOTER_HTML = `
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px" />
  <p style="font-size:12px;color:#64748b;line-height:1.5;margin:0">
    Sent via <a href="https://charitytooling.com" style="color:#2563eb;text-decoration:none">CharityTooling</a> -
    we only work with charities that spend 95%+ of revenue on charitable programs,
    verified against their IRS Form 990.
    <a href="https://charitytooling.com" style="color:#2563eb;text-decoration:none">Learn how we verify.</a>
  </p>
`;
