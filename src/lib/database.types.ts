// Hand-maintained mirror of the Supabase schema. Regenerate with
// `supabase gen types typescript --linked > src/lib/database.types.ts`
// once the project is linked.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
          is_super_admin: boolean;
          contact_queue_sort:
            | 'stalest_first'
            | 'followup_due_soonest'
            | 'name_az'
            | 'newest_added'
            | 'random';
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      charities: {
        Row: {
          id: string;
          name: string;
          slug: string | null;
          ein: string | null;
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          country: string | null;
          default_tz: string;
          resend_from_email: string | null;
          resend_from_name: string | null;
          receipt_signatory_name: string | null;
          receipt_disclaimer: string | null;
          stripe_account_id: string | null;
          stripe_charges_enabled: boolean;
          check_payable_to: string | null;
          check_mail_to_line1: string | null;
          check_mail_to_line2: string | null;
          check_mail_to_city: string | null;
          check_mail_to_state: string | null;
          check_mail_to_postal_code: string | null;
          check_memo_default: string | null;
          check_instructions_md: string | null;
          ach_bank_name: string | null;
          ach_account_name: string | null;
          ach_account_type: 'checking' | 'savings' | null;
          ach_routing_number: string | null;
          ach_account_number: string | null;
          wire_swift_bic: string | null;
          wire_intermediary_md: string | null;
          ach_instructions_md: string | null;
          card_default_amount_cents: number | null;
          card_recurring_enabled: boolean;
          check_subject_template: string | null;
          check_body_template_md: string | null;
          check_data_block: Json | null;
          cash_subject_template: string | null;
          cash_body_template_md: string | null;
          cash_data_block: Json | null;
          card_subject_template: string | null;
          card_body_template_md: string | null;
          card_data_block: Json | null;
          ach_subject_template: string | null;
          ach_body_template_md: string | null;
          ach_data_block: Json | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['charities']['Row']> & { name: string };
        Update: Partial<Database['public']['Tables']['charities']['Row']>;
        Relationships: [];
      };
      charity_members: {
        Row: {
          charity_id: string;
          user_id: string;
          role: 'admin' | 'rep';
          invited_by: string | null;
          invited_at: string | null;
          accepted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['charity_members']['Row']> & {
          charity_id: string;
          user_id: string;
          role: 'admin' | 'rep';
        };
        Update: Partial<Database['public']['Tables']['charity_members']['Row']>;
        Relationships: [];
      };
      invitations: {
        Row: {
          id: string;
          email: string;
          charity_id: string;
          role: 'admin' | 'rep';
          token: string;
          invited_by: string;
          expires_at: string;
          accepted_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['invitations']['Row']> & {
          email: string;
          charity_id: string;
          role: 'admin' | 'rep';
          token: string;
          invited_by: string;
        };
        Update: Partial<Database['public']['Tables']['invitations']['Row']>;
        Relationships: [];
      };
      customers: {
        Row: {
          id: string;
          charity_id: string;
          display_name: string | null;
          website: string | null;
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          country: string | null;
          preferred_contact_method: 'email' | 'phone' | 'mail' | null;
          last_contacted_at: string | null;
          giving_total_cents: number;
          tags: string[];
          notes_summary: string | null;
          completeness_score: number;
          ein: string | null;
          filing_revenue: number | null;
          filing_income: number | null;
          filing_assets: number | null;
          filing_tax_period: string | null;
          archived_at: string | null;
          archived_by: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['customers']['Row']> & { charity_id: string };
        Update: Partial<Database['public']['Tables']['customers']['Row']>;
        Relationships: [];
      };
      customer_contacts: {
        Row: {
          id: string;
          customer_id: string;
          charity_id: string;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          phone: string | null;
          note: string | null;
          is_primary: boolean;
          sort_order: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['customer_contacts']['Row']> & {
          customer_id: string;
        };
        Update: Partial<Database['public']['Tables']['customer_contacts']['Row']>;
        Relationships: [];
      };
      customer_field_defs: {
        Row: {
          id: string;
          charity_id: string;
          label: string;
          kind: 'text' | 'url' | 'email' | 'tel' | 'number' | 'money';
          sort_order: number;
          archived_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['customer_field_defs']['Row']> & {
          charity_id: string;
          label: string;
          kind: 'text' | 'url' | 'email' | 'tel' | 'number' | 'money';
        };
        Update: Partial<Database['public']['Tables']['customer_field_defs']['Row']>;
        Relationships: [];
      };
      customer_field_values: {
        Row: {
          id: string;
          customer_id: string;
          charity_id: string;
          field_def_id: string;
          value: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['customer_field_values']['Row']> & {
          customer_id: string;
          field_def_id: string;
        };
        Update: Partial<Database['public']['Tables']['customer_field_values']['Row']>;
        Relationships: [];
      };
      notes: {
        Row: {
          id: string;
          customer_id: string;
          charity_id: string;
          kind: 'call' | 'email' | 'meeting' | 'research' | 'other';
          body: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['notes']['Row']> & {
          customer_id: string;
          charity_id: string;
          kind: 'call' | 'email' | 'meeting' | 'research' | 'other';
          body: string;
        };
        Update: Partial<Database['public']['Tables']['notes']['Row']>;
        Relationships: [];
      };
      follow_ups: {
        Row: {
          id: string;
          customer_id: string;
          charity_id: string;
          due_date: string;
          status: 'open' | 'done' | 'snoozed';
          reason: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['follow_ups']['Row']> & {
          customer_id: string;
          charity_id: string;
          due_date: string;
        };
        Update: Partial<Database['public']['Tables']['follow_ups']['Row']>;
        Relationships: [];
      };
      email_templates: {
        Row: {
          id: string;
          charity_id: string;
          kind: 'thank_you' | 'donation_receipt' | 'follow_up' | 'intro' | 'custom';
          name: string;
          subject: string;
          body_md: string;
          is_default: boolean;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['email_templates']['Row']> & {
          charity_id: string;
          kind: 'thank_you' | 'donation_receipt' | 'follow_up' | 'intro' | 'custom';
          name: string;
          subject: string;
          body_md: string;
        };
        Update: Partial<Database['public']['Tables']['email_templates']['Row']>;
        Relationships: [];
      };
      email_log: {
        Row: {
          id: string;
          customer_id: string | null;
          charity_id: string;
          template_id: string | null;
          subject: string;
          body_html: string | null;
          to_email: string;
          resend_id: string | null;
          status: string | null;
          sent_by: string | null;
          sent_at: string;
        };
        Insert: Partial<Database['public']['Tables']['email_log']['Row']> & {
          charity_id: string;
          subject: string;
          to_email: string;
        };
        Update: Partial<Database['public']['Tables']['email_log']['Row']>;
        Relationships: [];
      };
      donations: {
        Row: {
          id: string;
          charity_id: string;
          customer_id: string;
          amount_cents: number;
          currency: string;
          method: 'check' | 'cash' | 'card' | 'ach' | 'stock' | 'other';
          received_date: string;
          reference: string | null;
          notes: string | null;
          receipt_number: string | null;
          receipt_storage_path: string | null;
          receipt_sent_at: string | null;
          stripe_payment_intent_id: string | null;
          edited_at: string | null;
          edited_by: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['donations']['Row']> & {
          charity_id: string;
          customer_id: string;
          amount_cents: number;
          method: 'check' | 'cash' | 'card' | 'ach' | 'stock' | 'other';
          received_date: string;
        };
        Update: Partial<Database['public']['Tables']['donations']['Row']>;
        Relationships: [];
      };
      customer_visits: {
        Row: {
          id: string;
          customer_id: string;
          charity_id: string;
          user_id: string;
          started_at: string;
          ended_at: string;
          duration_seconds: number;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['customer_visits']['Row']> & {
          customer_id: string;
          charity_id: string;
          user_id: string;
          started_at: string;
          ended_at: string;
          duration_seconds: number;
        };
        Update: Partial<Database['public']['Tables']['customer_visits']['Row']>;
        Relationships: [];
      };
      call_script_items: {
        Row: {
          id: string;
          charity_id: string;
          body: string;
          sort_order: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['call_script_items']['Row']> & {
          charity_id: string;
          body: string;
        };
        Update: Partial<Database['public']['Tables']['call_script_items']['Row']>;
        Relationships: [];
      };
      call_script_ticks: {
        Row: {
          customer_id: string;
          item_id: string;
          charity_id: string;
          ticked_by: string | null;
          ticked_at: string;
        };
        Insert: Partial<Database['public']['Tables']['call_script_ticks']['Row']> & {
          customer_id: string;
          item_id: string;
        };
        Update: Partial<Database['public']['Tables']['call_script_ticks']['Row']>;
        Relationships: [];
      };
      faq_entries: {
        Row: {
          id: string;
          charity_id: string;
          question: string;
          answer: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['faq_entries']['Row']> & {
          charity_id: string;
          question: string;
          answer: string;
        };
        Update: Partial<Database['public']['Tables']['faq_entries']['Row']>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['push_subscriptions']['Row']> & {
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
        };
        Update: Partial<Database['public']['Tables']['push_subscriptions']['Row']>;
        Relationships: [];
      };
      notification_preferences: {
        Row: {
          user_id: string;
          followups_due: boolean;
          update_queue_weekly: boolean;
          new_donation: boolean;
          invited_to_charity: boolean;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['notification_preferences']['Row']> & {
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['notification_preferences']['Row']>;
        Relationships: [];
      };
      stripe_events: {
        Row: {
          id: string;
          type: string | null;
          received_at: string;
          payload: Json | null;
        };
        Insert: Partial<Database['public']['Tables']['stripe_events']['Row']> & { id: string };
        Update: Partial<Database['public']['Tables']['stripe_events']['Row']>;
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: number;
          actor_id: string | null;
          charity_id: string | null;
          entity_type: string;
          entity_id: string;
          action: 'insert' | 'update' | 'delete';
          diff: Json | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['audit_log']['Row']> & {
          entity_type: string;
          entity_id: string;
          action: 'insert' | 'update' | 'delete';
        };
        Update: Partial<Database['public']['Tables']['audit_log']['Row']>;
        Relationships: [];
      };
      app_sessions: {
        Row: {
          id: string;
          user_id: string;
          started_at: string;
          last_seen_at: string;
          ended_at: string | null;
          duration_seconds: number;
          user_agent: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['app_sessions']['Row']> & {
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['app_sessions']['Row']>;
        Relationships: [];
      };
      activity_digest_recipients: {
        Row: {
          id: string;
          user_id: string;
          send_daily: boolean;
          send_weekly: boolean;
          scope: 'all' | 'specific';
          charity_ids: string[];
          enabled: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['activity_digest_recipients']['Row']> & {
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['activity_digest_recipients']['Row']>;
        Relationships: [];
      };
      activity_digest_log: {
        Row: {
          id: string;
          recipient_user_id: string | null;
          to_email: string;
          frequency: 'daily' | 'weekly';
          period_key: string;
          resend_id: string | null;
          status: string | null;
          detail: Json | null;
          sent_at: string;
        };
        Insert: Partial<Database['public']['Tables']['activity_digest_log']['Row']> & {
          to_email: string;
          frequency: 'daily' | 'weekly';
          period_key: string;
        };
        Update: Partial<Database['public']['Tables']['activity_digest_log']['Row']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      list_charity_members: {
        Args: { c_id: string };
        Returns: Array<{
          user_id: string;
          email: string | null;
          full_name: string | null;
          role: 'admin' | 'rep';
          invited_at: string | null;
          accepted_at: string | null;
        }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
