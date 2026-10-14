# Two apps, one Supabase project

CharityTooling (charitytooling.com) and CostTooling (costtooling.com) share
the Supabase project `cjwybuhogxyayjnuxpem` ("charity-tooling"). They share
sign-in, user profiles, the account Edge Functions and the email sender. Each
app keeps its own data in its own tables with its own row-level security.
This repo owns the database: every migration and every Edge Function lives
here, even the CostTooling ones. The CostTooling front end lives in
`clickconstruction/costtooling.github.io` and only talks to this project.

This page explains what is shared, what is per app, and the checklist for
adding a third app.

## What is shared

| Piece | Where | Notes |
| --- | --- | --- |
| Auth users and `public.profiles` | `supabase/migrations/20260522000000_init.sql` | One account works in every app. A CharityTooling user can be added to a CostTooling company without a second sign-up. |
| `private.is_super_admin()` | init migration | Super admin is global: it bypasses tenant checks in every app. |
| `audit_log`, `code_attempts`, `code_attempt_allowed()` | accounts migration | Rate limiting for code lookups is per IP, shared across apps. |
| `private.handle_new_user()` trigger | ct tenancy migration (latest version) | Fires on every new auth user. Creates the profile, then turns email-bound invitations into memberships for **each** app's invitations table. |
| `private.handle_user_signed_in()` trigger | ct tenancy migration (latest version) | On first sign-in, marks memberships and invitations accepted for **each** app. |
| `private.generate_code` family | per app, same shape | Codes look like `ABCD-1234`; the first four letters come from the tenant name. `private.normalize_code()` accepts them with or without the hyphen. |
| Edge Functions `invite-user`, `join-with-code`, `admin-reset` | `supabase/functions/` | One function serves every app. The request body carries `app: 'charity' \| 'ct'`; missing means `charity`. |
| `APPS` table | `supabase/functions/_shared/supabase.ts` | The single place that maps an app key to its tables, RPC names, roles, base URL and welcome route. Adding an app is mostly adding an entry here. |
| CORS allow list | `supabase/functions/_shared/cors.ts` | Every app origin, plus local dev origins. |
| `auth-email` Edge Function | `supabase/functions/auth-email/` | Supabase's Send Email hook. Replaces the stock mailer for every sign-in email. Picks the brand from the link's host and sends through Resend. |
| Resend | Resend dashboard | One API key (`RESEND_API_KEY` function secret). Each app's sending domain must be verified there or the mailer falls back to a charitytooling.com sender. |
| Auth settings | Supabase dashboard, Authentication | Redirect URL allow list, Site URL, the Send Email hook, password rules. Site URL stays charitytooling.com; other apps are reached through the allow list. |

## What is per app

| Piece | CharityTooling | CostTooling |
| --- | --- | --- |
| Tenant | `charities` | `ct_companies` |
| Membership | `charity_members` (roles `admin`, `rep`) | `ct_company_members` (roles `admin`, `member`) |
| Invitations and join codes | `invitations`, `join_codes` | `ct_invitations`, `ct_join_codes` |
| RLS helpers | `private.is_member_of`, `private.is_admin_of` | `private.ct_is_member_of`, `private.ct_is_admin_of` |
| Code RPCs | `create_invite_code`, `rotate_join_code`, `lookup_code`, `consume_code`, `new_invite_code`, `list_charity_members` | same names with a `ct_` prefix, plus `ct_create_company` |
| App data | customers, donations, notes, and so on | `ct_projects` (one JSON row per project) and the private `ct-photos` bucket, folders named by company id |
| Welcome route after an invite | `/#/welcome` | `/?auth=welcome` |
| Email brand | CharityTooling, hello@charitytooling.com | CostTooling, hello@costtooling.com |
| User guide | (in app) | https://costtooling.com/guide/ |

Rules that keep this safe:

- A table prefix per app (`ct_` for CostTooling). Never reuse a shared table for app data.
- Every app table has RLS on and policies written in terms of that app's helpers. Service-role functions are the only thing that reads across apps.
- Tenant ids are UUIDs and never appear in URLs the other app could guess.
- The `app` value in function bodies is validated with `appOf()`; anything unknown becomes `charity`, which has the strictest checks.

## Adding a third app

Say the new app is TakeoffTooling at takeofftooling.com with prefix `tt_`.

1. **Migration.** Copy `supabase/migrations/20261013010000_costtooling_tenancy.sql`
   and rename every `ct_` to `tt_` and every "company" to the new tenant word.
   Keep: tenant, members, invitations, join codes, RLS helpers, the code RPCs,
   the storage bucket if the app stores files. Extend `private.handle_new_user()`
   and `private.handle_user_signed_in()` with one more block each for the new
   invitations and members tables (the migration redefines both functions, so
   include the existing charity and ct blocks). Apply with the Supabase MCP
   `apply_migration` or `supabase db push`.
2. **`APPS` entry** in `supabase/functions/_shared/supabase.ts`: tables, RPC
   names, roles, `tenants`, `base`, `originRe`, and `welcome()`. Add the key to
   `AppKey` and teach `appOf()` about it.
3. **CORS**: add the origins to `ALLOWED_ORIGINS` in `_shared/cors.ts`.
4. **Email brand**: add a `BRANDS` entry in `supabase/functions/auth-email/index.ts`
   and extend `appFor()` to recognise the new host. Set `fallbackFrom` to a
   charitytooling.com address so mail still goes out before the domain is verified.
5. **Deploy** every function, since they share `_shared`:
   `supabase functions deploy --project-ref cjwybuhogxyayjnuxpem`.
6. **Auth settings** (dashboard or management API): add
   `https://takeofftooling.com/**` and `https://www.takeofftooling.com/**` to
   Redirect URLs. Without this, invite and reset links land on charitytooling.com.
7. **Resend**: add takeofftooling.com as a domain, put its DNS records in
   Cloudflare, wait for "Verified". Until then the fallback sender is used.
8. **Front end**: use the project URL and the publishable key (`sb_publishable_…`,
   never the service role key). Call functions with `{ app: 'tt', ... }`. Handle
   `?auth=welcome` / `?auth=reset` (or your own routes) to show the set-password
   screen, as `js/cloud.js` does in the CostTooling repo.
9. **Test user and end-to-end run**: create a test user with a non-example.com
   address (Resend refuses `example.com` recipients). Copy
   `qa/cloud-e2e.js` from the CostTooling repo as a starting point.
10. **Clean-up habits**: delete test tenants with SQL (memberships, invitations,
    codes and data cascade from the tenant row) but delete storage objects
    through the Storage API; direct deletes on `storage.objects` are blocked.

## Operating notes

- Function secrets: `supabase secrets list --project-ref cjwybuhogxyayjnuxpem`
  shows names and digests only. `SEND_EMAIL_HOOK_SECRET` must equal the
  project's `hook_send_email_secrets` value; rotate both together.
- The auth hook must answer within a few seconds or Supabase reports the
  email as failed to the caller. Keep `auth-email` free of slow lookups.
- Logs: `auth_logs` shows invites, logins and recovery requests per user;
  `function_logs` shows mailer failures with Resend's message.
- A user who belongs to both apps gets the email brand of whichever link they
  asked for, because the brand follows `redirect_to`, not the user.
- Admin resets (`admin-reset`) never email: they return a link or a temporary
  password for the admin to read out. That is the fallback when email fails.
