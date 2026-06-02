# CharityTooling

Phone-first PWA for charity reps to research, contact, and follow up with donors.

- Static SPA hosted on GitHub Pages at `https://charitytooling.com`
- Auth, data, edge functions, and storage on a single Supabase project
- Resend for transactional email and donation receipts
- Web Push (VAPID) for iOS/Android home-screen PWA notifications
- Stripe Connect (later phase) for card donations

## Tech stack

- React 18 + Vite + TypeScript
- Tailwind CSS, HashRouter (avoids SPA rewrite tricks on GitHub Pages)
- `@tanstack/react-query`, `react-hook-form` + `zod`
- `@supabase/supabase-js`
- `vite-plugin-pwa` with a custom service worker (`src/sw.ts`)
- Edge Functions written in TypeScript on Deno

## Repo layout

```
src/                  # React app
  auth/               # AuthProvider, RequireAuth, magic-link sign-in
  components/         # Layout, BottomNav, TopBar, CharitySwitcher
  lib/                # Supabase client + DB types
  routes/             # Update, Contact, Ledger, Admin
  state/              # Lightweight client state hooks
  sw.ts               # Custom service worker (precache + push handlers)
supabase/
  migrations/         # Versioned SQL (single 0001_init.sql to start)
  functions/          # Edge Function stubs (one folder per function)
public/
  CNAME               # charitytooling.com
  icon.svg            # Source icon (SVG)
.github/workflows/    # Pages deploy
```

## Local development

```bash
cp .env.example .env.local        # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

For a local Supabase stack (Phase 1+):

```bash
npm i -g supabase                  # or use brew install supabase/tap/supabase
supabase start                     # spins up local Postgres, Auth, Storage, Functions
supabase db reset                  # applies supabase/migrations/*.sql
supabase functions serve           # serves Edge Functions on :54321
```

## One-time setup

These steps are manual and must be performed by a human with the right credentials.
Numbered roughly in the order you'll need them.

### 1. Supabase project

1. Create a project at https://app.supabase.com (free tier is fine to start).
2. Note the **Project URL** and **anon/publishable key** for client-side use.
3. Note the **service-role key** - it will be set as an Edge Function secret only.
4. In **Auth -> Providers**: ensure **Email** is enabled and **Confirm email** is on.
5. In **Auth -> Settings**: **disable "Allow new users to sign up"**. The app is invite-only; new users only enter via the `invite-user` Edge Function.
6. In **Auth -> URL configuration**: add `https://charitytooling.com` and `http://localhost:5173` to **Site URL** and **Redirect URLs**.

### 2. Apply the database schema

```bash
supabase link --project-ref <your-ref>
supabase db push                   # applies supabase/migrations/0001_init.sql
```

After the migration runs, set the bootstrap email used by `handle_new_user`:

```sql
alter database postgres set app.bootstrap_admin_email = 'robert@douglasmining.com';
```

(The trigger also has `'robert@douglasmining.com'` hard-coded as a fallback, so this step is optional if you don't change the email.)

The first time `robert@douglasmining.com` signs in via magic link, that account is automatically promoted to `is_super_admin = true`. All other accounts are normal users.

### 3. Custom domain (charitytooling.com)

1. In the GitHub repo: **Settings -> Pages -> Custom domain** = `charitytooling.com`. Enforce HTTPS.
2. At your DNS provider, add these records:
   - `A` `@` -> `185.199.108.153`
   - `A` `@` -> `185.199.109.153`
   - `A` `@` -> `185.199.110.153`
   - `A` `@` -> `185.199.111.153`
   - `AAAA` `@` -> `2606:50c0:8000::153`
   - `AAAA` `@` -> `2606:50c0:8001::153`
   - `AAAA` `@` -> `2606:50c0:8002::153`
   - `AAAA` `@` -> `2606:50c0:8003::153`
3. `public/CNAME` already contains `charitytooling.com` so it ships in the build artifact.

### 4. Resend (transactional email)

1. Create a Resend account and add `charitytooling.com` (or a subdomain like `mail.charitytooling.com`) as a sending domain.
2. Add the SPF, DKIM, and DMARC DNS records Resend gives you, and click "Verify".
3. Create an API key. Store it as a Supabase function secret (see step 6).

### 5. GitHub Actions secrets

Repo **Settings -> Secrets and variables -> Actions**:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL from step 1 |
| `VITE_SUPABASE_ANON_KEY` | Anon/publishable key from step 1 |
| `VITE_VAPID_PUBLIC_KEY` | Generated in Phase 7 (leave empty until then) |

### 6. Supabase Edge Function secrets

```bash
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set RESEND_FROM_DOMAIN=charitytooling.com
# Phase 7
supabase secrets set VAPID_PUBLIC_KEY=...
supabase secrets set VAPID_PRIVATE_KEY=...
supabase secrets set VAPID_SUBJECT=mailto:robert@douglasmining.com
# Phase 8
supabase secrets set STRIPE_SECRET_KEY=sk_...
supabase secrets set STRIPE_CLIENT_ID=ca_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

### 7. Deploy the Edge Functions

```bash
supabase functions deploy invite-user
supabase functions deploy send-email
supabase functions deploy send-receipt
supabase functions deploy send-push
supabase functions deploy activity-digest   # super-admin activity digests (hourly cron + test send)
supabase functions deploy stripe-connect
supabase functions deploy stripe-webhook --no-verify-jwt   # public webhook
```

### 8. Generate VAPID keys (Phase 7)

```bash
npx web-push generate-vapid-keys
```

Put the public key in `VITE_VAPID_PUBLIC_KEY` (GitHub Actions secret) and the private key in `VAPID_PRIVATE_KEY` (Supabase function secret). Set `VAPID_SUBJECT` to a `mailto:` URL you own.

## Build phases

| # | Status | Description |
| --- | --- | --- |
| 0 | done | Vite/React/Tailwind scaffold, PWA, GH Pages deploy |
| 1 | done | Auth, schema, RLS, super-admin bootstrap, Edge Function stubs |
| 2 | done | Admin console: charities, members, invitations |
| 3 | done | Ledger: list, search, manual add, CSV import |
| 4 | done | Contact: detail, notes, follow-ups, send-email |
| 5 | done | Update queue: completeness, autosave |
| 6 | done | Donations + receipts (PDF, Resend) |
| 7 | done | iOS install, Web Push, pg_cron digests |
| 8 | done | Stripe Connect |
| 9 | done | App session tracking + super-admin activity digest emails (Resend, pg_cron) |

## License

Private / unlicensed.
