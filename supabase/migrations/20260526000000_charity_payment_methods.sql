-- Charity-level payment instructions used by the contact-page Donation modal
-- when a rep picks "Help donor send" instead of "Record received". Bank-detail
-- columns piggy-back on the existing `charities` RLS (member-gated select), so
-- no extra policy work is needed -- non-members can already not see this row.
--
-- The Stripe one-time / recurring flows added in this same change-set live
-- entirely in the `stripe-connect` Edge Function and don't need new columns
-- besides the two card-config fields below.

alter table public.charities
  add column if not exists check_payable_to        text,
  add column if not exists check_mail_to_line1     text,
  add column if not exists check_mail_to_line2     text,
  add column if not exists check_mail_to_city      text,
  add column if not exists check_mail_to_state     text,
  add column if not exists check_mail_to_postal_code text,
  add column if not exists check_memo_default      text,
  add column if not exists check_instructions_md   text,

  add column if not exists ach_bank_name           text,
  add column if not exists ach_account_name        text,
  add column if not exists ach_account_type        text,
  add column if not exists ach_routing_number      text,
  add column if not exists ach_account_number      text,
  add column if not exists wire_swift_bic          text,
  add column if not exists wire_intermediary_md    text,
  add column if not exists ach_instructions_md     text,

  add column if not exists card_default_amount_cents bigint,
  add column if not exists card_recurring_enabled  boolean not null default false;

-- Enforce the small set of valid ACH account types. Use a do-block so the
-- migration is idempotent if re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'charities_ach_account_type_check'
  ) then
    alter table public.charities
      add constraint charities_ach_account_type_check
      check (ach_account_type is null or ach_account_type in ('checking','savings'));
  end if;
end $$;
