-- Per-method donation email templates. Each of the four donation methods
-- (Check, Cash, Card, ACH/Wire) can override the canonical subject line and
-- the canonical body Markdown, plus customise the structured "data block"
-- that is rendered into the email (rename labels, reorder rows, omit rows,
-- inject custom rows). When all three columns are null for a method, the
-- existing hard-coded canonical render is used unchanged -- this migration
-- is fully backwards-compatible.
--
-- The data_block columns store JSON shaped like:
--   {
--     "rows": [
--       { "key": "check_payable_to", "label": "Make checks payable to" },
--       { "key": "check_mail_to",                                       },
--       { "custom": true, "label": "Notes",
--         "value": "Please write the donor's name on the back."         }
--     ]
--   }
-- Rows with `key` reference a known charity column (or a logical group
-- like `check_mail_to`); rows with `custom: true` carry a literal label and
-- value. An optional `omit: true` flag drops the row from the output.
--
-- Server templates that read these columns:
--   - supabase/functions/send-payment-instructions/index.ts (check, ach)
--   - supabase/functions/_shared/receipt.ts                  (cash receipt)
--   - supabase/functions/send-card-instructions/index.ts    (card)
-- Keep the in-card preview at
-- src/routes/admin/DonationInstructionsCard.tsx in lockstep with those
-- renderers so admins see exactly what donors will receive.

alter table public.charities
  add column if not exists check_subject_template text,
  add column if not exists check_body_template_md text,
  add column if not exists check_data_block       jsonb,

  add column if not exists cash_subject_template  text,
  add column if not exists cash_body_template_md  text,
  add column if not exists cash_data_block        jsonb,

  add column if not exists card_subject_template  text,
  add column if not exists card_body_template_md  text,
  add column if not exists card_data_block        jsonb,

  add column if not exists ach_subject_template   text,
  add column if not exists ach_body_template_md   text,
  add column if not exists ach_data_block         jsonb;
