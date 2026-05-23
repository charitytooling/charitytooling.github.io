import { supabase } from './supabase';

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) throw error;
  return data as T;
}

export const edgeFunctions = {
  inviteUser(args: { email: string; charity_id: string; role: 'admin' | 'rep' }) {
    return invoke<{ ok: true } | { error: string }>('invite-user', args);
  },
  sendEmail(args: {
    customer_id: string;
    charity_id: string;
    subject: string;
    body_html: string;
    template_id?: string;
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
};
