import { supabase } from './supabase';

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) throw error;
  return data as T;
}

export type JoinCheck =
  | { ok: true; charity_name: string; role: 'admin' | 'rep'; kind: 'invite' | 'join'; email_bound: boolean }
  | { ok: false; reason: string };
export type JoinResult =
  | { ok: true; existing: boolean; charity_name: string; role: 'admin' | 'rep' }
  | { ok: false; reason: string };

export const edgeFunctions = {
  inviteUser(args: { email: string; charity_id: string; role: 'admin' | 'rep' }) {
    return invoke<{ ok: true; code: string | null } | { error: string }>('invite-user', args);
  },
  checkCode(args: { code: string }) {
    return invoke<JoinCheck>('join-with-code', { action: 'check', code: args.code });
  },
  joinWithCode(args: { code: string; email: string }) {
    return invoke<JoinResult>('join-with-code', { action: 'join', code: args.code, email: args.email });
  },
  adminReset(args: { user_id: string; charity_id?: string; method: 'magic_link' | 'temp_password' | 'suspend' | 'unsuspend' }) {
    return invoke<{ ok: true; link?: string | null; expires_minutes?: number; password?: string } | { error: string }>('admin-reset', args);
  },
  sendEmail(args: {
    customer_id: string;
    charity_id: string;
    subject: string;
    body_html: string;
    template_id?: string;
    contact_id?: string;
  }) {
    return invoke<{ ok: true; resend_id: string | null }>('send-email', args);
  },
  sendReceipt(args: {
    donation_id?: string;
    charity_id: string;
    customer_id: string;
    amount_cents: number;
    method: 'check' | 'cash' | 'card' | 'ach' | 'stock' | 'other';
    received_date: string;
    reference?: string;
    notes?: string;
  }) {
    return invoke<{ ok: true; donation_id: string; receipt_number: string }>('send-receipt', args);
  },
  activityDigestTest(args: { recipient_id: string }) {
    return invoke<{ ok: true; skipped: boolean; resend_id?: string | null }>('activity-digest', {
      test: true,
      recipient_id: args.recipient_id,
    });
  },
  sendPush(args: {
    user_ids?: string[];
    charity_id?: string;
    pref_key?: 'followups_due' | 'update_queue_weekly' | 'new_donation' | 'invited_to_charity';
    title: string;
    body: string;
    url?: string;
  }) {
    return invoke<{ ok: true; delivered: number; removed: number }>('send-push', args);
  },
  stripeConnect(args: { action: 'start' | 'callback'; charity_id: string; code?: string }) {
    return invoke<{ url?: string; ok?: true; account_id?: string; charges_enabled?: boolean }>(
      `stripe-connect?action=${args.action}`,
      { charity_id: args.charity_id, code: args.code },
    );
  },
  stripeCheckout(args: { charity_id: string; customer_id: string; amount_cents?: number }) {
    return invoke<{ url: string }>(`stripe-connect?action=checkout`, args);
  },
  stripeInvoice(args: {
    charity_id: string;
    customer_id: string;
    amount_cents: number;
    description?: string;
    send?: boolean;
  }) {
    return invoke<{ ok: true; url: string | null; invoice_id: string; stripe_customer_id: string }>(
      `stripe-connect?action=invoice`,
      args,
    );
  },
  stripeSubscriptionCheckout(args: {
    charity_id: string;
    customer_id: string;
    amount_cents: number;
    interval?: 'month' | 'year' | 'week';
  }) {
    return invoke<{ url: string }>(`stripe-connect?action=subscription_checkout`, args);
  },
  sendPaymentInstructions(args: {
    charity_id: string;
    customer_id: string;
    contact_id?: string;
    method: 'check' | 'ach';
    rep_message_md?: string;
  }) {
    return invoke<{ ok: true; resend_id: string | null }>('send-payment-instructions', args);
  },
  sendCardInstructions(args: {
    charity_id: string;
    customer_id: string;
    contact_id?: string;
    amount_cents: number;
    mode: 'invoice' | 'subscription';
    rep_message_md?: string;
    description?: string;
    currency?: string;
    interval?: 'month' | 'year' | 'week';
  }) {
    return invoke<{
      ok: true;
      resend_id: string | null;
      donate_url: string;
      stripe_ref: { kind: 'invoice' | 'session'; id: string } | null;
    }>('send-card-instructions', args);
  },
};
